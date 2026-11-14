import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES } from "@/server/db/schema";
import {
  lessons,
  RAID_TYPE_FIELDS,
  RAID_TYPES,
  raidItems,
  SOURCE_REF_PATTERN,
  BLOCKING_REF_PATTERN,
  type RaidType,
} from "@/server/db/schema-raid";
import { expectViolation, setup, type Fixture } from "./support";

let h: Fixture;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

/** The smallest row each type accepts. */
const BASE: Readonly<Record<RaidType, Readonly<Record<string, unknown>>>> = {
  risk: {},
  assumption: { validation_state: "unverified" },
  issue: {},
  dependency: { blocked_task_id: "IRP-04", blocking_ref: "task:IRP-04", task_ids: ["IRP-04"] },
};

const FILLED: Readonly<Record<keyof typeof RAID_TYPE_FIELDS, unknown>> = {
  probability: "likely",
  impact: "a real impact",
  mitigation: "a mitigation",
  validation_method: "a method",
  validation_state: "validated",
  resolution: "a resolution",
  escalated: true,
  blocked_task_id: "IRP-04",
  blocking_ref: "task:IRP-04",
};

let next = 90;
function insertRaid(type: RaidType, columns: Readonly<Record<string, unknown>>): Promise<unknown> {
  const row: Record<string, unknown> = {
    id: `RAID-${next++}`,
    type,
    title: "t",
    summary: "s",
    description: "d",
    source_url: "https://example.org/x",
    ...columns,
  };
  const names = Object.keys(row);
  return h.q(
    `insert into raid_items (${names.map((n) => `"${n}"`).join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    names.map((n) => row[n]),
  );
}

describe("raid_items per-type CHECKs follow RAID_TYPE_FIELDS", () => {
  it("accepts each type's smallest row", async () => {
    for (const type of RAID_TYPES) await insertRaid(type, BASE[type]);
  });

  for (const [column, field] of Object.entries(RAID_TYPE_FIELDS)) {
    const name = `raid_items_${column}_by_type`;
    for (const type of RAID_TYPES) {
      const owned = (field.types as readonly RaidType[]).includes(type);
      if (!owned) {
        it(`refuses ${column} on a ${type}`, async () => {
          const extra = column === "blocked_task_id" ? { task_ids: ["IRP-04"] } : {};
          await expectViolation(
            insertRaid(type, {
              ...BASE[type],
              ...extra,
              [column]: FILLED[column as keyof typeof FILLED],
            }),
            name,
          );
        });
      } else if (field.required) {
        it(`refuses a ${type} without ${column}`, async () => {
          await expectViolation(insertRaid(type, { ...BASE[type], [column]: null }), name);
        });
      } else {
        it(`accepts ${column} on a ${type}`, async () => {
          await insertRaid(type, {
            ...BASE[type],
            [column]: FILLED[column as keyof typeof FILLED],
          });
        });
      }
    }
  }

  it("lists the blocked task in task_ids", async () => {
    await expectViolation(
      insertRaid("dependency", { ...BASE.dependency, task_ids: [] }),
      "raid_items_blocked_task_listed",
    );
  });

  it("pairs a severity with its rater", async () => {
    await expectViolation(insertRaid("risk", { severity: "high" }), "raid_items_severity_rated");
    await expectViolation(
      insertRaid("risk", { severity_rated_by: "CC1" }),
      "raid_items_severity_rated",
    );
    await insertRaid("risk", { severity: "high", severity_rated_by: "CC1" });
  });

  it("refuses a bare path as a source and a malformed blocking ref", async () => {
    await expectViolation(
      insertRaid("risk", { source_url: "SPEC.md:79" }),
      "raid_items_source_ref",
    );
    await expectViolation(
      insertRaid("dependency", { ...BASE.dependency, blocking_ref: "D-01" }),
      "raid_items_blocking_ref_format",
    );
  });
});

type DbColumn = { name: string; type: string; not_null: boolean };

async function dbColumns(table: string): Promise<DbColumn[]> {
  return h.q<DbColumn>(
    `select attname as name, format_type(atttypid, atttypmod) as type, attnotnull as not_null
       from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attname`,
    [table],
  );
}

function drizzleColumns(table: PgTable): DbColumn[] {
  return getTableConfig(table)
    .columns.map((c) => ({ name: c.name, type: c.getSQLType(), not_null: c.notNull }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function checkDefs(table: string): Promise<Map<string, string>> {
  const rows = await h.q<{ name: string; def: string }>(
    `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = $1::regclass and contype = 'c'`,
    [table],
  );
  return new Map(rows.map((r) => [r.name, r.def]));
}

const quoted = (def: string): string[] =>
  [...def.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "").sort();

describe("0002 matches schema-raid.ts", () => {
  for (const table of [raidItems, lessons]) {
    const name = getTableConfig(table).name;
    it(`${name}: drizzle columns equal the database columns`, async () => {
      expect(await dbColumns(name)).toEqual(drizzleColumns(table));
    });
    it(`${name}: drizzle CHECK names equal the database CHECK names`, async () => {
      const db = [...(await checkDefs(name)).keys()].sort();
      expect(db).toEqual(
        getTableConfig(table)
          .checks.map((c) => c.name)
          .sort(),
      );
    });
  }

  it("uses the shared pattern strings in the database", async () => {
    const raid = await checkDefs("raid_items");
    const lesson = await checkDefs("lessons");
    expect(raid.get("raid_items_source_ref")).toContain(SOURCE_REF_PATTERN);
    expect(raid.get("raid_items_blocking_ref_format")).toContain(BLOCKING_REF_PATTERN);
    expect(lesson.get("lessons_source_ref")).toContain(SOURCE_REF_PATTERN);
    expect(lesson.get("lessons_enforced_by_ref")).toContain(SOURCE_REF_PATTERN);
  });

  it("widens the activity_log CHECKs to the task lists plus the RAID and lesson ones", async () => {
    const activity = await checkDefs("activity_log");
    expect(quoted(activity.get("activity_log_action_check") ?? "")).toEqual(
      [...ACTIVITY_ACTIONS].sort(),
    );
    expect(quoted(activity.get("activity_log_entity_check") ?? "")).toEqual(
      [...ACTIVITY_ENTITIES].sort(),
    );
  });
});
