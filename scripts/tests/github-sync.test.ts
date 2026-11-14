import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { register } from "tsx/esm/api";
import type { GithubPrInput, GithubRepoInput, GithubSnapshot } from "@/server/services";
import { main } from "../github-sync.ts";
import type { Fetch, OpenPr, SyncStore } from "../github-sync.ts";

const API = "https://api.github.com";
const ORG = "HX-Infratstructure";
const TOKEN = "ghp_FakeTokenForGithubSyncTests0000000001";
const NOW = new Date("2026-11-14T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const reposUrl = `${API}/orgs/${ORG}/repos?type=all&per_page=100`;
const openUrl = (repo: string) => `${API}/repos/${ORG}/${repo}/pulls?state=open&per_page=100`;
const closedUrl = (repo: string) =>
  `${API}/repos/${ORG}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;
const branchUrl = (repo: string, encodedBranch: string) =>
  `${API}/repos/${ORG}/${repo}/branches/${encodedBranch}`;
const pullUrl = (repo: string, number: number) => `${API}/repos/${ORG}/${repo}/pulls/${number}`;

interface Canned {
  status?: number;
  body: unknown;
  next?: string;
  location?: string;
}
type Routes = Record<string, Canned>;
interface Call {
  url: string;
  init: RequestInit;
}

function repo(name: string, defaultBranch = "main", archived = false) {
  return { name, default_branch: defaultBranch, archived };
}

function pull(repoName: string, id: number, number: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    number,
    title: `Pull ${number}`,
    state: "open",
    draft: false,
    head: { sha: `head-${id}` },
    base: { repo: { name: repoName, owner: { login: ORG } } },
    merge_commit_sha: `test-merge-${id}`,
    html_url: `https://github.com/${ORG}/${repoName}/pull/${number}`,
    merged_at: null,
    closed_at: null,
    updated_at: daysAgo(0),
    ...fields,
  };
}

function mergedPull(
  repoName: string,
  id: number,
  number: number,
  mergedDaysAgo: number,
  updatedDaysAgo = mergedDaysAgo,
) {
  return pull(repoName, id, number, {
    state: "closed",
    merged_at: daysAgo(mergedDaysAgo),
    closed_at: daysAgo(mergedDaysAgo),
    updated_at: daysAgo(updatedDaysAgo),
    merge_commit_sha: `merge-${id}`,
  });
}

function row(
  repoName: string,
  id: number,
  number: number,
  state: GithubPrInput["state"],
  mergeCommitSha: string | null,
): GithubPrInput {
  return {
    id,
    repo: repoName,
    number,
    title: `Pull ${number}`,
    state,
    draft: false,
    headSha: `head-${id}`,
    mergeCommitSha,
    url: `https://github.com/${ORG}/${repoName}/pull/${number}`,
  };
}

const byId = (rows: readonly GithubPrInput[]) => [...rows].sort((a, b) => a.id - b.id);
const byName = (rows: readonly GithubRepoInput[]) =>
  [...rows].sort((a, b) => a.name.localeCompare(b.name));

function quietRepo(name: string, encodedBranch = "main"): Routes {
  return {
    [openUrl(name)]: { body: [] },
    [closedUrl(name)]: { body: [] },
    [branchUrl(name, encodedBranch)]: { body: { commit: { sha: `sha-${name}` } } },
  };
}

function baseRoutes(): Routes {
  return {
    [reposUrl]: { body: [repo("alpha"), repo("beta", "release/v1"), repo("attic", "main", true)] },
    ...quietRepo("alpha"),
    ...quietRepo("beta", "release%2Fv1"),
  };
}

function stubGitHub(routes: Routes, reject?: (init: RequestInit) => Error) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    // Node's fetch validates the request this way before it sends anything.
    new Request(url, init);
    if (reject) throw reject(init);
    const route = routes[url];
    if (route === undefined)
      return new Response(JSON.stringify({ message: `no canned response for ${url}` }), {
        status: 500,
      });
    const headers = new Headers();
    if (route.location !== undefined) headers.set("Location", route.location);
    if (route.next !== undefined) {
      headers.set(
        "Link",
        `<${API}/prev-page>; rel="prev", <${route.next}>; rel="next", <${API}/last-page>; rel="last"`,
      );
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers });
  };
  return { fetch, calls };
}

function memoryStore(open: OpenPr[] = [], saveError?: Error) {
  const calls = { openPrs: 0, save: 0 };
  const saved: GithubSnapshot[] = [];
  const store: SyncStore = {
    async openPrs() {
      calls.openPrs += 1;
      return open;
    },
    async save(snapshot) {
      calls.save += 1;
      if (saveError) throw saveError;
      saved.push(snapshot);
    },
  };
  return { store, calls, saved };
}

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "github-sync-test-"));
  tempDirs.push(dir);
  return dir;
}

function tokenFile(mode: number, content = `${TOKEN}\n`): string {
  const file = join(tempDir(), "token");
  writeFileSync(file, content);
  chmodSync(file, mode);
  return file;
}

function output() {
  let text = "";
  return {
    write(chunk: string) {
      text += chunk;
      return true;
    },
    text: () => text,
  };
}

interface RunOptions {
  open?: OpenPr[];
  saveError?: Error;
  reject?: (init: RequestInit) => Error;
  mode?: number;
  env?: Record<string, string | undefined>;
  printToProcess?: boolean;
}

async function run(routes: Routes, options: RunOptions = {}) {
  const github = stubGitHub(routes, options.reject);
  const db = memoryStore(options.open, options.saveError);
  const stdout = output();
  const stderr = output();
  const code = await main(options.env ?? { GITHUB_TOKEN_FILE: tokenFile(options.mode ?? 0o600) }, {
    fetch: github.fetch,
    store: db.store,
    now: () => NOW,
    ...(options.printToProcess ? {} : { stdout, stderr }),
  });
  return {
    code,
    calls: github.calls,
    urls: github.calls.map((call) => call.url),
    db,
    stdout: stdout.text(),
    stderr: stderr.text(),
  };
}

/** Every 8-character run of `secret` that appears in the printed output. */
function printedParts(chunks: readonly string[], secret: string): string[] {
  const printed = chunks.join("");
  return Array.from({ length: secret.length - 7 }, (_, i) => secret.slice(i, i + 8)).filter(
    (part) => printed.includes(part),
  );
}

function captureProcessOutput() {
  const seen: string[] = [];
  const restores: Array<() => void> = [];
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write;
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("latin1");
      seen.push(text);
      // The test runner reports through these streams, so only the script's own result lines are held back.
      return text.startsWith("github-sync ")
        ? true
        : Reflect.apply(write, stream, [chunk, ...rest]);
    }) as typeof stream.write;
    restores.push(() => {
      stream.write = write;
    });
  }
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      seen.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" "));
    };
    restores.push(() => {
      console[method] = original;
    });
  }
  return {
    chunks: seen,
    restore: () => {
      for (const restore of restores) restore();
    },
  };
}

describe("only GET requests to api.github.com", () => {
  test("every request of a full run is a GET to https://api.github.com/ that never follows a redirect", async () => {
    const result = await run(baseRoutes());
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.calls.length > 0, "the run sent requests");
    for (const { url, init } of result.calls) {
      assert.equal(init.method, "GET", url);
      assert.equal(init.redirect, "manual", url);
      assert.ok(url.startsWith("https://api.github.com/"), url);
    }
  });

  for (const next of [
    "https://evil.example/orgs/HX-Infratstructure/repos?page=2",
    "https://api.github.com.evil.example/orgs/HX-Infratstructure/repos?page=2",
  ]) {
    test(`a Link next URL on another origin fails the run without being fetched: ${next}`, async () => {
      const routes = {
        ...baseRoutes(),
        [reposUrl]: { body: [repo("alpha")], next },
        [next]: { body: [repo("beta")] },
      };
      const result = await run(routes);
      assert.equal(result.code, 1);
      assert.ok(result.urls.includes(reposUrl), "the first page was requested");
      assert.ok(!result.urls.includes(next), "the foreign URL was never fetched");
      assert.equal(result.db.calls.save, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^github-sync failed: [^\n]*\n$/);
    });
  }
});

describe("the token is never printed", () => {
  const scenarios: Array<{
    name: string;
    routes: Routes;
    options: RunOptions;
    code: number;
    line: RegExp;
  }> = [
    {
      name: "successful run",
      routes: baseRoutes(),
      options: {},
      code: 0,
      line: /^github-sync ok /,
    },
    {
      name: "GitHub answers 401",
      routes: {
        [reposUrl]: {
          status: 401,
          body: { message: "Bad credentials", documentation_url: "https://docs.github.com/rest" },
        },
      },
      options: {},
      code: 1,
      line: /^github-sync failed: GitHub GET \/orgs\/HX-Infratstructure\/repos\?type=all&per_page=100 -> 401\n$/,
    },
    {
      name: "fetch rejects with the header value in its message, as Node 22 does for an invalid header",
      routes: baseRoutes(),
      options: {
        reject: (init) =>
          new TypeError(
            `Headers.append: "${new Headers(init.headers).get("authorization")}" is an invalid header value.`,
          ),
      },
      code: 1,
      line: /^github-sync failed: GitHub GET \/orgs\/HX-Infratstructure\/repos\?type=all&per_page=100 -> request failed \(TypeError\)\n$/,
    },
    {
      name: "fetch cannot connect",
      routes: baseRoutes(),
      options: {
        reject: () =>
          new TypeError("fetch failed", {
            cause: Object.assign(new Error("connect ECONNREFUSED 140.82.121.6:443"), {
              code: "ECONNREFUSED",
            }),
          }),
      },
      code: 1,
      line: /^github-sync failed: GitHub GET \/orgs\/HX-Infratstructure\/repos\?type=all&per_page=100 -> request failed \(ECONNREFUSED\)\n$/,
    },
    {
      name: "store.save throws",
      routes: baseRoutes(),
      options: { saveError: new Error("database unreachable") },
      code: 1,
      line: /^github-sync failed: database unreachable\n$/,
    },
  ];

  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const captured = captureProcessOutput();
      let result: Awaited<ReturnType<typeof run>>;
      try {
        result = await run(scenario.routes, { ...scenario.options, printToProcess: true });
      } finally {
        captured.restore();
      }
      assert.equal(result.code, scenario.code);
      assert.equal(
        new Headers(result.calls[0]?.init.headers).get("authorization"),
        `Bearer ${TOKEN}`,
      );
      assert.deepEqual(printedParts(captured.chunks, TOKEN), [], "no part of the token is printed");
      assert.ok(
        captured.chunks.some((chunk) => scenario.line.test(chunk)),
        `no result line in ${inspect(captured.chunks)}`,
      );
    });
  }

  const bareToken = (auth: string) => auth.slice("Bearer ".length);
  const echoes: Array<{
    name: string;
    routes: Routes;
    open?: OpenPr[];
    echo: { url: string; status: number; body: (auth: string) => string };
    line: string;
  }> = [
    {
      name: "a 401 whose message holds the Authorization header logs only the status and path",
      routes: {},
      echo: {
        url: reposUrl,
        status: 401,
        body: (auth) => JSON.stringify({ message: `Bad credentials for ${auth}` }),
      },
      line: `github-sync failed: GitHub GET ${reposUrl.slice(API.length)} -> 401\n`,
    },
    {
      name: "a 200 repo list that is the token, not JSON, logs only invalid JSON and the path",
      routes: {},
      echo: { url: reposUrl, status: 200, body: bareToken },
      line: `github-sync failed: GitHub GET ${reposUrl.slice(API.length)} -> invalid JSON\n`,
    },
    {
      name: "a 200 branch head that is the token, not JSON, logs only invalid JSON and the path",
      routes: {
        [reposUrl]: { body: [repo("alpha")] },
        [openUrl("alpha")]: { body: [] },
        [closedUrl("alpha")]: { body: [] },
      },
      echo: { url: branchUrl("alpha", "main"), status: 200, body: bareToken },
      line: `github-sync failed: GitHub GET ${branchUrl("alpha", "main").slice(API.length)} -> invalid JSON\n`,
    },
    {
      name: "a 200 stored PR that is the token, not JSON, logs only invalid JSON and the path",
      routes: { [reposUrl]: { body: [] } },
      open: [{ id: 107, repo: "alpha", number: 7 }],
      echo: { url: pullUrl("alpha", 7), status: 200, body: bareToken },
      line: `github-sync failed: GitHub GET ${pullUrl("alpha", 7).slice(API.length)} -> invalid JSON\n`,
    },
  ];

  for (const { name, routes, open, echo, line } of echoes) {
    test(`a loopback server: ${name}`, async () => {
      const echoed: string[] = [];
      const server = createServer((req, res) => {
        const url = `${API}${req.url}`;
        res.setHeader("content-type", "application/json");
        if (url === echo.url) {
          const auth = req.headers.authorization ?? "";
          echoed.push(auth);
          res.writeHead(echo.status).end(echo.body(auth));
          return;
        }
        const route = routes[url];
        res
          .writeHead(route === undefined ? 500 : (route.status ?? 200))
          .end(JSON.stringify(route === undefined ? { message: "no route" } : route.body));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const loopback: Fetch = (url, init) =>
        globalThis.fetch(`http://127.0.0.1:${port}${url.slice(API.length)}`, init);
      const captured = captureProcessOutput();
      let code: number;
      try {
        code = await main(
          { GITHUB_TOKEN_FILE: tokenFile(0o600) },
          { fetch: loopback, store: memoryStore(open).store, now: () => NOW },
        );
      } finally {
        captured.restore();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      assert.equal(code, 1);
      assert.deepEqual(echoed, [`Bearer ${TOKEN}`], "the echoed body held the token");
      assert.deepEqual(printedParts(captured.chunks, TOKEN), [], "no part of the token is printed");
      assert.ok(captured.chunks.includes(line), `no result line in ${inspect(captured.chunks)}`);
    });
  }

  test("a two-line token file is refused, under Node's own header validation, without printing any part of it", async () => {
    const lines = ["ghp_FirstLineOfATwoLineTokenFile00001", "SecondLineOfATwoLineTokenFile00002"];
    const captured = captureProcessOutput();
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(baseRoutes(), {
        env: { GITHUB_TOKEN_FILE: tokenFile(0o600, `${lines.join("\n")}\n`) },
        printToProcess: true,
      });
    } finally {
      captured.restore();
    }
    assert.equal(result.code, 1);
    for (const line of lines) {
      assert.deepEqual(printedParts(captured.chunks, line), [], "no part of the token is printed");
    }
    assert.equal(result.calls.length, 0, "no request was sent");
    assert.ok(
      captured.chunks.some((chunk) =>
        /^github-sync failed: GITHUB_TOKEN_FILE \S+ must hold one token of printable ASCII, with no space, line break or control character inside\n$/.test(
          chunk,
        ),
      ),
      `no refusal line in ${inspect(captured.chunks)}`,
    );
  });
});

describe("token file rules", () => {
  for (const mode of [0o644, 0o640, 0o400]) {
    const octal = mode.toString(8);
    test(`mode ${octal} is refused before any request or store call`, async () => {
      const result = await run(baseRoutes(), { mode });
      assert.equal(result.code, 1);
      assert.equal(result.calls.length, 0);
      assert.deepEqual(result.db.calls, { openPrs: 0, save: 0 });
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^github-sync failed: [^\n]*\n$/);
      assert.match(result.stderr, new RegExp(`GITHUB_TOKEN_FILE.*\\b${octal}\\b`));
      assert.ok(!result.stderr.includes(TOKEN));
    });
  }

  test("mode 600 is accepted", async () => {
    const result = await run(baseRoutes(), { mode: 0o600 });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.calls.length > 0);
  });

  const unusable: Array<{ name: string; path: () => string | undefined; reason: RegExp }> = [
    { name: "an unset variable", path: () => undefined, reason: /is not set/ },
    { name: "a relative path", path: () => "token", reason: /must be an absolute path/ },
    {
      name: "a missing file",
      path: () => join(tempDir(), "absent"),
      reason: /absent cannot be opened \(ENOENT\)/,
    },
    {
      name: "a directory",
      path: () => {
        const dir = join(tempDir(), "token");
        mkdirSync(dir, { mode: 0o700 });
        return dir;
      },
      reason: /is not a regular file/,
    },
    {
      name: "a file holding only whitespace",
      path: () => tokenFile(0o600, " \n"),
      reason: /is empty/,
    },
    ...Object.entries({
      "two lines": "ghp_one\nghp_two\n",
      "a space inside": "ghp_one two\n",
      "a tab inside": "ghp_one\ttwo\n",
      "a control character inside": "ghp_one\u0007two\n",
      "a non-ASCII character": "ghp_oné\n",
    }).map(([shape, content]) => ({
      name: `a token file with ${shape}`,
      path: () => tokenFile(0o600, content),
      reason:
        /must hold one token of printable ASCII, with no space, line break or control character inside\n$/,
    })),
  ];
  for (const { name, path, reason } of unusable) {
    test(`${name} is refused before any request or store call`, async () => {
      const result = await run(baseRoutes(), { env: { GITHUB_TOKEN_FILE: path() } });
      assert.equal(result.code, 1);
      assert.equal(result.calls.length, 0);
      assert.deepEqual(result.db.calls, { openPrs: 0, save: 0 });
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^github-sync failed: GITHUB_TOKEN_FILE [^\n]*\n$/);
      assert.match(result.stderr, reason);
    });
  }
});

describe("PR state", () => {
  test("recent merges and closes are saved, old merges are not, and a vanished open PR takes GitHub's answer", async () => {
    const routes: Routes = {
      [reposUrl]: { body: [repo("alpha")] },
      [openUrl("alpha")]: { body: [pull("alpha", 101, 1)] },
      [closedUrl("alpha")]: {
        body: [
          mergedPull("alpha", 102, 2, 3, 1),
          pull("alpha", 103, 3, { state: "closed", closed_at: daysAgo(2), updated_at: daysAgo(2) }),
          mergedPull("alpha", 104, 4, 40, 5),
        ],
      },
      [branchUrl("alpha", "main")]: { body: { commit: { sha: "sha-alpha" } } },
      [pullUrl("alpha", 5)]: { body: mergedPull("alpha", 105, 5, 35) },
    };
    const result = await run(routes, {
      open: [
        { id: 101, repo: "alpha", number: 1 },
        { id: 105, repo: "alpha", number: 5 },
      ],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.db.calls.save, 1);
    assert.deepEqual(result.db.saved[0]?.fetchedAt, NOW, "the snapshot carries the injected clock");
    assert.deepEqual(byId(result.db.saved[0]?.prs ?? []), [
      row("alpha", 101, 1, "open", null),
      row("alpha", 102, 2, "merged", "merge-102"),
      row("alpha", 103, 3, "closed", null),
      row("alpha", 105, 5, "merged", "merge-105"),
    ]);
    assert.deepEqual(result.db.saved[0]?.stateUpdates, []);
    assert.ok(
      !result.urls.includes(pullUrl("alpha", 1)),
      "a PR still in the open list is not fetched again",
    );
    assert.equal(
      result.stdout,
      "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=1 merged=2 closed=1 requests=5 ms=0\n",
    );
  });

  const vanished = (status: number): Routes => ({
    [reposUrl]: { body: [repo("alpha")] },
    ...quietRepo("alpha"),
    [pullUrl("alpha", 7)]: {
      status,
      body: { message: status === 404 ? "Not Found" : "Server Error" },
    },
  });

  test("a stored open PR that GitHub answers 404 for is marked gone with one log line, and the run succeeds", async () => {
    const result = await run(vanished(404), { open: [{ id: 107, repo: "alpha", number: 7 }] });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 107, state: "gone" }]);
    assert.deepEqual(result.db.saved[0]?.prs, []);
    assert.equal(
      result.stdout,
      "github-sync gone repo=alpha number=7 id=107\n" +
        "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=0 merged=0 closed=0 requests=5 ms=0\n",
    );
  });

  test("any other status for a stored open PR still fails the run", async () => {
    const result = await run(vanished(500), { open: [{ id: 107, repo: "alpha", number: 7 }] });
    assert.equal(result.code, 1);
    assert.equal(result.db.calls.save, 0);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "github-sync failed: GitHub GET /repos/HX-Infratstructure/alpha/pulls/7 -> 500\n",
    );
  });

  test("a stored open PR is rechecked when its repository is archived or no longer in the org list", async () => {
    const routes: Routes = {
      [reposUrl]: { body: [repo("alpha"), repo("attic", "main", true)] },
      ...quietRepo("alpha"),
      [pullUrl("attic", 3)]: {
        body: pull("attic", 303, 3, {
          state: "closed",
          closed_at: daysAgo(40),
          updated_at: daysAgo(40),
        }),
      },
      [pullUrl("retired", 9)]: { status: 404, body: { message: "Not Found" } },
    };
    const result = await run(routes, {
      open: [
        { id: 303, repo: "attic", number: 3 },
        { id: 900, repo: "retired", number: 9 },
      ],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.db.saved[0]?.prs, [row("attic", 303, 3, "closed", null)]);
    assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 900, state: "gone" }]);
    assert.equal(
      result.stdout,
      "github-sync gone repo=retired number=9 id=900\n" +
        "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=0 merged=0 closed=1 requests=6 ms=0\n",
    );
  });

  const oldClosedPull = (repoName: string) =>
    pull(repoName, 404, 4, { state: "closed", closed_at: daysAgo(40), updated_at: daysAgo(40) });
  const sentToken = (call: { init: RequestInit }) =>
    new Headers(call.init.headers).get("authorization") === `Bearer ${TOKEN}`;

  for (const status of [301, 302, 307, 308]) {
    test(`a stored open PR whose repository left the org (${status}) is marked gone, and the redirect is not followed`, async () => {
      const moved = `${API}/repos/elsewhere/beyond/pulls/4`;
      const routes: Routes = {
        [reposUrl]: { body: [repo("alpha")] },
        ...quietRepo("alpha"),
        [pullUrl("transferred", 4)]: { status, location: moved, body: { message: "Moved" } },
        [moved]: { body: oldClosedPull("beyond") },
      };
      const result = await run(routes, { open: [{ id: 404, repo: "transferred", number: 4 }] });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 404, state: "gone" }]);
      assert.deepEqual(result.db.saved[0]?.prs, []);
      assert.equal(
        result.urls.filter((url) => url === moved).length,
        0,
        "no request to the other org",
      );
      assert.equal(
        result.stdout,
        "github-sync gone repo=transferred number=4 id=404\n" +
          "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=0 merged=0 closed=0 requests=5 ms=0\n",
      );
    });

    test(`a stored open PR whose repository was renamed inside the org (${status}) takes GitHub's answer from one GET of the new URL`, async () => {
      const renamed = pullUrl("renamed", 4);
      const routes: Routes = {
        [reposUrl]: { body: [repo("alpha")] },
        ...quietRepo("alpha"),
        [pullUrl("old-name", 4)]: { status, location: renamed, body: { message: "Moved" } },
        [renamed]: { body: oldClosedPull("renamed") },
      };
      const result = await run(routes, { open: [{ id: 404, repo: "old-name", number: 4 }] });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.db.saved[0]?.prs, [row("renamed", 404, 4, "closed", null)]);
      assert.deepEqual(result.db.saved[0]?.stateUpdates, []);
      const hops = result.calls.filter((call) => call.url === renamed);
      assert.equal(hops.length, 1, "one GET of the new URL");
      assert.ok(hops.every(sentToken), "the new URL on api.github.com gets the token");
      assert.equal(
        result.stdout,
        "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=0 merged=0 closed=1 requests=6 ms=0\n",
      );
    });
  }

  for (const location of [
    `https://evil.example/repos/${ORG}/renamed/pulls/4`,
    `https://api.github.com.evil.example/repos/${ORG}/renamed/pulls/4`,
    `https://api.github.com@evil.example/repos/${ORG}/renamed/pulls/4`,
    `http://api.github.com/repos/${ORG}/renamed/pulls/4`,
    `https://api.github.com:8443/repos/${ORG}/renamed/pulls/4`,
    `${API}/repos/${ORG}/renamed/pulls/5`,
    `${API}/repos/${ORG}/renamed/pulls/4?page=2`,
    `${API}/repositories/1457388817/pulls/5`,
    `${API}/repositories/abc/pulls/4`,
    `https://evil.example/repositories/1457388817/pulls/4`,
    `/repos/${ORG}/renamed/pulls/4`,
    "not a url",
  ]) {
    test(`a redirect to a Location that is not this PR on api.github.com in the org is marked gone without a request: ${location}`, async () => {
      const routes: Routes = {
        [reposUrl]: { body: [repo("alpha")] },
        ...quietRepo("alpha"),
        [pullUrl("old-name", 4)]: { status: 301, location, body: { message: "Moved" } },
        [location]: { body: oldClosedPull("renamed") },
      };
      const result = await run(routes, { open: [{ id: 404, repo: "old-name", number: 4 }] });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 404, state: "gone" }]);
      assert.deepEqual(result.db.saved[0]?.prs, []);
      assert.equal(result.calls.length, 5, result.urls.join(" "));
      for (const call of result.calls) assert.ok(call.url.startsWith(`${API}/`), call.url);
    });
  }

  const movedById = `${API}/repositories/1457388817/pulls/4`;
  const movedByIdRoutes = (answer: Canned): Routes => ({
    [reposUrl]: { body: [repo("alpha")] },
    ...quietRepo("alpha"),
    [pullUrl("old-name", 4)]: { status: 301, location: movedById, body: { message: "Moved" } },
    [movedById]: answer,
  });

  test("a redirect to the PR by repository id in the org takes GitHub's answer and the repository's new name", async () => {
    const result = await run(movedByIdRoutes({ body: oldClosedPull("renamed") }), {
      open: [{ id: 404, repo: "old-name", number: 4 }],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.db.saved[0]?.prs, [row("renamed", 404, 4, "closed", null)]);
    assert.deepEqual(result.db.saved[0]?.stateUpdates, []);
    const hops = result.calls.filter((call) => call.url === movedById);
    assert.equal(hops.length, 1, "one GET of the repository-id URL");
    assert.ok(hops.every(sentToken), "the URL on api.github.com gets the token");
  });

  for (const [why, answer] of [
    [
      "a repository now owned by another org",
      {
        body: pull("beyond", 404, 4, {
          base: { repo: { name: "beyond", owner: { login: "elsewhere" } } },
        }),
      },
    ],
    ["a 404", { status: 404, body: { message: "Not Found" } }],
  ] as const) {
    test(`a redirect to the PR by repository id that answers with ${why} is marked gone after one GET`, async () => {
      const result = await run(movedByIdRoutes(answer), {
        open: [{ id: 404, repo: "old-name", number: 4 }],
      });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 404, state: "gone" }]);
      assert.deepEqual(result.db.saved[0]?.prs, []);
      assert.equal(
        result.urls.filter((url) => url === movedById).length,
        1,
        "one GET of the repository-id URL",
      );
    });
  }

  test("a second redirect after the one hop is marked gone, and the second Location is not requested", async () => {
    const renamed = pullUrl("renamed", 4);
    const again = pullUrl("renamed-again", 4);
    const routes: Routes = {
      [reposUrl]: { body: [repo("alpha")] },
      ...quietRepo("alpha"),
      [pullUrl("old-name", 4)]: { status: 301, location: renamed, body: { message: "Moved" } },
      [renamed]: { status: 307, location: again, body: { message: "Moved" } },
      [again]: { body: oldClosedPull("renamed-again") },
    };
    const result = await run(routes, { open: [{ id: 404, repo: "old-name", number: 4 }] });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.db.saved[0]?.stateUpdates, [{ id: 404, state: "gone" }]);
    assert.deepEqual(result.db.saved[0]?.prs, []);
    assert.equal(result.urls.filter((url) => url === renamed).length, 1, "the one hop was made");
    assert.equal(result.urls.filter((url) => url === again).length, 0, "no second hop");
  });

  test("a redirect anywhere else still fails the run", async () => {
    const result = await run({
      [reposUrl]: { status: 301, body: { message: "Moved Permanently" } },
    });
    assert.equal(result.code, 1);
    assert.equal(result.db.calls.save, 0);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "github-sync failed: GitHub GET /orgs/HX-Infratstructure/repos?type=all&per_page=100 -> 301\n",
    );
  });
});

describe("pagination", () => {
  test("repo and open PR pages are followed, and closed pages stop at the 30-day cutoff", async () => {
    const reposPage2 = `${reposUrl}&page=2`;
    const alphaOpenPage2 = `${openUrl("alpha")}&page=2`;
    const alphaClosedPage2 = `${closedUrl("alpha")}&page=2`;
    const betaClosedPage2 = `${closedUrl("beta")}&page=2`;
    const routes: Routes = {
      [reposUrl]: { body: [repo("alpha")], next: reposPage2 },
      [reposPage2]: { body: [repo("beta")] },
      ...quietRepo("alpha"),
      ...quietRepo("beta"),
      [openUrl("alpha")]: { body: [pull("alpha", 201, 1)], next: alphaOpenPage2 },
      [alphaOpenPage2]: { body: [pull("alpha", 202, 2)] },
      [closedUrl("alpha")]: {
        body: [mergedPull("alpha", 203, 3, 10), mergedPull("alpha", 204, 4, 31)],
        next: alphaClosedPage2,
      },
      [alphaClosedPage2]: { body: [mergedPull("alpha", 205, 5, 32)] },
      [closedUrl("beta")]: { body: [mergedPull("beta", 301, 1, 20)], next: betaClosedPage2 },
      [betaClosedPage2]: { body: [mergedPull("beta", 302, 2, 25)] },
    };
    const result = await run(routes);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(byName(result.db.saved[0]?.repos ?? []), [
      { name: "alpha", defaultBranch: "main", headSha: "sha-alpha" },
      { name: "beta", defaultBranch: "main", headSha: "sha-beta" },
    ]);
    assert.deepEqual(byId(result.db.saved[0]?.prs ?? []), [
      row("alpha", 201, 1, "open", null),
      row("alpha", 202, 2, "open", null),
      row("alpha", 203, 3, "merged", "merge-203"),
      row("beta", 301, 1, "merged", "merge-301"),
      row("beta", 302, 2, "merged", "merge-302"),
    ]);
    assert.ok(
      !result.urls.includes(alphaClosedPage2),
      "the page past the cutoff was never requested",
    );
    assert.ok(
      result.urls.includes(betaClosedPage2),
      "a page whose last item is inside the cutoff is followed",
    );
  });
});

describe("exit status", () => {
  test("a failing store.save exits 1 with one stderr line and no ok line", async () => {
    const result = await run(baseRoutes(), { saveError: new Error("database unreachable") });
    assert.equal(result.code, 1);
    assert.equal(result.db.calls.save, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "github-sync failed: database unreachable\n");
  });

  for (const status of [404, 409]) {
    test(`an empty repository whose branch answers ${status} is counted as empty and the run succeeds`, async () => {
      const routes = {
        ...baseRoutes(),
        [branchUrl("beta", "release%2Fv1")]: {
          status,
          body: { message: "Git Repository is empty." },
        },
      };
      const result = await run(routes);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(
        result.stdout,
        "github-sync ok org=HX-Infratstructure repos=2 heads=1 empty=1 open=0 merged=0 closed=0 requests=7 ms=0\n",
      );
      assert.deepEqual(result.db.saved[0]?.repos, [
        { name: "alpha", defaultBranch: "main", headSha: "sha-alpha" },
      ]);
    });
  }

  test("any other branch error fails the run", async () => {
    const routes = {
      ...baseRoutes(),
      [branchUrl("beta", "release%2Fv1")]: { status: 502, body: { message: "Server Error" } },
    };
    const result = await run(routes);
    assert.equal(result.code, 1);
    assert.equal(result.db.calls.save, 0);
    assert.equal(
      result.stderr,
      "github-sync failed: GitHub GET /repos/HX-Infratstructure/beta/branches/release%2Fv1 -> 502\n",
    );
  });
});

describe("the database store", () => {
  test("main writes repos and PRs to an injected db through the services, marks a 404 PR gone, reconciles only open PRs, and leaves the db open", async () => {
    register();
    const { createTestDb } = await import("../../src/server/db/test-db.ts");
    const t = await createTestDb();
    try {
      const sync = async (routes: Routes, at: Date) => {
        const github = stubGitHub(routes);
        const stdout = output();
        const stderr = output();
        const code = await main(
          { GITHUB_TOKEN_FILE: tokenFile(0o600) },
          { fetch: github.fetch, db: t.db, now: () => at, stdout, stderr },
        );
        assert.equal(code, 0, stderr.text());
        return {
          pullUrls: github.calls.map((call) => call.url).filter((url) => /\/pulls\/\d+$/.test(url)),
          stdout: stdout.text(),
        };
      };
      const alpha = (headSha: string, open: unknown[], closed: unknown[] = []): Routes => ({
        [reposUrl]: { body: [repo("alpha")] },
        [openUrl("alpha")]: { body: open },
        [closedUrl("alpha")]: { body: closed },
        [branchUrl("alpha", "main")]: { body: { commit: { sha: headSha } } },
      });
      const pr = (
        id: number,
        number: number,
        title: string,
        state: string,
        merge_commit_sha: string | null,
        fetched_at: string,
      ) => ({
        id,
        repo: "alpha",
        number,
        title,
        state,
        draft: false,
        head_sha: `head-${id}`,
        merge_commit_sha,
        url: `https://github.com/${ORG}/alpha/pull/${number}`,
        fetched_at,
      });
      const prsInDb = async () =>
        [...(await t.services.listGithubPrs({ limit: 100 })).items].sort(
          (a, b) => a.repo.localeCompare(b.repo) || a.number - b.number,
        );
      const reposInDb = async () => (await t.services.listWorkspace()).repos;
      const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);

      const first = await sync(
        alpha("sha-alpha-1", [pull("alpha", 101, 1), pull("alpha", 102, 2), pull("alpha", 103, 3)]),
        NOW,
      );
      assert.deepEqual(first.pullUrls, []);
      assert.deepEqual(await prsInDb(), [
        pr(101, 1, "Pull 1", "open", null, "2026-11-14T12:00:00Z"),
        pr(102, 2, "Pull 2", "open", null, "2026-11-14T12:00:00Z"),
        pr(103, 3, "Pull 3", "open", null, "2026-11-14T12:00:00Z"),
      ]);
      assert.deepEqual(await reposInDb(), [
        {
          name: "alpha",
          default_branch: "main",
          head_sha: "sha-alpha-1",
          fetched_at: "2026-11-14T12:00:00Z",
        },
      ]);

      const second = await sync(
        {
          ...alpha(
            "sha-alpha-2",
            [pull("alpha", 103, 3)],
            [{ ...mergedPull("alpha", 101, 1, 0), title: "Pull 1, renamed" }],
          ),
          [pullUrl("alpha", 2)]: { status: 404, body: { message: "Not Found" } },
        },
        minutesLater(5),
      );
      assert.deepEqual(second.pullUrls, [pullUrl("alpha", 2)]);
      assert.equal(
        second.stdout,
        "github-sync gone repo=alpha number=2 id=102\n" +
          "github-sync ok org=HX-Infratstructure repos=1 heads=1 empty=0 open=1 merged=1 closed=0 requests=5 ms=0\n",
      );
      assert.deepEqual(await prsInDb(), [
        pr(101, 1, "Pull 1, renamed", "merged", "merge-101", "2026-11-14T12:05:00Z"),
        pr(102, 2, "Pull 2", "gone", null, "2026-11-14T12:00:00Z"),
        pr(103, 3, "Pull 3", "open", null, "2026-11-14T12:05:00Z"),
      ]);
      assert.deepEqual(await reposInDb(), [
        {
          name: "alpha",
          default_branch: "main",
          head_sha: "sha-alpha-2",
          fetched_at: "2026-11-14T12:05:00Z",
        },
      ]);

      const closed = pull("alpha", 103, 3, {
        state: "closed",
        closed_at: daysAgo(0),
        updated_at: daysAgo(0),
      });
      const third = await sync(
        { ...alpha("sha-alpha-3", []), [pullUrl("alpha", 3)]: { body: closed } },
        minutesLater(10),
      );
      assert.deepEqual(
        third.pullUrls,
        [pullUrl("alpha", 3)],
        "only the PR still stored as open is fetched",
      );
      assert.deepEqual(await prsInDb(), [
        pr(101, 1, "Pull 1, renamed", "merged", "merge-101", "2026-11-14T12:05:00Z"),
        pr(102, 2, "Pull 2", "gone", null, "2026-11-14T12:00:00Z"),
        pr(103, 3, "Pull 3", "closed", null, "2026-11-14T12:10:00Z"),
      ]);
      assert.deepEqual(
        await reposInDb(),
        [
          {
            name: "alpha",
            default_branch: "main",
            head_sha: "sha-alpha-3",
            fetched_at: "2026-11-14T12:10:00Z",
          },
        ],
        "the injected db still answers after main returned",
      );
    } finally {
      await t.close();
    }
  });

  test("a PR of a repository renamed inside the org is saved under the new name", async () => {
    register();
    const { createTestDb } = await import("../../src/server/db/test-db.ts");
    const t = await createTestDb();
    try {
      const sync = async (routes: Routes) => {
        const stderr = output();
        const code = await main(
          { GITHUB_TOKEN_FILE: tokenFile(0o600) },
          { fetch: stubGitHub(routes).fetch, db: t.db, now: () => NOW, stdout: output(), stderr },
        );
        assert.equal(code, 0, stderr.text());
      };
      await sync({
        [reposUrl]: { body: [repo("old-name")] },
        ...quietRepo("old-name"),
        [openUrl("old-name")]: { body: [pull("old-name", 404, 4)] },
      });
      const movedById = `${API}/repositories/1457388817/pulls/4`;
      await sync({
        [reposUrl]: { body: [] },
        [pullUrl("old-name", 4)]: { status: 301, location: movedById, body: { message: "Moved" } },
        [movedById]: {
          body: pull("renamed", 404, 4, { state: "closed", closed_at: daysAgo(40) }),
        },
      });
      const { items } = await t.services.listGithubPrs({ limit: 100 });
      assert.deepEqual(
        items.map(({ id, repo, number, state, url }) => ({ id, repo, number, state, url })),
        [
          {
            id: 404,
            repo: "renamed",
            number: 4,
            state: "closed",
            url: `https://github.com/${ORG}/renamed/pull/4`,
          },
        ],
      );
    } finally {
      await t.close();
    }
  });
});
