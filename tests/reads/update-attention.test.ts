// CodeRabbit 4575492144: the overview's needs-attention feed names a reason, and the server selects that reason's open
// tasks, so a reason with more than 100 tasks still reads. A task is open when it is blocked or not done. `blocked` is
// any blocked_on but none. `owner` is Ready for owner, blocked on an owner decision or an assignment, or listed in a
// Pending decision's `blocks`. `stale` is the task's computed `stale` being true. `attention` belongs to the task facet
// with `taskId` and `taskIds`, and is a 400 beside either.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as updatesRoute } from "@/routes/api/v1/updates";
import { recordGithubSnapshot, type UpdateQueryInput } from "@/server/services";
import { expectInvalidAt, mcpClient, rest, setup, toolValue, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const REPO = "HX-Attention-Test";
const full = (prefix: string) => prefix.padEnd(40, "0");

type Row = { id: string; group?: string; blocked_on?: string; commit_sha?: string };

async function addTasks(rows: readonly Row[]): Promise<void> {
  for (const r of rows) {
    await h.q(
      `insert into engineering_tasks (id, title, agent, repository, host, commit_sha, status, "group", blocked_on, source_url)
       values ($1, $1, 'Codex', $2, 'HX-15', $3, (select id from status_labels order by id limit 1), $4, $5, $6)`,
      [
        r.id,
        REPO,
        r.commit_sha ?? null,
        r.group ?? "in_progress",
        r.blocked_on ?? "none",
        "https://github.com/HX-Infratstructure/HX-CentCom/issues/1",
      ],
    );
    await h.q(
      `insert into task_updates (task_id, agent_id, kind, note, source) values ($1, 'Codex', 'progress', $1, 'api')`,
      [r.id],
    );
  }
}

async function addDecision(id: string, blocks: readonly string[], status = "Pending") {
  await h.q(
    `insert into owner_decisions (id, summary, description, gate_type, blocks, status, decision_source_url)
     values ($1, $1, $1, 'merge', $2, $3, $4)`,
    [
      id,
      blocks,
      status,
      status === "Pending" ? null : "https://github.com/HX-Infratstructure/HX-CentCom/issues/10",
    ],
  );
}

/** Every page of the feed, followed through its cursors. */
async function feedTasks(query: Exclude<UpdateQueryInput, undefined>): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await h.svc.listUpdates({ ...query, limit: 100, cursor });
    ids.push(...page.items.map((u) => u.task_id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ids;
}

const ours = (ids: readonly string[]) => ids.filter((id) => id.startsWith("ATT-")).sort();

/** One task per reason and per near miss, with the GitHub snapshot that makes ATT-STALE stale. */
async function addReasons(): Promise<void> {
  await addTasks([
    { id: "ATT-DEP", blocked_on: "dependency" },
    { id: "ATT-ASSIGN", blocked_on: "assignment" },
    { id: "ATT-ODEC", blocked_on: "owner_decision" },
    { id: "ATT-RFO", group: "ready_for_owner" },
    { id: "ATT-PEND" },
    { id: "ATT-DECIDED" },
    { id: "ATT-STALE", commit_sha: "bbbbbbb" },
    { id: "ATT-FRESH", commit_sha: "aaaaaaa" },
    { id: "ATT-DONE", group: "done", commit_sha: "bbbbbbb" },
    { id: "ATT-DONE-BLOCKED", group: "done", blocked_on: "dependency" },
    { id: "ATT-FREE" },
  ]);
  await addDecision("D-ATT-1", ["ATT-PEND", "ATT-DONE"]);
  await addDecision("D-ATT-2", ["ATT-DECIDED"], "Decided");
  await recordGithubSnapshot(h.db, {
    repos: [{ name: REPO, headSha: full("aaaaaaa"), defaultBranch: "main" }],
    prs: [],
    stateUpdates: [],
    fetchedAt: new Date("2026-11-14T12:00:00Z"),
  });
}

describe("listUpdates attention", () => {
  it("returns the updates of more than 100 blocked tasks, which taskIds cannot name", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `ATT-B${String(i).padStart(3, "0")}`,
      blocked_on: "dependency",
    }));
    await addTasks([...many, { id: "ATT-FREE" }]);

    await expectInvalidAt(h.svc.listUpdates({ taskIds: many.map((t) => t.id) }), "taskIds");
    const feed = ours(await feedTasks({ attention: "blocked" }));
    expect(feed).toEqual(many.map((t) => t.id));
    expect(feed).not.toContain("ATT-FREE");
  });

  it("selects each reason's open tasks by the overview's definition", async () => {
    await addReasons();

    expect(ours(await feedTasks({ attention: "blocked" }))).toEqual(
      ["ATT-ASSIGN", "ATT-DEP", "ATT-DONE-BLOCKED", "ATT-ODEC"].sort(),
    );
    expect(ours(await feedTasks({ attention: "owner" }))).toEqual(
      ["ATT-ASSIGN", "ATT-ODEC", "ATT-PEND", "ATT-RFO"].sort(),
    );
    expect(ours(await feedTasks({ attention: "stale" }))).toEqual(["ATT-STALE"]);
  });

  it("gives each task the reasons whose feed holds its updates, in every task read", async () => {
    await addReasons();
    const { tasks } = await h.svc.listWorkspace();
    const reasons = ["blocked", "owner", "stale"] as const;
    for (const attention of reasons) {
      const flagged = ours(tasks.filter((t) => t.attention.includes(attention)).map((t) => t.id));
      expect(flagged.length, attention).toBeGreaterThan(0);
      expect(flagged, attention).toEqual(ours(await feedTasks({ attention })));
    }
    const byId = new Map(tasks.map((t) => [t.id, t.attention]));
    expect(byId.get("ATT-ASSIGN")).toEqual(["blocked", "owner"]);
    expect(byId.get("ATT-DONE")).toEqual([]);
    expect((await h.svc.getTask("ATT-ASSIGN")).task.attention).toEqual(["blocked", "owner"]);
    expect((await h.svc.getTask("ATT-STALE")).task.attention).toEqual(["stale"]);
  });

  it("counts under the facet rule: byTask drops the reason, every other count applies it", async () => {
    await addTasks([{ id: "ATT-DEP", blocked_on: "dependency" }, { id: "ATT-FREE" }]);
    const page = await h.svc.listUpdates({ attention: "blocked", agentId: "Codex" });
    expect(page.items.map((u) => u.task_id)).toEqual(["ATT-DEP"]);
    expect(page.counts.total).toBe(1);
    expect(page.counts.bySource).toEqual({ api: 1 });
    expect(page.counts.byTask).toMatchObject({ "ATT-DEP": 1, "ATT-FREE": 1 });
  });

  it("refuses attention beside taskId or taskIds, at attention", async () => {
    await expectInvalidAt(
      h.svc.listUpdates({ attention: "blocked", taskIds: ["CC-01"] }),
      "attention",
    );
    await expectInvalidAt(h.svc.listUpdates({ attention: "owner", taskId: "CC-01" }), "attention");
  });

  it("takes ?attention= over REST and attention in the MCP list_updates tool", async () => {
    await addTasks([{ id: "ATT-DEP", blocked_on: "dependency" }, { id: "ATT-FREE" }]);
    const expected = JSON.parse(
      JSON.stringify(await h.svc.listUpdates({ attention: "blocked", agentId: "Codex" })),
    );
    expect(expected.items.map((u: { task_id: string }) => u.task_id)).toEqual(["ATT-DEP"]);

    const res = await rest(
      h.svc,
      updatesRoute,
      "GET",
      "/api/v1/updates?attention=blocked&agentId=Codex",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expected);
    const both = await rest(
      h.svc,
      updatesRoute,
      "GET",
      "/api/v1/updates?attention=blocked&taskIds=CC-01",
    );
    expect(both.status).toBe(400);
    const unknown = await rest(h.svc, updatesRoute, "GET", "/api/v1/updates?attention=late");
    expect(unknown.status).toBe(400);

    const c = await mcpClient(h.svc);
    const tool = toolValue(
      await c.callTool({
        name: "list_updates",
        arguments: { attention: "blocked", agentId: "Codex" },
      }),
    );
    expect(tool).toEqual(expected);
  });
});
