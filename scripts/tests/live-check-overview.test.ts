import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/overview.ts";
import type { CheckContext, CheckOutcome } from "../live-check/types.ts";

function fakeContext(api: Record<string, unknown>, pageData: unknown): CheckContext {
  const session = {
    goto: async () => 200,
    page: { evaluate: async () => pageData },
  };
  return {
    base: "http://h",
    session,
    api: {
      getJson: async (path: string) => {
        if (!(path in api)) throw new Error(`unexpected API path ${path}`);
        return api[path];
      },
    },
    screenshot: async (name: string) => name,
  } as unknown as CheckContext;
}

function run(id: string, ctx: CheckContext): Promise<CheckOutcome> {
  const check = checks.find((entry) => entry.id === id);
  assert.ok(check, `check ${id} exists`);
  return check.run(ctx);
}

const OPEN_PRS = "/api/v1/github/prs?state=open&limit=100";

describe("pull-requests-open-first", () => {
  test("passes with no Open group when no pull request is open", async () => {
    const ctx = fakeContext({ [OPEN_PRS]: { items: [], counts: { total: 0 } } }, [
      { title: "Merged", rows: 3 },
    ]);
    assert.equal((await run("pull-requests-open-first", ctx)).status, "PASS");
  });

  test("fails when an Open group shows although no pull request is open", async () => {
    const ctx = fakeContext({ [OPEN_PRS]: { items: [], counts: { total: 0 } } }, [
      { title: "Merged", rows: 3 },
      { title: "Open", rows: 1 },
    ]);
    assert.equal((await run("pull-requests-open-first", ctx)).status, "FAIL");
  });

  test("still needs the Open group first with the API's row count", async () => {
    const api = { [OPEN_PRS]: { items: [], counts: { total: 2 } } };
    const first = fakeContext(api, [
      { title: "Open", rows: 2 },
      { title: "Merged", rows: 3 },
    ]);
    assert.equal((await run("pull-requests-open-first", first)).status, "PASS");
    const missing = fakeContext(api, [{ title: "Merged", rows: 3 }]);
    assert.equal((await run("pull-requests-open-first", missing)).status, "FAIL");
    const wrongCount = fakeContext(api, [{ title: "Open", rows: 1 }]);
    assert.equal((await run("pull-requests-open-first", wrongCount)).status, "FAIL");
  });
});

const CREATED = "2026-11-16T17:00:00.123Z";

function activityContext(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  change: { field: string; from: string | null; to: string | null },
  entity = "task",
): CheckContext {
  return fakeContext(
    {
      "/api/v1/activity": {
        items: [{ entity, actor: "cc1", created_at: "2026-11-16T17:00:00.123456Z", before, after }],
      },
      "/api/v1/workspace": {
        agents: [{ id: "cc1", display_name: "CC1" }],
        statusLabels: [
          { id: "todo", label: "To do" },
          { id: "done", label: "Done" },
        ],
      },
    },
    [{ actorName: "CC1", createdAt: CREATED, changes: [change] }],
  );
}

describe("activity-row-changes", () => {
  test("passes when the shown values are the API values as the page prints them", async () => {
    const ctx = activityContext(
      { title: "Old title", priority: null, done: false, commit_sha: "abcdef0123456789" },
      { title: "New title", priority: 2, done: true, commit_sha: "1234567890abcdef" },
      { field: "title", from: "Old title", to: "New title" },
    );
    assert.equal((await run("activity-row-changes", ctx)).status, "PASS");
    for (const change of [
      { field: "priority", from: "none", to: "2" },
      { field: "done", from: "false", to: "true" },
      { field: "commit sha", from: "abcdef0", to: "1234567" },
    ]) {
      const each = activityContext(
        { priority: null, done: false, commit_sha: "abcdef0123456789" },
        { priority: 2, done: true, commit_sha: "1234567890abcdef" },
        change,
      );
      assert.equal((await run("activity-row-changes", each)).status, "PASS", change.field);
    }
  });

  test("fails when the shown values differ from the API values", async () => {
    const ctx = activityContext(
      { title: "Old title" },
      { title: "New title" },
      { field: "title", from: "wrong-a", to: "wrong-b" },
    );
    assert.equal((await run("activity-row-changes", ctx)).status, "FAIL");
  });

  test("fails when only one side differs from the API value", async () => {
    const ctx = activityContext(
      { title: "Old title" },
      { title: "New title" },
      { field: "title", from: "Old title", to: "wrong-b" },
    );
    assert.equal((await run("activity-row-changes", ctx)).status, "FAIL");
  });

  test("long text shows as edited, with no from value", async () => {
    const long = "x".repeat(41);
    const ok = activityContext(
      { notes: "short" },
      { notes: long },
      { field: "notes", from: null, to: "edited" },
    );
    assert.equal((await run("activity-row-changes", ok)).status, "PASS");
    const printed = activityContext(
      { notes: "short" },
      { notes: long },
      { field: "notes", from: "short", to: long },
    );
    assert.equal((await run("activity-row-changes", printed)).status, "FAIL");
  });

  test("a labelled field shows the page's labels", async () => {
    const cases = [
      {
        entity: "decision",
        key: "status",
        from: "Pending",
        to: "Decided",
        shownFrom: "Pending",
        shownTo: "Decided",
      },
      {
        entity: "requirement",
        key: "state",
        from: "PASS",
        to: "FAIL",
        shownFrom: "Proven",
        shownTo: "Failed",
      },
      {
        entity: "raid_item",
        key: "validation_state",
        from: "unverified",
        to: "validated",
        shownFrom: "Unverified",
        shownTo: "Validated",
      },
      {
        entity: "task",
        key: "status",
        from: "todo",
        to: "done",
        shownFrom: "To do",
        shownTo: "Done",
      },
      {
        entity: "task",
        key: "status",
        from: "todo",
        to: "gone",
        shownFrom: "To do",
        shownTo: "gone",
      },
    ];
    for (const c of cases) {
      const field = c.key.replace(/_/g, " ");
      const [from, to] = [c.shownFrom, c.shownTo];
      const right = activityContext(
        { [c.key]: c.from },
        { [c.key]: c.to },
        { field, from, to },
        c.entity,
      );
      assert.equal(
        (await run("activity-row-changes", right)).status,
        "PASS",
        `${c.entity} ${c.key}`,
      );
    }
  });

  test("a labelled field showing the wrong labels fails", async () => {
    const cases = [
      {
        entity: "decision",
        key: "status",
        from: "Pending",
        to: "Decided",
        shownFrom: "wrong-a",
        shownTo: "wrong-b",
      },
      {
        entity: "decision",
        key: "status",
        from: "Pending",
        to: "Decided",
        shownFrom: "Pending",
        shownTo: "Deferred",
      },
      {
        entity: "requirement",
        key: "state",
        from: "PASS",
        to: "FAIL",
        shownFrom: "PASS",
        shownTo: "FAIL",
      },
      {
        entity: "task",
        key: "status",
        from: "todo",
        to: "done",
        shownFrom: "todo",
        shownTo: "done",
      },
    ];
    for (const c of cases) {
      const field = c.key.replace(/_/g, " ");
      const [from, to] = [c.shownFrom, c.shownTo];
      const wrong = activityContext(
        { [c.key]: c.from },
        { [c.key]: c.to },
        { field, from, to },
        c.entity,
      );
      assert.equal(
        (await run("activity-row-changes", wrong)).status,
        "FAIL",
        `${c.entity} ${from} ${to}`,
      );
    }
  });
});
