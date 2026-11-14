import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import {
  isServiceError,
  type Actor,
  type DecideInput,
  type Decision,
  type RequestDecisionInput,
} from "@/server/services";

const REQUEST_SOURCE =
  "hx15:/home/hxsa/agent-activity-compass.wt/docs/wu1-monday-reference/SPEC.md:247";
const DECIDE_SOURCE = "hx15:/home/hxsa/caio-notes/skill-reports/example.md:10-20";
const NOT_SOURCES = ["hx15:relative/path", "hx15:", "hx15:/has space", "ftp://example.com/x"];

let t: TestDb;
let cc1: Actor;
let owner: Actor;
beforeEach(async () => {
  t = await createTestDb();
  cc1 = await t.actorFor("CC1");
  owner = await t.actorFor("Agent Zero");
});
afterEach(async () => {
  await t.close();
});

const request = (sourceUrl: string): RequestDecisionInput => ({
  question: "Accept an HX-15 source on a decision?",
  summary: "A decision whose source exists only on HX-15.",
  description: "A RAID automation cites records that exist only on HX-15.",
  subject: "hx15 sources",
  gateType: "policy",
  options: [],
  blocks: ["CC-01"],
  sourceUrl,
});

const decision = (sourceUrl: string): DecideInput => ({
  status: "Decided",
  decisionText: "Accepted with an HX-15 source.",
  sourceUrl,
});

async function stored(id: string): Promise<Decision | undefined> {
  return (await t.services.listDecisions({ limit: 100 })).items.find((d) => d.id === id);
}

async function refusal(call: Promise<unknown>): Promise<{ code: string; paths: string[] }> {
  const err = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!isServiceError(err)) throw new Error(`expected a service error, got ${String(err)}`);
  const body = err.body;
  return { code: body.code, paths: body.code === "invalid" ? body.issues.map((i) => i.path) : [] };
}

describe("decision sources: an hx15:<absolute path> reference is accepted (SPEC §6.1)", () => {
  it("records an hx15 request source and an hx15 decision source, and links the blocked task to it", async () => {
    const requested = await t.services.requestDecision(cc1, request(REQUEST_SOURCE), {});
    expect(requested.status).toBe(201);
    const id = requested.value.decision.id;
    expect((await stored(id))?.source_url).toBe(REQUEST_SOURCE);

    const decided = await t.services.decide(owner, id, decision(DECIDE_SOURCE), {});
    expect(decided.status).toBe(200);
    expect((await stored(id))?.decision_source_url).toBe(DECIDE_SOURCE);

    const updates = (await t.services.listUpdates({ taskId: "CC-01", limit: 100 })).items;
    const system = updates.filter((u) => u.kind === "system" && u.note.startsWith(`${id} `));
    expect(system).toHaveLength(1);
    expect(system[0]?.links.map((l) => l.url)).toEqual([DECIDE_SOURCE]);
  });

  it.each(NOT_SOURCES)("refuses %j as a request source with invalid at sourceUrl", async (bad) => {
    const result = await refusal(t.services.requestDecision(cc1, request(bad), {}));
    expect(result.code).toBe("invalid");
    expect(result.paths).toContain("sourceUrl");
  });

  it.each(NOT_SOURCES)("refuses %j as a decision source with invalid at sourceUrl", async (bad) => {
    const pending = await t.services.requestDecision(
      cc1,
      request("https://example.invalid/pending"),
      {},
    );
    const id = pending.value.decision.id;
    const result = await refusal(t.services.decide(owner, id, decision(bad), {}));
    expect(result.code).toBe("invalid");
    expect(result.paths).toContain("sourceUrl");
    expect((await stored(id))?.status).toBe("Pending");
  });
});
