// R12 (CC1's design H1): the workspace no longer carries every pull request and every decision. Its decisions are the
// Pending ones plus those whose `blocks` holds an open task, one that is blocked or not done; tasks, requirements,
// agents, status labels and repository heads stay whole. A task's detail and an agent's work are reads of their own, so
// a done task keeps its decided decisions, and REST and MCP return the same thing.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as taskRoute } from "@/routes/api/v1/tasks/$id";
import { DECISIONS } from "../services/seed-truth";
import {
  expectInvalidAt,
  expectServiceError,
  mcpClient,
  rest,
  setup,
  toolValue,
  WEB_SOURCE,
  type Fixture,
} from "../raid/support";

let h: Fixture;
let client: Client | undefined;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  await h.close();
});

const PENDING = DECISIONS.filter((d) => d.status === "Pending")
  .map((d) => d.id)
  .sort();
const ids = (rows: readonly { readonly id: string }[]) => rows.map((r) => r.id).sort();

describe("listWorkspace", () => {
  it("carries no pull requests, and only the Pending decisions plus those that block an open task", async () => {
    const ws = await h.svc.listWorkspace();
    expect(ws).not.toHaveProperty("prs");
    expect(ids(ws.decisions)).toEqual(PENDING);
    expect(ids(ws.decisions), "D-12 and D-13 block only IRP-05, which is Complete").not.toContain(
      "D-12",
    );
  });

  it("keeps a decided decision while the task it blocks is open, and drops it once the task is done and unblocked", async () => {
    await h.svc.decide(h.as.OWNER, "D-01", {
      status: "Decided",
      decisionText: "Merge it.",
      sourceUrl: WEB_SOURCE,
    });
    expect(ids((await h.svc.listWorkspace()).decisions)).toContain("D-01");

    await h.svc.postProgress(h.as.CC2, "IRP-04", {
      note: "Run 2 passed.",
      status: "Complete",
      source: "api",
    });
    expect(
      ids((await h.svc.listWorkspace()).decisions),
      "IRP-04 is done but still blocked on an owner decision, so it is open",
    ).toContain("D-01");

    await h.q(`update engineering_tasks set blocked_on = 'none' where id = 'IRP-04'`);
    const after = ids((await h.svc.listWorkspace()).decisions);
    expect(after).not.toContain("D-01");
    expect(after, "Pending decisions on the done task stay").toEqual(
      expect.arrayContaining(["D-03", "D-05", "D-17"]),
    );
  });

  it("keeps tasks, requirements, agents, status labels and repository heads whole", async () => {
    const ws = await h.svc.listWorkspace();
    expect(ids(ws.tasks)).toEqual(
      ["CC-01", "HX12-01", "HX14-02", "IRP-04", "IRP-05", "IRP-UI", "RO-01"].sort(),
    );
    expect(ws.requirements).toHaveLength(7);
    expect(ws.agents).toHaveLength(5);
    expect(ws.statusLabels).toHaveLength(5);
    expect(ws.repos).toEqual([]);
  });
});

describe("getTask", () => {
  it("keeps every decision that blocks a done task, whatever its status, and REST and MCP return it unchanged", async () => {
    const detail = await h.svc.getTask("IRP-05");
    expect(detail.task).toMatchObject({ id: "IRP-05", status: "Complete", stale: null });
    expect(ids(detail.decisions)).toEqual(["D-12", "D-13"]);
    expect(detail.requirements.map((r) => r.task_id)).toEqual(Array(4).fill("IRP-05"));

    const res = await rest(h.svc, taskRoute, "GET", "/api/v1/tasks/IRP-05", {
      params: { id: "IRP-05" },
    });
    expect(res.status).toBe(200);
    const viaRest = await res.json();
    expect(viaRest).toEqual(JSON.parse(JSON.stringify(detail)));
    client = await mcpClient(h.svc);
    expect(
      toolValue(await client.callTool({ name: "get_task", arguments: { taskId: "IRP-05" } })),
    ).toEqual(viaRest);
  });

  it("is 404 for an unknown task", async () => {
    await expectServiceError(h.svc.getTask("NOPE-1"), "not_found", 404);
  });
});

describe("myWork", () => {
  it("is the actor's open tasks, their open requirements and the Pending decisions that concern the agent", async () => {
    const work = await h.svc.myWork(h.as.CC2);
    expect(work.agentId).toBe("CC2");
    expect(ids(work.tasks)).toEqual(["IRP-04"]);
    expect(work.openRequirements.map((r) => `${r.task_id} ${r.state}`).sort()).toEqual([
      "IRP-04 BLOCKED",
      "IRP-04 NOT_RUN",
    ]);
    expect(ids(work.pendingDecisions)).toEqual([
      "D-01",
      "D-03",
      "D-04",
      "D-05",
      "D-06",
      "D-07",
      "D-17",
    ]);
  });

  it("takes agentId over the actor, needs one of them, and is 404 for an unknown agent", async () => {
    const cc1 = await h.svc.myWork(null, "CC1");
    expect(cc1.agentId).toBe("CC1");
    expect(ids(cc1.tasks)).toEqual(["CC-01"]);
    expect(ids(cc1.pendingDecisions)).toEqual(["D-08", "D-10", "D-11"]);
    expect(await h.svc.myWork(h.as.CC2, "CC1")).toEqual(cc1);
    await expectInvalidAt(h.svc.myWork(null), "agentId");
    await expectServiceError(h.svc.myWork(null, "cc1"), "not_found", 404);
  });

  it("is what the MCP my_work tool returns", async () => {
    client = await mcpClient(h.svc, await h.auth("CC2"));
    expect(toolValue(await client.callTool({ name: "my_work", arguments: {} }))).toEqual(
      JSON.parse(JSON.stringify(await h.svc.myWork(h.as.CC2))),
    );
  });
});
