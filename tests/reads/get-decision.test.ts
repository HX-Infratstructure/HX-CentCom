// CC1's follow-up 3: one decision by its id, whatever its status, so a detail view never pages the list to find it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectServiceError, setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

describe("getDecision", () => {
  it("returns a decided and a pending decision as the list holds them, and not_found for an unknown id", async () => {
    const all = (await h.svc.listDecisions({ limit: 100 })).items;
    const listed = (id: string) => all.find((d) => d.id === id);
    expect(listed("D-15")?.status).toBe("Decided");
    expect(listed("D-01")?.status).toBe("Pending");

    expect(await h.svc.getDecision("D-15")).toEqual(listed("D-15"));
    expect(await h.svc.getDecision("D-01")).toEqual(listed("D-01"));
    await expectServiceError(h.svc.getDecision("D-999"), "not_found", 404);
  });
});
