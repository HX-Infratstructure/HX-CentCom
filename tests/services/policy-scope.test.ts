// The RAID and lesson actions are in POLICY, and one pipeline decides row scope for tasks, RAID items and lessons.
// Each refusal text is asserted word for word, so moving the scope check never changes what a refused caller reads.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { isServiceError, POLICY, type ServiceErrorBody } from "@/server/services";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

async function refusal(call: Promise<unknown>): Promise<ServiceErrorBody> {
  const outcome = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!isServiceError(outcome)) throw new Error(`expected a service error, got ${String(outcome)}`);
  return outcome.body;
}

const SOURCE = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";

describe("POLICY", () => {
  it("has a rule for each RAID and lesson action: creates for any agent, updates scoped like task writes", () => {
    const rules: Readonly<Record<string, string>> = POLICY;
    expect({
      "raid.create": rules["raid.create"],
      "lesson.create": rules["lesson.create"],
      "raid.update": rules["raid.update"],
      "lesson.update": rules["lesson.update"],
    }).toEqual({
      "raid.create": "any",
      "lesson.create": "any",
      "raid.update": rules["task.progress"],
      "lesson.update": rules["task.progress"],
    });
  });
});

describe("row scope through the shared update pipeline", () => {
  it("refuses an agent outside the row with the service's text, and lets the row's agent write", async () => {
    const codex = await t.actorFor("Codex");
    const cc2 = await t.actorFor("CC2");
    const cc1 = await t.actorFor("CC1");

    // RAID-01 is owned by CC2 and has no creator (seed rows have created_by null).
    expect(
      await refusal(t.services.updateRaidItem(codex, "RAID-01", { status: "monitoring" })),
    ).toEqual({
      code: "forbidden",
      status: 403,
      message: "Codex may edit only RAID items it owns or created; RAID-01 is not one.",
    });
    const updated = await t.services.updateRaidItem(cc2, "RAID-01", { status: "monitoring" });
    expect(updated).toMatchObject({
      status: 200,
      value: { item: { id: "RAID-01", status: "monitoring", version: 2 } },
    });

    const { lesson } = (
      await t.services.createLesson(cc1, {
        title: "A lesson",
        summary: "By CC1.",
        sourceUrl: SOURCE,
      })
    ).value;
    expect(await refusal(t.services.updateLesson(cc2, lesson.id, { title: "Taken over" }))).toEqual(
      {
        code: "forbidden",
        status: 403,
        message: `CC2 may edit only lessons it created; ${lesson.id} is not one.`,
      },
    );
    const retitled = await t.services.updateLesson(cc1, lesson.id, { title: "Retitled" });
    expect(retitled.value.lesson).toMatchObject({ title: "Retitled", version: 2 });

    expect(
      await refusal(
        t.services.postProgress(cc2, "CC-01", { note: "Not CC2's task.", source: "api" }),
      ),
    ).toEqual({
      code: "forbidden",
      status: 403,
      message: "CC2 may write only its own tasks; CC-01 is not one.",
    });
  });
});

describe("a malformed If-Match beside an invalid body", () => {
  it("is one 400 listing both on a task update, as it already was on a RAID update", async () => {
    const cc1 = await t.actorFor("CC1");
    const body = await refusal(
      t.services.postProgress(cc1, "CC-01", { note: "", source: "api" }, { expectedVersion: 0 }),
    );
    expect(body.code).toBe("invalid");
    const paths = body.code === "invalid" ? body.issues.map((i) => i.path).sort() : [];
    expect(paths).toEqual(["If-Match", "note"]);
  });
});
