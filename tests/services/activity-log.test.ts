// @vitest-environment node
// T6 (R1, R5): every service write adds exactly one activity_log row with the actor and the before and after values.
// SPEC §3 activity_log: "Every service write inserts exactly one row in the same transaction."
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RequestDecisionInput } from "@/server/services";
import { IDS, count, expectServiceError, loose, setup, type Harness } from "./support";

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  run_id: string | null;
  created_at: unknown;
}

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

// Runs one write and returns the activity_log row it added. Fails unless it added exactly one.
async function oneAuditRow(write: () => Promise<unknown>): Promise<AuditRow> {
  const seen = new Set(
    (await h.q<{ id: string }>("select id from activity_log")).map((r) => String(r.id)),
  );
  await write();
  const added = (await h.q<AuditRow>("select * from activity_log")).filter(
    (r) => !seen.has(String(r.id)),
  );
  expect(added, "activity_log rows added by one write").toHaveLength(1);
  const row = added[0] as AuditRow;
  expect(row.action).toBeTruthy();
  expect(row.entity).toBeTruthy();
  expect(row.entity_id).toBeTruthy();
  expect(row.created_at).toBeTruthy();
  return row;
}

describe("T6 (R1, R5): one activity_log row per write, naming the actor", () => {
  it("postProgress: one row, actor CC1, before and after values, and the run id", async () => {
    // Catches: a write with no audit trail, or an audit row that names the wrong actor.
    const row = await oneAuditRow(() =>
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "t6 progress", source: "hook", runId: "run-t6" },
        {},
      ),
    );
    expect(row.actor).toBe(IDS.CC1);
    expect(row.before).not.toBeNull();
    expect(row.after).not.toBeNull();
    expect(row.after).not.toEqual(row.before);
    // The audit row must lead to what was written: the new update's id or its note.
    const update = await h.one<{ id: string }>(
      "select id from task_updates where note = 't6 progress'",
    );
    const after = JSON.stringify(row.after);
    expect(after.includes(String(update.id)) || after.includes("t6 progress")).toBe(true);
    expect(row.run_id).toBe("run-t6");
  });

  it("setRequirement on an existing requirement: one row, with the state before and after", async () => {
    // Catches: an audit row that loses what the value was before the change.
    const req = await h.one<{ id: string }>(
      "select id from task_requirements where task_id = 'IRP-05' and state = 'NOT_RUN'",
    );
    const row = await oneAuditRow(() =>
      h.svc.setRequirement(
        h.as.CC1,
        "IRP-05",
        { requirementId: req.id, state: "PASS", proofUrl: "https://example.invalid/t6-proof" },
        {},
      ),
    );
    expect(row.actor).toBe(IDS.CC1);
    expect(row.before).toMatchObject({ state: "NOT_RUN" });
    expect(row.after).toMatchObject({ state: "PASS" });
  });

  it("requestDecision: one row, actor CC2, with the new decision as the after value", async () => {
    // Catches: decision requests that leave no trace of who asked.
    const row = await oneAuditRow(() =>
      h.svc.requestDecision(
        h.as.CC2,
        {
          question: "t6 request?",
          summary: "t6 summary",
          description: "t6 description",
          subject: "t6 subject",
          gateType: "scope",
          options: [],
          blocks: [],
          sourceUrl: "https://example.invalid/t6-request",
        },
        {},
      ),
    );
    expect(row.actor).toBe(IDS.CC2);
    expect(row.before ?? null).toBeNull();
    expect(JSON.stringify(row.after)).toContain("t6 summary");
  });

  it("decide: exactly one row, with status Pending before and Decided after, even though it posts system updates", async () => {
    // Catches: decide auditing only the side effects, or none, or one row per blocked task instead of one per write.
    const row = await oneAuditRow(() =>
      h.svc.decide(
        h.as.OWNER,
        "D-01",
        {
          status: "Decided",
          decisionText: "t6 decided",
          sourceUrl: "https://example.invalid/t6-decide",
        },
        {},
      ),
    );
    expect(row.actor).toBe(IDS.OWNER);
    expect(row.entity_id).toBe("D-01");
    expect(row.before).toMatchObject({ status: "Pending" });
    expect(row.after).toMatchObject({ status: "Decided" });
  });

  it("issueKey and revokeKey: one row each, actor owner", async () => {
    // Catches: key administration with no audit trail.
    let keyId = "";
    const issued = await oneAuditRow(async () => {
      keyId = (await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t6 key")).keyId;
    });
    expect(issued.actor).toBe(IDS.OWNER);
    const revoked = await oneAuditRow(() => h.svc.revokeKey(h.as.OWNER, keyId));
    expect(revoked.actor).toBe(IDS.OWNER);
  });

  it("adds no row when a write is refused (403, 400, 409, 422)", async () => {
    // Catches: an audit row written outside the transaction, which records a write that never happened.
    await h.svc.postProgress(
      h.as.CC1,
      "IRP-05",
      { note: "t6 keyed", source: "api" },
      { idempotencyKey: "t6-k" },
    );
    const audit = await count(h, "activity_log");
    const version = Number(
      (
        await h.one<{ version: number }>(
          "select version from engineering_tasks where id = 'IRP-05'",
        )
      ).version,
    );

    await expectServiceError(
      h.svc.postProgress(h.as.CC1, "IRP-04", { note: "x", source: "api" }, {}),
      "forbidden",
      403,
    );
    await expectServiceError(
      h.svc.requestDecision(
        h.as.CC1,
        loose<RequestDecisionInput>({
          question: "q?",
          summary: "s",
          description: "d",
          subject: "s",
          gateType: "policy",
          options: [],
          blocks: [],
        }),
        {},
      ),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "x", source: "api" },
        { expectedVersion: version + 1 },
      ),
      "version_conflict",
      409,
    );
    await expectServiceError(
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "t6 other body", source: "api" },
        { idempotencyKey: "t6-k" },
      ),
      "idempotency_mismatch",
      422,
    );
    expect(await count(h, "activity_log")).toBe(audit);
  });
});
