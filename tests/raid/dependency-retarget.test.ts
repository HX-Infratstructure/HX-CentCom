// A dependency that leaves a task releases it the same way a close does: the task's block clears when it is
// `dependency` and no other open dependency blocks it, and the task gets one system update stating the outcome.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

type TaskState = { blocked_on: string; version: number };
const task = (id: string) =>
  h.one<TaskState>("select blocked_on, version from engineering_tasks where id = $1", [id]);
const systemNotes = (taskId: string) =>
  h.q<{ note: string }>(
    "select note from task_updates where task_id = $1 and kind = 'system' order by created_at, id",
    [taskId],
  );

async function dependencyOn(blockedTaskId: string): Promise<string> {
  const { item } = (
    await h.svc.createRaidItem(h.as.OWNER, {
      type: "dependency",
      title: `Blocks ${blockedTaskId}`,
      summary: "A dependency.",
      description: "The whole dependency.",
      sourceUrl: WEB_SOURCE,
      blockedTaskId,
      blockingRef: "task:RO-01",
    })
  ).value;
  return item.id;
}

describe("a dependency that leaves its task releases that task", () => {
  it("unblocks HX12-01 when its last open dependency moves to CC-01 and closes in one update", async () => {
    const id = await dependencyOn("HX12-01");
    const before = await task("HX12-01");
    expect(before.blocked_on).toBe("dependency");
    const updated = await h.svc.updateRaidItem(h.as.OWNER, id, {
      blockedTaskId: "CC-01",
      status: "closed",
    });
    expect(updated.value.item).toMatchObject({ blocked_task_id: "CC-01", status: "closed" });
    expect(await task("HX12-01")).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect((await systemNotes("HX12-01")).map((u) => u.note)).toEqual([
      `${id} moved to CC-01. HX12-01 is unblocked.`,
    ]);
    expect((await systemNotes("CC-01")).map((u) => u.note)).toEqual([
      `${id} is closed. CC-01 is not blocked.`,
    ]);
  });

  it("unblocks HX12-01 when its last open dependency moves to CC-01 and stays open", async () => {
    const id = await dependencyOn("HX12-01");
    const before = await task("HX12-01");
    await h.svc.updateRaidItem(h.as.OWNER, id, { blockedTaskId: "CC-01" });
    expect(await task("HX12-01")).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect((await systemNotes("HX12-01")).map((u) => u.note)).toEqual([
      `${id} moved to CC-01. HX12-01 is unblocked.`,
    ]);
    expect(await systemNotes("CC-01")).toEqual([]);
  });

  it("keeps HX12-01 blocked when another open dependency still blocks it", async () => {
    const moved = await dependencyOn("HX12-01");
    const kept = await dependencyOn("HX12-01");
    const before = await task("HX12-01");
    await h.svc.updateRaidItem(h.as.OWNER, moved, { blockedTaskId: "CC-01", status: "closed" });
    expect(await task("HX12-01")).toEqual(before);
    expect((await systemNotes("HX12-01")).map((u) => u.note)).toEqual([
      `${moved} moved to CC-01. HX12-01 stays blocked: ${kept} still open.`,
    ]);
  });
});
