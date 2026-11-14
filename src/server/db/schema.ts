/**
 * - Every timestamptz column is `isoTimestamp`: an ISO-8601 UTC string with the database's microseconds, so keyset
 *   cursors and idempotent replays never round through a JS Date.
 * - "Never invent a value": a column the sources may lack is nullable, and null means "not recorded".
 */
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const AGENT_ROLES = ["agent", "owner"] as const;
export const TASK_GROUPS = ["backlog", "in_progress", "ready_for_owner", "done"] as const;
export const BLOCKED_ON = ["owner_decision", "assignment", "dependency", "none"] as const;
export const UPDATE_KINDS = ["progress", "note", "link", "system"] as const;
export const UPDATE_SOURCES = ["api", "mcp", "cli", "hook", "ui"] as const;
export const REQUIREMENT_STATES = ["PASS", "FAIL", "NOT_RUN", "BLOCKED"] as const;
export const GATE_TYPES = [
  "merge",
  "deploy",
  "live_run",
  "host",
  "scope",
  "assignment",
  "policy",
] as const;
export const DECISION_STATUSES = ["Pending", "Decided", "Deferred", "Superseded"] as const;
export const OWNER_DECISION_STATUSES = [
  "Decided",
  "Deferred",
  "Superseded",
] as const satisfies readonly (typeof DECISION_STATUSES)[number][];
export const ACTIVITY_ENTITIES = [
  "task",
  "requirement",
  "decision",
  "agent_key",
  "raid_item",
  "lesson",
] as const;
export const ACTIVITY_ACTIONS = [
  "task.progress",
  "requirement.set",
  "decision.request",
  "decision.decide",
  "key.issue",
  "key.revoke",
  "key.bootstrap",
  "raid.create",
  "raid.update",
  "lesson.create",
  "lesson.update",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type TaskGroup = (typeof TASK_GROUPS)[number];
export type BlockedOn = (typeof BLOCKED_ON)[number];
export type UpdateKind = (typeof UPDATE_KINDS)[number];
export type UpdateSource = (typeof UPDATE_SOURCES)[number];
export type RequirementState = (typeof REQUIREMENT_STATES)[number];
export type GateType = (typeof GATE_TYPES)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** `type` aliases, not interfaces, so drizzle row types stay assignable to Json. */
export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
export type UpdateLink = { label: string; url: string };
export type DecisionOption = { label: string; description?: string; recommended: boolean };

const PG_UTC_TEXT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\+00$/;

/**
 * Both drivers hand timestamptz to drizzle as the server's text. Both db factories pin `TimeZone=UTC,
 * DateStyle=ISO`, so that text is always `YYYY-MM-DD HH:MM:SS[.ffffff]+00`. Any other shape means a connection
 * skipped the factory, and failing loudly beats returning a timestamp in an unknown zone.
 */
export const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamp with time zone",
  fromDriver(value: string): string {
    const match = PG_UTC_TEXT.exec(value);
    if (!match) throw new Error(`timestamptz outside the UTC session contract: ${value}`);
    return `${match[1]}T${match[2]}Z`;
  },
  toDriver: (value: string): string => value,
});

function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    display_name: text("display_name").notNull(),
    role: text("role", { enum: AGENT_ROLES }).notNull(),
    color: text("color").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("agents_role_check", oneOf(t.role, AGENT_ROLES))],
);

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    key_hash: text("key_hash").notNull().unique(),
    label: text("label").notNull(),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    revoked_at: isoTimestamp("revoked_at"),
  },
  (t) => [check("agent_keys_hash_is_sha256_hex", sql`${t.key_hash} ~ '^[0-9a-f]{64}$'`)],
);

export const statusLabels = pgTable("status_labels", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  is_done: boolean("is_done").notNull(),
  color: text("color"),
});

export const engineeringTasks = pgTable(
  "engineering_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    agent: text("agent").references(() => agents.id),
    repository: text("repository").notNull(),
    host: text("host").notNull(),
    commit_sha: text("commit_sha"),
    status: text("status")
      .notNull()
      .references(() => statusLabels.id),
    group: text("group", { enum: TASK_GROUPS }).notNull(),
    blocked_on: text("blocked_on", { enum: BLOCKED_ON }).notNull().default("none"),
    start_date: date("start_date", { mode: "string" }),
    due_date: date("due_date", { mode: "string" }),
    note: text("note"),
    source_url: text("source_url").notNull(),
    version: integer("version").notNull().default(1),
    updated_at: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    check("engineering_tasks_dates_check", sql`${t.due_date} >= ${t.start_date}`),
    check("engineering_tasks_group_check", oneOf(t.group, TASK_GROUPS)),
    check("engineering_tasks_blocked_on_check", oneOf(t.blocked_on, BLOCKED_ON)),
    check("engineering_tasks_version_check", sql`${t.version} >= 1`),
  ],
);

// Feed indexes are (filter, created_at, id) ascending: a backward scan serves ORDER BY created_at DESC, id DESC.
// A `.desc()` index would be generated as DESC NULLS LAST and would not match that ordering.
export const taskUpdates = pgTable(
  "task_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    task_id: text("task_id")
      .notNull()
      .references(() => engineeringTasks.id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    kind: text("kind", { enum: UPDATE_KINDS }).notNull(),
    status: text("status").references(() => statusLabels.id),
    note: text("note").notNull(),
    links: jsonb("links")
      .$type<UpdateLink[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    commit_sha: text("commit_sha"),
    pr_url: text("pr_url"),
    source: text("source", { enum: UPDATE_SOURCES }),
    run_id: text("run_id"),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("task_updates_feed_idx").on(t.created_at, t.id),
    index("task_updates_agent_feed_idx").on(t.agent_id, t.created_at, t.id),
    index("task_updates_task_feed_idx").on(t.task_id, t.created_at, t.id),
    index("task_updates_source_feed_idx").on(t.source, t.created_at, t.id),
    check("task_updates_kind_check", oneOf(t.kind, UPDATE_KINDS)),
    check(
      "task_updates_source_check",
      sql`${t.source} is null or ${oneOf(t.source, UPDATE_SOURCES)}`,
    ),
    check("task_updates_system_has_no_source", sql`(${t.kind} = 'system') = (${t.source} is null)`),
  ],
);

export const taskRequirements = pgTable(
  "task_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    task_id: text("task_id")
      .notNull()
      .references(() => engineeringTasks.id),
    requirement: text("requirement").notNull(),
    source_url: text("source_url"),
    proof_url: text("proof_url"),
    state: text("state", { enum: REQUIREMENT_STATES }).notNull().default("NOT_RUN"),
    version: integer("version").notNull().default(1),
    updated_by: text("updated_by").references(() => agents.id),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("task_requirements_task_text_uq").on(t.task_id, t.requirement),
    check("task_requirements_state_check", oneOf(t.state, REQUIREMENT_STATES)),
    check(
      "task_requirements_pass_needs_proof",
      sql`${t.state} <> 'PASS' or ${t.proof_url} is not null`,
    ),
  ],
);

export const ownerDecisionIdSeq = pgSequence("owner_decision_id_seq", {
  startWith: 1,
  minValue: 1,
});

export const ownerDecisions = pgTable(
  "owner_decisions",
  {
    id: text("id").primaryKey(),
    question: text("question"),
    subject: text("subject"),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    gate_type: text("gate_type", { enum: GATE_TYPES }).notNull(),
    options: jsonb("options")
      .$type<DecisionOption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    blocks: text("blocks")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    recommended_by: text("recommended_by").references(() => agents.id),
    requested_by: text("requested_by").references(() => agents.id),
    requested_at: isoTimestamp("requested_at"),
    source_url: text("source_url"),
    status: text("status", { enum: DECISION_STATUSES }).notNull().default("Pending"),
    decision_text: text("decision_text"),
    decision_source_url: text("decision_source_url"),
    decided_at: isoTimestamp("decided_at"),
    superseded_by: text("superseded_by"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    foreignKey({
      name: "owner_decisions_superseded_by_fk",
      columns: [t.superseded_by],
      foreignColumns: [t.id],
    }),
    check("owner_decisions_gate_type_check", oneOf(t.gate_type, GATE_TYPES)),
    check("owner_decisions_status_check", oneOf(t.status, DECISION_STATUSES)),
    check("owner_decisions_summary_length", sql`char_length(${t.summary}) between 1 and 140`),
    check("owner_decisions_description_present", sql`char_length(${t.description}) >= 1`),
    check(
      "owner_decisions_decided_has_source",
      sql`${t.status} <> 'Decided' or coalesce(${t.decision_source_url}, '') <> ''`,
    ),
    check(
      "owner_decisions_recommendation_attributed",
      sql`(${t.recommended_by} is not null) = (${t.options} @? '$[*] ? (@.recommended == true)')`,
    ),
    check("owner_decisions_version_check", sql`${t.version} >= 1`),
  ],
);

export const githubPrs = pgTable("github_prs", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull(),
  draft: boolean("draft").notNull().default(false),
  head_sha: text("head_sha").notNull(),
  merge_commit_sha: text("merge_commit_sha"),
  url: text("url").notNull(),
  fetched_at: isoTimestamp("fetched_at")
    .notNull()
    .default(sql`now()`),
});

export const githubRepos = pgTable("github_repos", {
  name: text("name").primaryKey(),
  default_branch: text("default_branch").notNull(),
  head_sha: text("head_sha").notNull(),
  fetched_at: isoTimestamp("fetched_at")
    .notNull()
    .default(sql`now()`),
});

/** Append-only: migration 0001 adds a trigger that refuses UPDATE, DELETE and TRUNCATE. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor")
      .notNull()
      .references(() => agents.id),
    action: text("action", { enum: ACTIVITY_ACTIONS }).notNull(),
    entity: text("entity", { enum: ACTIVITY_ENTITIES }).notNull(),
    entity_id: text("entity_id").notNull(),
    before: jsonb("before").$type<Json>(),
    after: jsonb("after").$type<Json>(),
    run_id: text("run_id"),
    commit_sha: text("commit_sha"),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("activity_log_feed_idx").on(t.created_at, t.id),
    index("activity_log_actor_feed_idx").on(t.actor, t.created_at, t.id),
    index("activity_log_entity_feed_idx").on(t.entity, t.entity_id, t.created_at, t.id),
    check("activity_log_action_check", oneOf(t.action, ACTIVITY_ACTIONS)),
    check("activity_log_entity_check", oneOf(t.entity, ACTIVITY_ENTITIES)),
  ],
);

/**
 * The row is claimed (status 0) and completed inside the write's own transaction, so no other transaction observes
 * status 0 and a rolled-back write leaves no row.
 */
export const idempotency = pgTable(
  "idempotency",
  {
    key: text("key").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => agents.id),
    request_hash: text("request_hash").notNull(),
    status: integer("status").notNull(),
    response: jsonb("response").$type<Json>().notNull(),
    created_at: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ name: "idempotency_pk", columns: [t.key, t.actor] }),
    index("idempotency_created_idx").on(t.created_at),
    check("idempotency_status_check", sql`${t.status} = 0 or ${t.status} between 200 and 299`),
  ],
);
