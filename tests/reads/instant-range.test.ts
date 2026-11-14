// The `since` and `until` filters take the same instants as reviewAt (P3-6): one that PostgreSQL cannot store, or
// whose UTC text leaves years 0001-9999, is a 400 at the field from the input schema, never a database error (500).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as activityRoute } from "@/routes/api/v1/activity";
import { Route as updatesRoute } from "@/routes/api/v1/updates";
import { expectInvalidAt, rest, setup, type Fixture } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

const OUT_OF_RANGE = [
  ["year 0000", "0000-01-01T00:00:00Z"],
  ["an offset beyond +15:59", "2026-01-01T00:00:00+16:00"],
  ["minutes 60 in the offset", "2026-01-01T00:00:00+15:60"],
  ["an instant before 0001 in UTC", "0001-01-01T00:00:00+01:00"],
  ["an instant after 9999 in UTC", "9999-12-31T23:30:00-01:00"],
  ["microseconds that round into 10000", "9999-12-31T23:59:59.9999995Z"],
] as const;

describe("since and until stay within what PostgreSQL stores and reads back", () => {
  it.each(OUT_OF_RANGE)("listUpdates refuses %s with 400 at since and at until", async (_, at) => {
    await expectInvalidAt(h.svc.listUpdates({ since: at }), "since");
    await expectInvalidAt(h.svc.listUpdates({ until: at }), "until");
  });

  it.each(OUT_OF_RANGE)("listActivity refuses %s with 400 at since", async (_, at) => {
    await expectInvalidAt(h.svc.listActivity({ since: at }), "since");
  });

  it("answers 400 at the field over REST, and still accepts both ends of the range", async () => {
    const issues = async (res: Response) => {
      const body = (await res.json()) as { error: { code: string; issues?: { path: string }[] } };
      return {
        status: res.status,
        code: body.error.code,
        paths: body.error.issues?.map((i) => i.path),
      };
    };
    const query = (field: string, at: string) => `${field}=${encodeURIComponent(at)}`;
    expect(
      await issues(
        await rest(
          h.svc,
          updatesRoute,
          "GET",
          `/api/v1/updates?${query("until", "0000-01-01T00:00:00Z")}`,
        ),
      ),
    ).toEqual({ status: 400, code: "invalid", paths: ["until"] });
    expect(
      await issues(
        await rest(
          h.svc,
          activityRoute,
          "GET",
          `/api/v1/activity?${query("since", "2026-01-01T00:00:00+16:00")}`,
        ),
      ),
    ).toEqual({ status: 400, code: "invalid", paths: ["since"] });

    await h.svc.postProgress(h.as.CC1, "CC-01", { note: "One update to find.", source: "api" });
    const everything = (await h.svc.listUpdates({})).items;
    expect(everything).toHaveLength(1);
    const oldest = await rest(
      h.svc,
      updatesRoute,
      "GET",
      `/api/v1/updates?${query("since", "0001-01-01T00:00:00Z")}`,
    );
    const newest = await rest(
      h.svc,
      activityRoute,
      "GET",
      `/api/v1/activity?${query("since", "9999-12-31T23:59:59Z")}`,
    );
    expect([oldest.status, newest.status]).toEqual([200, 200]);
    expect(((await oldest.json()) as { items: unknown[] }).items).toEqual(everything);
    expect(((await newest.json()) as { items: unknown[] }).items).toEqual([]);
  });
});
