import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectServiceError, issuePaths, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const risk = {
  type: "risk" as const,
  title: "A risk",
  summary: "A short risk.",
  description: "The whole risk.",
  sourceUrl: WEB_SOURCE,
};
const lesson = { title: "A lesson", summary: "A short lesson.", sourceUrl: WEB_SOURCE };

type Activity = { actor: string; action: string; entity: string; entity_id: string };
const activity = () =>
  h.q<Activity>(
    "select actor, action, entity, entity_id from activity_log where entity in ('raid_item', 'lesson') order by created_at, id",
  );

describe("idempotency and versions on RAID and lesson writes", () => {
  it("replays the same key and body as one row", async () => {
    const first = await h.svc.createRaidItem(h.as.CC1, risk, { idempotencyKey: "k1" });
    const again = await h.svc.createRaidItem(h.as.CC1, risk, { idempotencyKey: "k1" });
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await h.count("raid_items", "created_by = 'CC1'")).toBe(1);
    const lessonFirst = await h.svc.createLesson(h.as.CC1, lesson, { idempotencyKey: "k2" });
    const lessonAgain = await h.svc.createLesson(h.as.CC1, lesson, { idempotencyKey: "k2" });
    expect(lessonAgain).toEqual({ ...lessonFirst, replayed: true });
    expect(await h.count("lessons", "created_by = 'CC1'")).toBe(1);
  });

  it("refuses the same key with another body, another row or another If-Match (422)", async () => {
    await h.svc.createRaidItem(h.as.CC1, risk, { idempotencyKey: "c" });
    await expectServiceError(
      h.svc.createRaidItem(h.as.CC1, { ...risk, title: "Another risk" }, { idempotencyKey: "c" }),
      "idempotency_mismatch",
      422,
    );
    const a = (await h.svc.createRaidItem(h.as.CC1, risk)).value.item;
    const b = (await h.svc.createRaidItem(h.as.CC1, risk)).value.item;
    await h.svc.updateRaidItem(h.as.CC1, a.id, { status: "monitoring" }, { idempotencyKey: "u" });
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, b.id, { status: "monitoring" }, { idempotencyKey: "u" }),
      "idempotency_mismatch",
      422,
    );
    await h.svc.updateRaidItem(
      h.as.CC1,
      a.id,
      { title: "v" },
      { idempotencyKey: "m", expectedVersion: 2 },
    );
    await expectServiceError(
      h.svc.updateRaidItem(
        h.as.CC1,
        a.id,
        { title: "v" },
        { idempotencyKey: "m", expectedVersion: 3 },
      ),
      "idempotency_mismatch",
      422,
    );
    expect(
      await h.one("select status, title, version from raid_items where id = $1", [b.id]),
    ).toEqual({
      status: "open",
      title: "A risk",
      version: 1,
    });
  });

  it("replays before it checks the version", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC2, risk)).value;
    const first = await h.svc.updateRaidItem(
      h.as.CC2,
      item.id,
      { status: "monitoring" },
      { idempotencyKey: "r", expectedVersion: 1 },
    );
    await h.svc.updateRaidItem(h.as.OWNER, item.id, { title: "moved on" });
    const replay = await h.svc.updateRaidItem(
      h.as.CC2,
      item.id,
      { status: "monitoring" },
      { idempotencyKey: "r", expectedVersion: 1 },
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(replay.status).toBe(200);
  });

  it("runs the write when a key is reused after an in-transaction 400", async () => {
    const bad = { ...risk, taskIds: ["NO-SUCH-TASK"] };
    const error = await expectServiceError(
      h.svc.createRaidItem(h.as.CC1, bad, { idempotencyKey: "x" }),
      "invalid",
      400,
    );
    expect(issuePaths(error)).toEqual(["taskIds.0"]);
    await expectServiceError(
      h.svc.createRaidItem(h.as.CC1, bad, { idempotencyKey: "x" }),
      "invalid",
      400,
    );
    const fixed = await h.svc.createRaidItem(
      h.as.CC1,
      { ...risk, taskIds: ["CC-01"] },
      { idempotencyKey: "x" },
    );
    expect(fixed).toMatchObject({ status: 201, replayed: false });
    expect(fixed.value.item.task_ids).toEqual(["CC-01"]);
  });

  it("reports a malformed If-Match at If-Match, beside a failing body field", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC1, risk)).value;
    const alone = await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { title: "x" }, { expectedVersion: Number.NaN }),
      "invalid",
      400,
    );
    expect(alone.body).toMatchObject({
      issues: [{ path: "If-Match", message: "must be a positive integer version" }],
    });
    const both = await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { title: "" }, { expectedVersion: 0 }),
      "invalid",
      400,
    );
    expect(issuePaths(both).sort()).toEqual(["If-Match", "title"]);
  });

  it("refuses an empty update and a type change", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC1, risk)).value;
    const empty = await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, {}),
      "invalid",
      400,
    );
    expect(issuePaths(empty)).toEqual(["(body)"]);
    const typed = await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { type: "issue" } as never),
      "invalid",
      400,
    );
    expect(issuePaths(typed)).toContain("type");
    await expectServiceError(h.svc.updateLesson(h.as.CC1, "L-01", {}), "invalid", 400);
  });

  it("adds exactly one activity row per write when automations run", async () => {
    const rows = () => h.count("activity_log");
    let before = await rows();
    await h.svc.createRaidItem(h.as.OWNER, {
      type: "issue",
      title: "i",
      summary: "s",
      description: "d",
      sourceUrl: WEB_SOURCE,
      severity: "critical",
    });
    expect(await rows()).toBe(before + 1);
    expect(await h.count("activity_log", "action = 'decision.request'")).toBe(0);
    const dep = (
      await h.svc.createRaidItem(h.as.OWNER, {
        type: "dependency",
        title: "d",
        summary: "s",
        description: "d",
        sourceUrl: WEB_SOURCE,
        blockedTaskId: "HX12-01",
        blockingRef: "task:RO-01",
      })
    ).value.item;
    before = await rows();
    await h.svc.updateRaidItem(h.as.OWNER, dep.id, { status: "closed" });
    expect(await rows()).toBe(before + 1);
    before = await rows();
    await h.svc.postProgress(h.as.CC1, "CC-01", {
      note: "Built.",
      status: "Complete",
      source: "api",
    });
    expect(await rows()).toBe(before + 1);
  });

  it("adds exactly one activity row per write, with its action and entity, and none for a refused write", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC1, risk, { idempotencyKey: "a" })).value;
    await h.svc.createRaidItem(h.as.CC1, risk, { idempotencyKey: "a" });
    await h.svc.updateRaidItem(h.as.CC1, item.id, { mitigation: "watch it" });
    const { lesson: created } = (await h.svc.createLesson(h.as.CC2, lesson)).value;
    await h.svc.updateLesson(h.as.CC2, created.id, { tags: ["x"] });
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC2, item.id, { title: "no" }),
      "forbidden",
      403,
    );
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { blockedTaskId: "IRP-04" }),
      "invalid",
      400,
    );
    expect(await activity()).toEqual([
      { actor: "CC1", action: "raid.create", entity: "raid_item", entity_id: item.id },
      { actor: "CC1", action: "raid.update", entity: "raid_item", entity_id: item.id },
      { actor: "CC2", action: "lesson.create", entity: "lesson", entity_id: created.id },
      { actor: "CC2", action: "lesson.update", entity: "lesson", entity_id: created.id },
    ]);
  });
});
