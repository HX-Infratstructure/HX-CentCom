// @vitest-environment node
// T7 (R3) owner decisions and T13 (R11) decision types and descriptions. SPEC §3 owner_decisions, §4.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecideInput, RequestDecisionInput } from "@/server/services";
import { DECISIONS } from "./seed-truth";
import { IDS, count, expectServiceError, loose, setup, type Harness } from "./support";

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

const request = (overrides: Partial<RequestDecisionInput> = {}): RequestDecisionInput => ({
  question: "Approve the test decision?",
  summary: "A short summary of the test decision.",
  description: "The complete description of the test decision.",
  subject: "Test subject",
  gateType: "policy",
  options: [],
  blocks: [],
  sourceUrl: "https://example.invalid/decision-source",
  ...overrides,
});

const without = (key: keyof RequestDecisionInput): RequestDecisionInput => {
  const input: Record<string, unknown> = { ...request() };
  delete input[key];
  return loose<RequestDecisionInput>(input);
};

const systemUpdates = (taskId: string) =>
  h.q<{ agent_id: string }>(
    "select agent_id from task_updates where task_id = $1 and kind = 'system'",
    [taskId],
  );

describe("T7 (R3): agents request owner decisions with a source; deciding notifies the blocked tasks", () => {
  it("rejects requestDecision without sourceUrl, or with an empty one, as invalid (400)", async () => {
    // Catches: unsourced decision requests reaching the owner (standing rule: every claim sourced).
    const before = await count(h, "owner_decisions");
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, without("sourceUrl"), {}),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, request({ sourceUrl: "" }), {}),
      "invalid",
      400,
    );
    expect(await count(h, "owner_decisions")).toBe(before);
  });

  it("records the requesting agent and request time from the server, as a Pending decision", async () => {
    // Catches: requested_by taken from the body (SPEC §2: the server ignores author fields), or a request not Pending.
    await h.svc.requestDecision(
      h.as.CC1,
      loose<RequestDecisionInput>({
        ...request({ question: "t7 who asked?" }),
        requestedBy: IDS.OWNER,
        requested_by: IDS.OWNER,
      }),
      {},
    );
    const row = await h.one<Record<string, unknown>>(
      "select * from owner_decisions where question = 't7 who asked?'",
    );
    expect(row).toMatchObject({
      requested_by: IDS.CC1,
      status: "Pending",
      source_url: "https://example.invalid/decision-source",
    });
    expect(row["requested_at"]).toBeTruthy();
  });

  it("posts exactly one system update on every blocked task when the owner decides, and none elsewhere", async () => {
    // Catches: decide updating the decision but leaving the blocked tasks silent, or notifying the wrong tasks.
    await h.svc.requestDecision(
      h.as.CC2,
      request({ question: "t7 blocks two?", blocks: ["IRP-04", "IRP-05"] }),
      {},
    );
    const d = await h.one<{ id: string }>(
      "select id from owner_decisions where question = 't7 blocks two?'",
    );
    const elsewhere = "task_id not in ('IRP-04', 'IRP-05') and kind = 'system'";
    const otherBefore = await count(h, "task_updates", elsewhere);
    const irp04Before = (await systemUpdates("IRP-04")).length;
    const irp05Before = (await systemUpdates("IRP-05")).length;

    await h.svc.decide(
      h.as.OWNER,
      d.id,
      {
        status: "Decided",
        decisionText: "t7 approved",
        sourceUrl: "https://example.invalid/t7-decided",
      },
      {},
    );

    expect(await systemUpdates("IRP-04")).toHaveLength(irp04Before + 1);
    expect(await systemUpdates("IRP-05")).toHaveLength(irp05Before + 1);
    expect(await count(h, "task_updates", elsewhere)).toBe(otherBefore);

    const row = await h.one<Record<string, unknown>>(
      "select * from owner_decisions where id = $1",
      [d.id],
    );
    expect(row).toMatchObject({
      status: "Decided",
      decision_text: "t7 approved",
      decision_source_url: "https://example.invalid/t7-decided",
    });
    expect(row["decided_at"]).toBeTruthy();
  });

  it("posts the system update for a seeded decision too (D-01 blocks IRP-04)", async () => {
    // Catches: blocked tasks read from somewhere other than the decision's blocks list.
    const before = (await systemUpdates("IRP-04")).length;
    await h.svc.decide(
      h.as.OWNER,
      "D-01",
      {
        status: "Decided",
        decisionText: "t7 merge approved",
        sourceUrl: "https://example.invalid/t7-d01",
      },
      {},
    );
    expect(await systemUpdates("IRP-04")).toHaveLength(before + 1);
  });

  it("rejects decide without a decision source (400)", async () => {
    // Catches: a decision recorded with no quote source for the owner's words.
    await expectServiceError(
      h.svc.decide(
        h.as.OWNER,
        "D-01",
        loose<DecideInput>({ status: "Decided", decisionText: "no source" }),
        {},
      ),
      "invalid",
      400,
    );
    const row = await h.one<{ status: string }>(
      "select status from owner_decisions where id = 'D-01'",
    );
    expect(row.status).toBe("Pending");
  });

  it("returns not_found (404) when deciding a decision that does not exist", async () => {
    // Catches: decide silently succeeding on a mistyped id.
    await expectServiceError(
      h.svc.decide(
        h.as.OWNER,
        "D-999",
        { status: "Decided", decisionText: "x", sourceUrl: "https://example.invalid/x" },
        {},
      ),
      "not_found",
      404,
    );
  });
});

describe("T13 (R11): every decision has a type, a short summary and a full description", () => {
  it("rejects requestDecision without summary or without description (400)", async () => {
    // Catches: decisions the owner cannot scan (no summary) or cannot read in full (no description).
    const before = await count(h, "owner_decisions");
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, without("summary"), {}),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, without("description"), {}),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, request({ summary: "" }), {}),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.requestDecision(h.as.CC1, request({ description: "" }), {}),
      "invalid",
      400,
    );
    expect(await count(h, "owner_decisions")).toBe(before);
  });

  it("rejects a 141-character summary (400) and accepts one of exactly 140", async () => {
    // Catches: no length limit, or an off-by-one limit (SPEC §3: summary at most 140 characters).
    await expectServiceError(
      h.svc.requestDecision(
        h.as.CC1,
        request({ question: "t13 141?", summary: "s".repeat(141) }),
        {},
      ),
      "invalid",
      400,
    );
    expect(await count(h, "owner_decisions", "question = 't13 141?'")).toBe(0);

    await h.svc.requestDecision(
      h.as.CC1,
      request({ question: "t13 140?", summary: "s".repeat(140) }),
      {},
    );
    const row = await h.one<{ summary: string }>(
      "select summary from owner_decisions where question = 't13 140?'",
    );
    expect(row.summary).toBe("s".repeat(140));
  });

  it("keeps the full description intact, however long, and returns it in the workspace", async () => {
    // Catches: the description truncated to the summary length, or replaced by the summary in the read model.
    const description = `${"Full description line one.\n".repeat(40)}Last line with the decisive detail.`;
    await h.svc.requestDecision(h.as.CC1, request({ question: "t13 full text?", description }), {});

    const row = await h.one<{ description: string }>(
      "select description from owner_decisions where question = 't13 full text?'",
    );
    expect(row.description).toBe(description);

    const ws = await h.svc.listWorkspace();
    const listed = ws.decisions.find((d) => d.question === "t13 full text?");
    expect(listed?.description).toBe(description);
  });

  it("filters decisions by type and returns only that type, all of them", async () => {
    // Catches: a type filter that is ignored or matches loosely (R11 asks for a filter by type).
    for (const type of ["merge", "deploy", "live_run", "policy"] as const) {
      const expected = DECISIONS.filter((d) => d.gateType === type)
        .map((d) => d.id)
        .sort();
      expect(expected.length).toBeGreaterThan(0);
      const page = await h.svc.listDecisions({ gateType: type, limit: 100 });
      expect(page.nextCursor).toBeNull();
      expect(page.items.every((d) => d.gate_type === type)).toBe(true);
      expect(page.items.map((d) => d.id).sort()).toEqual(expected);
    }
  });

  it("filters by type and status together", async () => {
    // Catches: the status filter ignored when a type is also chosen (the Pending inbox per type, SPEC §6).
    const expected = DECISIONS.filter((d) => d.gateType === "merge" && d.status === "Pending")
      .map((d) => d.id)
      .sort();
    const page = await h.svc.listDecisions({ gateType: "merge", status: "Pending", limit: 100 });
    expect(page.items.map((d) => d.id).sort()).toEqual(expected);
  });

  it("stores the requested type and refuses an unknown one", async () => {
    // Catches: gate_type dropped or defaulted on write, or a type the filter can never match.
    await h.svc.requestDecision(
      h.as.CC1,
      request({ question: "t13 deploy type?", gateType: "deploy" }),
      {},
    );
    const row = await h.one<{ gate_type: string }>(
      "select gate_type from owner_decisions where question = 't13 deploy type?'",
    );
    expect(row.gate_type).toBe("deploy");
    await expectServiceError(
      h.svc.requestDecision(
        h.as.CC1,
        loose<RequestDecisionInput>({ ...request(), gateType: "not_a_type" }),
        {},
      ),
      "invalid",
      400,
    );
  });
});
