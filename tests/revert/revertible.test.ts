// CR8: each listActivity entry says whether its own content allows a revert, by the rule revertActivity applies: an
// update with a before and no recorded effects, or a revert. The version check stays at revert time.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, WEB_SOURCE, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

/** The id of the one activity row of `action` on `entityId` whose `after` has `key` equal to `value`, if given. */
async function activityId(
  action: string,
  entityId: string,
  key?: string,
  value?: string,
): Promise<string> {
  const rows = (
    await h.q<{ id: string; after: Record<string, unknown> | null }>(
      "select id, after from activity_log where action = $1 and entity_id = $2",
      [action, entityId],
    )
  ).filter((r) => key === undefined || r.after?.[key] === value);
  expect(rows, `one ${action} row on ${entityId}`).toHaveLength(1);
  return (rows[0] as { id: string }).id;
}

async function listedRevertible(entityId: string, id: string): Promise<boolean | undefined> {
  const { items } = await h.svc.listActivity({ entityId, limit: 100 });
  return items.find((entry) => entry.id === id)?.revertible;
}

describe("listActivity's revertible", () => {
  it("is true for an update and a revert, false for a create and for an update with effects", async () => {
    const posted = await h.svc.postProgress(h.as.CC1, "CC-01", {
      note: "Parked until the review lands.",
      status: "Waiting",
      source: "api",
    });
    const update = await activityId("task.progress", "CC-01", "update_id", posted.value.update.id);
    await h.svc.revertActivity(h.as.OWNER, update);
    const revert = await activityId("activity.revert", "CC-01", "reverts", update);
    const raid = await h.svc.createRaidItem(h.as.CC1, {
      type: "risk",
      title: "A new risk",
      summary: "A risk.",
      description: "The whole risk.",
      sourceUrl: WEB_SOURCE,
    });
    const create = await activityId("raid.create", raid.value.item.id);
    await h.svc.updateRaidItem(h.as.CC2, "RAID-05", { status: "closed" });
    const withEffects = await activityId("raid.update", "RAID-05");

    expect({
      update: await listedRevertible("CC-01", update),
      revert: await listedRevertible("CC-01", revert),
      create: await listedRevertible(raid.value.item.id, create),
      withEffects: await listedRevertible("RAID-05", withEffects),
    }).toEqual({ update: true, revert: true, create: false, withEffects: false });
  });
});
