import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectInvalidAt, setup, type Fixture } from "./support";

let h: Fixture;

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  await h.close();
});

const cursorAt = (createdAt: string, id: string) =>
  Buffer.from(JSON.stringify([createdAt, id]), "utf8").toString("base64url");

const BAD_INSTANTS = ["2026-02-31T00:00:00Z", "2026-02-29T00:00:00Z", "0000-01-01T00:00:00Z"];

describe("CR13: a cursor instant PostgreSQL would refuse is a 400 at cursor", () => {
  it.each(BAD_INSTANTS)("listRaid refuses %s with a real RAID id", async (instant) => {
    const [item] = (await h.svc.listRaid({ limit: 1 })).items;
    expect(item, "the seed has a RAID item").toBeDefined();
    await expectInvalidAt(h.svc.listRaid({ cursor: cursorAt(instant, item?.id ?? "") }), "cursor");
  });

  it.each(BAD_INSTANTS)("listLessons refuses %s with a real lesson id", async (instant) => {
    const [lesson] = (await h.svc.listLessons({ limit: 1 })).items;
    expect(lesson, "the seed has a lesson").toBeDefined();
    await expectInvalidAt(
      h.svc.listLessons({ cursor: cursorAt(instant, lesson?.id ?? "") }),
      "cursor",
    );
  });

  it("still accepts a leap day and a cursor the API issued", async () => {
    const [item] = (await h.svc.listRaid({ limit: 1 })).items;
    await expect(
      h.svc.listRaid({ cursor: cursorAt("2024-02-29T00:00:00Z", item?.id ?? "") }),
    ).resolves.toHaveProperty("items");
    const first = await h.svc.listRaid({ limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await h.svc.listRaid({ limit: 1, cursor: first.nextCursor ?? "" });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
