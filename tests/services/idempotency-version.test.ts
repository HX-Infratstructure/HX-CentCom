// @vitest-environment node
// T4 (R2) idempotency and T5 (R2) optimistic versions. SPEC §3 idempotency table, §4 rules, §5 headers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RequestDecisionInput } from "@/server/services";
import { IDS, conflictVersion, count, expectServiceError, setup, type Harness } from "./support";

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

const notes = (note: string) => count(h, "task_updates", "note = $1", [note]);
const taskVersion = async (id: string) =>
  Number(
    (await h.one<{ version: number }>("select version from engineering_tasks where id = $1", [id]))
      .version,
  );
const decisionVersion = async (id: string) =>
  Number(
    (await h.one<{ version: number }>("select version from owner_decisions where id = $1", [id]))
      .version,
  );

const decisionInput = (question: string): RequestDecisionInput => ({
  question,
  summary: "t4 summary",
  description: "t4 full description",
  subject: "t4 subject",
  gateType: "policy",
  options: [],
  blocks: [],
  sourceUrl: "https://example.invalid/t4",
});

describe("T4 (R2): an Idempotency-Key makes a retried write safe", () => {
  it("stores one row for the same key and body, and marks the second response as a replay", async () => {
    // Catches: an agent's network retry posting the same progress twice.
    const body = { note: "t4 same", source: "api" } as const;
    const first = await h.svc.postProgress(h.as.CC1, "IRP-05", body, {
      idempotencyKey: "t4-key-1",
    });
    const audit = await count(h, "activity_log");
    const version = await taskVersion("IRP-05");

    const second = await h.svc.postProgress(
      h.as.CC1,
      "IRP-05",
      { ...body },
      { idempotencyKey: "t4-key-1" },
    );

    expect(await notes("t4 same")).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(await count(h, "activity_log")).toBe(audit);
    expect(await taskVersion("IRP-05")).toBe(version);
  });

  it("rejects the same key with a different body as idempotency_mismatch (422) and writes nothing", async () => {
    // Catches: a reused key silently returning the old response for a new request, or writing the new one.
    await h.svc.postProgress(
      h.as.CC1,
      "IRP-05",
      { note: "t4 original", source: "api" },
      { idempotencyKey: "t4-key-2" },
    );
    const audit = await count(h, "activity_log");

    await expectServiceError(
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "t4 changed", source: "api" },
        { idempotencyKey: "t4-key-2" },
      ),
      "idempotency_mismatch",
      422,
    );
    expect(await notes("t4 original")).toBe(1);
    expect(await notes("t4 changed")).toBe(0);
    expect(await count(h, "activity_log")).toBe(audit);
  });

  it("scopes a key to its actor, so two actors using the same key both write", async () => {
    // Catches: one agent's key colliding with another's (SPEC §3: the idempotency key is key + actor).
    const body = { note: "t4 shared key", source: "api" } as const;
    await h.svc.postProgress(h.as.CC1, "IRP-05", body, { idempotencyKey: "t4-key-3" });
    await h.svc.postProgress(h.as.OWNER, "IRP-05", body, { idempotencyKey: "t4-key-3" });
    const rows = await h.q<{ agent_id: string }>(
      "select agent_id from task_updates where note = 't4 shared key'",
    );
    expect(rows.map((r) => r.agent_id).sort()).toEqual([IDS.CC1, IDS.OWNER].sort());
  });

  it("creates one decision for a retried requestDecision", async () => {
    // Catches: duplicate owner decisions in the inbox from a retried request.
    const input = decisionInput("t4 retried request?");
    await h.svc.requestDecision(h.as.CC1, input, { idempotencyKey: "t4-key-4" });
    const second = await h.svc.requestDecision(
      h.as.CC1,
      { ...input },
      { idempotencyKey: "t4-key-4" },
    );
    expect(second.replayed).toBe(true);
    expect(await count(h, "owner_decisions", "question = $1", [input.question])).toBe(1);
  });
});

describe("T5 (R2): a stale If-Match version is refused", () => {
  it("rejects a stale expectedVersion with version_conflict (409) carrying the current version", async () => {
    // Catches: last-write-wins, where an agent overwrites a change it never saw.
    // The agent read version `read`; the owner then wrote, so `read` is stale.
    const read = await taskVersion("IRP-05");
    await h.svc.postProgress(
      h.as.OWNER,
      "IRP-05",
      { note: "t5 owner writes first", source: "ui" },
      {},
    );
    const current = await taskVersion("IRP-05");
    expect(current).toBe(read + 1);
    const err = await expectServiceError(
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "t5 stale", source: "api" },
        { expectedVersion: read },
      ),
      "version_conflict",
      409,
    );
    expect(conflictVersion(err)).toBe(current);
    expect(await notes("t5 stale")).toBe(0);
    expect(await taskVersion("IRP-05")).toBe(current);
  });

  it("accepts the current version and increments it by one on every write", async () => {
    // Catches: a version that never moves, so If-Match could never detect a conflict.
    const v0 = await taskVersion("IRP-05");
    await h.svc.postProgress(
      h.as.CC1,
      "IRP-05",
      { note: "t5 match", source: "api" },
      { expectedVersion: v0 },
    );
    expect(await taskVersion("IRP-05")).toBe(v0 + 1);
    await h.svc.postProgress(h.as.CC1, "IRP-05", { note: "t5 no if-match", source: "api" }, {});
    expect(await taskVersion("IRP-05")).toBe(v0 + 2);

    const err = await expectServiceError(
      h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        { note: "t5 old", source: "api" },
        { expectedVersion: v0 },
      ),
      "version_conflict",
      409,
    );
    expect(conflictVersion(err)).toBe(v0 + 2);
  });

  it("starts seeded rows at version 1", async () => {
    // Catches: a version column left null or 0, which a client cannot send back as If-Match (SPEC §3).
    expect(await taskVersion("IRP-04")).toBe(1);
    expect(await decisionVersion("D-01")).toBe(1);
  });

  it("rejects a stale version on decide and leaves the decision Pending", async () => {
    // Catches: the owner deciding on a decision that changed after they read it.
    const current = await decisionVersion("D-01");
    const err = await expectServiceError(
      h.svc.decide(
        h.as.OWNER,
        "D-01",
        {
          status: "Decided",
          decisionText: "t5 stale decide",
          sourceUrl: "https://example.invalid/t5",
        },
        { expectedVersion: current + 7 },
      ),
      "version_conflict",
      409,
    );
    expect(conflictVersion(err)).toBe(current);
    const row = await h.one<{ status: string }>(
      "select status from owner_decisions where id = 'D-01'",
    );
    expect(row.status).toBe("Pending");
  });
});
