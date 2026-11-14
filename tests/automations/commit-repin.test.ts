// F9 (CC1's follow-up 3): a task update that carries commitSha repins the task's commit_sha in the same write, so
// `stale` follows the merge commit that the hook posts after `gh pr merge` (SPEC:181). The activity row records the
// commit only when the update carries one, and the owner's revert of that row puts the old commit back.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGithubSnapshot } from "@/server/services";
import { setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const SR = "HX-Semantic-Router";
const MERGE_COMMIT = "b".repeat(40);

const irp04 = async () => (await h.svc.getTask("IRP-04")).task;
const latestTaskActivity = async () => {
  const [row] = (await h.svc.listActivity({ entity: "task", entityId: "IRP-04", limit: 1 })).items;
  if (!row) throw new Error("no activity row for IRP-04");
  return row;
};

describe("a commitSha on a task update repins the task", () => {
  it("pins IRP-04 to a merged PR's merge commit, so it is not stale, and a revert restores the old commit", async () => {
    await recordGithubSnapshot(h.db, {
      repos: [{ name: SR, headSha: "a".repeat(40), defaultBranch: "main" }],
      prs: [
        {
          id: 501,
          repo: SR,
          number: 51,
          title: "Merged work",
          state: "merged",
          draft: false,
          headSha: "c".repeat(40),
          mergeCommitSha: MERGE_COMMIT,
          url: `https://github.com/HX-Infratstructure/${SR}/pull/51`,
        },
      ],
      stateUpdates: [],
      fetchedAt: new Date("2026-11-14T12:00:00Z"),
    });
    expect(await irp04()).toMatchObject({ commit_sha: "c34c7cb", stale: true });

    await h.svc.postProgress(h.as.CC2, "IRP-04", {
      kind: "note",
      note: "No commit here.",
      source: "api",
    });
    expect(await irp04()).toMatchObject({ commit_sha: "c34c7cb", stale: true });
    const plain = await latestTaskActivity();
    expect(plain.before).not.toHaveProperty("commit_sha");
    expect(plain.after).not.toHaveProperty("commit_sha");

    await h.svc.postProgress(h.as.CC2, "IRP-04", {
      kind: "link",
      note: "Merged PR 51.",
      commitSha: MERGE_COMMIT.toUpperCase(),
      prUrl: `https://github.com/HX-Infratstructure/${SR}/pull/51`,
      source: "hook",
    });
    expect(await irp04()).toMatchObject({ commit_sha: MERGE_COMMIT, stale: false });
    const repin = await latestTaskActivity();
    expect(repin).toMatchObject({
      action: "task.progress",
      before: { commit_sha: "c34c7cb" },
      after: { commit_sha: MERGE_COMMIT },
    });

    await h.svc.revertActivity(h.as.OWNER, repin.id);
    expect(await irp04()).toMatchObject({ commit_sha: "c34c7cb", stale: true });
  });
});
