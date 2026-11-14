import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { isServiceError, type ActivityQueryInput } from "@/server/services";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

const SOURCE = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";
/** The `entity` filter values that docs/API.md lists for GET /api/v1/activity. */
const ENTITIES = ["task", "requirement", "decision", "agent_key", "raid_item", "lesson"];

describe("activity filter by RAID and lesson entities", () => {
  it("filters the activity log to raid_item, lesson and task rows", async () => {
    const actor = await t.actorFor("CC1");
    const item = (
      await t.services.createRaidItem(actor, {
        type: "risk",
        title: "A risk",
        summary: "A short risk.",
        description: "The whole risk.",
        sourceUrl: SOURCE,
      })
    ).value.item;
    const lesson = (
      await t.services.createLesson(actor, {
        title: "A lesson",
        summary: "A short lesson.",
        sourceUrl: SOURCE,
      })
    ).value.lesson;
    await t.services.postProgress(actor, "CC-01", { note: "Progress on CC-01.", source: "api" });

    const raid = (await t.services.listActivity({ entity: "raid_item" })).items;
    expect(new Set(raid.map((a) => a.entity))).toEqual(new Set(["raid_item"]));
    expect(raid.map((a) => a.entity_id)).toContain(item.id);

    const lessons = (await t.services.listActivity({ entity: "lesson" })).items;
    expect(new Set(lessons.map((a) => a.entity))).toEqual(new Set(["lesson"]));
    expect(lessons.map((a) => a.entity_id)).toContain(lesson.id);

    const tasks = (await t.services.listActivity({ entity: "task" })).items;
    expect(tasks.map((a) => a.entity_id)).toContain("CC-01");
    expect(tasks.map((a) => a.entity_id)).not.toContain(item.id);
    expect(tasks.map((a) => a.entity_id)).not.toContain(lesson.id);
  });

  it("names each entity once in the 400 for an unknown entity", async () => {
    const err = await t.services
      .listActivity({ entity: "nope" } as unknown as ActivityQueryInput)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    if (!isServiceError(err) || err.body.code !== "invalid") {
      throw new Error(`expected an invalid service error, got ${String(err)}`);
    }
    expect(err.status).toBe(400);
    const message = err.body.issues.find((i) => i.path === "entity")?.message ?? "";
    for (const entity of ENTITIES) {
      expect(message.match(new RegExp(`\\b${entity}\\b`, "g")), entity).toHaveLength(1);
    }
  });
});
