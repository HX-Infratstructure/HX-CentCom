/**
 * The GitHub mirror (`github_repos`, `github_prs`) that scripts/github-sync.ts refreshes. These writes add no
 * activity_log row. The sync is not an agent (activity_log.actor references agents), and copying GitHub's state is
 * not an actor's write.
 */
import { and, asc, desc, eq, getTableColumns, gt, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { githubPrs, githubRepos } from "@/server/db/schema";
import { parse } from "./inputs";
import {
  count,
  decodeCursor,
  encodeCursor,
  listCursor,
  listLimit,
  page,
  SNAPSHOT,
  tally,
  text,
} from "./raid";
import type { Page, PullRequest } from "./types";

export const GITHUB_PR_STATES = ["open", "closed", "merged", "gone"] as const;
export type GithubPrState = (typeof GITHUB_PR_STATES)[number];

export type GithubRepoInput = {
  readonly name: string;
  readonly defaultBranch: string;
  readonly headSha: string;
};

export type GithubPrInput = {
  readonly id: number;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly state: GithubPrState;
  readonly draft: boolean;
  readonly headSha: string;
  readonly mergeCommitSha: string | null;
  readonly url: string;
};

export type GithubSnapshot = {
  readonly repos: readonly GithubRepoInput[];
  readonly prs: readonly GithubPrInput[];
  /** Stored PRs whose state changes without a fresh row from GitHub. Only their `state` is written. */
  readonly stateUpdates: readonly { readonly id: number; readonly state: GithubPrState }[];
  readonly fetchedAt: Date;
};

type GithubPrRef = Pick<GithubPrInput, "id" | "repo" | "number">;

function fromExcluded(columns: Record<string, { readonly name: string }>) {
  return Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
  );
}

/** Writes the states it is given and decides none. The sync's `prState` owns that rule. */
export async function recordGithubSnapshot(db: Db, snapshot: GithubSnapshot): Promise<void> {
  const fetched_at = snapshot.fetchedAt.toISOString();
  await db.transaction(async (tx) => {
    if (snapshot.repos.length > 0) {
      await tx
        .insert(githubRepos)
        .values(
          snapshot.repos.map((repo) => ({
            name: repo.name,
            default_branch: repo.defaultBranch,
            head_sha: repo.headSha,
            fetched_at,
          })),
        )
        .onConflictDoUpdate({
          target: githubRepos.name,
          set: fromExcluded(getTableColumns(githubRepos)),
        });
    }
    if (snapshot.prs.length > 0) {
      await tx
        .insert(githubPrs)
        .values(
          snapshot.prs.map((pr) => ({
            id: pr.id,
            repo: pr.repo,
            number: pr.number,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            head_sha: pr.headSha,
            merge_commit_sha: pr.mergeCommitSha,
            url: pr.url,
            fetched_at,
          })),
        )
        .onConflictDoUpdate({
          target: githubPrs.id,
          set: fromExcluded(getTableColumns(githubPrs)),
        });
    }
    for (const { id, state } of snapshot.stateUpdates) {
      await tx.update(githubPrs).set({ state }).where(eq(githubPrs.id, id));
    }
  });
}

/** The PRs stored as open. The sync fetches each one that has left GitHub's open list. */
export async function listOpenGithubPrs(db: Db): Promise<GithubPrRef[]> {
  return db
    .select({ id: githubPrs.id, repo: githubPrs.repo, number: githubPrs.number })
    .from(githubPrs)
    .where(eq(githubPrs.state, "open"));
}

export const githubPrQueryInput = z
  .object({
    repo: text(200).optional(),
    state: z.enum(GITHUB_PR_STATES).optional(),
    limit: listLimit,
    cursor: listCursor.optional(),
  })
  .default({});
export type GithubPrQueryInput = z.input<typeof githubPrQueryInput>;

/** Chip counts under the listRaid rule: each facet applies every filter but its own, and none uses the cursor. */
export type GithubPrCounts = {
  readonly total: number;
  readonly byRepo: Readonly<Record<string, number>>;
  readonly byState: Readonly<Partial<Record<GithubPrState, number>>>;
};
export type GithubPrsPage = Page<PullRequest> & { readonly counts: GithubPrCounts };

/** The board's order (`PR_GROUPS` in src/components/pull-request.tsx): still moving, landed, ended, left GitHub. */
const PR_STATE_ORDER = [
  "open",
  "merged",
  "closed",
  "gone",
] as const satisfies readonly GithubPrState[];

/** A state's index in PR_STATE_ORDER. The column is text, so any other state ranks after them and still lists. */
const prStateRank = sql<number>`(case ${githubPrs.state} ${sql.join(
  PR_STATE_ORDER.map((state, rank) => sql`when ${state} then ${sql.raw(String(rank))}`),
  sql` `,
)} else ${sql.raw(String(PR_STATE_ORDER.length))} end)`.mapWith(Number);

/**
 * Rank first, then the highest id. GitHub fixes a PR's id at creation, while fetched_at moves on every sync, so
 * [rank, id] orders and pages. With a state filter every row has one rank, so the id alone orders.
 */
const prCursor = z.tuple([
  z.number().int().min(0).max(PR_STATE_ORDER.length),
  z.number().int().positive(),
]);

function afterPrCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) return undefined;
  const [rank, id] = decodeCursor(prCursor, cursor);
  return or(gt(prStateRank, rank), and(eq(prStateRank, rank), lt(githubPrs.id, id)));
}

type PrFacet = "repo" | "state";

function prFilters(query: z.output<typeof githubPrQueryInput>, except?: PrFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "repo" && query.repo !== undefined ? eq(githubPrs.repo, query.repo) : undefined,
    except !== "state" && query.state !== undefined ? eq(githubPrs.state, query.state) : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

/** R12: the mirrored PRs in PR_STATE_ORDER, newest id first in a state, in one REPEATABLE READ, READ ONLY snapshot. */
export async function listGithubPrs(db: Db, raw: unknown): Promise<GithubPrsPage> {
  const query = parse(githubPrQueryInput, raw);
  return db.transaction(async (tx) => {
    const ranked = await page(
      tx
        .select({ pr: githubPrs, rank: prStateRank })
        .from(githubPrs)
        .where(and(...prFilters(query), afterPrCursor(query.cursor)))
        .orderBy(asc(prStateRank), desc(githubPrs.id)),
      query.limit,
      (row) => encodeCursor([row.rank, row.pr.id]),
    );
    const [total] = await tx
      .select({ n: count })
      .from(githubPrs)
      .where(and(...prFilters(query)));
    const byRepo = await tx
      .select({ key: githubPrs.repo, n: count })
      .from(githubPrs)
      .where(and(...prFilters(query, "repo")))
      .groupBy(githubPrs.repo);
    const byState = await tx
      .select({ key: githubPrs.state, n: count })
      .from(githubPrs)
      .where(and(...prFilters(query, "state")))
      .groupBy(githubPrs.state);
    return {
      items: ranked.items.map((row) => row.pr),
      nextCursor: ranked.nextCursor,
      counts: { total: total?.n ?? 0, byRepo: tally(byRepo), byState: tally(byState) },
    };
  }, SNAPSHOT);
}
