/**
 * Updates and activity page on (created_at desc, id desc): the cursor carries the row's exact `created_at` string and
 * its id, and PostgreSQL compares the stored values; rows of one write share that write's clock reading, and the id
 * breaks the tie. Each read runs in one REPEATABLE READ, READ ONLY transaction, so its items and counts come from one
 * snapshot.
 */
import { and, desc, eq, gte, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
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
import { ServiceError } from "./errors";
import {
  activityQueryInput,
  decisionQueryInput,
  parse,
  updateQueryInput,
  type Parsed,
} from "./inputs";
import type {
  ActivityEntry,
  Decision,
  DecisionCounts,
  DecisionsPage,
  Page,
  Progress,
  UpdateCounts,
  UpdatesPage,
  Workspace,
} from "./types";

const SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

const isoMicros = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
const feedCursor = z.tuple([isoMicros, z.string().uuid()]);
const decisionCursor = z.tuple([
  z.boolean(),
  z.union([isoMicros, z.literal("-infinity")]),
  z.string().min(1).max(100),
]);

type FeedKey = z.output<typeof feedCursor>;
type DecisionKey = z.output<typeof decisionCursor>;

function encodeCursor(key: FeedKey | DecisionKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor<S extends typeof feedCursor | typeof decisionCursor>(
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

export async function listWorkspace(db: Db): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const taskRows = await tx
      .select()
      .from(engineeringTasks)
      .orderBy(sql`${engineeringTasks.start_date} asc nulls last`, engineeringTasks.id);
    const requirements = await tx
      .select()
      .from(taskRequirements)
      .orderBy(taskRequirements.task_id, taskRequirements.created_at, taskRequirements.id);
    const decisions = await tx
      .select()
      .from(ownerDecisions)
      .orderBy(sql`${ownerDecisions.requested_at} asc nulls last`, ownerDecisions.id);
    const agentRows = await tx.select().from(agents).orderBy(agents.id);
    const labels = await tx.select().from(statusLabels).orderBy(statusLabels.id);
    const prs = await tx.select().from(githubPrs).orderBy(githubPrs.repo, githubPrs.number);
    const repos = await tx.select().from(githubRepos).orderBy(githubRepos.name);
    const feed = await queryUpdates(tx, parse(updateQueryInput, {}));
    const decisionCounts = await countDecisions(tx, parse(decisionQueryInput, {}));
    const progress = computeProgress(requirements);
    return {
      tasks: taskRows.map((t) => ({ ...t, progress: progress.get(t.id) ?? NO_REQUIREMENTS })),
      updates: feed.items,
      updatesCursor: feed.nextCursor,
      requirements,
      decisions,
      agents: agentRows,
      statusLabels: labels,
      prs,
      repos,
      counts: { updates: feed.counts, decisions: decisionCounts },
    };
  }, SNAPSHOT);
}

export async function listUpdates(db: Db, raw: unknown): Promise<UpdatesPage> {
  const query = parse(updateQueryInput, raw);
  return db.transaction((tx) => queryUpdates(tx, query), SNAPSHOT);
}

type UpdateFacet = "agent" | "task" | "source";

function updateFilters(query: Parsed<typeof updateQueryInput>, except?: UpdateFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "agent" && query.agentId !== undefined
      ? eq(taskUpdates.agent_id, query.agentId)
      : undefined,
    except !== "task" && query.taskId !== undefined
      ? eq(taskUpdates.task_id, query.taskId)
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
  key: (row: T) => FeedKey | DecisionKey,
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

export async function listActivity(db: Db, raw: unknown): Promise<Page<ActivityEntry>> {
  const query = parse(activityQueryInput, raw);
  return db.transaction(
    (tx) =>
      page(
        tx
          .select()
          .from(activityLog)
          .where(
            and(
              query.actor !== undefined ? eq(activityLog.actor, query.actor) : undefined,
              query.entity !== undefined ? eq(activityLog.entity, query.entity) : undefined,
              query.entityId !== undefined ? eq(activityLog.entity_id, query.entityId) : undefined,
              query.since !== undefined ? gte(activityLog.created_at, query.since) : undefined,
              olderThan(activityLog.created_at, activityLog.id, query.cursor),
            ),
          )
          .orderBy(desc(activityLog.created_at), desc(activityLog.id)),
        query.limit,
        feedKey,
      ),
    SNAPSHOT,
  );
}

/**
 * requested_at may be null (not recorded), so it sorts as -infinity: the order stays total, and the cursor compares
 * the same three expressions as one row value.
 */
const pendingFirst = sql<boolean>`(${ownerDecisions.status} = 'Pending')`;
const requestedAt = sql<string>`coalesce(${ownerDecisions.requested_at}, '-infinity'::timestamptz)`;
const DECISION_ORDER = [desc(pendingFirst), desc(requestedAt), desc(ownerDecisions.id)];

const decisionKey = (row: Decision): DecisionKey => [
  row.status === "Pending",
  row.requested_at ?? "-infinity",
  row.id,
];

function afterDecision(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) return undefined;
  const [pending, requested, id] = decodeCursor(decisionCursor, cursor);
  return sql`(${pendingFirst}, ${requestedAt}, ${ownerDecisions.id}) < (${pending}::boolean, ${requested}::timestamptz, ${id}::text)`;
}

type DecisionFacet = "gateType" | "status";
type DecisionQuery = Parsed<typeof decisionQueryInput>;

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
  return db.transaction(async (tx) => {
    const decisions = await page(
      tx
        .select()
        .from(ownerDecisions)
        .where(and(...decisionFilters(query), afterDecision(query.cursor)))
        .orderBy(...DECISION_ORDER),
      query.limit,
      decisionKey,
    );
    return { ...decisions, counts: await countDecisions(tx, query) };
  }, SNAPSHOT);
}
