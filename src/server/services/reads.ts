/**
 * Updates and activity page on (created_at desc, id desc): the cursor carries the row's exact `created_at` string and
 * its id, and PostgreSQL compares the stored values; rows of one write share that write's clock reading, and the id
 * breaks the tie. Each read runs in one REPEATABLE READ, READ ONLY transaction, so its items and counts come from one
 * snapshot.
 */
import {
  and,
  arrayContains,
  arrayOverlaps,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import {
  activityLog,
  agents,
  engineeringTasks,
  githubPrs,
  githubRepos,
  ownerDecisions,
  statusLabels,
  taskRequirements,
  taskUpdates,
  type RequirementState,
} from "@/server/db/schema";
import type { Actor } from "./actor";
import { ServiceError } from "./errors";
import {
  activityQueryInput,
  decisionQueryInput,
  isoMicros,
  parse,
  updateQueryInput,
  type Parsed,
} from "./inputs";
import { revertRefusal } from "./revert";
import type {
  ActivityCounts,
  ActivityPage,
  Decision,
  DecisionCounts,
  DecisionsPage,
  MyWork,
  Page,
  Progress,
  Requirement,
  Task,
  TaskDetail,
  UpdateCounts,
  UpdatesPage,
  Workspace,
} from "./types";

const SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

const feedCursor = z.tuple([isoMicros, z.string().uuid()]);
const instantOrNone = z.union([isoMicros, z.literal("-infinity")]);
const decisionId = z.string().min(1).max(100);
const decisionCursor = z.tuple([z.boolean(), instantOrNone, decisionId]);
/** The literal tag keeps a history cursor from parsing as a default one, and the other way round. */
const historyCursor = z.tuple([z.literal("decided"), instantOrNone, decisionId]);

type FeedKey = z.output<typeof feedCursor>;
type DecisionKey = z.output<typeof decisionCursor>;
type HistoryKey = z.output<typeof historyCursor>;

function encodeCursor(key: FeedKey | DecisionKey | HistoryKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor<S extends typeof feedCursor | typeof decisionCursor | typeof historyCursor>(
  shape: S,
  cursor: string,
): z.output<S> {
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

export const NO_REQUIREMENTS: Progress = { proven: 0, total: 0, percent: null };

export function computeProgress(
  requirements: readonly { readonly task_id: string; readonly state: RequirementState }[],
): ReadonlyMap<string, Progress> {
  const tally = new Map<string, { proven: number; total: number }>();
  for (const r of requirements) {
    const t = tally.get(r.task_id) ?? { proven: 0, total: 0 };
    t.total += 1;
    if (r.state === "PASS") t.proven += 1;
    tally.set(r.task_id, t);
  }
  return new Map(
    [...tally].map(([taskId, t]) => [
      taskId,
      { ...t, percent: t.total === 0 ? null : Math.round((100 * t.proven) / t.total) },
    ]),
  );
}

const task = engineeringTasks;

/** The task's SHA (7-40 hex) is a case-insensitive prefix of `sha` (GitHub's 40). */
const pins = (sha: AnyPgColumn) =>
  sql`left(lower(${sha}), length(${task.commit_sha})) = lower(${task.commit_sha})`;

/** F9, one expression in the only Task loader, so every read of a task agrees on it. */
const stale = sql<boolean | null>`case
  when ${task.commit_sha} is null then null
  when not exists (select 1 from ${githubRepos} where ${githubRepos.name} = ${task.repository}) then null
  when exists (
    select 1 from ${githubRepos} where ${githubRepos.name} = ${task.repository} and ${pins(githubRepos.head_sha)}
  ) or exists (
    select 1 from ${githubPrs} where ${githubPrs.repo} = ${task.repository} and (
      (${githubPrs.state} = 'open' and ${pins(githubPrs.head_sha)})
      or (${githubPrs.state} = 'merged' and ${pins(githubPrs.merge_commit_sha)})
    )
  ) then false
  else true end`;

type Attention = NonNullable<Parsed<typeof updateQueryInput>["attention"]>;

/**
 * An open task is blocked or not done. The one definition behind `Task.open`, the attention reasons, the workspace's
 * decisions and myWork's tasks.
 */
const isOpen = sql<boolean>`(${task.blocked_on} <> 'none' or ${task.group} <> 'done')`;

/**
 * The needs-attention reasons, the one definition that `Task.attention` and listUpdates' `attention` filter both read.
 * Each holds only for an open task. `owner` counts a Pending decision that lists the task in `blocks`. `stale` holds
 * only for `true`, because `null` means no GitHub data, which is not a finding.
 */
const NEEDS_ATTENTION: { readonly [A in Attention]: SQL } = {
  blocked: ne(task.blocked_on, "none"),
  owner: sql`(${task.group} = 'ready_for_owner' or ${task.blocked_on} in ('owner_decision', 'assignment')
    or exists (select 1 from ${ownerDecisions} where ${ownerDecisions.status} = 'Pending' and ${task.id} = any(${ownerDecisions.blocks})))`,
  stale: sql`(${stale}) is true`,
};

const attends = (reason: Attention) => sql`(${isOpen} and ${NEEDS_ATTENTION[reason]})`;

/** The task's reasons in NEEDS_ATTENTION order. */
const attention = sql<Attention[]>`array_remove(array[${sql.join(
  (Object.keys(NEEDS_ATTENTION) as Attention[]).map(
    (reason) => sql`case when ${attends(reason)} then ${reason}::text end`,
  ),
  sql`, `,
)}], null)`;

/** The tasks that `where` selects, in board order, with their requirements and computed fields. */
async function tasksWith(
  tx: Tx,
  where?: SQL,
): Promise<{ readonly tasks: Task[]; readonly requirements: Requirement[] }> {
  const rows = await tx
    .select({ ...getTableColumns(task), open: isOpen, stale, attention })
    .from(task)
    .where(where)
    .orderBy(sql`${task.start_date} asc nulls last`, task.id);
  const requirements = await tx
    .select()
    .from(taskRequirements)
    .where(inArray(taskRequirements.task_id, tx.select({ id: task.id }).from(task).where(where)))
    .orderBy(taskRequirements.task_id, taskRequirements.created_at, taskRequirements.id);
  const progress = computeProgress(requirements);
  return {
    tasks: rows.map((t) => ({ ...t, progress: progress.get(t.id) ?? NO_REQUIREMENTS })),
    requirements,
  };
}

/** The workspace's decision order: the earliest request first, unrecorded request times last. */
const WORKSPACE_DECISION_ORDER = [
  sql`${ownerDecisions.requested_at} asc nulls last`,
  ownerDecisions.id,
];

export async function listWorkspace(db: Db): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const { tasks, requirements } = await tasksWith(tx);
    const blocksOpenTask = exists(
      tx
        .select({ id: task.id })
        .from(task)
        .where(and(sql`${task.id} = any(${ownerDecisions.blocks})`, isOpen)),
    );
    const decisions = await tx
      .select()
      .from(ownerDecisions)
      .where(or(eq(ownerDecisions.status, "Pending"), blocksOpenTask))
      .orderBy(...WORKSPACE_DECISION_ORDER);
    const agentRows = await tx.select().from(agents).orderBy(agents.id);
    const labels = await tx.select().from(statusLabels).orderBy(statusLabels.id);
    const repos = await tx.select().from(githubRepos).orderBy(githubRepos.name);
    const feed = await queryUpdates(tx, parse(updateQueryInput, {}));
    const decisionCounts = await countDecisions(tx, parse(decisionQueryInput, {}));
    return {
      tasks,
      updates: feed.items,
      updatesCursor: feed.nextCursor,
      requirements,
      decisions,
      agents: agentRows,
      statusLabels: labels,
      repos,
      counts: { updates: feed.counts, decisions: decisionCounts },
    };
  }, SNAPSHOT);
}

export async function getTask(db: Db, taskId: string): Promise<TaskDetail> {
  return db.transaction(async (tx) => {
    const {
      tasks: [found],
      requirements,
    } = await tasksWith(tx, eq(task.id, taskId));
    if (!found) throw ServiceError.notFound("Task", taskId);
    const decisions = await tx
      .select()
      .from(ownerDecisions)
      .where(arrayContains(ownerDecisions.blocks, [taskId]))
      .orderBy(...WORKSPACE_DECISION_ORDER);
    return { task: found, requirements, decisions };
  }, SNAPSHOT);
}

export async function myWork(db: Db, actor: Actor | null, agentId?: string): Promise<MyWork> {
  const who = agentId ?? actor?.agentId;
  if (who === undefined) {
    throw ServiceError.invalid("agentId is required when no bearer key is sent.", [
      { path: "agentId", message: "required without a bearer key" },
    ]);
  }
  return db.transaction(async (tx) => {
    const [agent] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, who));
    if (!agent) throw ServiceError.notFound("Agent", who);
    const { tasks, requirements } = await tasksWith(tx, and(eq(task.agent, who), isOpen));
    const taskIds = tasks.map((t) => t.id);
    const pendingDecisions = await tx
      .select()
      .from(ownerDecisions)
      .where(
        and(
          eq(ownerDecisions.status, "Pending"),
          or(
            eq(ownerDecisions.requested_by, who),
            taskIds.length === 0 ? undefined : arrayOverlaps(ownerDecisions.blocks, taskIds),
          ),
        ),
      )
      .orderBy(...WORKSPACE_DECISION_ORDER);
    return {
      agentId: who,
      tasks,
      openRequirements: requirements.filter((r) => r.state !== "PASS"),
      pendingDecisions,
    };
  }, SNAPSHOT);
}

export async function listUpdates(db: Db, raw: unknown): Promise<UpdatesPage> {
  const query = parse(updateQueryInput, raw);
  if (query.taskId !== undefined && query.taskIds !== undefined) {
    throw ServiceError.invalid("Give taskId or taskIds, not both.", [
      { path: "taskIds", message: "cannot be combined with taskId" },
    ]);
  }
  if (
    query.attention !== undefined &&
    (query.taskId !== undefined || query.taskIds !== undefined)
  ) {
    throw ServiceError.invalid("Give attention or a task, not both.", [
      { path: "attention", message: "cannot be combined with taskId or taskIds" },
    ]);
  }
  return db.transaction((tx) => queryUpdates(tx, query), SNAPSHOT);
}

type UpdateFacet = "agent" | "task" | "source";

const needsAttention = (reason: Attention) =>
  sql`${taskUpdates.task_id} in (select ${task.id} from ${task} where ${attends(reason)})`;

/**
 * `taskIds` and `attention` belong to the task facet with `taskId`, so `byTask` drops them and every other count
 * applies them.
 */
function updateFilters(query: Parsed<typeof updateQueryInput>, except?: UpdateFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "agent" && query.agentId !== undefined
      ? eq(taskUpdates.agent_id, query.agentId)
      : undefined,
    except !== "task" && query.taskId !== undefined
      ? eq(taskUpdates.task_id, query.taskId)
      : undefined,
    except !== "task" && query.taskIds !== undefined
      ? inArray(taskUpdates.task_id, query.taskIds)
      : undefined,
    except !== "task" && query.attention !== undefined
      ? needsAttention(query.attention)
      : undefined,
    except !== "source" && query.source !== undefined
      ? eq(taskUpdates.source, query.source)
      : undefined,
    query.since !== undefined ? gte(taskUpdates.created_at, query.since) : undefined,
    query.until !== undefined ? lt(taskUpdates.created_at, query.until) : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

function olderThan(
  createdAt: typeof taskUpdates.created_at | typeof activityLog.created_at,
  id: typeof taskUpdates.id | typeof activityLog.id,
  cursor: string | undefined,
): SQL | undefined {
  if (cursor === undefined) return undefined;
  const [createdAtKey, idKey] = decodeCursor(feedCursor, cursor);
  return sql`(${createdAt}, ${id}) < (${createdAtKey}::timestamptz, ${idKey}::uuid)`;
}

const feedKey = (row: { readonly created_at: string; readonly id: string }): FeedKey => [
  row.created_at,
  row.id,
];

/** Fetches one row past `limit`; only that row's presence shows a next page exists. */
async function page<T>(
  query: { limit(n: number): PromiseLike<T[]> },
  limit: number,
  key: (row: T) => FeedKey | DecisionKey | HistoryKey,
): Promise<Page<T>> {
  const rows = await query.limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(key(last)) : null,
  };
}

const count = sql<number>`count(*)::int`.mapWith(Number);

async function queryUpdates(tx: Tx, query: Parsed<typeof updateQueryInput>): Promise<UpdatesPage> {
  const filters = updateFilters(query);
  const feed = await page(
    tx
      .select()
      .from(taskUpdates)
      .where(and(...filters, olderThan(taskUpdates.created_at, taskUpdates.id, query.cursor)))
      .orderBy(desc(taskUpdates.created_at), desc(taskUpdates.id)),
    query.limit,
    feedKey,
  );
  const [total] = await tx
    .select({ n: count })
    .from(taskUpdates)
    .where(and(...filters));
  const byAgent = await tx
    .select({ key: taskUpdates.agent_id, n: count })
    .from(taskUpdates)
    .where(and(...updateFilters(query, "agent")))
    .groupBy(taskUpdates.agent_id);
  const byTask = await tx
    .select({ key: taskUpdates.task_id, n: count })
    .from(taskUpdates)
    .where(and(...updateFilters(query, "task")))
    .groupBy(taskUpdates.task_id);
  const bySource = await tx
    .select({ key: taskUpdates.source, n: count })
    .from(taskUpdates)
    .where(and(...updateFilters(query, "source"), isNotNull(taskUpdates.source)))
    .groupBy(taskUpdates.source);
  const counts: UpdateCounts = {
    total: total?.n ?? 0,
    byAgent: Object.fromEntries(byAgent.map((r) => [r.key, r.n])),
    byTask: Object.fromEntries(byTask.map((r) => [r.key, r.n])),
    bySource: Object.fromEntries(bySource.flatMap((r) => (r.key === null ? [] : [[r.key, r.n]]))),
  };
  return { ...feed, counts };
}

type ActivityFacet = "actor" | "entity";

/** Each facet count drops only its own filter; `entityId` and `since` always apply, as `since`/`until` do for updates. */
function activityFilters(query: Parsed<typeof activityQueryInput>, except?: ActivityFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "actor" && query.actor !== undefined
      ? eq(activityLog.actor, query.actor)
      : undefined,
    except !== "entity" && query.entity !== undefined
      ? eq(activityLog.entity, query.entity)
      : undefined,
    query.entityId !== undefined ? eq(activityLog.entity_id, query.entityId) : undefined,
    query.since !== undefined ? gte(activityLog.created_at, query.since) : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

export async function listActivity(db: Db, raw: unknown): Promise<ActivityPage> {
  const query = parse(activityQueryInput, raw);
  return db.transaction(async (tx) => {
    const filters = activityFilters(query);
    const entries = await page(
      tx
        .select()
        .from(activityLog)
        .where(and(...filters, olderThan(activityLog.created_at, activityLog.id, query.cursor)))
        .orderBy(desc(activityLog.created_at), desc(activityLog.id)),
      query.limit,
      feedKey,
    );
    const [total] = await tx
      .select({ n: count })
      .from(activityLog)
      .where(and(...filters));
    const byActor = await tx
      .select({ key: activityLog.actor, n: count })
      .from(activityLog)
      .where(and(...activityFilters(query, "actor")))
      .groupBy(activityLog.actor);
    const byEntity = await tx
      .select({ key: activityLog.entity, n: count })
      .from(activityLog)
      .where(and(...activityFilters(query, "entity")))
      .groupBy(activityLog.entity);
    const counts: ActivityCounts = {
      total: total?.n ?? 0,
      byActor: Object.fromEntries(byActor.map((r) => [r.key, r.n])),
      byEntity: Object.fromEntries(byEntity.map((r) => [r.key, r.n])),
    };
    const items = entries.items.map((entry) => ({
      ...entry,
      revertible: revertRefusal(entry) === null,
    }));
    return { items, nextCursor: entries.nextCursor, counts };
  }, SNAPSHOT);
}

export async function getDecision(db: Db, decisionId: string): Promise<Decision> {
  return db.transaction(async (tx) => {
    const [decision] = await tx
      .select()
      .from(ownerDecisions)
      .where(eq(ownerDecisions.id, decisionId));
    if (!decision) throw ServiceError.notFound("Decision", decisionId);
    return decision;
  }, SNAPSHOT);
}

/**
 * requested_at and decided_at may be null (not recorded), so they sort as -infinity: each order stays total, and its
 * cursor compares the same expressions as one row value.
 */
const pendingFirst = sql<boolean>`(${ownerDecisions.status} = 'Pending')`;
const requestedAt = sql<string>`coalesce(${ownerDecisions.requested_at}, '-infinity'::timestamptz)`;
const decidedAt = sql<string>`coalesce(${ownerDecisions.decided_at}, '-infinity'::timestamptz)`;

type DecisionOrder = {
  readonly orderBy: readonly SQL[];
  after(cursor: string | undefined): SQL | undefined;
  key(row: Decision): DecisionKey | HistoryKey;
};

/** Pending first, then the latest request. */
const PENDING_FIRST: DecisionOrder = {
  orderBy: [desc(pendingFirst), desc(requestedAt), desc(ownerDecisions.id)],
  after(cursor) {
    if (cursor === undefined) return undefined;
    const [pending, requested, id] = decodeCursor(decisionCursor, cursor);
    return sql`(${pendingFirst}, ${requestedAt}, ${ownerDecisions.id}) < (${pending}::boolean, ${requested}::timestamptz, ${id}::text)`;
  },
  key: (row) => [row.status === "Pending", row.requested_at ?? "-infinity", row.id],
};

/** P3-5: a history lists the newest decision first. */
const NEWEST_DECIDED: DecisionOrder = {
  orderBy: [desc(decidedAt), desc(ownerDecisions.id)],
  after(cursor) {
    if (cursor === undefined) return undefined;
    const [, decided, id] = decodeCursor(historyCursor, cursor);
    return sql`(${decidedAt}, ${ownerDecisions.id}) < (${decided}::timestamptz, ${id}::text)`;
  },
  key: (row) => ["decided", row.decided_at ?? "-infinity", row.id],
};

type DecisionFacet = "gateType" | "status";
type DecisionQuery = Parsed<typeof decisionQueryInput>;

/** A status filter that admits no Pending decision is a history. */
function decisionOrder(status: DecisionQuery["status"]): DecisionOrder {
  return status === undefined || status === "Pending" ? PENDING_FIRST : NEWEST_DECIDED;
}

function statusFilter(status: NonNullable<DecisionQuery["status"]>): SQL {
  return status === "not_pending"
    ? ne(ownerDecisions.status, "Pending")
    : eq(ownerDecisions.status, status);
}

function decisionFilters(query: DecisionQuery, except?: DecisionFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "gateType" && query.gateType !== undefined
      ? eq(ownerDecisions.gate_type, query.gateType)
      : undefined,
    except !== "status" && query.status !== undefined ? statusFilter(query.status) : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

async function countDecisions(
  tx: Tx,
  query: Parsed<typeof decisionQueryInput>,
): Promise<DecisionCounts> {
  const [total] = await tx
    .select({ n: count })
    .from(ownerDecisions)
    .where(and(...decisionFilters(query)));
  const byGateType = await tx
    .select({ key: ownerDecisions.gate_type, n: count })
    .from(ownerDecisions)
    .where(and(...decisionFilters(query, "gateType")))
    .groupBy(ownerDecisions.gate_type);
  const byStatus = await tx
    .select({ key: ownerDecisions.status, n: count })
    .from(ownerDecisions)
    .where(and(...decisionFilters(query, "status")))
    .groupBy(ownerDecisions.status);
  return {
    total: total?.n ?? 0,
    byGateType: Object.fromEntries(byGateType.map((r) => [r.key, r.n])),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.key, r.n])),
  };
}

export async function listDecisions(db: Db, raw: unknown): Promise<DecisionsPage> {
  const query = parse(decisionQueryInput, raw);
  const order = decisionOrder(query.status);
  return db.transaction(async (tx) => {
    const decisions = await page(
      tx
        .select()
        .from(ownerDecisions)
        .where(and(...decisionFilters(query), order.after(query.cursor)))
        .orderBy(...order.orderBy),
      query.limit,
      (row) => order.key(row),
    );
    return { ...decisions, counts: await countDecisions(tx, query) };
  }, SNAPSHOT);
}
