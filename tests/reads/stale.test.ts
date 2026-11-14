// F9 (CC1's design H1): every task the services return carries `stale`. It is null when the task has no commit_sha or
// its repository has no GitHub mirror row. It is false when the task's SHA is a case-insensitive prefix of the
// repository head, an open PR's head or a merged PR's merge commit in the same repository, and true otherwise. A
// Complete task pinned to a merge commit is not stale. The workspace, getTask and myWork agree.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGithubSnapshot, type GithubPrInput, type Task } from "@/server/services";
import { setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const SR = "HX-Semantic-Router";
const full = (prefix: string) => prefix.padEnd(40, "0");

function pr(id: number, repo: string, fields: Partial<GithubPrInput>): GithubPrInput {
  return {
    id,
    repo,
    number: id,
    title: `PR ${id}`,
    state: "open",
    draft: false,
    headSha: full("ffffff1"),
    mergeCommitSha: null,
    url: `https://github.com/HX-Infratstructure/${repo}/pull/${id}`,
    ...fields,
  };
}

async function record(
  repos: readonly { name: string; headSha: string }[],
  prs: readonly GithubPrInput[],
): Promise<void> {
  await recordGithubSnapshot(h.db, {
    repos: repos.map((r) => ({ ...r, defaultBranch: "main" })),
    prs,
    stateUpdates: [],
    fetchedAt: new Date("2026-11-14T12:00:00Z"),
  });
}

async function staleByTask(): Promise<Record<string, boolean | null>> {
  const { tasks } = await h.svc.listWorkspace();
  return Object.fromEntries(tasks.map((t: Task) => [t.id, t.stale]));
}

describe("stale", () => {
  it("is null on every seeded task while no GitHub data is mirrored", async () => {
    const stale = await staleByTask();
    expect(Object.keys(stale).length).toBeGreaterThan(0);
    expect(Object.values(stale).every((s) => s === null)).toBe(true);
  });

  it("is false for a Complete task pinned to a merged PR's merge commit, matched case-insensitively", async () => {
    await record(
      [{ name: SR, headSha: full("aaaaaaa") }],
      [pr(1, SR, { state: "merged", headSha: full("bbbbbbb"), mergeCommitSha: full("FC08970") })],
    );
    const stale = await staleByTask();
    expect(stale["IRP-05"], "IRP-05 (Complete) sits on fc08970").toBe(false);
    expect(stale["IRP-04"], "IRP-04's c34c7cb matches nothing").toBe(true);
  });

  it("counts an open PR's head and the repository head, and not a closed PR, a merged head or another repository", async () => {
    await record(
      [
        { name: SR, headSha: full("aaaaaaa") },
        { name: "HX-Agent-Lab", headSha: full("06475AC") },
      ],
      [
        pr(1, SR, { state: "closed", headSha: full("c34c7cb") }),
        pr(2, SR, { state: "merged", headSha: full("fc08970"), mergeCommitSha: full("ddddddd") }),
        pr(3, "HX-Agent-Lab", { state: "open", headSha: full("c34c7cb") }),
      ],
    );
    expect(await staleByTask()).toMatchObject({ "IRP-04": true, "IRP-05": true, "IRP-UI": false });

    await record([], [pr(4, SR, { state: "open", headSha: full("C34C7CB") })]);
    expect(await staleByTask()).toMatchObject({ "IRP-04": false });
  });

  it("is null without commit_sha or without a mirror row for the task's repository", async () => {
    await record(
      [{ name: "HX-CentCom", headSha: full("aaaaaaa") }],
      [pr(1, "HX-Qdrant", { state: "open", headSha: full("68053f0") })],
    );
    const stale = await staleByTask();
    expect(stale["CC-01"], "CC-01 has no commit_sha").toBeNull();
    expect(stale["RO-01"], "HX-Qdrant has no github_repos row").toBeNull();
  });

  it("is the same in the workspace, getTask and myWork", async () => {
    await record(
      [{ name: SR, headSha: full("aaaaaaa") }],
      [pr(1, SR, { state: "merged", headSha: full("bbbbbbb"), mergeCommitSha: full("fc08970") })],
    );
    const stale = await staleByTask();
    expect(stale).toMatchObject({ "IRP-04": true, "IRP-05": false });
    expect((await h.svc.getTask("IRP-04")).task.stale).toBe(true);
    expect((await h.svc.getTask("IRP-05")).task.stale).toBe(false);
    const cc2 = await h.svc.myWork(h.as.CC2);
    expect(cc2.tasks.map((t) => [t.id, t.stale])).toEqual([["IRP-04", true]]);
  });
});
