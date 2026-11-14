/**
 * B4's tables (SPEC §6.1): the RAID register and the lessons log. drizzle-kit reads only schema.ts, so migration 0002
 * is hand-written; tests/raid/schema.test.ts fails when 0002 and this file disagree.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { agents, engineeringTasks, isoTimestamp, ownerDecisions } from "./schema";

export const RAID_TYPES = ["risk", "assumption", "issue", "dependency"] as const;
export const RAID_STATUSES = ["open", "monitoring", "closed"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const VALIDATION_STATES = ["unverified", "validated", "invalidated"] as const;
export const LESSON_STATUSES = ["proposed", "adopted", "retired"] as const;

export type RaidType = (typeof RAID_TYPES)[number];
export type RaidStatus = (typeof RAID_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ValidationState = (typeof VALIDATION_STATES)[number];
export type LessonStatus = (typeof LESSON_STATUSES)[number];

type TypeField = {
  readonly types: readonly RaidType[];
  readonly empty: null | false;
  readonly required: boolean;
};

/**
 * The per-type columns of SPEC §6.1: the types that own each column, the value every other type holds, and whether
 * the owning types must fill it. The drizzle CHECKs below, the service's shape check and tests/raid/schema.test.ts
 * all read this table.
 */
export const RAID_TYPE_FIELDS = {
  probability: { types: ["risk"], empty: null, required: false },
  impact: { types: ["risk", "issue"], empty: null, required: false },
  mitigation: { types: ["risk"], empty: null, required: false },
  validation_method: { types: ["assumption"], empty: null, required: false },
  validation_state: { types: ["assumption"], empty: null, required: true },
  resolution: { types: ["issue"], empty: null, required: false },
  escalated: { types: ["issue"], empty: false, required: false },
  blocked_task_id: { types: ["dependency"], empty: null, required: true },
  blocking_ref: { types: ["dependency"], empty: null, required: true },
} as const satisfies Record<string, TypeField>;
export type RaidTypeField = keyof typeof RAID_TYPE_FIELDS;

/** Each pattern is read as is by PostgreSQL `~` (0002) and by JS `RegExp` (the services). */
export const SOURCE_REF_PATTERN = String.raw`^(https?://\S+|hx15:/\S+)$`;
export const BLOCKING_REF_PATTERN = String.raw`^(task:[^\s:]+|decision:D-[0-9]{2,}|https?://\S+)$`;
export const RAID_ID_PATTERN = String.raw`^RAID-[0-9]{2,}$`;
export const LESSON_ID_PATTERN = String.raw`^L-[0-9]{2,}$`;

/** padStart never truncates (RAID-100), unlike SQL lpad. */
export const formatRaidId = (n: number): string => `RAID-${String(n).padStart(2, "0")}`;
export const formatLessonId = (n: number): string => `L-${String(n).padStart(2, "0")}`;

// schema.ts keeps its `oneOf` private.
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

function matches(column: AnyPgColumn, pattern: string): SQL {
  return sql`${column} ~ ${sql.raw(`'${pattern}'`)}`;
}

function typeFieldRule(type: AnyPgColumn, column: AnyPgColumn, field: TypeField): SQL {
  const owned = oneOf(type, field.types);
  if (field.required) return sql`(${owned}) = (${column} is not null)`;
  return sql`${owned} or ${column} ${sql.raw(field.empty === false ? "= false" : "is null")}`;
}

export const raidItems = pgTable(
  "raid_items",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: RAID_TYPES }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    owner_agent: text("owner_agent").references(() => agents.id),
    status: text("status", { enum: RAID_STATUSES }).notNull().default("open"),
    severity: text("severity", { enum: SEVERITIES }),
    severity_rated_by: text("severity_rated_by").references(() => agents.id),
    review_at: isoTimestamp("review_at"),
    source_url: text("source_url").notNull(),
    // Null on seed rows: no agent created them, and null means not recorded.
    created_by: text("created_by").references(() => agents.id),
    task_ids: text("task_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    decision_id: text("decision_id").references(() => ownerDecisions.id),
    probability: text("probability"),
    impact: text("impact"),
    mitigation: text("mitigation"),
    validation_method: text("validation_method"),
    validation_state: text("validation_state", { enum: VALIDATION_STATES }),
    resolution: text("resolution"),
    escalated: boolean("escalated").notNull().default(false),
    blocked_task_id: text("blocked_task_id").references(() => engineeringTasks.id),
    blocking_ref: text("blocking_ref"),
    version: integer("version").notNull().default(1),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updated_at: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("raid_items_feed_idx").on(t.created_at, t.id),
    index("raid_items_task_ids_idx").using("gin", t.task_ids),
    index("raid_items_open_dependency_idx")
      .on(t.blocked_task_id)
      .where(sql`${t.type} = 'dependency' and ${t.status} <> 'closed'`),
    check("raid_items_id_format", matches(t.id, RAID_ID_PATTERN)),
    check("raid_items_type_check", oneOf(t.type, RAID_TYPES)),
    check("raid_items_status_check", oneOf(t.status, RAID_STATUSES)),
    check(
      "raid_items_severity_check",
      sql`${t.severity} is null or ${oneOf(t.severity, SEVERITIES)}`,
    ),
    check(
      "raid_items_severity_rated",
      sql`(${t.severity} is null) = (${t.severity_rated_by} is null)`,
    ),
    check(
      "raid_items_validation_state_check",
      sql`${t.validation_state} is null or ${oneOf(t.validation_state, VALIDATION_STATES)}`,
    ),
    check("raid_items_title_present", sql`char_length(${t.title}) >= 1`),
    check("raid_items_summary_length", sql`char_length(${t.summary}) between 1 and 140`),
    check("raid_items_description_present", sql`char_length(${t.description}) >= 1`),
    check("raid_items_source_ref", matches(t.source_url, SOURCE_REF_PATTERN)),
    check(
      "raid_items_blocking_ref_format",
      sql`${t.blocking_ref} is null or ${matches(t.blocking_ref, BLOCKING_REF_PATTERN)}`,
    ),
    check(
      "raid_items_blocked_task_listed",
      sql`${t.blocked_task_id} is null or ${t.blocked_task_id} = any(${t.task_ids})`,
    ),
    ...Object.entries(RAID_TYPE_FIELDS).map(([column, field]) =>
      check(
        `raid_items_${column}_by_type`,
        typeFieldRule(t.type, t[column as RaidTypeField], field),
      ),
    ),
    check("raid_items_version_check", sql`${t.version} >= 1`),
  ],
);

export const lessons = pgTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    situation: text("situation"),
    action: text("action"),
    outcome: text("outcome"),
    recommendation: text("recommendation"),
    source_url: text("source_url").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    applies_to: text("applies_to"),
    created_by: text("created_by").references(() => agents.id),
    status: text("status", { enum: LESSON_STATUSES }).notNull().default("proposed"),
    enforced_by_url: text("enforced_by_url"),
    version: integer("version").notNull().default(1),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updated_at: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("lessons_feed_idx").on(t.created_at, t.id),
    index("lessons_tags_idx").using("gin", t.tags),
    check("lessons_id_format", matches(t.id, LESSON_ID_PATTERN)),
    check("lessons_status_check", oneOf(t.status, LESSON_STATUSES)),
    check("lessons_title_present", sql`char_length(${t.title}) >= 1`),
    check("lessons_summary_length", sql`char_length(${t.summary}) between 1 and 140`),
    check("lessons_source_ref", matches(t.source_url, SOURCE_REF_PATTERN)),
    check(
      "lessons_enforced_by_ref",
      sql`${t.enforced_by_url} is null or ${matches(t.enforced_by_url, SOURCE_REF_PATTERN)}`,
    ),
    check(
      "lessons_adopted_is_enforced",
      sql`${t.status} <> 'adopted' or ${t.enforced_by_url} is not null`,
    ),
    check("lessons_version_check", sql`${t.version} >= 1`),
  ],
);
