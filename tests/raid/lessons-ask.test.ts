import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const ASK =
  "add any lessons from this task with their source (POST /api/v1/lessons or the add_lesson MCP tool).";
const systemNotes = (taskId: string) =>
  h.q<{ note: string; agent_id: string; source: string | null; status: string | null }>(
    "select note, agent_id, source, status from task_updates where task_id = $1 and kind = 'system' order by created_at, id",
    [taskId],
  );

describe("T15 automation 3: a task that becomes done asks its agent for lessons", () => {
  it("posts exactly one system update when a task moves to Complete, and leaves the answer as it was", async () => {
    // CC-01 is seeded In progress with agent CC1.
    const result = await h.svc.postProgress(h.as.CC1, "CC-01", {
      note: "Built.",
      status: "Complete",
      source: "api",
    });
    expect(result.status).toBe(201);
    expect(Object.keys(result.value).sort()).toEqual(["task", "update"]);
    expect(result.value.update).toMatchObject({
      task_id: "CC-01",
      kind: "progress",
      status: "Complete",
      note: "Built.",
    });
    expect(result.value.task).toEqual({ id: "CC-01", version: 2, status: "Complete" });
    expect(await systemNotes("CC-01")).toEqual([
      { note: `CC-01 is Complete. CC1: ${ASK}`, agent_id: "CC1", source: null, status: null },
    ]);
    const activity = await h.q<{ action: string; after: unknown }>(
      "select action, after from activity_log where entity_id = 'CC-01'",
    );
    expect(activity).toEqual([
      {
        action: "task.progress",
        after: { status: "Complete", group: "done", version: 2, update_id: result.value.update.id },
      },
    ]);
  });

  it("posts nothing when the task was already done, for a non-done status, or on a replay", async () => {
    const opts = { idempotencyKey: "done" };
    await h.svc.postProgress(
      h.as.CC1,
      "CC-01",
      { note: "Built.", status: "Complete", source: "api" },
      opts,
    );
    const replay = await h.svc.postProgress(
      h.as.CC1,
      "CC-01",
      { note: "Built.", status: "Complete", source: "api" },
      opts,
    );
    expect(replay.replayed).toBe(true);
    await h.svc.postProgress(h.as.CC1, "CC-01", {
      note: "Still done.",
      status: "Complete",
      source: "api",
    });
    await h.svc.postProgress(h.as.CC1, "CC-01", { note: "A note.", source: "api" });
    expect(await systemNotes("CC-01")).toHaveLength(1);
    // IRP-05 is seeded Complete; IRP-04 In progress.
    await h.svc.postProgress(h.as.CC1, "IRP-05", {
      note: "Still done.",
      status: "Complete",
      source: "api",
    });
    await h.svc.postProgress(h.as.CC2, "IRP-04", {
      note: "Waiting on GOs.",
      status: "Blocked",
      source: "api",
    });
    expect(await systemNotes("IRP-05")).toEqual([]);
    expect(await systemNotes("IRP-04")).toEqual([]);
  });

  it("asks without an agent name when the task has no agent", async () => {
    // RO-01 is seeded Waiting with no agent.
    await h.svc.postProgress(h.as.OWNER, "RO-01", {
      note: "Accepted.",
      status: "Complete",
      source: "ui",
    });
    expect((await systemNotes("RO-01")).map((u) => u.note)).toEqual([
      `RO-01 is Complete. ${ASK.charAt(0).toUpperCase()}${ASK.slice(1)}`,
    ]);
  });
});
