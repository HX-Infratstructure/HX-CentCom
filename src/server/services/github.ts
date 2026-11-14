/**
 * The GitHub mirror (`github_repos`, `github_prs`) that scripts/github-sync.ts refreshes. These writes add no
 * activity_log row. The sync is not an agent (activity_log.actor references agents), and copying GitHub's state is
 * not an actor's write.
 */
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { githubPrs, githubRepos } from "@/server/db/schema";

export type GithubPrState = "open" | "closed" | "merged" | "gone";

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
