// SPEC:199 (CC1's follow-up 3): the activity list carries chip counts, under the rule the other lists follow. `total`
// applies every filter; `byActor` applies every filter but `actor`; `byEntity` every filter but `entity`; `entityId` and
// `since` always apply; no count depends on the cursor. The seed writes no activity rows, so every row here is the
// test's own.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as activityRoute } from "@/routes/api/v1/activity";
import { rest, setup, WEB_SOURCE, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
  await h.svc.postProgress(h.as.CC1, "CC-01", { note: "CC1 on CC-01.", source: "api" });
  await h.svc.postProgress(h.as.CC2, "IRP-04", { note: "CC2 on IRP-04.", source: "api" });
  await h.svc.createRaidItem(h.as.CC1, {
    type: "risk",
    title: "A risk CC1 raised",
    summary: "A risk.",
    description: "The whole risk.",
    sourceUrl: WEB_SOURCE,
  });
});
afterEach(() => h.close());

describe("listActivity counts", () => {
  it("counts each facet without its own filter, and the total with every filter", async () => {
    expect((await h.svc.listActivity({ actor: "CC1" })).counts).toEqual({
      total: 2,
      byActor: { CC1: 2, CC2: 1 },
      byEntity: { task: 1, raid_item: 1 },
    });
    expect((await h.svc.listActivity({ entity: "task" })).counts).toEqual({
      total: 2,
      byActor: { CC1: 1, CC2: 1 },
      byEntity: { task: 2, raid_item: 1 },
    });
    expect((await h.svc.listActivity({ entityId: "IRP-04" })).counts).toEqual({
      total: 1,
      byActor: { CC2: 1 },
      byEntity: { task: 1 },
    });
    expect((await h.svc.listActivity({ since: "9999-01-01T00:00:00Z" })).counts).toEqual({
      total: 0,
      byActor: {},
      byEntity: {},
    });
  });

  it("gives the same counts on every page, and over REST", async () => {
    const first = await h.svc.listActivity({ limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await h.svc.listActivity({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.counts).toEqual(first.counts);
    expect(first.counts).toEqual({
      total: 3,
      byActor: { CC1: 2, CC2: 1 },
      byEntity: { task: 2, raid_item: 1 },
    });

    const res = await rest(h.svc, activityRoute, "GET", "/api/v1/activity?actor=CC2");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { counts: unknown }).counts).toEqual(
      (await h.svc.listActivity({ actor: "CC2" })).counts,
    );
  });
});
