import { describe, test } from "node:test";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/tasks.ts";
import type { Workspace, WorkspaceTask } from "../live-check/checks/shared.ts";
import type { CheckContext } from "../live-check/types.ts";

function tasksFor(counts: Record<string, number>): WorkspaceTask[] {
  return Object.entries(counts).flatMap(([repository, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${repository}-${i}`,
      repository,
      stale: false,
      attention: [],
    })),
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

interface DomWindow {
  readonly document: Document;
}
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { readonly window: DomWindow };
};

/** The API answers `path` with `body`; the page's `evaluate` runs against `html` in a real DOM. */
function domContext(path: string, body: unknown, html: string): CheckContext {
  const { document } = new JSDOM(html).window;
  const session = {
    goto: async () => 200,
    page: {
      evaluate: async (fn: () => unknown) => {
        const global = globalThis as { document?: Document };
        global.document = document;
        try {
          return fn();
        } finally {
          delete global.document;
        }
      },
    },
  };
  const api = {
    getJson: async (read: string) => {
      assert.equal(read, path);
      return body;
    },
  };
  return { session, api, screenshot: async (name: string) => name } as unknown as CheckContext;
}

function checkById(id: string) {
  const check = checks.find((candidate) => candidate.id === id);
  assert.ok(check, `${id} is exported`);
  return check;
}

describe("stale-badge", () => {
  const staleTitle = "This task's commit is not its repository's head.";
  const rows = `<table class="board-table"><tbody>
    <tr><td><code class="record-id">OPEN-1</code><span class="attention" title="${staleTitle}">Stale commit</span></td></tr>
    <tr><td><code class="record-id">DONE-1</code></td></tr>
  </tbody></table>`;

  test("a completed stale task, which the UI shows no badge for, is not expected to have one", async () => {
    const tasks = [
      { id: "OPEN-1", repository: "r", stale: true, attention: ["stale"] },
      { id: "DONE-1", repository: "r", stale: true, attention: [] },
    ];
    const ctx = domContext("/api/v1/workspace", { tasks }, rows);
    const outcome = await checkById("stale-badge").run(ctx);
    assert.equal(outcome.status, "PASS", outcome.reason);
  });
});

describe("task-feed-badges", () => {
  const systemRow = `<article class="update-item" data-kind="note"><header class="update-head">
    <span class="agent-person system-person"><span class="agent-person-name">System</span></span>
  </header></article>`;
  const agentRow = (
    badge: boolean,
  ) => `<article class="update-item" data-kind="note"><header class="update-head">
    ${badge ? '<span class="agent-person"><span class="agent-person-name">CC1</span></span>' : ""}
  </header></article>`;
  const feed = (...items: string[]) => `<section id="updates">${items.join("")}</section>`;
  const updates = { items: [{ task_id: "T-1" }] };

  test("a feed of only system rows shows no agent badge, so it is no data, not PASS", async () => {
    const ctx = domContext("/api/v1/updates", updates, feed(systemRow, systemRow));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED");
  });

  test("an agent row without a badge FAILs even beside a system row", async () => {
    const ctx = domContext("/api/v1/updates", updates, feed(systemRow, agentRow(false)));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "FAIL");
  });

  test("agent rows with badges beside a system row PASS", async () => {
    const ctx = domContext("/api/v1/updates", updates, feed(systemRow, agentRow(true)));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "PASS", outcome.reason);
  });
});
