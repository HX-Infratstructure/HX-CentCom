// A facet counts the records that carry a value, so a value repeated on one record counts once, as the filter on that
// value returns the record once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

describe("facet counts count each record once per value", () => {
  it("counts a RAID item with taskIds [IRP-UI, IRP-UI] once in byTask", async () => {
    const before = (await h.svc.listRaid()).counts.byTask["IRP-UI"] ?? 0;
    await h.svc.createRaidItem(h.as.OWNER, {
      type: "risk",
      title: "A risk",
      summary: "A risk.",
      description: "The whole risk.",
      sourceUrl: WEB_SOURCE,
      taskIds: ["IRP-UI", "IRP-UI"],
    });
    const page = await h.svc.listRaid({ task: "IRP-UI" });
    expect(page.counts.byTask["IRP-UI"]).toBe(before + 1);
    expect(page.counts.byTask["IRP-UI"], "the facet equals the filtered total").toBe(
      page.counts.total,
    );
  });

  it("counts a lesson with tags [cr3, cr3] once in byTag", async () => {
    await h.svc.createLesson(h.as.OWNER, {
      title: "A lesson",
      summary: "A lesson.",
      sourceUrl: WEB_SOURCE,
      tags: ["cr3", "cr3"],
    });
    const page = await h.svc.listLessons({ tag: "cr3" });
    expect(page.counts.byTag["cr3"]).toBe(1);
    expect(page.counts.total).toBe(1);
  });
});
