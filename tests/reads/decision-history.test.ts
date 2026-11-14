// P3-5: a decision listing whose status filter admits no Pending decision (not_pending, Decided, Deferred,
// Superseded) is a history, newest decision first: decided_at desc, an unrecorded decided_at last, then id desc. Its
// cursor has its own shape, so a cursor from one order is 400 in the other instead of a silently wrong page. The seed
// decided D-16 at 03:30Z and D-15 at 03:49Z, and neither has a requested_at.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionQueryInput } from "@/server/services";
import { expectInvalidAt, setup, WEB_SOURCE, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const SEEDED_HISTORY = ["D-02", "D-15", "D-16", "D-14", "D-13", "D-12"];

async function pagedIds(query: DecisionQueryInput): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await h.svc.listDecisions({ ...query, ...(cursor ? { cursor } : {}) });
    seen.push(...page.items.map((d) => d.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return seen;
}

describe("the decision history order", () => {
  it("lists not_pending and Decided newest decision first, across pages", async () => {
    expect(await pagedIds({ status: "not_pending", limit: 100 })).toEqual(SEEDED_HISTORY);
    expect(await pagedIds({ status: "Decided", limit: 2 })).toEqual(SEEDED_HISTORY);
  });

  it("puts a fresh decision first, and each single status keeps its own rows in that order", async () => {
    await h.svc.decide(h.as.OWNER, "D-04", {
      status: "Deferred",
      decisionText: "Later.",
      sourceUrl: WEB_SOURCE,
    });
    expect(await pagedIds({ status: "not_pending", limit: 3 })).toEqual([
      "D-04",
      ...SEEDED_HISTORY,
    ]);
    expect(await pagedIds({ status: "Decided", limit: 100 })).toEqual(SEEDED_HISTORY);
    expect(await pagedIds({ status: "Deferred", limit: 100 })).toEqual(["D-04"]);
    expect(await pagedIds({ status: "Superseded", limit: 100 })).toEqual([]);
  });

  it("refuses a history cursor in the default order and a default cursor in the history", async () => {
    const history = await h.svc.listDecisions({ status: "not_pending", limit: 1 });
    const pending = await h.svc.listDecisions({ limit: 1 });
    expect(history.nextCursor).not.toBeNull();
    expect(pending.nextCursor).not.toBeNull();
    await expectInvalidAt(h.svc.listDecisions({ cursor: history.nextCursor ?? "" }), "cursor");
    await expectInvalidAt(
      h.svc.listDecisions({ status: "Pending", cursor: history.nextCursor ?? "" }),
      "cursor",
    );
    await expectInvalidAt(
      h.svc.listDecisions({ status: "Decided", cursor: pending.nextCursor ?? "" }),
      "cursor",
    );
  });
});
