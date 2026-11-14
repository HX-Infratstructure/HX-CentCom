import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateLessonInput, CreateRaidItemInput } from "@/server/services";
import { expectInvalidAt, HX15_SOURCE, loose, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const risk = {
  type: "risk",
  title: "A risk",
  summary: "A short risk.",
  description: "The whole risk.",
};
const lesson = { title: "A lesson", summary: "A short lesson." };

describe("T15: a RAID item or lesson needs a source", () => {
  it("refuses a RAID item without sourceUrl, at sourceUrl", async () => {
    await expectInvalidAt(
      h.svc.createRaidItem(h.as.CC1, loose<CreateRaidItemInput>(risk)),
      "sourceUrl",
    );
    expect(await h.count("raid_items", "created_by = 'CC1'")).toBe(0);
  });

  it("refuses a lesson without sourceUrl, at sourceUrl", async () => {
    await expectInvalidAt(
      h.svc.createLesson(h.as.CC1, loose<CreateLessonInput>(lesson)),
      "sourceUrl",
    );
    expect(await h.count("lessons", "created_by = 'CC1'")).toBe(0);
  });

  it("refuses a bare path", async () => {
    await expectInvalidAt(
      h.svc.createRaidItem(
        h.as.CC1,
        loose<CreateRaidItemInput>({ ...risk, sourceUrl: "SPEC.md:79" }),
      ),
      "sourceUrl",
    );
    await expectInvalidAt(
      h.svc.createLesson(
        h.as.CC1,
        loose<CreateLessonInput>({ ...lesson, sourceUrl: "memory/x.md" }),
      ),
      "sourceUrl",
    );
  });

  it("accepts an hx15 reference and an http(s) URL", async () => {
    const local = await h.svc.createRaidItem(
      h.as.CC1,
      loose<CreateRaidItemInput>({ ...risk, sourceUrl: HX15_SOURCE }),
    );
    expect(local.status).toBe(201);
    expect(local.value.item).toMatchObject({
      type: "risk",
      source_url: HX15_SOURCE,
      created_by: "CC1",
    });
    const web = await h.svc.createLesson(h.as.CC1, { ...lesson, sourceUrl: WEB_SOURCE });
    expect(web.status).toBe(201);
    expect(web.value.lesson).toMatchObject({
      source_url: WEB_SOURCE,
      status: "proposed",
      created_by: "CC1",
    });
    const localLesson = await h.svc.createLesson(h.as.CC1, { ...lesson, sourceUrl: HX15_SOURCE });
    expect(localLesson.value.lesson.source_url).toBe(HX15_SOURCE);
  });
});
