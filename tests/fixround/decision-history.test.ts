import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import type { Decision, DecisionQueryInput } from "@/server/services";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

async function drain(query: DecisionQueryInput): Promise<Decision[]> {
  const items: Decision[] = [];
  let cursor: string | undefined;
  do {
    const page = await t.services.listDecisions({ ...query, cursor });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

const sum = (byStatus: Partial<Record<string, number>>, keep: (status: string) => boolean) =>
  Object.entries(byStatus).reduce((n, [status, c]) => (keep(status) ? n + (c ?? 0) : n), 0);

describe("decision history: status not_pending", () => {
  it("returns only Decided, Deferred and Superseded decisions, counted in total", async () => {
    const all = await t.services.listDecisions({});
    const history = sum(all.counts.byStatus, (s) => s !== "Pending");
    expect(all.counts.byStatus.Pending ?? 0, "seed has pending decisions").toBeGreaterThan(0);
    expect(history, "seed has decided history").toBeGreaterThan(0);

    const page = await t.services.listDecisions({ status: "not_pending" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.map((d) => d.status)).not.toContain("Pending");
    expect(page.counts.total).toBe(history);
  });

  it("pages through every non-pending decision exactly once", async () => {
    const expected = (await drain({ limit: 100 }))
      .filter((d) => d.status !== "Pending")
      .map((d) => d.id);
    const paged = (await drain({ status: "not_pending", limit: 2 })).map((d) => d.id);
    expect(paged).toHaveLength(expected.length);
    expect(new Set(paged).size).toBe(paged.length);
    expect([...paged].sort()).toEqual([...expected].sort());
  });

  it("combines with gateType", async () => {
    const history = (await drain({ limit: 100 })).filter((d) => d.status !== "Pending");
    const gateType = history[0]?.gate_type;
    if (gateType === undefined) throw new Error("seed has no decided history");
    const ofType = history.filter((d) => d.gate_type === gateType).map((d) => d.id);

    const page = await t.services.listDecisions({ status: "not_pending", gateType, limit: 100 });
    expect(page.items.map((d) => d.id).sort()).toEqual(ofType.sort());
    expect(page.counts.total).toBe(ofType.length);
  });

  it("leaves the status facet counting every status", async () => {
    const all = await t.services.listDecisions({});
    const history = await t.services.listDecisions({ status: "not_pending" });
    expect(history.counts.byStatus).toEqual(all.counts.byStatus);
  });
});
