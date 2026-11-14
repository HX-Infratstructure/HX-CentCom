import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateRaidItemInput } from "@/server/services";
import { HX15_SOURCE, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const issue = {
  type: "issue",
  title: "The classifier host restarted",
  summary: "Unattended upgrades restarted the classifier.",
  description: "The whole story of the restart.",
  sourceUrl: WEB_SOURCE,
} as const satisfies CreateRaidItemInput;

const decisions = () => h.count("owner_decisions");

describe("T15 automation 1: a high or critical issue opens one linked pending policy decision", () => {
  it("opens exactly one decision for a high issue, and links it", async () => {
    const before = await decisions();
    const { value } = await h.svc.createRaidItem(h.as.OWNER, { ...issue, severity: "high" });
    expect(await decisions()).toBe(before + 1);
    expect(value.decision).not.toBeNull();
    expect(value.item.decision_id).toBe(value.decision?.id);
    expect(value.item.escalated).toBe(false);
    const decision = await h.one(
      `select status, gate_type, question, subject, summary, description, options, blocks, source_url, requested_by
         from owner_decisions where id = $1`,
      [value.item.decision_id],
    );
    expect(decision).toEqual({
      status: "Pending",
      gate_type: "policy",
      question: `Owner decision needed for ${value.item.id}, a high issue: ${issue.title}`,
      subject: value.item.id,
      summary: issue.summary,
      description: issue.description,
      options: [],
      blocks: [],
      source_url: WEB_SOURCE,
      requested_by: "Agent Zero",
    });
  });

  it("opens no second decision on a later update or a replay", async () => {
    const before = await decisions();
    const first = await h.svc.createRaidItem(
      h.as.CC1,
      { ...issue, severity: "high" },
      { idempotencyKey: "k" },
    );
    const replay = await h.svc.createRaidItem(
      h.as.CC1,
      { ...issue, severity: "high" },
      { idempotencyKey: "k" },
    );
    expect(replay.replayed).toBe(true);
    const raised = await h.svc.updateRaidItem(h.as.CC1, first.value.item.id, {
      severity: "critical",
    });
    expect(raised.value.decision).toBeNull();
    expect(raised.value.item.decision_id).toBe(first.value.item.decision_id);
    expect(await decisions()).toBe(before + 1);
  });

  it("opens one decision when an update raises an issue to high, and none after", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC2, { ...issue, severity: "medium" })).value;
    expect(item.decision_id).toBeNull();
    const before = await decisions();
    const raised = await h.svc.updateRaidItem(h.as.CC2, item.id, { severity: "high" });
    expect(raised.value.decision?.requested_by).toBe("CC2");
    expect(raised.value.item.decision_id).toBe(raised.value.decision?.id);
    await h.svc.updateRaidItem(h.as.CC2, item.id, { resolution: "watching" });
    expect(await decisions()).toBe(before + 1);
  });

  it("opens none for an issue that names its decision, a high risk, or a closed issue", async () => {
    const before = await decisions();
    const linked = await h.svc.createRaidItem(h.as.OWNER, {
      ...issue,
      severity: "critical",
      decisionId: "D-06",
    });
    expect(linked.value).toMatchObject({ decision: null, item: { decision_id: "D-06" } });
    const risk = await h.svc.createRaidItem(h.as.OWNER, {
      ...issue,
      type: "risk",
      severity: "high",
    });
    expect(risk.value.item.decision_id).toBeNull();
    const closed = await h.svc.createRaidItem(h.as.OWNER, {
      ...issue,
      severity: "high",
      status: "closed",
    });
    expect(closed.value.item.decision_id).toBeNull();
    expect(await decisions()).toBe(before);
  });

  it("gives the decision the issue's hx15 source", async () => {
    const { value } = await h.svc.createRaidItem(h.as.OWNER, {
      ...issue,
      severity: "high",
      sourceUrl: HX15_SOURCE,
    });
    const decision = await h.one<{ source_url: string }>(
      "select source_url from owner_decisions where id = $1",
      [value.item.decision_id],
    );
    expect(decision.source_url).toBe(HX15_SOURCE);
  });

  it("records the write in one activity row whose after names the decision", async () => {
    const { value } = await h.svc.createRaidItem(h.as.OWNER, { ...issue, severity: "high" });
    const rows = await h.q<{
      action: string;
      entity: string;
      after: { decision_id: string; effects: unknown };
    }>(
      "select action, entity, after from activity_log where created_at = (select max(created_at) from activity_log)",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "raid.create",
      entity: "raid_item",
      after: {
        decision_id: value.item.decision_id,
        effects: { decisionId: value.item.decision_id },
      },
    });
  });
});
