import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as task } from "@/routes/api/v1/tasks/$id";
import { Route as mcpRoute } from "@/routes/mcp";
import {
  errorOf,
  metaOf,
  READ_TOOLS,
  SOURCE_URL,
  startApi,
  toolError,
  toolErrorText,
  toolValue,
  updatesPage,
  type Api,
  type Json,
} from "./harness";

const CC1_TASK = "CC-01";
const CC2_TASK = "IRP-04";

let api: Api;
let cc1: string;
beforeEach(async () => {
  api = await startApi();
  cc1 = await api.authFor("CC1");
});
afterEach(async () => {
  await api.close();
});

async function taskVersion(
  client: Awaited<ReturnType<Api["mcp"]>>,
  taskId: string,
): Promise<number> {
  const detail = toolValue(await client.callTool({ name: "get_task", arguments: { taskId } }));
  return (detail["task"] as { version: number }).version;
}

describe("server", () => {
  it("is named hx-centcom and says it is read-only only when no bearer key was sent", async () => {
    const anonymous = await api.mcp();
    expect(anonymous.getServerVersion()?.name).toBe("hx-centcom");
    expect(anonymous.getInstructions()).toMatch(/read-only: no bearer key was sent/);
    const agent = (await api.mcp(cc1)).getInstructions();
    expect(agent).toMatch(/as CC1 \(agent\)/);
    expect(agent).not.toMatch(/read-only/);
  });

  it.each([["GET"], ["DELETE"]])("answers %s with 405 Allow: POST", async (method) => {
    const res = await api.rest(mcpRoute, method, "/mcp");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect((await errorOf(res)).code).toBe("method_not_allowed");
  });
});

describe("annotations", () => {
  it("marks reads readOnly, and writes not readOnly with set_requirement the only destructive one", async () => {
    const { tools } = await (await api.mcp(cc1)).listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    for (const name of READ_TOOLS) {
      expect(byName.get(name), name).toEqual({ readOnlyHint: true, openWorldHint: false });
    }
    const write = { readOnlyHint: false, idempotentHint: false, openWorldHint: false };
    expect(byName.get("post_progress")).toEqual({ ...write, destructiveHint: false });
    expect(byName.get("request_decision")).toEqual({ ...write, destructiveHint: false });
    expect(byName.get("set_requirement")).toEqual({ ...write, destructiveHint: true });
  });
});

describe("strict inputs", () => {
  it.each([["foo"], ["source"], ["agent"]])(
    "post_progress refuses the unknown argument %s",
    async (extra) => {
      const client = await api.mcp(cc1);
      const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
      const refused = await client.callTool({
        name: "post_progress",
        arguments: { taskId: CC1_TASK, note: "strict", [extra]: "x" },
      });
      expect(toolErrorText(refused)).toContain(`Unrecognized key(s) in object: '${extra}'`);
      expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "no row landed").toBe(
        before,
      );

      const accepted = await client.callTool({
        name: "post_progress",
        arguments: { taskId: CC1_TASK, note: "strict" },
      });
      expect(toolValue(accepted)).toMatchObject({
        task_id: CC1_TASK,
        agent_id: "CC1",
        source: "mcp",
      });
    },
  );

  it("leaves set_requirement's cross-field rule to the service's 400", async () => {
    const client = await api.mcp(cc1);
    const refused = await client.callTool({
      name: "set_requirement",
      arguments: { taskId: CC1_TASK, requirement: "MCP contract check", state: "PASS" },
    });
    const error = toolError(refused);
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((i) => i.path)).toContain("proofUrl");

    const accepted = await client.callTool({
      name: "set_requirement",
      arguments: { taskId: CC1_TASK, requirement: "MCP contract check", state: "NOT_RUN" },
    });
    expect(toolValue(accepted)).toMatchObject({
      requirement: { task_id: CC1_TASK, state: "NOT_RUN" },
    });
  });

  const decision = {
    question: "Adopt the MCP error envelope?",
    summary: "Adopt the MCP error envelope.",
    description: "Requested by the MCP contract test.",
    subject: "B1",
    gateType: "scope",
    options: [{ label: "Adopt", recommended: true }],
    blocks: [CC1_TASK],
    sourceUrl: SOURCE_URL,
    recommendedBy: "CC1",
  };

  it("refuses a request_decision summary over 140 characters in the SDK schema check, as text", async () => {
    const client = await api.mcp(cc1);
    const refused = await client.callTool({
      name: "request_decision",
      arguments: { ...decision, summary: "x".repeat(141) },
    });
    expect(toolErrorText(refused)).toMatch(/\bsummary\b/);

    const accepted = await client.callTool({
      name: "request_decision",
      arguments: { ...decision, summary: "x".repeat(140) },
    });
    expect(toolValue(accepted)).toMatchObject({
      decision: { requested_by: "CC1", status: "Pending" },
    });
  });

  it("leaves request_decision's recommendedBy rule to the service's 400", async () => {
    const client = await api.mcp(cc1);
    const { recommendedBy, ...unattributed } = decision;
    const error = toolError(
      await client.callTool({ name: "request_decision", arguments: unattributed }),
    );
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((i) => i.path)).toContain("recommendedBy");

    const accepted = await client.callTool({ name: "request_decision", arguments: decision });
    expect(toolValue(accepted)).toMatchObject({
      decision: { recommended_by: recommendedBy, status: "Pending" },
    });
  });
});

describe("errors and replay", () => {
  it("returns a service refusal as isError with the REST error envelope", async () => {
    const refused = await (
      await api.mcp(cc1)
    ).callTool({
      name: "post_progress",
      arguments: { taskId: CC2_TASK, note: "not my task" },
    });
    expect(toolError(refused)).toMatchObject({ code: "forbidden", status: 403 });

    const owner = await api.mcp(await api.authFor("Agent Zero"));
    const allowed = await owner.callTool({
      name: "post_progress",
      arguments: { taskId: CC2_TASK, note: "owner" },
    });
    expect(toolValue(allowed)).toMatchObject({ task_id: CC2_TASK, agent_id: "Agent Zero" });
  });

  it("is version_conflict with currentVersion for a stale expectedVersion", async () => {
    const client = await api.mcp(cc1);
    const version = await taskVersion(client, CC1_TASK);
    const current = await client.callTool({
      name: "post_progress",
      arguments: { taskId: CC1_TASK, note: "current", expectedVersion: version },
    });
    expect(toolValue(current)).toMatchObject({ task_id: CC1_TASK });

    const stale = await client.callTool({
      name: "post_progress",
      arguments: { taskId: CC1_TASK, note: "stale", expectedVersion: version },
    });
    expect(toolError(stale)).toMatchObject({
      code: "version_conflict",
      status: 409,
      currentVersion: version + 1,
    });
  });

  it("marks a replay with _meta.replayed and lands one row", async () => {
    const client = await api.mcp(cc1);
    const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
    const call = {
      name: "post_progress",
      arguments: { taskId: CC1_TASK, note: "once", idempotencyKey: "mcp-replay-1" },
    };
    const first = await client.callTool(call);
    const second = await client.callTool(call);
    expect(metaOf(first)?.["replayed"], "the first answer is not a replay").toBeUndefined();
    expect(metaOf(second)?.["replayed"]).toBe(true);
    expect(toolValue(second)).toEqual(toolValue(first));
    expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "one row landed").toBe(
      before + 1,
    );
  });
});

describe("read tools", () => {
  it("get_task returns what GET /api/v1/tasks/:id returns", async () => {
    const viaMcp = toolValue(
      await (await api.mcp()).callTool({ name: "get_task", arguments: { taskId: CC2_TASK } }),
    );
    const res = await api.rest(task, "GET", `/api/v1/tasks/${CC2_TASK}`, {
      params: { id: CC2_TASK },
    });
    expect(viaMcp).toEqual(await res.json());
  });

  it("my_work needs agentId without a key, and defaults to the key's agent", async () => {
    const anonymous = await api.mcp();
    expect(
      toolError(await anonymous.callTool({ name: "my_work", arguments: {} })).issues?.map(
        (i) => i.path,
      ),
    ).toContain("agentId");
    const named = toolValue(
      await anonymous.callTool({ name: "my_work", arguments: { agentId: "CC1" } }),
    );
    const tasks = named["tasks"] as Json[];
    expect(tasks.map((t) => t["id"])).toContain(CC1_TASK);
    expect(
      tasks.every((t) => t["agent"] === "CC1" && t["group"] !== "done"),
      "CC1's open tasks only",
    ).toBe(true);

    const keyed = toolValue(
      await (await api.mcp(cc1)).callTool({ name: "my_work", arguments: {} }),
    );
    expect(keyed).toEqual(named);
    expect(
      toolError(await anonymous.callTool({ name: "my_work", arguments: { agentId: "cc1" } })).code,
    ).toBe("not_found");
  });

  it("list_tasks filters by agent and group", async () => {
    const value = toolValue(
      await (
        await api.mcp()
      ).callTool({ name: "list_tasks", arguments: { agentId: "CC1", group: "done" } }),
    );
    const tasks = value["tasks"] as Json[];
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t["agent"] === "CC1" && t["group"] === "done")).toBe(true);
  });

  it("list_decisions filters by status and gate type", async () => {
    const value = toolValue(
      await (
        await api.mcp()
      ).callTool({
        name: "list_decisions",
        arguments: { status: "Pending", gateType: "deploy" },
      }),
    );
    const items = value["items"] as Json[];
    expect(items.map((d) => d["id"])).toContain("D-03");
    expect(items.every((d) => d["status"] === "Pending" && d["gate_type"] === "deploy")).toBe(true);
  });
});
