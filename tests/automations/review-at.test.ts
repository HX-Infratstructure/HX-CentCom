// P3-6: a reviewAt that PostgreSQL cannot store, or that the UTC read-back cannot return, is a 400 at reviewAt from
// the input schema, so no RAID id is drawn. PostgreSQL refuses year 0000 and offsets beyond ±15:59, keeps
// microseconds, and its UTC text must stay within years 0001-9999.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expectInvalidAt, mcpClient, setup, WEB_SOURCE, type Fixture } from "../raid/support";

let h: Fixture;
let client: Client | undefined;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  await h.close();
});

const risk = {
  type: "risk" as const,
  title: "A risk with a review date",
  summary: "A dated risk.",
  description: "The whole risk.",
  sourceUrl: WEB_SOURCE,
};

const OUT_OF_RANGE = [
  ["year 0000", "0000-01-01T00:00:00Z"],
  ["an offset beyond +15:59", "2026-01-01T00:00:00+16:00"],
  ["minutes 60 in the offset", "2026-01-01T00:00:00+15:60"],
  ["an instant before 0001 in UTC", "0001-01-01T00:00:00+01:00"],
  ["an instant after 9999 in UTC", "9999-12-31T23:30:00-01:00"],
  ["microseconds that round into 10000", "9999-12-31T23:59:59.9999995Z"],
] as const;

const storedReviewAt = async (id: string) =>
  (await h.svc.listRaid({ limit: 100 })).items.find((i) => i.id === id)?.review_at;

describe("P3-6: reviewAt stays within what PostgreSQL stores and reads back", () => {
  it.each(OUT_OF_RANGE)("refuses %s on create with 400 at reviewAt", async (_, reviewAt) => {
    const before = await h.count("raid_items");
    await expectInvalidAt(h.svc.createRaidItem(h.as.CC1, { ...risk, reviewAt }), "reviewAt");
    expect(await h.count("raid_items"), "no row landed").toBe(before);
  });

  it.each(OUT_OF_RANGE)("refuses %s on update with 400 at reviewAt", async (_, reviewAt) => {
    const before = await h.one<{ version: number; review_at: string | null }>(
      "select version, review_at::text from raid_items where id = 'RAID-03'",
    );
    await expectInvalidAt(h.svc.updateRaidItem(h.as.CC1, "RAID-03", { reviewAt }), "reviewAt");
    expect(
      await h.one("select version, review_at::text from raid_items where id = 'RAID-03'"),
    ).toEqual(before);
  });

  it("burns no RAID id, and stores and reads back the boundaries exactly", async () => {
    for (const [, reviewAt] of OUT_OF_RANGE) {
      await expectInvalidAt(h.svc.createRaidItem(h.as.CC1, { ...risk, reviewAt }), "reviewAt");
    }
    const { item } = (await h.svc.createRaidItem(h.as.CC1, risk)).value;
    expect(item.id, "the refusals drew no id").toBe("RAID-09");
    for (const [reviewAt, readBack] of [
      ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00Z"],
      ["9999-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"],
      ["9999-12-31T23:59:59.9999994Z", "9999-12-31T23:59:59.999999Z"],
      ["2026-01-01T00:00:00+15:59", "2025-12-31T08:01:00Z"],
      ["2026-01-01T00:00:00-1559", "2026-01-01T15:59:00Z"],
    ] as const) {
      const { item: dated } = (await h.svc.createRaidItem(h.as.CC1, { ...risk, reviewAt })).value;
      expect(dated.review_at, reviewAt).toBe(readBack);
      expect(await storedReviewAt(dated.id), reviewAt).toBe(readBack);
    }
  });

  it("refuses an out-of-range reviewAt in the MCP add_raid_item schema check, naming the field", async () => {
    client = await mcpClient(h.svc, await h.auth("CC1"));
    const before = await h.count("raid_items");
    const refused = (await client.callTool({
      name: "add_raid_item",
      arguments: { ...risk, reviewAt: "9999-12-31T23:30:00-01:00" },
    })) as { isError?: boolean; content?: { text?: string }[] };
    const text = refused.content?.map((c) => c.text ?? "").join("\n") ?? "";
    expect(refused.isError, text).toBe(true);
    expect(text).toMatch(/\breviewAt\b/);
    expect(text).not.toMatch(/"internal"/);
    expect(await h.count("raid_items"), "no row landed").toBe(before);
  });
});
