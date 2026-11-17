import { describe, test } from "node:test";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/tasks.ts";
import { TasksPage } from "../live-check/checks/pages/tasks-page.ts";
import type { ReadOnlySession } from "../live-check/session.ts";
import type { TaskItem, TaskList } from "../live-check/checks/shared.ts";
import type { CheckContext } from "../live-check/types.ts";

const PAGE_SIZE = 20;

function tasksFor(counts: Record<string, number>): TaskItem[] {
  return Object.entries(counts).flatMap(([repository, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${repository}-${i}`,
      repository,
      stale: false,
      attention: [],
    })),
  );
}

/** Answers like the API: the workspace holds every task, the task list its first page in order. */
function taskApi(tasks: readonly TaskItem[], path: string): unknown {
  if (path === "/api/v1/workspace") return { tasks };
  const url = new URL(path, "http://centcom.test");
  assert.equal(url.pathname, "/api/v1/tasks");
  const repo = url.searchParams.get("repo");
  const matched = repo === null ? tasks : tasks.filter((task) => task.repository === repo);
  const byRepo: Record<string, number> = {};
  for (const task of tasks) byRepo[task.repository] = (byRepo[task.repository] ?? 0) + 1;
  const list: TaskList = {
    items: matched.slice(0, PAGE_SIZE),
    nextCursor: matched.length > PAGE_SIZE ? "next" : null,
    counts: {
      total: matched.length,
      byAgent: {},
      byRepo,
      byAttention: {
        blocked: 0,
        owner: 0,
        stale: matched.filter((task) => task.attention.includes("stale")).length,
      },
    },
  };
  return list;
}

interface DomWindow {
  readonly document: Document;
}
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { readonly window: DomWindow };
};

/** The API answers a read with `answer`; the page's `evaluate` runs against `html` in a real DOM. */
function domContext(answer: (path: string) => unknown, html: string): CheckContext {
  const { document } = new JSDOM(html).window;
  const session = {
    goto: async () => 200,
    page: {
      evaluate: async (fn: (arg: unknown) => unknown, arg?: unknown) => {
        const global = globalThis as { document?: Document };
        global.document = document;
        try {
          return fn(arg);
        } finally {
          delete global.document;
        }
      },
    },
  };
  const api = {
    getJson: async (path: string) => answer(path),
  };
  return { session, api, screenshot: async (name: string) => name } as unknown as CheckContext;
}

/** The Tasks board table, one row per task, each showing the task's ID. */
function boardTable(tasks: readonly TaskItem[]): string {
  return `<table class="board-table"><tbody>${tasks
    .map((task) => `<tr><td><code class="record-id">${task.id}</code></td></tr>`)
    .join("")}</tbody></table>`;
}

/** Each API read answers from the next snapshot of tasks; the page's board table shows `shown`. */
function fakeContext(
  snapshots: Record<string, number>[],
  shown: readonly TaskItem[],
): CheckContext {
  const reads = [...snapshots];
  const answer = (path: string) => {
    const next = reads.shift();
    assert.ok(next, "the check read the API more often than the test expected");
    return taskApi(tasksFor(next), path);
  };
  return domContext(answer, boardTable(shown));
}

const filterCheck = checks.find((check) => check.id === "tasks-filter");
assert.ok(filterCheck, "tasks-filter is exported");

describe("tasks-filter", () => {
  const firstAlphaPage = tasksFor({ alpha: 25 }).slice(0, PAGE_SIZE);

  test("a task count that moves between the API and page reads gives no data, not FAIL", async () => {
    const outcome = await filterCheck.run(
      fakeContext(
        [
          { alpha: 1, beta: 3 },
          { alpha: 2, beta: 3 },
        ],
        tasksFor({ alpha: 2 }),
      ),
    );
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED");
    assert.equal(outcome.reason, "the alpha task count moved from 1 to 2 during the check");
  });

  test("a page that ignores the filter while both API reads agree still FAILs", async () => {
    const counts = { alpha: 1, beta: 3 };
    const outcome = await filterCheck.run(fakeContext([counts, counts], tasksFor(counts)));
    assert.equal(outcome.status, "FAIL");
    assert.equal(outcome.reason, "filtered task IDs differ from the API's first page");
  });

  test("the filtered tasks on a stable API PASS", async () => {
    const counts = { alpha: 1, beta: 3 };
    const outcome = await filterCheck.run(fakeContext([counts, counts], tasksFor({ alpha: 1 })));
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("with more tasks than one page, the page shows the first page of the filtered list", async () => {
    const counts = { alpha: 25, beta: 30 };
    const firstPage = await filterCheck.run(fakeContext([counts, counts], firstAlphaPage));
    assert.equal(firstPage.status, "PASS", firstPage.reason);
    const everyTask = await filterCheck.run(fakeContext([counts, counts], tasksFor({ alpha: 25 })));
    assert.equal(everyTask.status, "FAIL");
  });

  test("a full page of another repository's tasks FAILs, though its row count matches", async () => {
    const counts = { alpha: 25, beta: 30 };
    const betaPage = tasksFor({ beta: 30 }).slice(0, PAGE_SIZE);
    const outcome = await filterCheck.run(fakeContext([counts, counts], betaPage));
    assert.equal(outcome.status, "FAIL");
    assert.deepEqual(outcome.evidence["shown"], betaPage.map((task) => task.id).sort());
    assert.deepEqual(outcome.evidence["expected"], firstAlphaPage.map((task) => task.id).sort());
  });

  test("a count that moves with more tasks than one page still gives no data", async () => {
    const outcome = await filterCheck.run(
      fakeContext(
        [
          { alpha: 25, beta: 30 },
          { alpha: 26, beta: 30 },
        ],
        firstAlphaPage,
      ),
    );
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED");
    assert.equal(outcome.reason, "the alpha task count moved from 25 to 26 during the check");
  });
});

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
    const tasks: TaskItem[] = [
      { id: "OPEN-1", repository: "r", stale: true, attention: ["stale"] },
      { id: "DONE-1", repository: "r", stale: true, attention: [] },
    ];
    const ctx = domContext((path) => taskApi(tasks, path), rows);
    const outcome = await checkById("stale-badge").run(ctx);
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("a reworded badge tooltip still counts as the stale badge", async () => {
    const reworded = rows.replace(staleTitle, "Commit is behind its repository head.");
    const tasks: TaskItem[] = [
      { id: "OPEN-1", repository: "r", stale: true, attention: ["stale"] },
    ];
    const outcome = await checkById("stale-badge").run(
      domContext((path) => taskApi(tasks, path), reworded),
    );
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("a stale task beyond the first page is not expected on the page", async () => {
    const firstPage = tasksFor({ r: PAGE_SIZE });
    const beyond: TaskItem = { id: "LATE-1", repository: "r", stale: true, attention: ["stale"] };
    const ctx = domContext((path) => taskApi([...firstPage, beyond], path), boardTable(firstPage));
    const outcome = await checkById("stale-badge").run(ctx);
    assert.equal(outcome.status, "PASS", outcome.reason);
  });
});

describe("TasksPage", () => {
  function pageWith(buttons: number) {
    const visited: string[] = [];
    const session = {
      goto: async (path: string) => {
        visited.push(path);
        return 200;
      },
      page: {
        locator: () => ({
          count: async () => buttons,
          click: async () => {
            throw new Error("locator.click: Timeout 30000ms exceeded");
          },
        }),
      },
    } as unknown as ReadOnlySession;
    return { page: new TasksPage(session), visited };
  }

  test("open takes the query and the fragment in one convention, neither with its prefix", async () => {
    const { page, visited } = pageWith(0);
    await page.open({ task: "T 1" }, "updates");
    await page.open();
    assert.deepEqual(visited, ["/tasks?task=T+1#updates", "/tasks"]);
  });

  test("Show more without its button fails with a diagnostic, not a click timeout", async () => {
    const { page } = pageWith(0);
    await assert.rejects(page.showMore(), { message: "the update log has no Show more button" });
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
  const updatesApi = (path: string) => {
    assert.equal(path, "/api/v1/updates");
    return updates;
  };

  test("a feed of only system rows shows no agent badge, so it is no data, not PASS", async () => {
    const ctx = domContext(updatesApi, feed(systemRow, systemRow));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED");
  });

  test("an agent row without a badge FAILs even beside a system row", async () => {
    const ctx = domContext(updatesApi, feed(systemRow, agentRow(false)));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "FAIL");
  });

  test("agent rows with badges beside a system row PASS", async () => {
    const ctx = domContext(updatesApi, feed(systemRow, agentRow(true)));
    const outcome = await checkById("task-feed-badges").run(ctx);
    assert.equal(outcome.status, "PASS", outcome.reason);
  });
});
