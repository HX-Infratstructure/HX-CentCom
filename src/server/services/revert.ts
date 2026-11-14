/**
 * F5: the owner's revert of one logged update, by its activity id. The activity row is the record: its `before` is the
 * snapshot to restore and its `after.version` the version the entity must still have. A revert row keeps its target's
 * entity and shapes, so the entity's feed shows it and it can be reverted in turn.
 */
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import {
  activityLog,
  engineeringTasks,
  taskRequirements,
  type ActivityAction,
  type ActivityEntity,
  type Json,
} from "@/server/db/schema";
import { lessons, raidItems } from "@/server/db/schema-raid";
import { authenticated, type Actor } from "./actor";
import { ServiceError } from "./errors";
import { parse } from "./inputs";
import type { RootRef, UpdatePlan } from "./pipeline";
import { gate } from "./policy";
import type { ActivityEntry, RevertResult, TaskUpdate } from "./types";

/** Like POLICY, it covers every action, so a new action does not compile until it says whether a revert undoes it. */
const REVERTIBLE: Readonly<Record<ActivityAction, true | string>> = {
  "task.progress": true,
  "requirement.set": true,
  "decision.request": "a create has nothing to restore",
  "decision.decide": "supersede the decision instead",
  "key.issue": "key actions are not reverted",
  "key.revoke": "key actions are not reverted",
  "key.bootstrap": "key actions are not reverted",
  "raid.create": "a create has nothing to restore",
  "raid.update": true,
  "lesson.create": "a create has nothing to restore",
  "lesson.update": true,
  "activity.revert": true,
};

const TABLES = {
  task: engineeringTasks,
  requirement: taskRequirements,
  raid_item: raidItems,
  lesson: lessons,
} as const satisfies Partial<Record<ActivityEntity, unknown>>;
type RevertibleEntity = keyof typeof TABLES;
type RevertibleTable = (typeof TABLES)[RevertibleEntity];

/** Who wrote the row and when stay as they are; the writer stamps the version and updated_at. */
const NEVER_RESTORED: ReadonlySet<string> = new Set([
  "id",
  "version",
  "created_at",
  "created_by",
  "updated_at",
]);

const revertInput = z.object({ activityId: z.string().uuid() });

type Snapshot = { readonly [key: string]: Json };

function isSnapshot(value: Json | null | undefined): value is Snapshot {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}

function snapshotOf(value: Json | null, what: string): Snapshot {
  if (!isSnapshot(value)) throw new Error(`${what} is not a row snapshot`);
  return value;
}

function isRevertible(entity: ActivityEntity): entity is RevertibleEntity {
  return Object.hasOwn(TABLES, entity);
}

/** A restored row cannot undo what the write's automations did: a decision opened, updates posted, a task unblocked. */
function refusal(target: ActivityEntry): string | null {
  const rule = REVERTIBLE[target.action];
  if (rule !== true) return rule;
  if (target.before === null) return "a create has nothing to restore";
  const effects = isSnapshot(target.after) ? target.after["effects"] : undefined;
  if (isSnapshot(effects) && Object.keys(effects).length > 0) {
    return `restoring the row cannot undo its effects (${Object.keys(effects).join(", ")})`;
  }
  return null;
}

/** The root the writer locks: a requirement's task, as setRequirementPlan locks it. */
function rootOf(entity: RevertibleEntity, entityId: string, after: Snapshot): RootRef {
  switch (entity) {
    case "task":
    case "raid_item":
    case "lesson":
      return { kind: entity, id: entityId };
    case "requirement": {
      const taskId = after["task_id"];
      if (typeof taskId !== "string") throw new Error(`requirement ${entityId} names no task`);
      return { kind: "task", id: taskId };
    }
  }
}

/** The snapshot's columns of `table`, minus the ones a revert never writes. */
function restorable(table: RevertibleTable, snapshot: Snapshot): Snapshot {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    Object.entries(snapshot).filter(
      ([key]) => Object.hasOwn(columns, key) && !NEVER_RESTORED.has(key),
    ),
  );
}

/** `row` cut to the keys of the target's snapshot, so a revert row has its target's shapes. */
function inShapeOf(snapshot: Snapshot, row: object): Snapshot {
  const values = row as Record<string, Json>;
  return Object.fromEntries(
    Object.keys(snapshot).flatMap((k) =>
      Object.hasOwn(values, k) ? [[k, values[k] ?? null]] : [],
    ),
  );
}

async function updateRow(
  tx: Tx,
  table: RevertibleTable,
  id: string,
  values: Record<string, unknown>,
): Promise<RevertibleTable["$inferSelect"]> {
  const [row] = await tx
    .update(table)
    .set(values as PgUpdateSetSource<RevertibleTable>)
    .where(eq(table.id, id))
    .returning();
  if (!row) throw new Error(`${id} vanished during its revert`);
  return row;
}

/**
 * Built before the writer runs, because the root is part of the request hash. Activity rows are append-only (0001
 * trigger), so reading the target outside the transaction is safe; the version check runs inside it.
 */
export async function revertPlan(
  db: Db,
  actor: Actor | null,
  activityId: string,
): Promise<UpdatePlan<typeof revertInput, RootRef, RevertResult>> {
  gate(authenticated(actor), "activity.revert");
  const { activityId: id } = parse(revertInput, { activityId });
  const [target] = await db.select().from(activityLog).where(eq(activityLog.id, id));
  if (!target) throw ServiceError.notFound("Activity", id);
  const reason = refusal(target);
  if (reason !== null) throw ServiceError.notRevertible(id, reason);
  const { entity, entity_id: entityId } = target;
  if (!isRevertible(entity)) throw ServiceError.notRevertible(id, `a ${entity} is not reverted`);
  const before = snapshotOf(target.before, `the before of activity ${id}`);
  const after = snapshotOf(target.after, `the after of activity ${id}`);
  const recordedVersion = after["version"];
  if (typeof recordedVersion !== "number") throw new Error(`activity ${id} records no version`);
  const table = TABLES[entity];
  return {
    action: "activity.revert",
    input: revertInput,
    root: rootOf(entity, entityId, after),
    async apply(tx, ctx) {
      const current =
        entity === "requirement"
          ? (await tx.select().from(taskRequirements).where(eq(taskRequirements.id, entityId)))[0]
          : ctx.before;
      if (!current) throw new Error(`requirement ${entityId} vanished`);
      if (current.version !== recordedVersion) throw ServiceError.versionConflict(current.version);
      const row = await updateRow(tx, table, entityId, {
        ...restorable(table, before),
        ...(Object.hasOwn(getTableColumns(table), "updated_by")
          ? { updated_by: ctx.actor.agentId }
          : {}),
        ...(entity === "requirement" ? { version: sql`${taskRequirements.version} + 1` } : {}),
      });
      const restored = inShapeOf(before, row);
      const systemUpdates: TaskUpdate[] =
        entity === "task"
          ? await ctx.insertUpdates([
              {
                task_id: entityId,
                kind: "system",
                status: null,
                note: `Owner reverted ${target.action} ${id.slice(0, 8)}: status back to ${String(restored["status"])}.`,
                links: [],
                source: null,
              },
            ])
          : [];
      const [systemUpdate] = systemUpdates;
      return {
        status: 200,
        value: { reverted: id, entity, entityId, version: row.version, systemUpdates },
        activity: {
          entity,
          entityId,
          before: inShapeOf(before, current),
          after: {
            ...restored,
            ...(systemUpdate ? { update_id: systemUpdate.id } : {}),
            reverts: id,
          },
        },
      };
    },
  };
}
