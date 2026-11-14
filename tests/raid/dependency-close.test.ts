import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/services";
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
  h.q<{ note: string; agent_id: string; source: string | null }>(
    "select note, agent_id, source from task_updates where task_id = $1 and kind = 'system' order by created_at, id",
    [taskId],
  );

async function dependency(
  actor: Actor,
  blockedTaskId: string,
  blockingRef: string,
): Promise<string> {
  const { item } = (
    await h.svc.createRaidItem(actor, {
      type: "dependency",
      title: `Waits on ${blockingRef}`,
      summary: "A dependency.",
      description: "The whole dependency.",
      sourceUrl: WEB_SOURCE,
      blockedTaskId,
      blockingRef,
    })
  ).value;
  return item.id;
}

describe("T15 automation 2: closing a dependency unblocks its task", () => {
  it("sets a task blocked on dependency to none, bumps its version by 1 and posts one system update", async () => {
    // HX12-01 is seeded with blocked_on dependency.
    const id = await dependency(
      h.as.OWNER,
      "HX12-01",
      "https://github.com/HX-Infratstructure/HX-Langchain-DeepAgent",
    );
    const before = await task("HX12-01");
    expect(before.blocked_on).toBe("dependency");
    const closed = await h.svc.updateRaidItem(h.as.OWNER, id, { status: "closed" });
    expect(await task("HX12-01")).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect(closed.value.systemUpdates).toHaveLength(1);
    expect(await systemNotes("HX12-01")).toEqual([
      { note: `${id} is closed. HX12-01 is unblocked.`, agent_id: "Agent Zero", source: null },
    ]);
    const [activity] = await h.q<{ after: { effects: unknown } }>(
      "select after from activity_log where action = 'raid.update' and entity_id = $1",
      [id],
    );
    expect(activity?.after.effects).toEqual({
      systemUpdateIds: [closed.value.systemUpdates[0]?.id],
      unblockedTask: { id: "HX12-01", version: before.version + 1 },
    });
  });

  it("keeps the task blocked until its last open dependency closes", async () => {
    const first = await dependency(h.as.CC2, "HX12-01", "task:IRP-04");
    const last = await dependency(h.as.CC2, "HX12-01", "decision:D-07");
    const before = await task("HX12-01");
    await h.svc.updateRaidItem(h.as.CC2, first, { status: "closed" });
    expect(await task("HX12-01")).toEqual(before);
    await h.svc.updateRaidItem(h.as.CC2, last, { status: "closed" });
    expect(await task("HX12-01")).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect((await systemNotes("HX12-01")).map((u) => u.note)).toEqual([
      `${first} is closed. HX12-01 stays blocked: ${last} still open.`,
      `${last} is closed. HX12-01 is unblocked.`,
    ]);
  });

  it("clears only a dependency block: a task blocked on assignment stays blocked", async () => {
    // RO-01 is seeded with blocked_on assignment.
    const ids = [
      await dependency(h.as.CC2, "RO-01", "decision:D-01"),
      await dependency(h.as.CC2, "RO-01", "decision:D-03"),
      await dependency(h.as.CC2, "RO-01", "task:HX14-02"),
    ];
    const before = await task("RO-01");
    expect(before.blocked_on).toBe("assignment");
    for (const id of ids) {
      const closed = await h.svc.updateRaidItem(h.as.CC2, id, { status: "closed" });
      expect(closed.value.systemUpdates).toHaveLength(1);
    }
    expect(await task("RO-01")).toEqual(before);
    expect((await systemNotes("RO-01")).map((u) => u.note)).toEqual([
      `${ids[0]} is closed. RO-01 stays blocked: ${ids[1]}, ${ids[2]} still open.`,
      `${ids[1]} is closed. RO-01 stays blocked: ${ids[2]} still open.`,
      `${ids[2]} is closed. RO-01 stays blocked on assignment.`,
    ]);
  });

  it("keeps IRP-04 at owner_decision while CC2 closes the seeded RAID-05, RAID-06 and RAID-07", async () => {
    const before = await task("IRP-04");
    for (const id of ["RAID-05", "RAID-06", "RAID-07"]) {
      const closed = await h.svc.updateRaidItem(h.as.CC2, id, { status: "closed" });
      expect(closed.value.systemUpdates).toHaveLength(1);
    }
    expect(await task("IRP-04")).toEqual(before);
    expect(before.blocked_on).toBe("owner_decision");
    expect((await systemNotes("IRP-04")).map((u) => u.note)).toEqual([
      "RAID-05 is closed. IRP-04 stays blocked: RAID-06, RAID-07 still open.",
      "RAID-06 is closed. IRP-04 stays blocked: RAID-07 still open.",
      "RAID-07 is closed. IRP-04 stays blocked on owner_decision.",
    ]);
  });

  it("posts nothing more on a re-close or a replay", async () => {
    const id = await dependency(h.as.OWNER, "HX12-01", "task:RO-01");
    const first = await h.svc.updateRaidItem(
      h.as.OWNER,
      id,
      { status: "closed" },
      { idempotencyKey: "close" },
    );
    const replay = await h.svc.updateRaidItem(
      h.as.OWNER,
      id,
      { status: "closed" },
      { idempotencyKey: "close" },
    );
    expect(replay).toEqual({ ...first, replayed: true });
    const again = await h.svc.updateRaidItem(h.as.OWNER, id, { status: "closed" });
    expect(again.value.systemUpdates).toEqual([]);
    expect(await systemNotes("HX12-01")).toHaveLength(1);
    expect((await task("HX12-01")).blocked_on).toBe("none");
  });

  it("posts nothing when a non-dependency closes", async () => {
    const { item } = (
      await h.svc.createRaidItem(h.as.OWNER, {
        type: "risk",
        title: "r",
        summary: "s",
        description: "d",
        sourceUrl: WEB_SOURCE,
        taskIds: ["HX12-01"],
      })
    ).value;
    const closed = await h.svc.updateRaidItem(h.as.OWNER, item.id, { status: "closed" });
    expect(closed.value.systemUpdates).toEqual([]);
    expect((await task("HX12-01")).blocked_on).toBe("dependency");
  });
});
