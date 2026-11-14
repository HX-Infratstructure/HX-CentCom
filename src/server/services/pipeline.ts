/**
 * Replay sits before 404/403/409 so that a client retrying a committed write gets its original answer, not a 409
 * caused by its own first attempt. A failed write rolls back its claim, so errors are never replayed.
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import {
  activityLog,
  engineeringTasks,
  idempotency,
  ownerDecisions,
  taskUpdates,
  type ActivityAction,
  type ActivityEntity,
  type Json,
} from "@/server/db/schema";
import { lessons, raidItems } from "@/server/db/schema-raid";
import { authenticated, type Actor } from "./actor";
import { isServiceError, ServiceError, type Issue } from "./errors";
import { parse } from "./inputs";
import { authorize, gate } from "./policy";
import type {
  CreateOptions,
  Decision,
  MintedKey,
  ServiceDeps,
  TaskRow,
  TaskUpdate,
  UpdateOptions,
  WriteResult,
} from "./types";

export type ActivityRecord = {
  readonly entity: ActivityEntity;
  readonly entityId: string;
  readonly before: Json | null;
  readonly after: Json | null;
  readonly runId?: string | null | undefined;
  readonly commitSha?: string | null | undefined;
};

export type Applied<T extends Json> = {
  readonly status: 200 | 201;
  readonly value: T;
  readonly activity: ActivityRecord;
};

export type NewTaskUpdate = Omit<typeof taskUpdates.$inferInsert, "id" | "agent_id" | "created_at">;

type RootRows = {
  readonly task: TaskRow;
  readonly decision: Decision;
  readonly raid_item: typeof raidItems.$inferSelect;
  readonly lesson: typeof lessons.$inferSelect;
};
type RootKind = keyof RootRows;

export type RootRef = {
  readonly [K in RootKind]: { readonly kind: K; readonly id: string };
}[RootKind];
export type RootRow<R extends RootRef> = RootRows[R["kind"]];
/** A root read FOR UPDATE, tagged with its kind so that `authorize` can tell whose row it is. */
export type LockedRoot = {
  readonly [K in RootKind]: { readonly kind: K; readonly row: RootRows[K] };
}[RootKind];

type WriteEnv = {
  readonly at: string;
  mintKey(agentId: string): MintedKey;
};

export type WriteContext<I> = WriteEnv & {
  readonly actor: Actor;
  readonly input: I;
  insertUpdates(rows: readonly NewTaskUpdate[]): Promise<TaskUpdate[]>;
};

export interface UpdatePlan<S extends z.ZodTypeAny, R extends RootRef, T extends Json> {
  readonly action: ActivityAction;
  readonly input: S;
  readonly root: R;
  apply(
    tx: Tx,
    ctx: WriteContext<z.output<S>> & {
      readonly before: RootRow<R>;
      readonly bumpedVersion: number;
    },
  ): Promise<Applied<T>>;
}

export interface CreatePlan<S extends z.ZodTypeAny, T extends Json> {
  readonly action: ActivityAction;
  readonly input: S;
  apply(tx: Tx, ctx: WriteContext<z.output<S>>): Promise<Applied<T>>;
}

export interface BootstrapPlan<S extends z.ZodTypeAny, T extends Json> {
  readonly action: "key.bootstrap";
  readonly input: S;
  apply(
    tx: Tx,
    ctx: WriteEnv & { readonly input: z.output<S> },
  ): Promise<Applied<T> & { readonly actorId: string }>;
}

export interface Writer {
  update<S extends z.ZodTypeAny, R extends RootRef, T extends Json>(
    actor: Actor | null,
    raw: unknown,
    opts: UpdateOptions,
    plan: UpdatePlan<S, R, T>,
  ): Promise<WriteResult<T>>;
  create<S extends z.ZodTypeAny, T extends Json>(
    actor: Actor | null,
    raw: unknown,
    opts: CreateOptions,
    plan: CreatePlan<S, T>,
  ): Promise<WriteResult<T>>;
  keys<S extends z.ZodTypeAny, T extends Json>(
    actor: Actor | null,
    raw: unknown,
    plan: CreatePlan<S, T>,
  ): Promise<T>;
  bootstrap<S extends z.ZodTypeAny, T extends Json>(
    raw: unknown,
    plan: BootstrapPlan<S, T>,
  ): Promise<T>;
}

export function createWriter(db: Db, deps: ServiceDeps): Writer {
  const writeEnv = (): WriteEnv => ({ at: deps.now().toISOString(), mintKey: deps.mintKey });
  return {
    async update(actorOrNull, raw, opts, plan) {
      const actor = authenticated(actorOrNull);
      gate(actor, plan.action);
      const input = parseUpdate(plan.input, raw, opts.expectedVersion);
      const key = idempotencyKey(opts.idempotencyKey);
      const expectedVersion = checkedVersion(opts.expectedVersion);
      const hash = requestHash({ action: plan.action, root: plan.root, input, expectedVersion });
      const env = writeEnv();
      return idempotentWrite(db, actor, plan.action, key, hash, env.at, async (tx) => {
        const locked = await lockRoot(tx, plan.root);
        authorize(actor, plan.action, locked);
        if (expectedVersion !== null && expectedVersion !== locked.row.version) {
          throw ServiceError.versionConflict(locked.row.version);
        }
        const bumpedVersion = await bumpRoot(tx, plan.root, env.at);
        return plan.apply(tx, {
          ...env,
          actor,
          input,
          // lockRoot read the row of plan.root's kind; TypeScript cannot narrow the union back to the plan's root.
          before: locked.row as RootRow<typeof plan.root>,
          bumpedVersion,
          insertUpdates: updateInserter(tx, actor, env.at),
        });
      });
    },

    async create(actorOrNull, raw, opts, plan) {
      const actor = authenticated(actorOrNull);
      gate(actor, plan.action);
      const input = parse(plan.input, raw);
      const key = idempotencyKey(opts.idempotencyKey);
      const hash = requestHash({ action: plan.action, root: null, input, expectedVersion: null });
      const env = writeEnv();
      return idempotentWrite(db, actor, plan.action, key, hash, env.at, async (tx) => {
        authorize(actor, plan.action, null);
        return plan.apply(tx, {
          ...env,
          actor,
          input,
          insertUpdates: updateInserter(tx, actor, env.at),
        });
      });
    },

    async keys(actorOrNull, raw, plan) {
      const actor = authenticated(actorOrNull);
      gate(actor, plan.action);
      const input = parse(plan.input, raw);
      const env = writeEnv();
      return db.transaction(async (tx) => {
        authorize(actor, plan.action, null);
        const applied = await plan.apply(tx, {
          ...env,
          actor,
          input,
          insertUpdates: updateInserter(tx, actor, env.at),
        });
        await insertActivity(tx, actor.agentId, plan.action, applied.activity, env.at);
        return applied.value;
      });
    },

    async bootstrap(raw, plan) {
      const input = parse(plan.input, raw);
      const env = writeEnv();
      return db.transaction(async (tx) => {
        const applied = await plan.apply(tx, { ...env, input });
        await insertActivity(tx, applied.actorId, plan.action, applied.activity, env.at);
        return applied.value;
      });
    },
  };
}

async function idempotentWrite<T extends Json>(
  db: Db,
  actor: Actor,
  action: ActivityAction,
  key: string | null,
  hash: string,
  at: string,
  body: (tx: Tx) => Promise<Applied<T>>,
): Promise<WriteResult<T>> {
  const result = await db.transaction(async (tx): Promise<WriteResult<T>> => {
    if (key !== null) {
      const prior = await claim(tx, key, actor.agentId, hash, at);
      if (prior) return prior as WriteResult<T>;
    }
    const applied = await body(tx);
    await insertActivity(tx, actor.agentId, action, applied.activity, at);
    if (key !== null) {
      await tx
        .update(idempotency)
        .set({ status: applied.status, response: applied.value })
        .where(and(eq(idempotency.key, key), eq(idempotency.actor, actor.agentId)));
    }
    return { value: applied.value, status: applied.status, replayed: false };
  });
  if (key !== null && !result.replayed) await pruneExpired(db, at);
  return result;
}

function idempotencyKey(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!/^[\x21-\x7e]{1,255}$/.test(raw)) {
    throw ServiceError.invalid("The Idempotency-Key is invalid.", [
      { path: "Idempotency-Key", message: "must be 1-255 visible ASCII characters" },
    ]);
  }
  return raw;
}

const IF_MATCH_ISSUE: Issue = { path: "If-Match", message: "must be a positive integer version" };

function malformedVersion(raw: number | undefined): boolean {
  return raw !== undefined && (!Number.isInteger(raw) || raw < 1);
}

function checkedVersion(raw: number | undefined): number | null {
  if (malformedVersion(raw)) {
    throw ServiceError.invalid("The expected version is invalid.", [IF_MATCH_ISSUE]);
  }
  return raw ?? null;
}

/** An invalid body beside a malformed If-Match is one 400 that lists both. */
function parseUpdate<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  expectedVersion: number | undefined,
): z.output<S> {
  try {
    return parse(schema, raw);
  } catch (error) {
    if (
      !malformedVersion(expectedVersion) ||
      !isServiceError(error) ||
      error.body.code !== "invalid"
    ) {
      throw error;
    }
    throw ServiceError.invalid(error.message, [...error.body.issues, IF_MATCH_ISSUE]);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((k) => record[k] !== undefined)
        .map((k) => [k, canonical(record[k])]),
    );
  }
  return value;
}

/**
 * sha256 over canonical JSON of the parsed input, so fields the service ignores cannot turn a retry into a 422.
 * The action and root make a key reused on another write a 422; a new If-Match is a new request. The actor is not
 * hashed: it is part of the idempotency primary key.
 */
function requestHash(request: {
  action: ActivityAction;
  root: RootRef | null;
  input: unknown;
  expectedVersion: number | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)), "utf8")
    .digest("hex");
}

/**
 * A returned row means this transaction owns the key: new, or expired and taken over. No row means a live row
 * exists. A concurrent first attempt holds its uncommitted row, so PostgreSQL makes this INSERT wait for it: after
 * a commit this request replays, after a rollback it runs the write itself.
 */
async function claim(
  tx: Tx,
  key: string,
  actor: string,
  hash: string,
  at: string,
): Promise<WriteResult<Json> | null> {
  const owned = await tx
    .insert(idempotency)
    .values({
      key,
      actor,
      request_hash: hash,
      status: 0,
      response: sql`'null'::jsonb`,
      created_at: at,
    })
    .onConflictDoUpdate({
      target: [idempotency.key, idempotency.actor],
      set: { request_hash: hash, status: 0, response: sql`'null'::jsonb`, created_at: at },
      setWhere: lt(idempotency.created_at, expiryCutoff(at)),
    })
    .returning({ key: idempotency.key });
  if (owned.length > 0) return null;
  const [row] = await tx
    .select({
      request_hash: idempotency.request_hash,
      status: idempotency.status,
      response: idempotency.response,
    })
    .from(idempotency)
    .where(and(eq(idempotency.key, key), eq(idempotency.actor, actor)));
  if (!row) throw new Error("idempotency row missing after a refused claim");
  if (row.request_hash !== hash) throw ServiceError.idempotencyMismatch();
  return { value: row.response, status: row.status as 200 | 201, replayed: true };
}

async function lockRoot(tx: Tx, root: RootRef): Promise<LockedRoot> {
  const one = async <T>(rows: PromiseLike<T[]>, noun: string): Promise<T> => {
    const [row] = await rows;
    if (!row) throw ServiceError.notFound(noun, root.id);
    return row;
  };
  switch (root.kind) {
    case "task":
      return {
        kind: root.kind,
        row: await one(
          tx.select().from(engineeringTasks).where(eq(engineeringTasks.id, root.id)).for("update"),
          "Task",
        ),
      };
    case "decision":
      return {
        kind: root.kind,
        row: await one(
          tx.select().from(ownerDecisions).where(eq(ownerDecisions.id, root.id)).for("update"),
          "Decision",
        ),
      };
    case "raid_item":
      return {
        kind: root.kind,
        row: await one(
          tx.select().from(raidItems).where(eq(raidItems.id, root.id)).for("update"),
          "RAID item",
        ),
      };
    case "lesson":
      return {
        kind: root.kind,
        row: await one(
          tx.select().from(lessons).where(eq(lessons.id, root.id)).for("update"),
          "Lesson",
        ),
      };
  }
}

/** A decision has no updated_at; the other roots record the write's time. */
async function bumpRoot(tx: Tx, root: RootRef, at: string): Promise<number> {
  const version = async (rows: PromiseLike<{ version: number }[]>): Promise<number> => {
    const [row] = await rows;
    if (!row) throw new Error(`locked ${root.kind} ${root.id} vanished`);
    return row.version;
  };
  switch (root.kind) {
    case "task":
      return version(
        tx
          .update(engineeringTasks)
          .set({ version: sql`${engineeringTasks.version} + 1`, updated_at: at })
          .where(eq(engineeringTasks.id, root.id))
          .returning({ version: engineeringTasks.version }),
      );
    case "decision":
      return version(
        tx
          .update(ownerDecisions)
          .set({ version: sql`${ownerDecisions.version} + 1` })
          .where(eq(ownerDecisions.id, root.id))
          .returning({ version: ownerDecisions.version }),
      );
    case "raid_item":
      return version(
        tx
          .update(raidItems)
          .set({ version: sql`${raidItems.version} + 1`, updated_at: at })
          .where(eq(raidItems.id, root.id))
          .returning({ version: raidItems.version }),
      );
    case "lesson":
      return version(
        tx
          .update(lessons)
          .set({ version: sql`${lessons.version} + 1`, updated_at: at })
          .where(eq(lessons.id, root.id))
          .returning({ version: lessons.version }),
      );
  }
}

function updateInserter(tx: Tx, actor: Actor, at: string): WriteContext<unknown>["insertUpdates"] {
  return async (rows) =>
    rows.length === 0
      ? []
      : tx
          .insert(taskUpdates)
          .values(rows.map((row) => ({ ...row, agent_id: actor.agentId, created_at: at })))
          .returning();
}

async function insertActivity(
  tx: Tx,
  actorId: string,
  action: ActivityAction,
  record: ActivityRecord,
  at: string,
): Promise<void> {
  await tx.insert(activityLog).values({
    actor: actorId,
    action,
    entity: record.entity,
    entity_id: record.entityId,
    before: record.before,
    after: record.after,
    run_id: record.runId ?? null,
    commit_sha: record.commitSha ?? null,
    created_at: at,
  });
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function expiryCutoff(at: string): string {
  return new Date(Date.parse(at) - IDEMPOTENCY_TTL_MS).toISOString();
}

async function pruneExpired(db: Db, at: string): Promise<void> {
  try {
    await db.delete(idempotency).where(lt(idempotency.created_at, expiryCutoff(at)));
  } catch (error) {
    console.error("idempotency prune failed", error);
  }
}
