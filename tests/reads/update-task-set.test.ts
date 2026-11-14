// SPEC:202 (CC1's follow-up 3): the feed filters by a set of tasks, which the overview's needs-attention facet uses.
// `taskIds` holds 1 to 100 ids and belongs to the task facet: `byTask` drops it as it drops `taskId`, and every other
// count applies it. `taskId` with `taskIds` is a 400. REST takes `taskIds` as one comma-separated parameter.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as updatesRoute } from "@/routes/api/v1/updates";
import { expectInvalidAt, rest, setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
  await h.svc.postProgress(h.as.CC1, "CC-01", { note: "CC1 on CC-01.", source: "api" });
  await h.svc.postProgress(h.as.CC2, "IRP-04", { note: "CC2 on IRP-04.", source: "cli" });
  await h.svc.postProgress(h.as.CC1, "IRP-05", { note: "CC1 on IRP-05.", source: "api" });
});
afterEach(() => h.close());

const tasksOf = (items: readonly { task_id: string }[]) => items.map((u) => u.task_id).sort();

describe("listUpdates taskIds", () => {
  it("returns the updates of any listed task, with counts under the facet rule", async () => {
    const page = await h.svc.listUpdates({ taskIds: ["CC-01", "IRP-04"] });
    expect(tasksOf(page.items)).toEqual(["CC-01", "IRP-04"]);
    expect(page.counts).toEqual({
      total: 2,
      byAgent: { CC1: 1, CC2: 1 },
      byTask: { "CC-01": 1, "IRP-04": 1, "IRP-05": 1 },
      bySource: { api: 1, cli: 1 },
    });

    const mine = await h.svc.listUpdates({ agentId: "CC1", taskIds: ["CC-01", "IRP-04"] });
    expect(tasksOf(mine.items)).toEqual(["CC-01"]);
    expect(mine.counts.byTask).toEqual({ "CC-01": 1, "IRP-05": 1 });
  });

  it("refuses taskId with taskIds, an empty list and more than 100 ids", async () => {
    await expectInvalidAt(h.svc.listUpdates({ taskId: "CC-01", taskIds: ["IRP-04"] }), "taskIds");
    await expectInvalidAt(h.svc.listUpdates({ taskIds: [] }), "taskIds");
    const many = Array.from({ length: 101 }, (_, i) => `T-${i}`);
    await expectInvalidAt(h.svc.listUpdates({ taskIds: many }), "taskIds");
  });

  it("takes a comma-separated taskIds over REST", async () => {
    const res = await rest(h.svc, updatesRoute, "GET", "/api/v1/updates?taskIds=CC-01,IRP-04");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      JSON.parse(JSON.stringify(await h.svc.listUpdates({ taskIds: ["CC-01", "IRP-04"] }))),
    );
    const both = await rest(
      h.svc,
      updatesRoute,
      "GET",
      "/api/v1/updates?taskId=CC-01&taskIds=IRP-04",
    );
    expect(both.status).toBe(400);
  });
});
