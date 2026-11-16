import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/tasks.ts";
import type { Workspace, WorkspaceTask } from "../live-check/checks/shared.ts";
import type { CheckContext } from "../live-check/types.ts";

function tasksFor(counts: Record<string, number>): WorkspaceTask[] {
  return Object.entries(counts).flatMap(([repository, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${repository}-${i}`, repository, stale: false })),
  );
}

function workspace(counts: Record<string, number>): Workspace {
  return { tasks: tasksFor(counts), agents: [], statusLabels: [], updatesCursor: null };
}

/** Each `/api/v1/workspace` read returns the next snapshot; the page renders `rows` table rows. */
function fakeContext(snapshots: Workspace[], rows: number): CheckContext {
  const reads = [...snapshots];
  const session = {
    goto: async () => 200,
    page: { locator: () => ({ count: async () => rows }) },
  };
  const api = {
    getJson: async (path: string) => {
      assert.equal(path, "/api/v1/workspace");
      const next = reads.shift();
      assert.ok(next, "the check read the workspace more often than the test expected");
      return next;
    },
  };
  return {
    session,
    api,
    screenshot: async (name: string) => name,
  } as unknown as CheckContext;
}

const filterCheck = checks.find((check) => check.id === "tasks-filter");
assert.ok(filterCheck, "tasks-filter is exported");

describe("tasks-filter", () => {
  test("a task count that moves between the API and page reads gives no data, not FAIL", async () => {
    const before = workspace({ alpha: 1, beta: 3 });
    const after = workspace({ alpha: 2, beta: 3 });
    const outcome = await filterCheck.run(fakeContext([before, after], 2));
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED");
    assert.equal(outcome.reason, "the alpha task count moved from 1 to 2 during the check");
  });

  test("rows that differ while both API reads agree still FAIL", async () => {
    const counts = { alpha: 1, beta: 3 };
    const outcome = await filterCheck.run(fakeContext([workspace(counts), workspace(counts)], 4));
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.reason, "filtered rows differ from the API count");
  });

  test("rows that match a stable API count PASS", async () => {
    const counts = { alpha: 1, beta: 3 };
    const outcome = await filterCheck.run(fakeContext([workspace(counts), workspace(counts)], 1));
    assert.equal(outcome.status, "PASS");
  });
});
