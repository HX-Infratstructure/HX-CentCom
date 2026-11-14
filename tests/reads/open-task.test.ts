// CR24: one definition of an open task, a task that is blocked or not done. `Task.open` reads it, listWorkspace keeps
// a decision that blocks an open task, and myWork lists an agent's open tasks, so a done task that is still blocked
// stays in all three and a done, unblocked task leaves all three.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

async function addTask(id: string, blockedOn: string): Promise<void> {
  await h.q(
    `insert into engineering_tasks (id, title, agent, repository, host, status, "group", blocked_on, source_url)
     values ($1, $1, 'Codex', 'HX-Open-Test', 'HX-15', (select id from status_labels order by id limit 1), 'done', $2, $3)`,
    [id, blockedOn, "https://github.com/HX-Infratstructure/HX-CentCom/issues/1"],
  );
}

async function addDecidedDecision(id: string, blocks: readonly string[]): Promise<void> {
  await h.q(
    `insert into owner_decisions (id, summary, description, gate_type, blocks, status, decision_source_url)
     values ($1, $1, $1, 'merge', $2, 'Decided', $3)`,
    [id, blocks, "https://github.com/HX-Infratstructure/HX-CentCom/issues/10"],
  );
}

describe("an open task", () => {
  it("is blocked or not done, in Task.open, the workspace's decisions and myWork", async () => {
    await addTask("OPEN-DONE-BLOCKED", "dependency");
    await addTask("OPEN-DONE", "none");
    await addDecidedDecision("D-OPEN-BLOCKED", ["OPEN-DONE-BLOCKED"]);
    await addDecidedDecision("D-OPEN-DONE", ["OPEN-DONE"]);

    const ws = await h.svc.listWorkspace();
    const open = new Map(ws.tasks.map((t) => [t.id, t.open]));
    expect(open.get("OPEN-DONE-BLOCKED")).toBe(true);
    expect(open.get("OPEN-DONE")).toBe(false);
    expect((await h.svc.getTask("OPEN-DONE-BLOCKED")).task.open).toBe(true);
    expect((await h.svc.getTask("OPEN-DONE")).task.open).toBe(false);

    const kept = ws.decisions.map((d) => d.id);
    expect(kept).toContain("D-OPEN-BLOCKED");
    expect(kept).not.toContain("D-OPEN-DONE");

    const mine = (await h.svc.myWork(null, "Codex")).tasks.map((t) => t.id);
    expect(mine).toContain("OPEN-DONE-BLOCKED");
    expect(mine).not.toContain("OPEN-DONE");
  });
});
