// The source rule lives in the services: a progress body cannot record source mcp. Only the MCP adapter can, through
// the `via` option that no REST body or header sets. Because the rule is part of the input schema, one 400 lists a
// refused source beside every other bad field.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Route as updatesRoute } from "@/routes/api/v1/tasks/$id/updates";
import {
  expectInvalidAt,
  issuePaths,
  mcpClient,
  rest,
  setup,
  toolValue,
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

const updatesOn = (taskId: string) => h.count("task_updates", "task_id = $1", [taskId]);

describe("source mcp is recorded only through the MCP adapter", () => {
  it("refuses source mcp from a service caller without via, and records it with via mcp", async () => {
    const before = await updatesOn("CC-01");
    await expectInvalidAt(
      h.svc.postProgress(h.as.CC1, "CC-01", { note: "claims mcp", source: "mcp" }),
      "source",
    );
    expect(await updatesOn("CC-01"), "no row landed").toBe(before);

    const recorded = await h.svc.postProgress(
      h.as.CC1,
      "CC-01",
      { note: "through the adapter", source: "mcp" },
      { via: "mcp" },
    );
    expect(recorded.status).toBe(201);
    expect(recorded.value.update).toMatchObject({ source: "mcp", agent_id: "CC1" });
  });

  it("lists a refused source and a bad note in one 400 from the service", async () => {
    const error = await expectInvalidAt(
      h.svc.postProgress(h.as.CC1, "CC-01", { note: "", source: "mcp" }),
      "source",
    );
    expect(issuePaths(error).sort()).toEqual(["note", "source"]);
  });

  it("lists a refused source and a bad note in one REST 400, and records api from REST", async () => {
    const authorization = await h.auth("CC1");
    const before = await updatesOn("CC-01");
    const refused = await rest(h.svc, updatesRoute, "POST", "/api/v1/tasks/CC-01/updates", {
      params: { id: "CC-01" },
      authorization,
      body: { note: "", source: "mcp" },
    });
    expect(refused.status).toBe(400);
    const { error } = (await refused.json()) as {
      error: { code: string; issues: { path: string }[] };
    };
    expect(error.code).toBe("invalid");
    expect(error.issues.map((i) => i.path).sort()).toEqual(["note", "source"]);
    expect(await updatesOn("CC-01"), "no row landed").toBe(before);

    const accepted = await rest(h.svc, updatesRoute, "POST", "/api/v1/tasks/CC-01/updates", {
      params: { id: "CC-01" },
      authorization,
      body: { note: "from REST", source: "api" },
    });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({ source: "api", agent_id: "CC1" });

    client = await mcpClient(h.svc, authorization);
    const posted = toolValue(
      await client.callTool({
        name: "post_progress",
        arguments: { taskId: "CC-01", note: "from MCP" },
      }),
    );
    expect(posted).toMatchObject({ source: "mcp", agent_id: "CC1" });
  });
});
