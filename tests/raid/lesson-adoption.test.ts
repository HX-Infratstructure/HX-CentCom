import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectInvalidAt,
  expectViolation,
  HX15_SOURCE,
  setup,
  WEB_SOURCE,
  type Fixture,
} from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const lesson = { title: "A lesson", summary: "A short lesson.", sourceUrl: WEB_SOURCE };
const ENFORCER = "hx15:/home/hxsa/.claude/projects/-home-hxsa/memory/feedback-done-is-a-claim.md";

describe("T15: a lesson is adopted only with enforced_by_url", () => {
  it("refuses creating an adopted lesson without enforcedByUrl", async () => {
    await expectInvalidAt(
      h.svc.createLesson(h.as.CC1, { ...lesson, status: "adopted" }),
      "enforcedByUrl",
    );
    await expectInvalidAt(
      h.svc.createLesson(h.as.CC1, { ...lesson, status: "adopted", enforcedByUrl: null }),
      "enforcedByUrl",
    );
    expect(await h.count("lessons", "created_by = 'CC1'")).toBe(0);
  });

  it("creates an adopted lesson that names its enforcer", async () => {
    const created = await h.svc.createLesson(h.as.CC1, {
      ...lesson,
      status: "adopted",
      enforcedByUrl: ENFORCER,
    });
    expect(created.value.lesson).toMatchObject({ status: "adopted", enforced_by_url: ENFORCER });
  });

  it("refuses adopting on update when the merged row has no enforcedByUrl", async () => {
    const proposed = (await h.svc.createLesson(h.as.CC1, lesson)).value.lesson;
    await expectInvalidAt(
      h.svc.updateLesson(h.as.CC1, proposed.id, { status: "adopted" }),
      "enforcedByUrl",
    );
    const adopted = (
      await h.svc.createLesson(h.as.CC1, { ...lesson, status: "adopted", enforcedByUrl: ENFORCER })
    ).value.lesson;
    await expectInvalidAt(
      h.svc.updateLesson(h.as.CC1, adopted.id, { enforcedByUrl: null }),
      "enforcedByUrl",
    );
    const rows = await h.q<{
      id: string;
      status: string;
      enforced_by_url: string | null;
      version: number;
    }>("select id, status, enforced_by_url, version from lessons where id = any($1) order by id", [
      [proposed.id, adopted.id],
    ]);
    expect(rows).toEqual([
      { id: proposed.id, status: "proposed", enforced_by_url: null, version: 1 },
      { id: adopted.id, status: "adopted", enforced_by_url: ENFORCER, version: 1 },
    ]);
  });

  it("adopts on update with an hx15 enforcer", async () => {
    const proposed = (await h.svc.createLesson(h.as.CC1, lesson)).value.lesson;
    const adopted = await h.svc.updateLesson(h.as.CC1, proposed.id, {
      status: "adopted",
      enforcedByUrl: HX15_SOURCE,
    });
    expect(adopted.status).toBe(200);
    expect(adopted.value.lesson).toMatchObject({
      status: "adopted",
      enforced_by_url: HX15_SOURCE,
      version: 2,
    });
  });

  it("refuses a raw SQL adoption with a null enforcer", async () => {
    const proposed = (await h.svc.createLesson(h.as.CC1, lesson)).value.lesson;
    await expectViolation(
      h.q("update lessons set status = 'adopted' where id = $1", [proposed.id]),
      "lessons_adopted_is_enforced",
    );
  });
});
