// P2-1: a RAID dependency writes its blocked task (blocked_on, version, a system update), so only the owner and that
// task's agent may pin a dependency on the task or close one on it. Moving a dependency away from another agent's task
// changes nothing on that task and stays allowed. The 400 shape checks run first, and a refusal draws no RAID id.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor, CreateRaidItemInput } from "@/server/services";
import {
  expectInvalidAt,
  expectServiceError,
  setup,
  WEB_SOURCE,
  type Fixture,
} from "../raid/support";

let h: Fixture;
let openCode: Actor;
beforeEach(async () => {
  h = await setup();
  const actor = await h.svc.resolveActor(await h.auth("OpenCode"));
  if (!actor) throw new Error("no OpenCode actor");
  openCode = actor;
});
afterEach(() => h.close());

type TaskState = { blocked_on: string; version: number };
const task = (id: string) =>
  h.one<TaskState>("select blocked_on, version from engineering_tasks where id = $1", [id]);
const item = (id: string) =>
  h.one<{ status: string; blocked_task_id: string; version: number }>(
    "select status, blocked_task_id, version from raid_items where id = $1",
    [id],
  );
const systemNotes = (taskId: string) =>
  h.q<{ note: string; agent_id: string }>(
    "select note, agent_id from task_updates where task_id = $1 and kind = 'system' order by created_at, id",
    [taskId],
  );

const dependency = (
  blockedTaskId: string,
  extra: Partial<CreateRaidItemInput> = {},
): CreateRaidItemInput => ({
  type: "dependency",
  title: `Blocks ${blockedTaskId}`,
  summary: "A dependency.",
  description: "The whole dependency.",
  sourceUrl: WEB_SOURCE,
  blockedTaskId,
  blockingRef: "task:RO-01",
  ...extra,
});

describe("P2-1: only the owner and the blocked task's agent pin or close a dependency on that task", () => {
  it("refuses CC1 a dependency on OpenCode's HX12-01 or CC2's IRP-04 with 403 after the 400 checks, drawing no id", async () => {
    const hx12 = await task("HX12-01");
    const rows = await h.count("raid_items");
    for (const blockedTaskId of ["HX12-01", "IRP-04"]) {
      const refused = await expectServiceError(
        h.svc.createRaidItem(h.as.CC1, dependency(blockedTaskId)),
        "forbidden",
        403,
      );
      expect(refused.message).toBe(
        `CC1 may write only its own tasks; ${blockedTaskId} is not one.`,
      );
    }
    await expectInvalidAt(
      h.svc.createRaidItem(h.as.CC1, {
        type: "risk",
        title: "A risk",
        summary: "A risk.",
        description: "The whole risk.",
        sourceUrl: WEB_SOURCE,
        blockedTaskId: "IRP-04",
      }),
      "blockedTaskId",
    );
    expect(await h.count("raid_items"), "no row landed").toBe(rows);
    expect(await task("HX12-01")).toEqual(hx12);

    const own = await h.svc.createRaidItem(h.as.CC1, dependency("CC-01"));
    expect(own.value.item.id, "the refusals drew no id").toBe("RAID-09");
  });

  it("refuses CC1 retargeting onto IRP-04, and lets it move a dependency away from IRP-04 to its own task", async () => {
    const mine = (await h.svc.createRaidItem(h.as.CC1, dependency("CC-01"))).value.item.id;
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, mine, { blockedTaskId: "IRP-04" }),
      "forbidden",
      403,
    );
    expect(await item(mine)).toMatchObject({ blocked_task_id: "CC-01", version: 1 });

    const assigned = (
      await h.svc.createRaidItem(h.as.OWNER, dependency("IRP-04", { ownerAgent: "CC1" }))
    ).value.item.id;
    const moved = await h.svc.updateRaidItem(h.as.CC1, assigned, { blockedTaskId: "CC-01" });
    expect(moved.value.item).toMatchObject({ blocked_task_id: "CC-01", owner_agent: "CC1" });

    const pinned = await h.svc.updateRaidItem(h.as.OWNER, mine, { blockedTaskId: "IRP-04" });
    expect(pinned.value.item.blocked_task_id, "the owner is exempt").toBe("IRP-04");
  });

  it("refuses CC1 closing a dependency it owns on HX12-01: the block, the version and the item stay", async () => {
    const id = (
      await h.svc.createRaidItem(h.as.OWNER, dependency("HX12-01", { ownerAgent: "CC1" }))
    ).value.item.id;
    const before = await task("HX12-01");
    expect(before.blocked_on).toBe("dependency");
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, id, { status: "closed" }),
      "forbidden",
      403,
    );
    expect(await task("HX12-01")).toEqual(before);
    expect(await item(id)).toMatchObject({ status: "open", version: 1 });
    expect(await systemNotes("HX12-01")).toEqual([]);
  });

  it("lets OpenCode close a dependency on its HX12-01 that it neither owns nor created, which unblocks the task", async () => {
    const id = (
      await h.svc.createRaidItem(h.as.OWNER, dependency("HX12-01", { ownerAgent: "CC1" }))
    ).value.item.id;
    const before = await task("HX12-01");
    const closed = await h.svc.updateRaidItem(openCode, id, { status: "closed" });
    expect(closed.value.item.status).toBe("closed");
    expect(await task("HX12-01")).toEqual({ blocked_on: "none", version: before.version + 1 });
    expect(await systemNotes("HX12-01")).toEqual([
      { note: `${id} is closed. HX12-01 is unblocked.`, agent_id: "OpenCode" },
    ]);
  });
});
