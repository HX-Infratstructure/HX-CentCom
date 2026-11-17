// Roadmap item 7 P1: listTasks pages the tasks blocked first, then by start date (missing last), then by id, with
// facet counts that ignore their own filter and the cursor.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "@/server/services";
import { expectInvalidAt, setup, WEB_SOURCE, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

type Seed = {
  readonly id: string;
  readonly repo: string;
  readonly agent?: string;
  readonly blockedOn?: string;
  readonly group?: string;
  readonly start?: string | null;
};

async function addTask(t: Seed): Promise<void> {
  await h.q(
    `insert into engineering_tasks (id, title, agent, repository, host, status, "group", blocked_on, start_date, source_url)
     values ($1, $1, $2, $3, 'HX-15', (select id from status_labels order by id limit 1), $4, $5, $6, $7)`,
    [
      t.id,
      t.agent ?? "Codex",
      t.repo,
      t.group ?? "in_progress",
      t.blockedOn ?? "none",
      t.start ?? null,
      WEB_SOURCE,
    ],
  );
}

async function everyPage(query: Record<string, unknown>): Promise<Task[][]> {
  const pages: Task[][] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await h.svc.listTasks({ ...query, ...(cursor ? { cursor } : {}) });
    pages.push([...page.items]);
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
  }
}

describe("listTasks", () => {
  it("lists blocked tasks first, then by start date with missing dates last, then by id", async () => {
    const repo = "HX-Order-Test";
    await addTask({ id: "ORD-NODATE", repo, start: null });
    await addTask({ id: "ORD-TIE-B", repo, start: "2026-02-01" });
    await addTask({ id: "ORD-TIE-A", repo, start: "2026-02-01" });
    await addTask({ id: "ORD-EARLY", repo, start: "2026-01-01" });
    await addTask({ id: "ORD-BLOCKED", repo, blockedOn: "dependency", start: "2026-03-01" });

    const ids = (await h.svc.listTasks({ repo })).items.map((t) => t.id);
    expect(ids).toEqual(["ORD-BLOCKED", "ORD-EARLY", "ORD-TIE-A", "ORD-TIE-B", "ORD-NODATE"]);
  });

  it("pages 20 at a time and reaches every task exactly once", async () => {
    const repo = "HX-Page-Test";
    for (let i = 0; i < 45; i++) {
      await addTask({
        id: `PG-${String(i).padStart(2, "0")}`,
        repo,
        blockedOn: i % 7 === 0 ? "dependency" : "none",
        start: i % 5 === 0 ? null : `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }
    const pages = await everyPage({ repo });
    expect(pages.map((p) => p.length)).toEqual([20, 20, 5]);
    const ids = pages.flat().map((t) => t.id);
    expect(new Set(ids).size).toBe(45);
    expect(ids).toHaveLength(45);
  });

  it("refuses a limit over 100 and a cursor from another list", async () => {
    await expectInvalidAt(h.svc.listTasks({ limit: 101 }), "limit");
    await addTask({ id: "CUR-1", repo: "HX-Cursor-Test" });
    await h.q(
      `insert into task_updates (task_id, agent_id, kind, note) values ('CUR-1', 'Codex', 'system', 'a'), ('CUR-1', 'Codex', 'system', 'b')`,
    );
    const updates = await h.svc.listUpdates({ limit: 1 });
    expect(updates.nextCursor).not.toBeNull();
    await expectInvalidAt(h.svc.listTasks({ cursor: updates.nextCursor ?? "" }), "cursor");
    await h.q(
      `insert into owner_decisions (id, summary, description, gate_type, blocks, status, decision_source_url)
       values ('D-CUR-1', 'a', 'a', 'merge', '{}', 'Decided', $1), ('D-CUR-2', 'b', 'b', 'merge', '{}', 'Decided', $1)`,
      [WEB_SOURCE],
    );
    const decisions = await h.svc.listDecisions({ limit: 1 });
    expect(decisions.nextCursor).not.toBeNull();
    await expectInvalidAt(h.svc.listTasks({ cursor: decisions.nextCursor ?? "" }), "cursor");
  });

  it("filters by agent, repository, attention and open", async () => {
    const repo = "HX-Filter-Test";
    await addTask({ id: "FL-CC1", repo, agent: "CC1" });
    await addTask({ id: "FL-CODEX-BLOCKED", repo, agent: "Codex", blockedOn: "dependency" });
    await addTask({ id: "FL-CODEX-DONE", repo, agent: "Codex", group: "done" });
    await addTask({ id: "FL-OTHER-REPO", repo: "HX-Filter-Other", agent: "CC1" });

    const ids = async (q: Record<string, unknown>) =>
      (await h.svc.listTasks({ repo, ...q })).items.map((t) => t.id).sort();
    expect(await ids({})).toEqual(["FL-CC1", "FL-CODEX-BLOCKED", "FL-CODEX-DONE"]);
    expect(await ids({ agentId: "CC1" })).toEqual(["FL-CC1"]);
    expect(await ids({ attention: "blocked" })).toEqual(["FL-CODEX-BLOCKED"]);
    expect(await ids({ open: true })).toEqual(["FL-CC1", "FL-CODEX-BLOCKED"]);
    expect(await ids({ open: "true" })).toEqual(["FL-CC1", "FL-CODEX-BLOCKED"]);
    expect(await ids({ open: "false" })).toEqual(["FL-CODEX-DONE"]);
    await expectInvalidAt(h.svc.listTasks({ open: "yes" } as never), "open");
    const other = await h.svc.listTasks({ repo: "HX-Filter-Other" });
    expect(other.items.map((t) => t.id)).toEqual(["FL-OTHER-REPO"]);
  });

  it("counts each facet without its own filter, with open on every count, the same on every page", async () => {
    const repo = "HX-Count-Test";
    await addTask({ id: "CT-CC1-1", repo, agent: "CC1" });
    await addTask({ id: "CT-CC1-2", repo, agent: "CC1", blockedOn: "dependency" });
    await addTask({ id: "CT-CC2-1", repo, agent: "CC2", blockedOn: "dependency" });
    await addTask({ id: "CT-CC2-DONE", repo, agent: "CC2", group: "done" });
    await addTask({ id: "CT-ELSE", repo: "HX-Count-Else", agent: "CC1", blockedOn: "dependency" });

    const first = await h.svc.listTasks({
      repo,
      agentId: "CC1",
      attention: "blocked",
      open: true,
      limit: 1,
    });
    expect(first.items.map((t) => t.id)).toEqual(["CT-CC1-2"]);
    expect(first.counts.total).toBe(1);
    expect(first.counts.byAgent).toEqual({ CC1: 1, CC2: 1 });
    expect(first.counts.byRepo).toEqual({ [repo]: 1, "HX-Count-Else": 1 });
    expect(first.counts.byAttention.blocked).toBe(1);
    expect(first.counts.byAttention.owner ?? 0).toBe(0);

    const all = await h.svc.listTasks({ repo, limit: 2 });
    expect(all.counts.total).toBe(4);
    expect(all.counts.byAgent).toEqual({ CC1: 2, CC2: 2 });
    expect(all.counts.byAttention.blocked).toBe(2);
    expect(all.nextCursor).not.toBeNull();
    const second = await h.svc.listTasks({ repo, limit: 2, cursor: all.nextCursor ?? "" });
    expect(second.counts).toEqual(all.counts);

    const open = await h.svc.listTasks({ repo, open: true });
    expect(open.counts.total).toBe(3);
    expect(open.counts.byAgent).toEqual({ CC1: 2, CC2: 1 });
  });

  it("returns each task as getTask does", async () => {
    const repo = "HX-Same-Test";
    await addTask({ id: "SAME-1", repo, blockedOn: "owner_decision", start: "2026-01-02" });
    await addTask({ id: "SAME-2", repo, group: "done" });
    await h.q(
      `insert into task_requirements (task_id, requirement, state, source_url, proof_url)
       values ($1, 'r1', 'PASS', $2, $2), ($1, 'r2', 'FAIL', $2, null)`,
      ["SAME-1", WEB_SOURCE],
    );
    const page = await h.svc.listTasks({ repo });
    expect(page.items).toHaveLength(2);
    for (const t of page.items) {
      const { task } = await h.svc.getTask(t.id);
      expect(t).toEqual(task);
    }
    expect(page.items[0]?.progress).toEqual({ proven: 1, total: 2, percent: 50 });
    expect(page.items[0]?.attention).toEqual(["blocked", "owner"]);
  });
});
