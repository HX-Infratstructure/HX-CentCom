import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as postUpdate } from "@/routes/api/v1/tasks/$id/updates";
import { Route as mcpRoute } from "@/routes/mcp";
import {
  errorOf,
  READ_TOOLS,
  startApi,
  toolValue,
  UNKNOWN_KEY,
  updatesPage,
  WRITE_TOOLS,
  type Api,
  type Json,
} from "./harness";

const CC1_TASK = "CC-01";
const PR = "https://github.com/HX-Infratstructure/HX-CentCom/pull/1";
const fields = {
  kind: "link",
  status: "In progress",
  links: [{ label: "PR", url: PR }],
  commitSha: "c34c7cb",
  prUrl: PR,
  runId: "t9-run",
};

function shape(row: Json): Json {
  const { id: _id, created_at: _createdAt, note: _note, source: _source, ...rest } = row;
  return rest;
}

let api: Api;
beforeEach(async () => {
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

describe("T9: REST and MCP write the same row", () => {
  it("rows differ only in id, created_at, note and source (api vs mcp), and each response is its row", async () => {
    const auth = await api.authFor("CC1");
    const res = await api.rest(postUpdate, "POST", `/api/v1/tasks/${CC1_TASK}/updates`, {
      params: { id: CC1_TASK },
      authorization: auth,
      body: { ...fields, note: "T9 via REST", source: "api" },
    });
    expect(res.status, "the REST post is 201").toBe(201);
    const restBody = (await res.json()) as Json;

    const client = await api.mcp(auth);
    const mcpValue = toolValue(
      await client.callTool({
        name: "post_progress",
        arguments: { taskId: CC1_TASK, ...fields, note: "T9 via MCP" },
      }),
    );

    const { items } = await updatesPage(api, `taskId=${CC1_TASK}&limit=100`);
    const viaRest = items.find((u) => u["id"] === restBody["id"]);
    const viaMcp = items.find((u) => u["id"] === mcpValue["id"]);
    expect(viaRest, "the REST row reads back").toBeDefined();
    expect(viaMcp, "the MCP row reads back").toBeDefined();
    if (!viaRest || !viaMcp) return;

    expect(Object.keys(viaMcp).sort(), "both rows have the same columns").toEqual(
      Object.keys(viaRest).sort(),
    );
    expect(viaRest).toMatchObject({
      task_id: CC1_TASK,
      agent_id: "CC1",
      source: "api",
      note: "T9 via REST",
    });
    expect(viaMcp).toMatchObject({
      task_id: CC1_TASK,
      agent_id: "CC1",
      source: "mcp",
      note: "T9 via MCP",
    });
    expect(shape(viaMcp), "every other column is equal").toEqual(shape(viaRest));
    expect(restBody, "the REST 201 body is the stored row").toEqual(viaRest);
    expect(mcpValue, "the MCP result is the stored row").toEqual(viaMcp);
  });
});

function rawPostProgress(authorization: string): Promise<Response> {
  return api.rest(mcpRoute, "POST", "/mcp", {
    authorization,
    headers: { accept: "application/json, text/event-stream" },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "post_progress", arguments: { taskId: CC1_TASK, note: "raw MCP call" } },
    },
  });
}

describe("T9: read-only MCP", () => {
  it("with no Authorization header only the seven read tools are listed and post_progress lands no row", async () => {
    const client = await api.mcp();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names, "exactly the read tools").toEqual(READ_TOOLS);

    const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
    const result = await client.callTool({
      name: "post_progress",
      arguments: { taskId: CC1_TASK, note: "must not land" },
    });
    expect(result.isError, "the write is refused").toBe(true);
    expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "no row landed").toBe(
      before,
    );
  });

  it.each([
    ["an unknown hxc_ key", UNKNOWN_KEY],
    ["a malformed bearer", "Bearer not-a-key"],
    ["a Basic header", "Basic Zm9vOmJhcg=="],
  ])(
    "with %s /mcp is HTTP 401 unauthorized, lands no row and the client cannot connect",
    async (_label, authorization) => {
      const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
      const refused = await rawPostProgress(authorization);
      expect(refused.status).toBe(401);
      expect((await errorOf(refused)).code).toBe("unauthorized");
      expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "no row landed").toBe(
        before,
      );
      await expect(
        api.mcp(authorization),
        "connect rejects with the HTTP status",
      ).rejects.toMatchObject({ code: 401 });

      const accepted = await rawPostProgress(await api.authFor("CC1"));
      expect(accepted.status, "the same call with an agent key is served").toBe(200);
      const { result } = (await accepted.json()) as { result: unknown };
      expect(toolValue(result)).toMatchObject({
        task_id: CC1_TASK,
        agent_id: "CC1",
        source: "mcp",
      });
      expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "one row landed").toBe(
        before + 1,
      );
    },
  );

  it.each([
    ["an agent", "CC1"],
    ["the owner", "Agent Zero"],
  ])("with %s's key all fourteen tools are listed", async (_label, agentId) => {
    const client = await api.mcp(await api.authFor(agentId));
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names, "read and write tools").toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });
});
