// The committed migrations build a fresh database the way `npm run db:migrate` does. Expected values come from the
// migrations folder and the drizzle schema, so a new migration needs no edit here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_SETTINGS, type Db } from "@/server/db/client";
import { MIGRATIONS_FOLDER } from "@/server/db/migrations";
import { activityLog, taskUpdates } from "@/server/db/schema";
import { seedDb } from "@/server/db/seed";

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string; when: number }[] };
const sqlFiles = readdirSync(MIGRATIONS_FOLDER)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let pg: PGlite;
let db: Db;
beforeAll(async () => {
  pg = await PGlite.create();
  for (const [name, value] of Object.entries(SESSION_SETTINGS)) {
    await pg.exec(`SET ${name} = '${value}';`);
  }
  const pglite = drizzle({ client: pg });
  await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
  db = pglite;
});
afterAll(async () => {
  await pg.close();
});

describe("migrations on a fresh database", () => {
  it("the journal lists every SQL file in the folder, in order", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(sqlFiles);
  });

  it("the migrator records one applied migration per journal entry", async () => {
    const { rows } = await pg.query<{ created_at: string | number }>(
      "select created_at from drizzle.__drizzle_migrations order by id",
    );
    expect(rows.map((r) => Number(r.created_at))).toEqual(journal.entries.map((e) => e.when));
  });

  it.each([
    ["task_updates", taskUpdates],
    ["activity_log", activityLog],
  ] as const)("%s has the CHECKs the drizzle schema names", async (table, schema: PgTable) => {
    const { rows } = await pg.query<{ name: string }>(
      "select conname as name from pg_constraint where conrelid = $1::regclass and contype = 'c'",
      [table],
    );
    const named = getTableConfig(schema)
      .checks.map((c) => c.name)
      .sort();
    expect(rows.map((r) => r.name).sort()).toEqual(named);
  });

  it("seedDb fills the database once and inserts nothing on a second run", async () => {
    const first = await seedDb(db);
    expect(Object.values(first)).not.toContain(0);
    const second = await seedDb(db);
    expect(second).toEqual(Object.fromEntries(Object.keys(first).map((k) => [k, 0])));
  });
});
