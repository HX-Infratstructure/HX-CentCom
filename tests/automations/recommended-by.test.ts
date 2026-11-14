// P3-8: the server stamps recommended_by with the requesting agent when an option is recommended, and null
// otherwise. REST drops a sent recommendedBy like any unknown field; the strict MCP tool refuses it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Route as decisionsRoute } from "@/routes/api/v1/decisions";
import {
  loose,
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

const request = {
  question: "Adopt the webhook envelope?",
  summary: "Adopt the webhook envelope.",
  description: "Requested by the recommended_by test.",
  subject: "P3-8",
  gateType: "scope" as const,
  blocks: ["CC-01"],
  sourceUrl: WEB_SOURCE,
};
const RECOMMENDED = [{ label: "Adopt", recommended: true }, { label: "Defer" }];

const recommender = async (id: string) =>
  (
    await h.one<{ recommended_by: string | null }>(
      "select recommended_by from owner_decisions where id = $1",
      [id],
    )
  ).recommended_by;

describe("P3-8: recommended_by is the requesting agent, stamped by the server", () => {
  it("stores CC1, not the agent CC1 named, when CC1 recommends an option over REST", async () => {
    const res = await rest(h.svc, decisionsRoute, "POST", "/api/v1/decisions", {
      authorization: await h.auth("CC1"),
      body: { ...request, options: RECOMMENDED, recommendedBy: "Agent Zero" },
    });
    expect(res.status).toBe(201);
    const { decision } = (await res.json()) as { decision: { id: string; recommended_by: string } };
    expect(decision.recommended_by).toBe("CC1");
    expect(await recommender(decision.id)).toBe("CC1");
  });

  it("stamps the requester when an option is recommended and recommendedBy is absent, and null without one", async () => {
    const recommended = await h.svc.requestDecision(h.as.CC2, { ...request, options: RECOMMENDED });
    expect(recommended.status).toBe(201);
    expect(recommended.value.decision.recommended_by).toBe("CC2");

    const plain = await h.svc.requestDecision(h.as.CC2, {
      ...request,
      options: [{ label: "Adopt" }],
    });
    expect(plain.value.decision.recommended_by).toBeNull();

    const ignored = await h.svc.requestDecision(
      h.as.CC2,
      loose({ ...request, options: [], recommendedBy: "CC1" }),
    );
    expect(ignored.status, "a sent recommendedBy without a recommended option is dropped").toBe(
      201,
    );
    expect(await recommender(ignored.value.decision.id)).toBeNull();
  });

  it("refuses recommendedBy in the strict MCP request_decision schema and stamps the caller otherwise", async () => {
    client = await mcpClient(h.svc, await h.auth("CC1"));
    const before = await h.count("owner_decisions");
    const refused = (await client.callTool({
      name: "request_decision",
      arguments: { ...request, options: RECOMMENDED, recommendedBy: "CC2" },
    })) as { isError?: boolean; content?: { text?: string }[] };
    const text = refused.content?.map((c) => c.text ?? "").join("\n") ?? "";
    expect(refused.isError, text).toBe(true);
    expect(text).toContain("Unrecognized key(s) in object: 'recommendedBy'");
    expect(await h.count("owner_decisions"), "no decision landed").toBe(before);

    const accepted = toolValue<{ decision: { recommended_by: string } }>(
      await client.callTool({
        name: "request_decision",
        arguments: { ...request, options: RECOMMENDED },
      }),
    );
    expect(accepted.decision.recommended_by).toBe("CC1");
  });
});
