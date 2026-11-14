// F5 (CC1's design H1): the owner reverts a logged update of a task, a requirement, a RAID item or a lesson by its
// activity id. The revert restores the row from the activity's `before`, is version-checked against the version the
// activity recorded, writes one activity.revert row in the target's entity feed, and a task revert posts one system
// update. Creates, decides, key actions and writes whose automations did more than change the row are refused with
// 409 not_revertible.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as revertRoute } from "@/routes/api/v1/activity/$id/revert";
import {
  expectInvalidAt,
  expectServiceError,
  rest,
  setup,
  WEB_SOURCE,
  type Fixture,
} from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

type ActivityRow = {
  id: string;
  actor: string;
  entity: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** The one activity row of `action` on `entityId` whose `after` passes `match`. */
async function activity(
  action: string,
  entityId: string,
  match: (after: Record<string, unknown>) => boolean = () => true,
): Promise<ActivityRow> {
  const rows = (
    await h.q<ActivityRow>(
      "select id, actor, entity, entity_id, before, after from activity_log where action = $1 and entity_id = $2",
      [action, entityId],
    )
  ).filter((r) => match(r.after ?? {}));
  expect(rows, `one ${action} row on ${entityId}`).toHaveLength(1);
  return rows[0] as ActivityRow;
}

const reverts = () =>
  h.q<ActivityRow>("select * from activity_log where action = 'activity.revert'");
const taskRow = (id: string) =>
  h.one<{ status: string; group: string; version: number }>(
    'select status, "group", version from engineering_tasks where id = $1',
    [id],
  );
const systemUpdates = (taskId: string) =>
  h.q<{ id: string; agent_id: string; note: string; source: string | null }>(
    "select id, agent_id, note, source from task_updates where task_id = $1 and kind = 'system' order by created_at, id",
    [taskId],
  );

/** CC1 moves CC-01 from In progress to Waiting; the activity id of that write. */
async function parkCc01(): Promise<string> {
  const posted = await h.svc.postProgress(h.as.CC1, "CC-01", {
    note: "Parked until the review lands.",
    status: "Waiting",
    source: "api",
  });
  return (
    await activity("task.progress", "CC-01", (a) => a["update_id"] === posted.value.update.id)
  ).id;
}

describe("a task revert", () => {
  it("restores the status and group, bumps the version, posts one owner system update and logs one revert", async () => {
    const start = await taskRow("CC-01");
    expect(start).toMatchObject({ status: "In progress", group: "in_progress" });
    const target = await parkCc01();
    const updatesBefore = await systemUpdates("CC-01");

    const result = await h.svc.revertActivity(h.as.OWNER, target);

    expect(result.status).toBe(200);
    expect(await taskRow("CC-01")).toEqual({
      status: "In progress",
      group: "in_progress",
      version: start.version + 2,
    });
    const added = (await systemUpdates("CC-01")).slice(updatesBefore.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ agent_id: "Agent Zero", source: null });
    expect(result.value).toEqual({
      reverted: target,
      entity: "task",
      entityId: "CC-01",
      version: start.version + 2,
      systemUpdates: [expect.objectContaining({ id: added[0]?.id, kind: "system" })],
    });
    const [row] = await reverts();
    expect(await reverts()).toHaveLength(1);
    expect(row).toMatchObject({
      actor: "Agent Zero",
      entity: "task",
      entity_id: "CC-01",
      before: { status: "Waiting", group: "backlog", version: start.version + 1 },
      after: {
        status: "In progress",
        group: "in_progress",
        version: start.version + 2,
        reverts: target,
      },
    });
  });

  it("can itself be reverted", async () => {
    const start = await taskRow("CC-01");
    await h.svc.revertActivity(h.as.OWNER, await parkCc01());
    const [revert] = await reverts();

    const again = await h.svc.revertActivity(h.as.OWNER, revert?.id ?? "");

    expect(again.value).toMatchObject({ reverted: revert?.id, entity: "task", entityId: "CC-01" });
    expect(await taskRow("CC-01")).toEqual({
      status: "Waiting",
      group: "backlog",
      version: start.version + 3,
    });
    expect(await reverts()).toHaveLength(2);
  });

  it("is a version_conflict once a later write moved the task, and changes nothing", async () => {
    const target = await parkCc01();
    await h.svc.postProgress(h.as.CC1, "CC-01", { note: "A later note.", source: "api" });
    const current = await taskRow("CC-01");

    const error = await expectServiceError(
      h.svc.revertActivity(h.as.OWNER, target),
      "version_conflict",
      409,
    );

    expect(error.body).toMatchObject({ currentVersion: current.version });
    expect(await taskRow("CC-01")).toEqual(current);
    expect(await reverts()).toEqual([]);
  });

  it("is a version_conflict the second time, because the first revert moved the version", async () => {
    const target = await parkCc01();
    await h.svc.revertActivity(h.as.OWNER, target);
    await expectServiceError(h.svc.revertActivity(h.as.OWNER, target), "version_conflict", 409);
    expect(await reverts()).toHaveLength(1);
  });
});

describe("a requirement revert", () => {
  const REQUIREMENT = "Stage 2 Run 1 sequential: 254 / 254 requests";
  const requirementRow = () =>
    h.one<{
      id: string;
      state: string;
      proof_url: string | null;
      updated_by: string | null;
      version: number;
    }>(
      "select id, state, proof_url, updated_by, version from task_requirements where task_id = 'IRP-04' and requirement = $1",
      [REQUIREMENT],
    );

  it("restores the state and proof, records the owner as the last writer and bumps the requirement's version", async () => {
    const seeded = await requirementRow();
    expect(seeded).toMatchObject({ state: "PASS", updated_by: null });
    await h.svc.setRequirement(h.as.CC2, "IRP-04", { requirement: REQUIREMENT, state: "FAIL" });
    expect(await requirementRow()).toMatchObject({
      state: "FAIL",
      proof_url: null,
      updated_by: "CC2",
    });
    const target = await activity("requirement.set", seeded.id);

    const result = await h.svc.revertActivity(h.as.OWNER, target.id);

    expect(await requirementRow()).toEqual({
      id: seeded.id,
      state: "PASS",
      proof_url: seeded.proof_url,
      updated_by: "Agent Zero",
      version: seeded.version + 2,
    });
    expect(result.value).toEqual({
      reverted: target.id,
      entity: "requirement",
      entityId: seeded.id,
      version: seeded.version + 2,
      systemUpdates: [],
    });
    const [row] = await reverts();
    expect(row).toMatchObject({
      entity: "requirement",
      entity_id: seeded.id,
      after: { state: "PASS", task_id: "IRP-04", reverts: target.id },
    });
  });
});

describe("a RAID revert", () => {
  it("restores the fields with the severity and its rater from the snapshot, never the reverting owner", async () => {
    const created = await h.svc.createRaidItem(h.as.CC1, {
      type: "risk",
      title: "The bench host may be busy",
      summary: "A risk.",
      description: "The whole risk.",
      sourceUrl: WEB_SOURCE,
      severity: "low",
    });
    const id = created.value.item.id;
    await h.svc.updateRaidItem(h.as.OWNER, id, {
      severity: "high",
      title: "The bench host is busy",
    });
    const target = await activity("raid.update", id);

    const result = await h.svc.revertActivity(h.as.OWNER, target.id);

    const item = await h.one<Record<string, unknown>>(
      "select title, severity, severity_rated_by, created_by, version from raid_items where id = $1",
      [id],
    );
    expect(item).toEqual({
      title: "The bench host may be busy",
      severity: "low",
      severity_rated_by: "CC1",
      created_by: "CC1",
      version: 3,
    });
    expect(result.value).toMatchObject({
      reverted: target.id,
      entity: "raid_item",
      entityId: id,
      version: 3,
    });
    const [row] = await reverts();
    expect(row?.after).not.toHaveProperty("effects");
    expect(row?.after).toMatchObject({ severity: "low", reverts: target.id });
  });
});

describe("a lesson revert", () => {
  it("restores the lesson's fields", async () => {
    const created = await h.svc.createLesson(h.as.CC1, {
      title: "Brief reviewers with the target only",
      summary: "Target-only briefs.",
      sourceUrl: WEB_SOURCE,
    });
    const id = created.value.lesson.id;
    await h.svc.updateLesson(h.as.CC1, id, { title: "Reviewers get the target and nothing else" });
    const target = await activity("lesson.update", id);

    const result = await h.svc.revertActivity(h.as.OWNER, target.id);

    expect(
      await h.one("select title, created_by, version from lessons where id = $1", [id]),
    ).toEqual({ title: "Brief reviewers with the target only", created_by: "CC1", version: 3 });
    expect(result.value).toMatchObject({
      reverted: target.id,
      entity: "lesson",
      entityId: id,
      version: 3,
    });
  });
});

describe("what cannot be reverted", () => {
  async function expectNotRevertible(activityId: string): Promise<void> {
    await expectServiceError(h.svc.revertActivity(h.as.OWNER, activityId), "not_revertible", 409);
  }

  it("refuses creates: a RAID item, a lesson, a decision request and a new requirement", async () => {
    const raid = await h.svc.createRaidItem(h.as.CC1, {
      type: "risk",
      title: "A new risk",
      summary: "A risk.",
      description: "The whole risk.",
      sourceUrl: WEB_SOURCE,
    });
    const lesson = await h.svc.createLesson(h.as.CC1, {
      title: "A new lesson",
      summary: "A lesson.",
      sourceUrl: WEB_SOURCE,
    });
    const decision = await h.svc.requestDecision(h.as.CC1, {
      question: "Ship it?",
      summary: "Ship it.",
      description: "Ship the build.",
      subject: "CC-01",
      gateType: "scope",
      options: [],
      blocks: [],
      sourceUrl: WEB_SOURCE,
    });
    const requirement = await h.svc.setRequirement(h.as.CC1, "CC-01", {
      requirement: "A brand-new requirement",
      state: "NOT_RUN",
    });
    await expectNotRevertible((await activity("raid.create", raid.value.item.id)).id);
    await expectNotRevertible((await activity("lesson.create", lesson.value.lesson.id)).id);
    await expectNotRevertible((await activity("decision.request", decision.value.decision.id)).id);
    await expectNotRevertible(
      (await activity("requirement.set", requirement.value.requirement.id)).id,
    );
    expect(await reverts()).toEqual([]);
  });

  it("refuses a decide and a key action", async () => {
    await h.svc.decide(h.as.OWNER, "D-04", {
      status: "Deferred",
      decisionText: "Later.",
      sourceUrl: WEB_SOURCE,
    });
    const key = await h.svc.issueKey(h.as.OWNER, "CC1", "revert test");
    await expectNotRevertible((await activity("decision.decide", "D-04")).id);
    await expectNotRevertible((await activity("key.issue", key.keyId)).id);
    expect(await reverts()).toEqual([]);
  });

  it("refuses a dependency close that posted a system update, and an update that opened a decision", async () => {
    await h.svc.updateRaidItem(h.as.CC2, "RAID-05", { status: "closed" });
    const close = await activity("raid.update", "RAID-05");
    expect(close.after?.["effects"]).toMatchObject({ systemUpdateIds: [expect.any(String)] });
    const ready = await h.svc.postProgress(h.as.CC1, "CC-01", {
      note: "Build done.",
      status: "Ready for owner",
      prUrl: "https://github.com/HX-Infratstructure/HX-CentCom/pull/7",
      source: "api",
    });
    const opened = await activity(
      "task.progress",
      "CC-01",
      (a) => a["update_id"] === ready.value.update.id,
    );
    expect(opened.after?.["effects"]).toMatchObject({ decisionId: expect.any(String) });

    await expectNotRevertible(close.id);
    await expectNotRevertible(opened.id);
    expect(await reverts()).toEqual([]);
  });
});

describe("who may revert, and the error order", () => {
  it("is 401 without a key and 403 for an agent, before the id is read or even parsed", async () => {
    const target = await parkCc01();
    await expectServiceError(h.svc.revertActivity(null, target), "unauthorized", 401);
    await expectServiceError(h.svc.revertActivity(h.as.CC1, target), "forbidden", 403);
    await expectServiceError(h.svc.revertActivity(h.as.CC1, randomUUID()), "forbidden", 403);
    await expectServiceError(h.svc.revertActivity(h.as.CC1, "abc"), "forbidden", 403);
    expect(await reverts()).toEqual([]);
  });

  it("is 400 at activityId for an id that is not a uuid, and 404 for an unknown one", async () => {
    await expectInvalidAt(h.svc.revertActivity(h.as.OWNER, "abc"), "activityId");
    await expectServiceError(h.svc.revertActivity(h.as.OWNER, randomUUID()), "not_found", 404);
  });
});

describe("idempotency and REST", () => {
  it("replays a revert with the same key and writes one row", async () => {
    const target = await parkCc01();
    const first = await h.svc.revertActivity(h.as.OWNER, target, { idempotencyKey: "revert-1" });
    const replay = await h.svc.revertActivity(h.as.OWNER, target, { idempotencyKey: "revert-1" });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(first.replayed).toBe(false);
    expect(await reverts()).toHaveLength(1);
  });

  it("POST /api/v1/activity/:id/revert takes no body, answers 200 and replays with Idempotency-Replayed", async () => {
    const target = await parkCc01();
    const authorization = await h.auth("Agent Zero");
    const post = () =>
      rest(h.svc, revertRoute, "POST", `/api/v1/activity/${target}/revert`, {
        params: { id: target },
        authorization,
        headers: { "Idempotency-Key": "rest-revert-1" },
      });

    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ reverted: target, entity: "task", entityId: "CC-01" });

    const replay = await post();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.json()).toEqual(body);
    expect(await reverts()).toHaveLength(1);
    expect(await taskRow("CC-01")).toMatchObject({ status: "In progress" });
  });

  it("POST without a key is 401, and from an agent 403", async () => {
    const target = await parkCc01();
    const unauthenticated = await rest(
      h.svc,
      revertRoute,
      "POST",
      `/api/v1/activity/${target}/revert`,
      {
        params: { id: target },
      },
    );
    expect(unauthenticated.status).toBe(401);
    const agent = await rest(h.svc, revertRoute, "POST", `/api/v1/activity/${target}/revert`, {
      params: { id: target },
      authorization: await h.auth("CC1"),
    });
    expect(agent.status).toBe(403);
    expect(await reverts()).toEqual([]);
  });
});
