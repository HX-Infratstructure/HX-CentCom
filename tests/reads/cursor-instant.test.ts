import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectInvalidAt, setup, type Fixture } from "../raid/support";

let h: Fixture;

beforeAll(async () => {
  h = await setup();
  await h.svc.postProgress(h.as.CC1, "CC-01", { note: "CC1 on CC-01.", source: "api" });
  await h.svc.postProgress(h.as.CC2, "IRP-04", { note: "CC2 on IRP-04.", source: "api" });
});

afterAll(async () => {
  await h.close();
});

const cursorOf = (key: readonly unknown[]) =>
  Buffer.from(JSON.stringify(key), "utf8").toString("base64url");

const BAD_INSTANTS = ["2026-02-31T00:00:00Z", "2026-02-29T00:00:00Z", "0000-01-01T00:00:00Z"];

type Lister = (query: {
  limit?: number;
  cursor?: string;
}) => Promise<{ items: readonly { id: string }[]; nextCursor: string | null }>;

const LISTS: readonly {
  name: string;
  list: Lister;
  key: (instant: string, id: string) => readonly unknown[];
}[] = [
  {
    name: "listUpdates",
    list: (q) => h.svc.listUpdates(q),
    key: (instant, id) => [instant, id],
  },
  {
    name: "listActivity",
    list: (q) => h.svc.listActivity(q),
    key: (instant, id) => [instant, id],
  },
  {
    name: "listDecisions pending first",
    list: (q) => h.svc.listDecisions(q),
    key: (instant, id) => [true, instant, id],
  },
  {
    name: "listDecisions history",
    list: (q) => h.svc.listDecisions({ ...q, status: "not_pending" }),
    key: (instant, id) => ["decided", instant, id],
  },
];

describe("CR17: a cursor instant PostgreSQL would refuse is a 400 at cursor", () => {
  describe.each(LISTS)("$name", ({ list, key }) => {
    it.each(BAD_INSTANTS)("refuses %s with a real id", async (instant) => {
      const [item] = (await list({ limit: 1 })).items;
      expect(item, "the list has a row").toBeDefined();
      await expectInvalidAt(list({ cursor: cursorOf(key(instant, item?.id ?? "")) }), "cursor");
    });

    it("accepts a leap day and pages with a cursor the API issued", async () => {
      const first = await list({ limit: 1 });
      const id = first.items[0]?.id ?? "";
      await expect(
        list({ cursor: cursorOf(key("2024-02-29T00:00:00Z", id)) }),
      ).resolves.toHaveProperty("items");
      expect(first.nextCursor).not.toBeNull();
      const second = await list({ limit: 1, cursor: first.nextCursor ?? "" });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(id);
    });
  });
});
