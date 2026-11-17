/**
 * The RAID register (SPEC §6.1). Every write is one plan object in the shape of writes.ts, run by the shared writer
 * (pipeline.ts). Automations 1 and 2 run inside the plan whose write triggers them, in that write's transaction.
 */
import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import {
  agents,
  engineeringTasks,
  ownerDecisions,
  type BlockedOn,
  type Json,
} from "@/server/db/schema";
import {
  BLOCKING_REF_PATTERN,
  formatRaidId,
  RAID_ID_PATTERN,
  RAID_STATUSES,
  RAID_TYPE_FIELDS,
  RAID_TYPES,
  raidItems,
  SEVERITIES,
  VALIDATION_STATES,
  type RaidStatus,
  type RaidType,
  type RaidTypeField,
  type Severity,
} from "@/server/db/schema-raid";
import type { Actor } from "./actor";
import { ServiceError, type Issue } from "./errors";
import { isoMicros, parse, pgInstant, requestDecisionInput, sourceRef } from "./inputs";
import type { CreatePlan, UpdatePlan, WriteContext } from "./pipeline";
import { authorizeTaskWrite } from "./policy";
import type {
  CreateOptions,
  Decision,
  Page,
  TaskUpdate,
  UpdateOptions,
  WriteResult,
} from "./types";
import { requestDecisionPlan } from "./writes";

export type RaidItem = typeof raidItems.$inferSelect;

// §1 Shared helpers.

/** reads.ts keeps its keyset helpers private; these order by (created_at desc, id desc) as its feeds do. */
export const SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

export type Keyset = {
  encode(row: { readonly created_at: string; readonly id: string }): string;
  olderThan(createdAt: AnyPgColumn, id: AnyPgColumn, cursor: string | undefined): SQL | undefined;
};

/** A cursor is the base64url JSON of its row's sort key. */
export function encodeCursor(key: readonly Json[]): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/** A cursor that is not `shape`'s, a cursor from another list included, is 400 at `cursor`. */
export function decodeCursor<S extends z.ZodTypeAny>(shape: S, cursor: string): z.output<S> {
  const malformed = () =>
    ServiceError.invalid("The cursor is malformed.", [
      { path: "cursor", message: "not a cursor from this API" },
    ]);
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw malformed();
  }
  const parsed = shape.safeParse(decoded);
  if (!parsed.success) throw malformed();
  return parsed.data as z.output<S>;
}

export function keyset(idPattern: string): Keyset {
  const shape = z.tuple([isoMicros, z.string().regex(new RegExp(idPattern))]);
  return {
    encode: (row) => encodeCursor([row.created_at, row.id]),
    olderThan(createdAt, id, cursor) {
      if (cursor === undefined) return undefined;
      const [createdAtKey, idKey] = decodeCursor(shape, cursor);
      return sql`(${createdAt}, ${id}) < (${createdAtKey}::timestamptz, ${idKey}::text)`;
    },
  };
}

/** Fetches one row past `limit`; only that row's presence shows a next page exists. */
export async function page<T>(
  query: { limit(n: number): PromiseLike<T[]> },
  limit: number,
  encode: (row: T) => string,
): Promise<Page<T>> {
  const rows = await query.limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encode(last) : null,
  };
}

export const count = sql<number>`count(*)::int`.mapWith(Number);

export function tally<K extends string>(
  rows: readonly { readonly key: K | null; readonly n: number }[],
): Record<K, number> {
  return Object.fromEntries(rows.flatMap((r) => (r.key === null ? [] : [[r.key, r.n]]))) as Record<
    K,
    number
  >;
}

// §2 Inputs. Exported through index.ts so the MCP tools reuse them; refined ones through `.innerType()`.

export const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().trim().min(1).max(100);
export const listLimit = z.coerce.number().int().min(1).max(100).default(20);
export const listCursor = z.string().min(1).max(500);

const raidFields = {
  title: text(200).describe("One-line title."),
  summary: text(140).describe("The row view, at most 140 characters."),
  description: text(20000).describe("The full text."),
  sourceUrl: sourceRef.describe(
    "Required: where this is recorded. An http(s) URL, or hx15:<absolute path> for a record that exists only on HX-15.",
  ),
  ownerAgent: id.nullable().describe("The agent id that owns the item."),
  status: z.enum(RAID_STATUSES),
  severity: z
    .enum(SEVERITIES)
    .nullable()
    .describe("Setting it records you as the rater; null clears it."),
  reviewAt: pgInstant.nullable(),
  taskIds: z
    .array(id)
    .max(20)
    .describe("Existing task ids the item concerns. A dependency's blockedTaskId is added."),
  decisionId: id
    .nullable()
    .describe(
      "An existing owner decision. A high or critical issue without one opens a pending policy decision and links it.",
    ),
  probability: text(2000).nullable().describe("Risk only."),
  impact: text(2000).nullable().describe("Risk or issue only."),
  mitigation: text(2000).nullable().describe("Risk only."),
  validationMethod: text(2000).nullable().describe("Assumption only."),
  validationState: z
    .enum(VALIDATION_STATES)
    .nullable()
    .describe("Assumption only, required; unverified when absent on create."),
  resolution: text(2000).nullable().describe("Issue only."),
  escalated: z.boolean().describe("Issue only."),
  blockedTaskId: id
    .nullable()
    .describe(
      "Dependency only, required: the task it blocks. Unless you are the owner, it must be assigned to you, and so must the task a move or a reopen affects. Closing the dependency unblocks its task, and moving an open one away unblocks the task it leaves, when that task is blocked on dependency and no other open dependency blocks it.",
    ),
  blockingRef: z
    .string()
    .trim()
    .max(2000)
    .regex(new RegExp(BLOCKING_REF_PATTERN), "must be task:<id>, decision:D-NN or an http(s) URL")
    .nullable()
    .describe("Dependency only, required: task:<id>, decision:D-NN or an http(s) URL."),
};
type RaidField = keyof typeof raidFields;

const RAID_COLUMNS = {
  title: "title",
  summary: "summary",
  description: "description",
  sourceUrl: "source_url",
  ownerAgent: "owner_agent",
  status: "status",
  severity: "severity",
  reviewAt: "review_at",
  taskIds: "task_ids",
  decisionId: "decision_id",
  probability: "probability",
  impact: "impact",
  mitigation: "mitigation",
  validationMethod: "validation_method",
  validationState: "validation_state",
  resolution: "resolution",
  escalated: "escalated",
  blockedTaskId: "blocked_task_id",
  blockingRef: "blocking_ref",
} as const satisfies Record<RaidField, keyof RaidItem>;

const FIELD_OF_COLUMN = Object.fromEntries(
  Object.entries(RAID_COLUMNS).map(([field, column]) => [column, field]),
) as Record<RaidTypeField, RaidField>;

type RaidColumns = Partial<Pick<RaidItem, (typeof RAID_COLUMNS)[RaidField]>>;

function raidColumns(input: Partial<Record<RaidField, unknown>>): RaidColumns {
  return Object.fromEntries(
    Object.entries(RAID_COLUMNS).flatMap(([field, column]) => {
      const value = input[field as RaidField];
      return value === undefined ? [] : [[column, value]];
    }),
  ) as RaidColumns;
}

const raidObject = z.object(raidFields);

export function raidShapeIssues(
  type: RaidType,
  columns: Partial<Record<RaidTypeField, unknown>>,
): Issue[] {
  return Object.entries(RAID_TYPE_FIELDS).flatMap(([column, field]): Issue[] => {
    const owned = (field.types as readonly RaidType[]).includes(type);
    const value = columns[column as RaidTypeField];
    const path = FIELD_OF_COLUMN[column as RaidTypeField];
    if (!owned && value != null && value !== field.empty) {
      return [
        { path, message: `a ${type} has no ${path}; it belongs to ${field.types.join(" and ")}` },
      ];
    }
    if (owned && field.required && value == null) {
      return [{ path, message: `a ${type} needs ${path}` }];
    }
    return [];
  });
}

/** An assumption's validation_state is required, and unverified when the caller gives none. */
function withRequiredDefaults(type: RaidType, columns: RaidColumns): RaidColumns {
  return type === "assumption" && columns.validation_state == null
    ? { ...columns, validation_state: "unverified" }
    : columns;
}

function addShapeIssues(issues: readonly Issue[], ctx: z.RefinementCtx): void {
  for (const issue of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
}

export const createRaidItemInput = raidObject
  .partial({
    ownerAgent: true,
    severity: true,
    reviewAt: true,
    decisionId: true,
    probability: true,
    impact: true,
    mitigation: true,
    validationMethod: true,
    validationState: true,
    resolution: true,
    blockedTaskId: true,
    blockingRef: true,
  })
  .extend({
    type: z
      .enum(RAID_TYPES)
      .describe("risk, assumption, issue or dependency. It cannot change later."),
    status: raidFields.status.default("open"),
    taskIds: raidFields.taskIds.default([]),
    escalated: raidFields.escalated.default(false),
  })
  .superRefine((v, ctx) =>
    addShapeIssues(raidShapeIssues(v.type, withRequiredDefaults(v.type, raidColumns(v))), ctx),
  );

/** A partial update: an absent field stays, null clears it. */
export const updateRaidItemInput = raidObject
  .partial()
  .extend({
    type: z
      .never({ message: "type cannot change; close this item and create one of the new type" })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.values(raidColumns(v)).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "give at least one field to change",
      });
    }
  });

export const raidQueryInput = z
  .object({
    type: z.enum(RAID_TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(RAID_STATUSES).optional(),
    owner: id.optional().describe("owner_agent"),
    task: id.optional().describe("A task id in task_ids."),
    limit: listLimit,
    cursor: listCursor.optional(),
  })
  .default({});

export type CreateRaidItemInput = z.input<typeof createRaidItemInput>;
export type UpdateRaidItemInput = z.input<typeof updateRaidItemInput>;
export type RaidQueryInput = z.input<typeof raidQueryInput>;

// §3 Plans.

/** `decision` is the decision automation 1 opened in this write, else null; `systemUpdates` those automation 2 posted. */
export type RaidWrite = {
  readonly item: RaidItem;
  readonly decision: Decision | null;
  readonly systemUpdates: readonly TaskUpdate[];
};
type RaidRoot = { readonly kind: "raid_item"; readonly id: string };

async function nextRaidId(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ n: sql<number>`nextval('raid_item_id_seq')::int`.mapWith(Number) })
    .from(sql`(select 1) as one`);
  if (!row) throw new Error("nextval returned no row");
  return formatRaidId(row.n);
}

type References = Partial<
  Pick<
    z.output<typeof updateRaidItemInput>,
    "ownerAgent" | "taskIds" | "decisionId" | "blockedTaskId" | "blockingRef"
  >
>;

/** The referenced agent, tasks and decisions must exist, as requestDecisionPlan checks a decision's `blocks`. */
async function referenceIssues(tx: Tx, refs: References): Promise<Issue[]> {
  const issues: Issue[] = [];
  const [kind, target] = refs.blockingRef?.split(/:(.*)/s) ?? [];
  const refTask = kind === "task" ? target : undefined;
  const refDecision = kind === "decision" ? target : undefined;
  const taskIds = [
    ...(refs.taskIds ?? []),
    ...(refs.blockedTaskId ? [refs.blockedTaskId] : []),
    ...(refTask ? [refTask] : []),
  ];
  const decisionIds = [
    ...(refs.decisionId ? [refs.decisionId] : []),
    ...(refDecision ? [refDecision] : []),
  ];
  const tasks = new Set(
    taskIds.length === 0
      ? []
      : (
          await tx
            .select({ id: engineeringTasks.id })
            .from(engineeringTasks)
            .where(inArray(engineeringTasks.id, taskIds))
        ).map((t) => t.id),
  );
  const decisions = new Set(
    decisionIds.length === 0
      ? []
      : (
          await tx
            .select({ id: ownerDecisions.id })
            .from(ownerDecisions)
            .where(inArray(ownerDecisions.id, decisionIds))
        ).map((d) => d.id),
  );
  if (refs.ownerAgent) {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, refs.ownerAgent));
    if (!agent) issues.push({ path: "ownerAgent", message: `no agent ${refs.ownerAgent}` });
  }
  (refs.taskIds ?? []).forEach((taskId, i) => {
    if (!tasks.has(taskId)) issues.push({ path: `taskIds.${i}`, message: `no task ${taskId}` });
  });
  if (refs.blockedTaskId && !tasks.has(refs.blockedTaskId)) {
    issues.push({ path: "blockedTaskId", message: `no task ${refs.blockedTaskId}` });
  }
  if (refs.decisionId && !decisions.has(refs.decisionId)) {
    issues.push({ path: "decisionId", message: `no decision ${refs.decisionId}` });
  }
  if (refTask && !tasks.has(refTask)) {
    issues.push({ path: "blockingRef", message: `no task ${refTask}` });
  }
  if (refDecision && !decisions.has(refDecision)) {
    issues.push({ path: "blockingRef", message: `no decision ${refDecision}` });
  }
  return issues;
}

function throwIfAny(issues: readonly Issue[]): void {
  if (issues.length > 0) throw ServiceError.invalid("The request body is invalid.", issues);
}

/** task_ids always lists blocked_task_id, so the `task` filter reads one column. */
function withBlockedTask(taskIds: readonly string[], blockedTaskId: string | null): string[] {
  return blockedTaskId === null || taskIds.includes(blockedTaskId)
    ? [...taskIds]
    : [...taskIds, blockedTaskId];
}

type Effects = {
  decisionId?: string;
  systemUpdateIds?: string[];
  unblockedTask?: { id: string; version: number };
  unblockedPreviousTask?: { id: string; version: number };
};

/** The activity row's `after`: the stored row, plus what the write's automations did. */
function afterWith(item: RaidItem, effects: Effects): Json {
  return { ...item, effects };
}

const OPENS_DECISION: readonly Severity[] = ["high", "critical"];

/**
 * Automation 1 (SPEC §6.1; CC1: only while decision_id is null). Level-triggered on the stored row: an open or
 * monitored issue with severity high or critical and no decision. It runs requestDecisionPlan in this transaction,
 * so the decision draws its id from the decision id sequence and records this actor and clock; the RAID write's
 * one activity row records it. The row is new or locked, so a repeat sees decision_id set; a replay never runs this.
 */
async function openIssueDecision(
  tx: Tx,
  ctx: WriteContext<unknown>,
  item: RaidItem,
): Promise<{ readonly item: RaidItem; readonly decision: Decision } | null> {
  if (
    item.type !== "issue" ||
    item.severity === null ||
    !OPENS_DECISION.includes(item.severity) ||
    item.decision_id !== null ||
    item.status === "closed"
  ) {
    return null;
  }
  const input = parse(requestDecisionInput, {
    question: `Owner decision needed for ${item.id}, a ${item.severity} issue: ${item.title}`,
    subject: item.id,
    summary: item.summary,
    description: item.description,
    gateType: "policy",
    options: [],
    blocks: [],
    sourceUrl: item.source_url,
  });
  const {
    value: { decision },
  } = await requestDecisionPlan.apply(tx, { ...ctx, input });
  const [linked] = await tx
    .update(raidItems)
    .set({ decision_id: decision.id })
    .where(eq(raidItems.id, item.id))
    .returning();
  if (!linked) throw new Error(`raid item ${item.id} vanished while linking ${decision.id}`);
  return { item: linked, decision };
}

type DependencyState = Pick<RaidItem, "type" | "status" | "blocked_task_id">;

/** Automation 2's trigger: a dependency on a task moves into closed. */
function closesDependency(before: DependencyState | null, after: DependencyState): boolean {
  return (
    after.type === "dependency" &&
    before?.status !== "closed" &&
    after.status === "closed" &&
    after.blocked_task_id !== null
  );
}

/** The task an open dependency leaves when the write moves it to another task, else null. */
function leftTask(before: DependencyState, after: DependencyState): string | null {
  return before.type === "dependency" &&
    before.status !== "closed" &&
    before.blocked_task_id !== after.blocked_task_id
    ? before.blocked_task_id
    : null;
}

/** The tasks a dependency write affects: a create's task, both tasks of a move, and the task of a close or reopen. */
function affectedTasks(before: DependencyState | null, after: DependencyState): string[] {
  if (after.type !== "dependency") return [];
  return touchedTasks(before, after).filter((t): t is string => t !== null);
}

/** The `blocked_task_id` of each side a dependency write touches; null where that side is on no task. */
function touchedTasks(before: DependencyState | null, after: DependencyState): (string | null)[] {
  if (before === null) return [after.blocked_task_id];
  if (before.blocked_task_id !== after.blocked_task_id) {
    return [before.blocked_task_id, after.blocked_task_id];
  }
  if ((before.status === "closed") !== (after.status === "closed")) return [after.blocked_task_id];
  return [];
}

/**
 * P2-1. A dependency write that affects a task writes that task, so it needs the owner or the task's agent: pinning
 * one on a task, moving one onto or away from a task (both tasks), and closing or reopening one. It runs after the
 * 400 checks, and on create before nextRaidId, so a refusal draws no id.
 */
async function authorizeDependencyChange(
  tx: Tx,
  actor: Actor,
  before: DependencyState | null,
  after: DependencyState,
): Promise<void> {
  if (actor.role === "owner") return;
  const taskIds = affectedTasks(before, after);
  if (taskIds.length === 0) return;
  const tasks = await tx
    .select({ id: engineeringTasks.id, agent: engineeringTasks.agent })
    .from(engineeringTasks)
    .where(inArray(engineeringTasks.id, taskIds));
  for (const taskId of taskIds) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`blocked task ${taskId} vanished after its reference check`);
    authorizeTaskWrite(actor, task);
  }
}

/**
 * Locks every task a dependency write affects, one at a time in ascending id order, FOR NO KEY UPDATE, before the RAID
 * row insert or update sets its foreign key. Two crossing moves (D1 from A to B, D2 from B to A) then serialise on the
 * lower id, and the second one's release check runs after the first commits, so it sees the first one's move. A
 * create on a task and a move off it serialise the same way. The lock is FOR NO KEY UPDATE, not FOR UPDATE, because
 * it must not wait on another write's foreign-key FOR KEY SHARE on the task. `releaseTask` takes the same lock again
 * later in the transaction, which is then a no-op.
 */
async function lockAffectedTasks(
  tx: Tx,
  before: DependencyState | null,
  after: DependencyState,
): Promise<void> {
  const taskIds = affectedTasks(before, after).sort((a, b) => (a < b ? -1 : 1));
  for (const taskId of taskIds) {
    await tx
      .select({ id: engineeringTasks.id })
      .from(engineeringTasks)
      .where(eq(engineeringTasks.id, taskId))
      .for("no key update");
  }
}

type TaskVersion = { readonly id: string; readonly version: number };
type Released = {
  readonly systemUpdates: readonly TaskUpdate[];
  /** The task the dependency is on after the write, unblocked by its close. */
  readonly unblockedTask: TaskVersion | null;
  /** The task an open dependency left, unblocked because no open dependency is left on it. */
  readonly unblockedPreviousTask: TaskVersion | null;
};

/**
 * Under the task's lock (so two last releases serialise): clear the task's block only when it is `dependency` and no
 * other open dependency blocks it, bumping the task's version because a task column changed. `owner_decision` and
 * `assignment` blocks belong to other processes (IRP-04 stays blocked on D-05). Posts one system update, `event`
 * followed by the outcome.
 */
async function releaseTask(
  tx: Tx,
  ctx: WriteContext<unknown>,
  item: RaidItem,
  taskId: string,
  event: string,
): Promise<{ readonly systemUpdates: TaskUpdate[]; readonly unblocked: TaskVersion | null }> {
  const [task] = await tx
    .select({ blocked_on: engineeringTasks.blocked_on })
    .from(engineeringTasks)
    .where(eq(engineeringTasks.id, taskId))
    .for("no key update");
  if (!task) throw new Error(`blocked task ${taskId} of ${item.id} vanished`);
  const stillOpen = and(
    eq(raidItems.type, "dependency"),
    ne(raidItems.status, "closed"),
    eq(raidItems.blocked_task_id, taskId),
    ne(raidItems.id, item.id),
  );
  const [unblocked] = await tx
    .update(engineeringTasks)
    .set({ blocked_on: "none", version: sql`${engineeringTasks.version} + 1`, updated_at: ctx.at })
    .where(
      and(
        eq(engineeringTasks.id, taskId),
        eq(engineeringTasks.blocked_on, "dependency"),
        notExists(tx.select({ id: raidItems.id }).from(raidItems).where(stillOpen)),
      ),
    )
    .returning({ id: engineeringTasks.id, version: engineeringTasks.version });
  const open = unblocked
    ? []
    : (
        await tx.select({ id: raidItems.id }).from(raidItems).where(stillOpen).orderBy(raidItems.id)
      ).map((r) => r.id);
  const outcome = releaseOutcome(taskId, task.blocked_on, unblocked !== undefined, open);
  const systemUpdates = await ctx.insertUpdates([
    {
      task_id: taskId,
      kind: "system",
      status: null,
      note: `${event} ${outcome}.`,
      links: [],
      source: null,
    },
  ]);
  return { systemUpdates, unblocked: unblocked ?? null };
}

/** What a release did to its task: unblocked it, found it not blocked, or left it blocked by `open` or `blockedOn`. */
function releaseOutcome(
  taskId: string,
  blockedOn: BlockedOn,
  unblocked: boolean,
  open: readonly string[],
): string {
  if (unblocked) return `${taskId} is unblocked`;
  if (blockedOn === "none") return `${taskId} is not blocked`;
  if (open.length > 0) return `${taskId} stays blocked: ${open.join(", ")} still open`;
  return `${taskId} stays blocked on ${blockedOn}`;
}

/**
 * Automation 2 (SPEC §6.1). A dependency's move into closed releases the task it is on, and an open dependency's move
 * to another task releases the task it left. Every release posts one system update that states the outcome. Every
 * released task is already locked by `lockAffectedTasks`, in id order and before the RAID row update, so the releases
 * run in id order only to keep the system updates in a stable order.
 */
async function releaseDependencyTasks(
  tx: Tx,
  ctx: WriteContext<unknown>,
  before: RaidItem,
  after: RaidItem,
): Promise<Released> {
  const closedOn = closesDependency(before, after) ? after.blocked_task_id : null;
  const left = leftTask(before, after);
  const releases = [
    ...(left === null
      ? []
      : [{ taskId: left, event: `${after.id} moved to ${after.blocked_task_id}.` }]),
    ...(closedOn === null ? [] : [{ taskId: closedOn, event: `${after.id} is closed.` }]),
  ].sort((a, b) => (a.taskId < b.taskId ? -1 : 1));
  const systemUpdates: TaskUpdate[] = [];
  const unblocked = new Map<string, TaskVersion>();
  for (const { taskId, event } of releases) {
    const released = await releaseTask(tx, ctx, after, taskId, event);
    systemUpdates.push(...released.systemUpdates);
    if (released.unblocked) unblocked.set(taskId, released.unblocked);
  }
  return {
    systemUpdates,
    unblockedTask: closedOn === null ? null : (unblocked.get(closedOn) ?? null),
    unblockedPreviousTask: left === null ? null : (unblocked.get(left) ?? null),
  };
}

export const createRaidItemPlan: CreatePlan<typeof createRaidItemInput, RaidWrite> = {
  action: "raid.create",
  input: createRaidItemInput,
  async apply(tx, ctx) {
    const { actor, input, at } = ctx;
    throwIfAny(await referenceIssues(tx, input));
    const dependency: DependencyState = {
      type: input.type,
      status: input.status,
      blocked_task_id: input.blockedTaskId ?? null,
    };
    await lockAffectedTasks(tx, null, dependency);
    await authorizeDependencyChange(tx, actor, null, dependency);
    const columns = withRequiredDefaults(input.type, raidColumns(input));
    const id = await nextRaidId(tx);
    const [inserted] = await tx
      .insert(raidItems)
      .values({
        ...columns,
        id,
        type: input.type,
        title: input.title,
        summary: input.summary,
        description: input.description,
        source_url: input.sourceUrl,
        task_ids: withBlockedTask(input.taskIds, input.blockedTaskId ?? null),
        severity_rated_by: input.severity ? actor.agentId : null,
        created_by: actor.agentId,
        created_at: at,
        updated_at: at,
      })
      .returning();
    if (!inserted) throw new Error("raid item insert returned no row");
    const opened = await openIssueDecision(tx, ctx, inserted);
    const item = opened?.item ?? inserted;
    const effects: Effects = opened ? { decisionId: opened.decision.id } : {};
    return {
      status: 201,
      value: { item, decision: opened?.decision ?? null, systemUpdates: [] },
      activity: {
        entity: "raid_item",
        entityId: id,
        before: null,
        after: afterWith(item, effects),
      },
    };
  },
};

export function updateRaidItemPlan(
  id: string,
): UpdatePlan<typeof updateRaidItemInput, RaidRoot, RaidWrite> {
  return {
    action: "raid.update",
    input: updateRaidItemInput,
    root: { kind: "raid_item", id },
    async apply(tx, ctx) {
      const { actor, input, before } = ctx;
      const columns = raidColumns(input);
      const merged = { ...before, ...columns };
      throwIfAny([...raidShapeIssues(before.type, merged), ...(await referenceIssues(tx, input))]);
      await lockAffectedTasks(tx, before, merged);
      await authorizeDependencyChange(tx, actor, before, merged);
      const [updated] = await tx
        .update(raidItems)
        .set({
          ...columns,
          task_ids: withBlockedTask(merged.task_ids, merged.blocked_task_id),
          ...(input.severity === undefined
            ? {}
            : { severity_rated_by: input.severity === null ? null : actor.agentId }),
        })
        .where(eq(raidItems.id, before.id))
        .returning();
      if (!updated) throw new Error("raid item update returned no row");
      const opened = await openIssueDecision(tx, ctx, updated);
      const item = opened?.item ?? updated;
      const released = await releaseDependencyTasks(tx, ctx, before, item);
      const effects: Effects = {
        ...(opened ? { decisionId: opened.decision.id } : {}),
        ...(released.systemUpdates.length > 0
          ? { systemUpdateIds: released.systemUpdates.map((u) => u.id) }
          : {}),
        ...(released.unblockedTask ? { unblockedTask: { ...released.unblockedTask } } : {}),
        ...(released.unblockedPreviousTask
          ? { unblockedPreviousTask: { ...released.unblockedPreviousTask } }
          : {}),
      };
      return {
        status: 200,
        value: { item, decision: opened?.decision ?? null, systemUpdates: released.systemUpdates },
        activity: {
          entity: "raid_item",
          entityId: before.id,
          before,
          after: afterWith(item, effects),
        },
      };
    },
  };
}

// §4 Read.

export type RaidCounts = {
  readonly total: number;
  readonly byType: Readonly<Partial<Record<RaidType, number>>>;
  /** Unrated rows count in `total` only. */
  readonly bySeverity: Readonly<Partial<Record<Severity, number>>>;
  readonly byStatus: Readonly<Partial<Record<RaidStatus, number>>>;
  /** Unowned rows count in `total` only. */
  readonly byOwner: Readonly<Record<string, number>>;
  readonly byTask: Readonly<Record<string, number>>;
};
export type RaidPage = Page<RaidItem> & { readonly counts: RaidCounts };

const raidKeyset = keyset(RAID_ID_PATTERN);

type RaidFacet = "type" | "severity" | "status" | "owner" | "task";

function raidFilters(query: z.output<typeof raidQueryInput>, except?: RaidFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "type" && query.type !== undefined ? eq(raidItems.type, query.type) : undefined,
    except !== "severity" && query.severity !== undefined
      ? eq(raidItems.severity, query.severity)
      : undefined,
    except !== "status" && query.status !== undefined
      ? eq(raidItems.status, query.status)
      : undefined,
    except !== "owner" && query.owner !== undefined
      ? eq(raidItems.owner_agent, query.owner)
      : undefined,
    except !== "task" && query.task !== undefined
      ? sql`${query.task}::text = any(${raidItems.task_ids})`
      : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

/** One REPEATABLE READ, READ ONLY snapshot; each facet applies every filter but its own; counts ignore the cursor. */
export async function listRaid(db: Db, raw: unknown): Promise<RaidPage> {
  const query = parse(raidQueryInput, raw);
  return db.transaction(async (tx) => {
    const items = await page(
      tx
        .select()
        .from(raidItems)
        .where(
          and(
            ...raidFilters(query),
            raidKeyset.olderThan(raidItems.created_at, raidItems.id, query.cursor),
          ),
        )
        .orderBy(desc(raidItems.created_at), desc(raidItems.id)),
      query.limit,
      raidKeyset.encode,
    );
    const [total] = await tx
      .select({ n: count })
      .from(raidItems)
      .where(and(...raidFilters(query)));
    const byType = await tx
      .select({ key: raidItems.type, n: count })
      .from(raidItems)
      .where(and(...raidFilters(query, "type")))
      .groupBy(raidItems.type);
    const bySeverity = await tx
      .select({ key: raidItems.severity, n: count })
      .from(raidItems)
      .where(and(...raidFilters(query, "severity"), isNotNull(raidItems.severity)))
      .groupBy(raidItems.severity);
    const byStatus = await tx
      .select({ key: raidItems.status, n: count })
      .from(raidItems)
      .where(and(...raidFilters(query, "status")))
      .groupBy(raidItems.status);
    const byOwner = await tx
      .select({ key: raidItems.owner_agent, n: count })
      .from(raidItems)
      .where(and(...raidFilters(query, "owner"), isNotNull(raidItems.owner_agent)))
      .groupBy(raidItems.owner_agent);
    const tasks = tx
      .select({ id: raidItems.id, task: sql<string>`unnest(${raidItems.task_ids})`.as("task") })
      .from(raidItems)
      .where(and(...raidFilters(query, "task")))
      .as("tasks");
    const byTask = await tx
      .select({ key: tasks.task, n: countDistinct(tasks.id) })
      .from(tasks)
      .groupBy(tasks.task);
    return {
      ...items,
      counts: {
        total: total?.n ?? 0,
        byType: tally(byType),
        bySeverity: tally(bySeverity),
        byStatus: tally(byStatus),
        byOwner: tally(byOwner),
        byTask: tally(byTask),
      },
    };
  }, SNAPSHOT);
}

export async function getRaidItem(db: Db, id: string): Promise<RaidItem> {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(raidItems).where(eq(raidItems.id, id));
    if (!item) throw ServiceError.notFound("RAID item", id);
    return item;
  }, SNAPSHOT);
}

// §5 Service surface, merged into `Services` by index.ts.

export interface RaidServices {
  listRaid(query?: RaidQueryInput): Promise<RaidPage>;
  getRaidItem(id: string): Promise<RaidItem>;
  createRaidItem(
    actor: Actor | null,
    input: CreateRaidItemInput,
    opts?: CreateOptions,
  ): Promise<WriteResult<RaidWrite>>;
  updateRaidItem(
    actor: Actor | null,
    id: string,
    input: UpdateRaidItemInput,
    opts?: UpdateOptions,
  ): Promise<WriteResult<RaidWrite>>;
}
