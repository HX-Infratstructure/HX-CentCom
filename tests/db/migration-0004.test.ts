// Migration 0004 widens the activity_log action CHECK by task.create, additively, and its snapshot is the
// newest one, so drizzle-kit has nothing left to generate (tests/revert/migration-0003.test.ts checks that).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "@/server/db/migrations";
import { setup, type Fixture } from "../raid/support";

const META = join(MIGRATIONS_FOLDER, "meta");
const journal = JSON.parse(readFileSync(join(META, "_journal.json"), "utf8")) as {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[];
};
const sql = readFileSync(join(MIGRATIONS_FOLDER, "0004_task_create.sql"), "utf8");

let h: Fixture;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h.close();
});

describe("migration 0004", () => {
  it("is the journal's fifth entry, and the newest snapshot is its own", () => {
    expect(journal.entries.find((e) => e.idx === 4)?.tag).toBe("0004_task_create");
    const snapshots = readdirSync(META).filter((f) => f.endsWith("_snapshot.json"));
    expect(snapshots.sort().at(-1)).toBe("0004_snapshot.json");
  });

  it("lets the database store a task.create row and keeps every earlier action", async () => {
    const [check] = await h.q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'activity_log'::regclass and conname = 'activity_log_action_check'`,
    );
    for (const action of ["task.create", "task.progress", "activity.revert", "lesson.update"]) {
      expect(check?.def).toContain(`'${action}'`);
    }
  });

  it("only replaces the action CHECK: no table, column or row change", () => {
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.replace(/^--.*$/gm, "").trim())
      .filter((s) => s.length > 0);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/DROP CONSTRAINT "activity_log_action_check";$/);
    expect(statements[1]).toMatch(/ADD CONSTRAINT "activity_log_action_check" CHECK/);
  });
});
