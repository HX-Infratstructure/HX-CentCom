// An agent registers its own work as a task through createTask, so it has a task to post progress to.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateTaskInput } from "@/server/services";
import { count, expectServiceError, IDS, loose, setup, type Harness } from "./support";

const SOURCE = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

function body(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return { id: "CC-90", title: "Register agent work", sourceUrl: SOURCE, ...overrides };
}

const taskCreates = (h: Harness, id: string) =>
  count(h, "activity_log", "action = 'task.create' and entity_id = $1", [id]);

describe("createTask", () => {
  it("lets an agent create its own task: 201, the caller as agent, version 1, one activity row", async () => {
    const result = await h.svc.createTask(
      h.as.CC1,
      body({ repository: "HX-CentCom", host: "HX-15", note: "From the hook" }),
    );
    expect(result.status).toBe(201);
    expect(result.replayed).toBe(false);
    expect(result.value.task).toMatchObject({
      id: "CC-90",
      title: "Register agent work",
      agent: IDS.CC1,
      repository: "HX-CentCom",
      host: "HX-15",
      status: "Waiting",
      group: "backlog",
      blocked_on: "none",
      commit_sha: null,
      note: "From the hook",
      source_url: SOURCE,
      version: 1,
    });
    expect(await taskCreates(h, "CC-90")).toBe(1);
    const activity = await h.one<{ actor: string; entity: string; before: unknown }>(
      "select actor, entity, before from activity_log where action = 'task.create'",
    );
    expect(activity).toEqual({ actor: IDS.CC1, entity: "task", before: null });
    expect(await count(h, "task_requirements", "task_id = 'CC-90'")).toBe(0);
  });

  it("sets the group from the status the way postProgress does", async () => {
    const started = await h.svc.createTask(h.as.CC1, body({ status: "In progress" }));
    expect(started.value.task).toMatchObject({ status: "In progress", group: "in_progress" });
    const done = await h.svc.createTask(h.as.CC1, body({ id: "CC-91", status: "Complete" }));
    expect(done.value.task).toMatchObject({ status: "Complete", group: "done" });
  });

  it("refuses an agent that names another agent with 403 and writes nothing", async () => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.CC1, body({ agentId: IDS.CC2 })),
      "forbidden",
      403,
    );
    expect(err.message).toContain(IDS.CC2);
    expect(await count(h, "engineering_tasks", "id = 'CC-90'")).toBe(0);
    expect(await taskCreates(h, "CC-90")).toBe(0);
  });

  it("lets an agent name itself", async () => {
    const result = await h.svc.createTask(h.as.CC2, body({ agentId: IDS.CC2 }));
    expect(result.value.task.agent).toBe(IDS.CC2);
  });

  it("refuses a duplicate id with 409 conflict naming the id", async () => {
    const seeded = await h.one<{ id: string }>("select id from engineering_tasks limit 1");
    const err = await expectServiceError(
      h.svc.createTask(h.as.OWNER, body({ id: seeded.id })),
      "conflict",
      409,
    );
    expect(err.message).toContain(seeded.id);
    expect(await taskCreates(h, seeded.id)).toBe(0);
  });

  it.each([
    ["a lowercase id", "id", { id: "cc-90" }],
    ["an id without a dash", "id", { id: "CC90" }],
    ["an id longer than 24 characters", "id", { id: `CC-${"9".repeat(22)}` }],
    ["an empty title", "title", { title: " " }],
    [
      "a due date before the start date",
      "dueDate",
      { startDate: "2026-11-20", dueDate: "2026-11-19" },
    ],
    ["an impossible date", "startDate", { startDate: "2026-02-31" }],
    ["an empty repository", "repository", { repository: " " }],
    ["a host longer than 32 characters", "host", { host: "H".repeat(33) }],
    ["an unknown status", "status", { status: "Someday" }],
    ["a source that is not http(s) or hx15:", "sourceUrl", { sourceUrl: "ftp://example.com/x" }],
    ["a note longer than 4000 characters", "note", { note: "n".repeat(4001) }],
  ] as const)("refuses %s with 400 at %s", async (_, path, overrides) => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.CC1, body(loose(overrides))),
      "invalid",
      400,
    );
    expect(err.body.code === "invalid" ? err.body.issues.map((i) => i.path) : []).toContain(path);
    expect(await count(h, "engineering_tasks", "id = 'CC-90'")).toBe(0);
  });

  it.each([
    [
      "a start date before 2020",
      "startDate",
      { startDate: "0001-01-01" },
      "2020-01-01 and 2099-12-31",
    ],
    ["a due date after 2099", "dueDate", { dueDate: "9999-12-31" }, "2020-01-01 and 2099-12-31"],
    [
      "a span of 731 days",
      "dueDate",
      { startDate: "2026-01-01", dueDate: "2028-01-02" },
      "at most 730 days after startDate",
    ],
  ] as const)("refuses %s with 400 at %s naming the rule", async (_, path, overrides, rule) => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.CC1, body(overrides)),
      "invalid",
      400,
    );
    const issues = err.body.code === "invalid" ? err.body.issues : [];
    expect(issues).toContainEqual({ path, message: expect.stringContaining(rule) });
    expect(await count(h, "engineering_tasks", "id = 'CC-90'")).toBe(0);
  });

  it("names the valid statuses in the issue for an unknown status", async () => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.CC1, body({ status: "Someday" })),
      "invalid",
      400,
    );
    expect(err.body.code === "invalid" ? err.body.issues : []).toContainEqual({
      path: "status",
      message:
        "no status Someday; the valid statuses are Blocked, Complete, In progress, Ready for owner, Waiting",
    });
  });

  it("accepts a span of exactly 730 days", async () => {
    const result = await h.svc.createTask(
      h.as.CC1,
      body({ startDate: "2026-01-01", dueDate: "2028-01-01" }),
    );
    expect(result.status).toBe(201);
    expect(result.value.task).toMatchObject({ start_date: "2026-01-01", due_date: "2028-01-01" });
  });

  it("refuses a body without an id or a source", async () => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.CC1, loose({ title: "No id" })),
      "invalid",
      400,
    );
    const paths = err.body.code === "invalid" ? err.body.issues.map((i) => i.path) : [];
    expect(paths).toEqual(expect.arrayContaining(["id", "sourceUrl"]));
  });

  it("lets the owner create a task for CC2 and an unassigned one", async () => {
    const forCc2 = await h.svc.createTask(h.as.OWNER, body({ agentId: IDS.CC2 }));
    expect(forCc2.value.task.agent).toBe(IDS.CC2);
    const unassigned = await h.svc.createTask(h.as.OWNER, body({ id: "CC-91" }));
    expect(unassigned.value.task.agent).toBeNull();
    const actors = await h.q<{ actor: string }>(
      "select actor from activity_log where action = 'task.create' order by entity_id",
    );
    expect(actors).toEqual([{ actor: IDS.OWNER }, { actor: IDS.OWNER }]);
  });

  it("refuses an owner assignment to an unknown agent with 400 at agentId", async () => {
    const err = await expectServiceError(
      h.svc.createTask(h.as.OWNER, body({ agentId: "Nobody" })),
      "invalid",
      400,
    );
    expect(err.body.code === "invalid" ? err.body.issues.map((i) => i.path) : []).toEqual([
      "agentId",
    ]);
  });

  it("replays an idempotent retry: the same task, no second activity row", async () => {
    const first = await h.svc.createTask(h.as.CC1, body(), { idempotencyKey: "create-cc-90" });
    const again = await h.svc.createTask(h.as.CC1, body(), { idempotencyKey: "create-cc-90" });
    expect(again.replayed).toBe(true);
    expect(again.status).toBe(201);
    expect(again.value).toEqual(first.value);
    expect(await taskCreates(h, "CC-90")).toBe(1);
  });

  it("refuses to revert a task.create with not_revertible", async () => {
    await h.svc.createTask(h.as.CC1, body());
    const { id } = await h.one<{ id: string }>(
      "select id from activity_log where action = 'task.create'",
    );
    await expectServiceError(h.svc.revertActivity(h.as.OWNER, id), "not_revertible", 409);
    const listed = await h.svc.listActivity({ entityId: "CC-90" });
    expect(listed.items.map((a) => [a.action, a.revertible])).toEqual([["task.create", false]]);
  });

  it("puts the new task in listWorkspace with no requirements, open, and not stale", async () => {
    await h.svc.createTask(h.as.CC1, body());
    const ws = await h.svc.listWorkspace();
    const task = ws.tasks.find((t) => t.id === "CC-90");
    expect(task).toMatchObject({
      agent: IDS.CC1,
      progress: { proven: 0, total: 0, percent: null },
      open: true,
      stale: null,
    });
    expect(ws.requirements.filter((r) => r.task_id === "CC-90")).toEqual([]);
    const mine = await h.svc.myWork(h.as.CC1);
    expect(mine.tasks.map((t) => t.id)).toContain("CC-90");
  });

  it("lets the creating agent post progress to its new task", async () => {
    await h.svc.createTask(h.as.CC2, body());
    const posted = await h.svc.postProgress(h.as.CC2, "CC-90", {
      note: "Started",
      status: "In progress",
      source: "api",
    });
    expect(posted.value.task).toMatchObject({ id: "CC-90", version: 2, status: "In progress" });
  });
});
