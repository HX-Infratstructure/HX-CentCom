// Migration 0003 widens the activity_log action CHECK for the owner's revert (F5), and the newest snapshot matches
// schema.ts, so the next `npm run db:generate` carries only the change its author made (P3-1). drizzle-kit reads only
// schema.ts, so the snapshot holds no RAID or lesson table: one there would make a later generate emit DROPs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from "drizzle-kit/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "@/server/db/migrations";
import * as schema from "@/server/db/schema";
import { setup, type Fixture } from "../raid/support";

const META = join(MIGRATIONS_FOLDER, "meta");
const journal = JSON.parse(readFileSync(join(META, "_journal.json"), "utf8")) as {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[];
};
const latestSnapshotFile = readdirSync(META)
  .filter((f) => f.endsWith("_snapshot.json"))
  .sort()
  .at(-1);
const latestSnapshot = JSON.parse(
  readFileSync(join(META, latestSnapshotFile ?? "missing"), "utf8"),
) as DrizzleSnapshotJSON & { readonly tables: Record<string, unknown> };

let h: Fixture;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h.close();
});

describe("migration 0003", () => {
  it("is the journal's fourth entry", () => {
    expect(journal.entries.find((e) => e.idx === 3)?.tag).toBe("0003_activity_revert");
  });

  it("lets the database store an activity.revert row", async () => {
    const [check] = await h.q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'activity_log'::regclass and conname = 'activity_log_action_check'`,
    );
    expect(check?.def).toContain("'activity.revert'");
  });

  it("leaves nothing for drizzle-kit to generate, and holds no RAID or lesson table", async () => {
    expect(await generateMigration(latestSnapshot, generateDrizzleJson(schema))).toEqual([]);
    expect(Object.keys(latestSnapshot.tables).filter((t) => /raid_items|lessons/.test(t))).toEqual(
      [],
    );
  });
});
