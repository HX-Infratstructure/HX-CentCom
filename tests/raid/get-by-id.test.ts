// CodeRabbit #9 on PR #2: one RAID item or lesson by its id, whatever the filters, so a deep link never pages the list.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectServiceError, setup, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

describe("getRaidItem", () => {
  it("returns the item as the list holds it, and not_found for an unknown id", async () => {
    const listed = (await h.svc.listRaid({ limit: 100 })).items.find((i) => i.id === "RAID-01");
    expect(listed).toBeDefined();

    expect(await h.svc.getRaidItem("RAID-01")).toEqual(listed);
    await expectServiceError(h.svc.getRaidItem("RAID-999"), "not_found", 404);
  });
});

describe("getLesson", () => {
  it("returns the lesson as the list holds it, and not_found for an unknown id", async () => {
    const listed = (await h.svc.listLessons({ limit: 100 })).items.find((l) => l.id === "L-01");
    expect(listed).toBeDefined();

    expect(await h.svc.getLesson("L-01")).toEqual(listed);
    await expectServiceError(h.svc.getLesson("L-999"), "not_found", 404);
  });
});
