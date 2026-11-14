import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@/server/db/client";
import type {
  GithubPrInput,
  GithubPrState,
  GithubRepoInput,
  GithubSnapshot,
} from "@/server/services";
import { readSecretFile } from "./secret-file.ts";

const ORG = "HX-Infratstructure";
const API = "https://api.github.com";
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

export type OpenPr = Pick<GithubPrInput, "id" | "repo" | "number">;

export interface SyncStore {
  openPrs(): Promise<OpenPr[]>;
  save(snapshot: GithubSnapshot): Promise<void>;
}

interface Summary {
  repos: number;
  heads: number;
  empty: number;
  open: number;
  merged: number;
  closed: number;
  gone: OpenPr[];
  requests: number;
  ms: number;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubRepo {
  name: string;
  default_branch: string;
  archived: boolean;
}

interface GitHubPull {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  head: { sha: string };
  base: { repo: { name: string; owner: { login: string } } };
  merge_commit_sha: string | null;
  html_url: string;
  merged_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

interface GitHubBranch {
  commit: { sha: string };
}

/** `null` is GitHub's 404, or a redirect out of the org, for a PR that the database still holds. */
function prState(pull: GitHubPull | null): GithubPrState {
  if (pull === null) return "gone";
  return pull.merged_at ? "merged" : pull.state;
}

function toPrRow(repo: string, pull: GitHubPull): GithubPrInput {
  const state = prState(pull);
  return {
    id: pull.id,
    repo,
    number: pull.number,
    title: pull.title,
    state,
    draft: pull.draft,
    headSha: pull.head.sha,
    // Until a PR merges, GitHub fills merge_commit_sha with a throwaway test merge.
    mergeCommitSha: state === "merged" ? pull.merge_commit_sha : null,
    url: pull.html_url,
  };
}

function closedSince(pull: GitHubPull, cutoff: number): boolean {
  const at = pull.merged_at ?? pull.closed_at;
  return at !== null && Date.parse(at) >= cutoff;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

/** A failed fetch's error code, such as ECONNREFUSED on its cause, or else its class name. Never free text. */
function failureKind(error: unknown): string {
  const cause =
    error instanceof Error ? (error.cause as NodeJS.ErrnoException | undefined) : undefined;
  const kind =
    cause?.code ?? (error as NodeJS.ErrnoException | undefined)?.code ?? (error as Error)?.name;
  return typeof kind === "string" && /^\w+$/.test(kind) ? kind : "unknown";
}

function nextUrl(link: string | null): string | undefined {
  return link?.match(/<([^>]*)>;\s*rel="next"/)?.[1];
}

/**
 * The URL to fetch once when `location` names this same PR on api.github.com, by a repository name in the org or by a
 * repository id. GitHub sends the id form for a renamed repository. The URL is rebuilt, so only api.github.com gets it.
 */
function redirectTarget(location: string | null, number: number): string | undefined {
  if (location === null || !URL.canParse(location)) return undefined;
  const url = new URL(location);
  if (url.origin !== API || url.username || url.password || url.search || url.hash)
    return undefined;
  const named = url.pathname.match(/^\/repos\/([^/]+)\/([\w.-]+)\/pulls\/(\d+)$/);
  if (named?.[1] === ORG && named[3] === String(number))
    return `${API}/repos/${ORG}/${named[2]}/pulls/${number}`;
  const byId = url.pathname.match(/^\/repositories\/(\d+)\/pulls\/(\d+)$/);
  if (byId?.[2] === String(number)) return `${API}/repositories/${byId[1]}/pulls/${number}`;
  return undefined;
}

function gitHubApi(fetch: Fetch, token: string) {
  let requests = 0;

  /** A redirect is never followed, so the token goes nowhere else. It fails the run unless `absent` accepts it. */
  async function get(
    url: string,
    absent: (status: number) => boolean = () => false,
  ): Promise<Response> {
    if (!url.startsWith(`${API}/`)) throw new Error(`refusing to GET a URL outside ${API}/`);
    const path = url.slice(API.length);
    requests += 1;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "hx-centcom-sync",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch (error) {
      // The request carried the token, and a fetch error can quote a header value, so its message is never kept.
      throw new Error(`GitHub GET ${path} -> request failed (${failureKind(error)})`);
    }
    if (res.ok || absent(res.status)) return res;
    // A server can echo the Authorization header in its body, so no response text is kept.
    throw new Error(`GitHub GET ${path} -> ${res.status}`);
  }

  /** V8's JSON parse error quotes the start of the body, so its message is never kept. */
  async function json<T>(res: Response, url: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`GitHub GET ${url.slice(API.length)} -> invalid JSON`);
    }
  }

  async function list<T>(path: string, more: (page: T[]) => boolean = () => true): Promise<T[]> {
    const items: T[] = [];
    let url: string | undefined = `${API}${path}`;
    while (url !== undefined) {
      const res = await get(url);
      const page: T[] = await json(res, url);
      items.push(...page);
      url = more(page) ? nextUrl(res.headers.get("link")) : undefined;
    }
    return items;
  }

  return {
    requests: () => requests,
    repos: () => list<GitHubRepo>(`/orgs/${ORG}/repos?type=all&per_page=100`),
    openPulls: (repo: string) =>
      list<GitHubPull>(`/repos/${ORG}/${repo}/pulls?state=open&per_page=100`),
    closedPulls: (repo: string, cutoff: number) =>
      list<GitHubPull>(
        `/repos/${ORG}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
        (page) => {
          const last = page.at(-1);
          return last !== undefined && Date.parse(last.updated_at) >= cutoff;
        },
      ),
    /**
     * GitHub redirects a repository that was renamed inside the org, and one that left it. Only a Location that names
     * this PR on api.github.com is fetched, once, and its answer counts only if the org still owns the repository.
     */
    pull: async (
      repo: string,
      number: number,
    ): Promise<{ repo: string; pull: GitHubPull } | null> => {
      const absent = (status: number) => status === 404 || (status >= 300 && status < 400);
      const url = `${API}/repos/${ORG}/${repo}/pulls/${number}`;
      const res = await get(url, absent);
      if (res.ok) return { repo, pull: await json<GitHubPull>(res, url) };
      const moved =
        res.status === 404 ? undefined : redirectTarget(res.headers.get("location"), number);
      if (moved === undefined) return null;
      const next = await get(moved, absent);
      if (!next.ok) return null;
      const found = await json<GitHubPull>(next, moved);
      const { name, owner } = found.base.repo;
      return owner.login === ORG ? { repo: name, pull: found } : null;
    },
    head: async (repo: string, branch: string): Promise<string | undefined> => {
      const url = `${API}/repos/${ORG}/${repo}/branches/${encodeURIComponent(branch)}`;
      const res = await get(url, (status) => status === 404 || status === 409);
      return res.ok ? (await json<GitHubBranch>(res, url)).commit.sha : undefined;
    },
  };
}

async function runSync({
  fetch,
  token,
  store,
  now,
}: {
  fetch: Fetch;
  token: string;
  store: SyncStore;
  now: () => Date;
}): Promise<Summary> {
  const fetchedAt = now();
  const cutoff = fetchedAt.getTime() - RECENT_MS;
  const gh = gitHubApi(fetch, token);
  const repos = (await gh.repos()).filter((repo) => !repo.archived);
  const repoRows: GithubRepoInput[] = [];
  const prs = new Map<number, GithubPrInput>();

  for (const repo of repos) {
    const [open, closed, headSha] = await Promise.all([
      gh.openPulls(repo.name),
      gh.closedPulls(repo.name, cutoff),
      gh.head(repo.name, repo.default_branch),
    ]);
    if (headSha !== undefined)
      repoRows.push({ name: repo.name, defaultBranch: repo.default_branch, headSha });
    const recent = closed.filter((pull) => closedSince(pull, cutoff));
    for (const pull of [...open, ...recent]) prs.set(pull.id, toPrRow(repo.name, pull));
  }

  // Every stored open PR is rechecked, including one whose repository is archived or has left the org list.
  const gone: OpenPr[] = [];
  for (const stored of await store.openPrs()) {
    if (prs.has(stored.id)) continue;
    const found = await gh.pull(stored.repo, stored.number);
    if (found === null) gone.push(stored);
    else prs.set(found.pull.id, toPrRow(found.repo, found.pull));
  }

  const rows = [...prs.values()];
  await store.save({
    repos: repoRows,
    prs: rows,
    stateUpdates: gone.map((pr) => ({ id: pr.id, state: prState(null) })),
    fetchedAt,
  });
  const count = (state: GithubPrState) => rows.filter((row) => row.state === state).length;
  return {
    repos: repos.length,
    heads: repoRows.length,
    empty: repos.length - repoRows.length,
    open: count("open"),
    merged: count("merged"),
    closed: count("closed"),
    gone,
    requests: gh.requests(),
    ms: now().getTime() - fetchedAt.getTime(),
  };
}

/**
 * A store or db the caller injects stays open: the caller owns its lifetime. Only a connection made here is closed.
 * The services load only on the db path, so the in-memory tests run this file under plain Node without path aliases.
 */
async function withStore<T>(
  deps: Partial<Deps>,
  run: (store: SyncStore) => Promise<T>,
): Promise<T> {
  if (deps.store) return run(deps.store);
  const { listOpenGithubPrs, recordGithubSnapshot } = await import("@/server/services");
  const storeFor = (db: Db): SyncStore => ({
    openPrs: () => listOpenGithubPrs(db),
    save: (snapshot) => recordGithubSnapshot(db, snapshot),
  });
  if (deps.db) return run(storeFor(deps.db));
  const { connectDb, requireEnv } = await import("@/server/db/client");
  const { db, close } = connectDb(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    return await run(storeFor(db));
  } finally {
    await close();
  }
}

interface Output {
  write(text: string): unknown;
}

export interface Deps {
  fetch: Fetch;
  /** Takes precedence over `db`. */
  store: SyncStore;
  db: Db;
  now: () => Date;
  stdout: Output;
  stderr: Output;
}

export async function main(
  env: Record<string, string | undefined>,
  deps: Partial<Deps> = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  try {
    const token = readSecretFile(env["GITHUB_TOKEN_FILE"], "GITHUB_TOKEN_FILE");
    const s = await withStore(deps, (store) =>
      runSync({
        fetch: deps.fetch ?? globalThis.fetch,
        token,
        store,
        now: deps.now ?? (() => new Date()),
      }),
    );
    for (const pr of s.gone)
      stdout.write(`github-sync gone repo=${pr.repo} number=${pr.number} id=${pr.id}\n`);
    stdout.write(
      `github-sync ok org=${ORG} repos=${s.repos} heads=${s.heads} empty=${s.empty} open=${s.open} merged=${s.merged} closed=${s.closed} requests=${s.requests} ms=${s.ms}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(`github-sync failed: ${describe(error).replace(/[\r\n]+/g, " ")}\n`);
    return 1;
  }
}

// import.meta.main needs Node 22.18. process.argv[1] keeps a symlinked path, and import.meta.url is the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.env));
}
