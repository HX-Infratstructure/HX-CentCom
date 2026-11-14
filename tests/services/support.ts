// Test harness for the service-layer acceptance tests (SPEC §4, §7). This is the only file that knows the services'
// module paths and return shapes; every test file goes through it, and checks database state with plain SQL
// against the SPEC §3 table and column names wherever it can. It uses only the public exports of
// @/server/services and @/server/db/test-db.
import { expect } from "vitest";
import { createTestDb } from "@/server/db/test-db";
import {
  isServiceError,
  type Actor,
  type ErrorCode,
  type ServiceError,
  type Services,
} from "@/server/services";

// SPEC §2: agents CC1 and CC2 (role agent) and the owner Agent Zero (role owner), by agent id.
export const IDS = { CC1: "CC1", CC2: "CC2", OWNER: "Agent Zero" } as const;
export type ActorName = keyof typeof IDS;

type Row = Record<string, unknown>;
type PgClient = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

export interface Harness {
  readonly svc: Services;
  /** Actors resolved from real keys through resolveActor, as every transport gets them. */
  readonly as: Readonly<Record<ActorName, Actor>>;
  q<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Exactly one row, or the test fails. */
  one<T = Row>(text: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
}

/** A private, migrated and seeded database per call (SPEC §2: PGlite through createTestDb). */
export async function setup(): Promise<Harness> {
  const t = await createTestDb();
  // The drizzle PGlite handle keeps its driver on $client; Db's public type does not name it.
  const client = (t.db as unknown as { $client: PgClient }).$client;
  const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(text, params)).rows as T[];
  return {
    svc: t.services,
    as: {
      CC1: await t.actorFor(IDS.CC1),
      CC2: await t.actorFor(IDS.CC2),
      OWNER: await t.actorFor(IDS.OWNER),
    },
    q,
    one: async <T = Row>(text: string, params: unknown[] = []): Promise<T> => {
      const rows = await q<T>(text, params);
      expect(rows, text).toHaveLength(1);
      return rows[0] as T;
    },
    close: () => t.close(),
  };
}

/**
 * A request body the TypeScript input type forbids (a missing, extra or wrong field), sent on purpose to test the
 * runtime check behind it. The services parse every body at runtime because REST and MCP callers are untyped.
 */
export function loose<T>(body: Row): T {
  return body as T;
}

export async function expectServiceError(
  call: Promise<unknown>,
  code: ErrorCode,
  status: number,
): Promise<ServiceError> {
  let caught: unknown;
  try {
    await call;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected a ${code} (${status}) error, but the call succeeded`).toBeDefined();
  if (!isServiceError(caught)) throw caught;
  expect({ code: caught.code, status: caught.status }, caught.message).toEqual({ code, status });
  expect(typeof caught.message).toBe("string");
  return caught;
}

/** SPEC §4: version_conflict carries the current version. */
export function conflictVersion(err: ServiceError): number {
  const body = err.body;
  if (body.code !== "version_conflict") throw new Error(`not a version_conflict: ${body.code}`);
  return body.currentVersion;
}

/** SPEC §3: progress is computed, PASS over total. Returned as the fraction, whatever scale the services report. */
export async function taskProgress(h: Harness, taskId: string): Promise<number> {
  const ws = await h.svc.listWorkspace();
  const task = ws.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`listWorkspace has no task ${taskId}`);
  const { proven, total } = task.progress;
  expect(total).toBeGreaterThan(0);
  return proven / total;
}

export async function count(
  h: Harness,
  table: string,
  where = "true",
  params: unknown[] = [],
): Promise<number> {
  const row = await h.one<{ n: number | string }>(
    `select count(*)::int as n from ${table} where ${where}`,
    params,
  );
  return Number(row.n);
}
