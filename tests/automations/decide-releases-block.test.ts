// F-FIX1: a decide that sets Decided or Superseded releases each task in the decision's blocks whose blocked_on is
// owner_decision and that no other Pending decision blocks. In the seed, D-01, D-03, D-05 and D-17 are Pending and
// block IRP-04, whose blocked_on is owner_decision; HX12-01 is blocked on dependency.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecideInput } from "@/server/services";
import { setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

const decided = (status: DecideInput["status"] = "Decided"): DecideInput => ({
  status,
  decisionText: "Approved as recommended.",
  sourceUrl: "https://github.com/HX-Infratstructure/HX-CentCom/issues/1#issuecomment-9",
});
const decide = (id: string, status?: DecideInput["status"]) =>
  h.svc.decide(h.as.OWNER, id, decided(status), {});
const taskRow = (id: string) =>
  h.one<{ blocked_on: string; version: number }>(
    "select blocked_on, version from engineering_tasks where id = $1",
    [id],
  );
const decideAfter = async (decisionId: string) =>
  (
    await h.one<{ after: Record<string, unknown> }>(
      "select after from activity_log where action = 'decision.decide' and entity_id = $1 order by created_at desc, id desc limit 1",
      [decisionId],
    )
  ).after;

describe("F-FIX1: a decide releases the owner_decision block it was the last to hold", () => {
  it("releases IRP-04 when its last Pending decision is decided, and records the release", async () => {
    for (const id of ["D-01", "D-03", "D-05"]) await decide(id);
    const before = await taskRow("IRP-04");
    expect(before.blocked_on).toBe("owner_decision");

    const result = await decide("D-17");

    const after = await taskRow("IRP-04");
    expect(after).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect(result.value.systemUpdates).toHaveLength(1);
    const [update] = result.value.systemUpdates;
    expect(update).toMatchObject({ task_id: "IRP-04", kind: "system" });
    expect(update?.note).toContain("IRP-04 is no longer blocked: D-17 decided");
    expect((await decideAfter("D-17"))["effects"]).toEqual({
      systemUpdateIds: [update?.id],
      unblockedTasks: [{ id: "IRP-04", version: after.version }],
    });
  });

  it("releases on Superseded as it does on Decided", async () => {
    for (const id of ["D-01", "D-03", "D-05"]) await decide(id);
    const result = await decide("D-17", "Superseded");
    expect((await taskRow("IRP-04")).blocked_on).toBe("none");
    expect(result.value.systemUpdates[0]?.note).toContain(
      "IRP-04 is no longer blocked: D-17 superseded",
    );
  });

  it("keeps the block while another Pending decision blocks the task, and names it", async () => {
    for (const id of ["D-01", "D-03"]) await decide(id);
    const before = await taskRow("IRP-04");

    const result = await decide("D-05");

    expect(await taskRow("IRP-04")).toEqual(before);
    expect(result.value.systemUpdates[0]?.note).toContain(
      "IRP-04 stays blocked: D-17 still pending",
    );
    expect((await decideAfter("D-05"))["effects"]).toEqual({
      systemUpdateIds: [result.value.systemUpdates[0]?.id],
    });
  });

  it("keeps the block when the last Pending decision is Deferred", async () => {
    for (const id of ["D-01", "D-03", "D-05"]) await decide(id);
    const before = await taskRow("IRP-04");

    const result = await decide("D-17", "Deferred");

    expect(await taskRow("IRP-04")).toEqual(before);
    expect(result.value.systemUpdates[0]?.note).toContain(
      "IRP-04 stays blocked on owner_decision: D-17 deferred",
    );
  });

  it("leaves a task blocked on something else unchanged", async () => {
    const requested = await h.svc.requestDecision(
      h.as.CC1,
      {
        question: "Unblock HX12-01?",
        subject: "HX12-01",
        summary: "HX12-01 waits on a dependency.",
        description: "HX12-01 is blocked on a dependency, not on this decision.",
        gateType: "policy",
        options: [{ label: "Yes", recommended: true }],
        blocks: ["HX12-01"],
        sourceUrl: "https://github.com/HX-Infratstructure/HX-CentCom/issues/1",
      },
      {},
    );
    const before = await taskRow("HX12-01");
    expect(before.blocked_on).toBe("dependency");

    const result = await decide(requested.value.decision.id);

    expect(await taskRow("HX12-01")).toEqual(before);
    expect(result.value.systemUpdates[0]?.note).toContain("HX12-01 stays blocked on dependency");
  });
});
