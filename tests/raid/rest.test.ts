import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as lessonsRoute } from "@/routes/api/v1/lessons";
import { Route as lessonRoute } from "@/routes/api/v1/lessons/$id";
import { Route as raidRoute } from "@/routes/api/v1/raid";
import { Route as raidItemRoute } from "@/routes/api/v1/raid/$id";
import { rest, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
let cc2: string;
beforeEach(async () => {
  h = await setup();
  cc2 = await h.auth("CC2");
});
afterEach(() => h.close());

type WireError = {
  code: string;
  status: number;
  message: string;
  currentVersion?: number;
  issues?: { path: string; message: string }[];
};
const errorOf = async (res: Response): Promise<WireError> =>
  ((await res.json()) as { error: WireError }).error;

const risk = {
  type: "risk",
  title: "A risk",
  summary: "A short risk.",
  description: "The whole risk.",
  sourceUrl: WEB_SOURCE,
};

describe("REST /api/v1/raid and /api/v1/lessons", () => {
  it("creates a RAID item: 201 with {item, decision, systemUpdates}", async () => {
    const res = await rest(h.svc, raidRoute, "POST", "/api/v1/raid", {
      authorization: cc2,
      body: risk,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["decision", "item", "systemUpdates"]);
    expect(body).toMatchObject({
      item: { type: "risk", created_by: "CC2", version: 1 },
      decision: null,
      systemUpdates: [],
    });
  });

  it("refuses a body without sourceUrl: 400 with error.issues", async () => {
    const { sourceUrl: _omitted, ...noSource } = risk;
    const res = await rest(h.svc, raidRoute, "POST", "/api/v1/raid", {
      authorization: cc2,
      body: noSource,
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error).toMatchObject({ code: "invalid", status: 400 });
    expect(error.issues?.map((i) => i.path)).toEqual(["sourceUrl"]);
  });

  it("replays a POST with Idempotency-Replayed", async () => {
    const init = { authorization: cc2, headers: { "Idempotency-Key": "rest-1" }, body: risk };
    const first = await rest(h.svc, raidRoute, "POST", "/api/v1/raid", init);
    const again = await rest(h.svc, raidRoute, "POST", "/api/v1/raid", init);
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
  });

  it("refuses a PUT with a stale If-Match: 409 with error.currentVersion", async () => {
    const path = "/api/v1/raid/RAID-05";
    const init = { authorization: cc2, params: { id: "RAID-05" } };
    const ok = await rest(h.svc, raidItemRoute, "PUT", path, {
      ...init,
      headers: { "If-Match": "1" },
      body: { status: "monitoring" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      item: { id: "RAID-05", status: "monitoring", version: 2 },
    });
    const stale = await rest(h.svc, raidItemRoute, "PUT", path, {
      ...init,
      headers: { "If-Match": "1" },
      body: { status: "closed" },
    });
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toMatchObject({ code: "version_conflict", currentVersion: 2 });
    const malformed = await rest(h.svc, raidItemRoute, "PUT", path, {
      ...init,
      headers: { "If-Match": "W/x" },
      body: { status: "closed" },
    });
    expect((await errorOf(malformed)).issues?.map((i) => i.path)).toEqual(["If-Match"]);
  });

  it("lists with filters and a cursor", async () => {
    const res = await rest(h.svc, raidRoute, "GET", "/api/v1/raid?type=dependency&limit=2");
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: { id: string }[];
      nextCursor: string;
      counts: { total: number; byType: Record<string, number> };
    };
    expect(page.items.map((i) => i.id)).toEqual(["RAID-07", "RAID-06"]);
    expect(page.counts).toMatchObject({
      total: 3,
      byType: { dependency: 3, issue: 2, risk: 2, assumption: 1 },
    });
    const next = await rest(
      h.svc,
      raidRoute,
      "GET",
      `/api/v1/raid?type=dependency&limit=2&cursor=${page.nextCursor}`,
    );
    expect(
      ((await next.json()) as { items: { id: string }[]; nextCursor: null }).items.map((i) => i.id),
    ).toEqual(["RAID-05"]);
    const bad = await rest(h.svc, raidRoute, "GET", "/api/v1/raid?limit=101");
    expect(bad.status).toBe(400);
  });

  it("creates, updates and lists lessons", async () => {
    const created = await rest(h.svc, lessonsRoute, "POST", "/api/v1/lessons", {
      authorization: cc2,
      body: { title: "A lesson", summary: "Short.", sourceUrl: WEB_SOURCE, tags: ["rest"] },
    });
    expect(created.status).toBe(201);
    const { lesson } = (await created.json()) as { lesson: { id: string; version: number } };
    const updated = await rest(h.svc, lessonRoute, "PUT", `/api/v1/lessons/${lesson.id}`, {
      authorization: cc2,
      params: { id: lesson.id },
      headers: { "If-Match": String(lesson.version) },
      body: { status: "adopted" },
    });
    expect(updated.status).toBe(400);
    expect((await errorOf(updated)).issues?.map((i) => i.path)).toEqual(["enforcedByUrl"]);
    const listed = await rest(h.svc, lessonsRoute, "GET", "/api/v1/lessons?tag=rest");
    expect(((await listed.json()) as { items: { id: string }[] }).items.map((l) => l.id)).toEqual([
      lesson.id,
    ]);
  });

  it("refuses an anonymous write with 401 and an unknown method with 405", async () => {
    const anonymous = await rest(h.svc, raidRoute, "POST", "/api/v1/raid", { body: risk });
    expect(anonymous.status).toBe(401);
    const del = await rest(h.svc, raidItemRoute, "DELETE", "/api/v1/raid/RAID-01", {
      authorization: cc2,
      params: { id: "RAID-01" },
    });
    expect(del.status).toBe(405);
    expect(del.headers.get("Allow")).toBe("PUT");
  });
});
