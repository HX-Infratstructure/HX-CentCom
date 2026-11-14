// B4's own test helpers (SPEC §8.1: tests never import another component's private helpers). They use only
// createTestDb, the public exports of @/server/services and B4's own route modules, and check database state with
// plain SQL against the SPEC §6.1 table and column names.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect } from "vitest";
import type { Db } from "@/server/db/client";
import { createTestDb } from "@/server/db/test-db";
import { Route as mcpRoute } from "@/routes/mcp";
import {
  isServiceError,
  type Actor,
  type ErrorCode,
  type ServiceError,
  type Services,
} from "@/server/services";

export const IDS = { CC1: "CC1", CC2: "CC2", CODEX: "Codex", OWNER: "Agent Zero" } as const;
export type ActorName = keyof typeof IDS;

export const WEB_SOURCE = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";
export const HX15_SOURCE =
  "hx15:/home/hxsa/agent-activity-compass.wt/docs/wu1-monday-reference/SPEC.md:247";

type Row = Record<string, unknown>;
type PgClient = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

export interface Fixture {
  readonly db: Db;
  readonly svc: Services;
  readonly as: Readonly<Record<ActorName, Actor>>;
  q<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(text: string, params?: unknown[]): Promise<T>;
  count(table: string, where?: string, params?: unknown[]): Promise<number>;
  /** An Authorization header value for a fresh key of the agent. */
  auth(agentId: string): Promise<string>;
  close(): Promise<void>;
}

/** A private, migrated and seeded database per call. */
export async function setup(): Promise<Fixture> {
  const t = await createTestDb();
  // The drizzle PGlite handle keeps its driver on $client; Db's public type does not name it.
  const client = (t.db as unknown as { $client: PgClient }).$client;
  const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(text, params)).rows as T[];
  const one = async <T = Row>(text: string, params: unknown[] = []): Promise<T> => {
    const rows = await q<T>(text, params);
    expect(rows, text).toHaveLength(1);
    return rows[0] as T;
  };
  return {
    db: t.db,
    svc: t.services,
    as: {
      CC1: await t.actorFor(IDS.CC1),
      CC2: await t.actorFor(IDS.CC2),
      CODEX: await t.actorFor(IDS.CODEX),
      OWNER: await t.actorFor(IDS.OWNER),
    },
    q,
    one,
    count: async (table, where = "true", params = []) =>
      (await one<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`, params))
        .n,
    auth: async (agentId) => `Bearer ${await t.keyFor(agentId)}`,
    close: () => t.close(),
  };
}

/** A body the TypeScript input type forbids, sent on purpose to test the runtime check behind it. */
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
  return caught;
}

export function issuePaths(error: ServiceError): string[] {
  const body = error.body;
  return body.code === "invalid" ? body.issues.map((i) => i.path) : [];
}

export async function expectInvalidAt(call: Promise<unknown>, path: string): Promise<ServiceError> {
  const error = await expectServiceError(call, "invalid", 400);
  expect(issuePaths(error), error.message).toContain(path);
  return error;
}

/** Runs raw SQL that must fail on the named constraint. */
export async function expectViolation(run: Promise<unknown>, constraint: string): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (err) {
    caught = err;
  }
  expect(
    caught,
    `expected a violation of ${constraint}, but the statement succeeded`,
  ).toBeDefined();
  expect(String((caught as Error).message)).toContain(constraint);
}

export const ORIGIN = "http://centcom.test";

export type ServerRoute = {
  readonly options: { readonly server?: { readonly handlers?: unknown } };
};

type AnyHandler = (ctx: {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly context: { readonly services: Services };
  readonly pathname: string;
  readonly next: () => never;
}) => Response | Promise<Response>;

export type RestInit = {
  readonly params?: Readonly<Record<string, string>>;
  readonly authorization?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

/** Calls a route module's ANY handler with a real Request, as TanStack Start does. */
export function rest(
  services: Services,
  route: ServerRoute,
  method: string,
  path: string,
  init: RestInit = {},
  prebuilt?: Request,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.authorization !== undefined) headers.set("authorization", init.authorization);
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  const request =
    prebuilt ??
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  const handlers = route.options.server?.handlers as { readonly ANY: AnyHandler };
  return Promise.resolve(
    handlers.ANY({
      request,
      params: init.params ?? {},
      context: { services },
      pathname: new URL(request.url).pathname,
      next: () => {
        throw new Error("B4 handlers never call next()");
      },
    }),
  );
}

/** An MCP client on the /mcp route, without a network. Close it before the database. */
export async function mcpClient(services: Services, authorization?: string): Promise<Client> {
  const client = new Client({ name: "hx-centcom-raid-tests", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      fetch: (url, init) => rest(services, mcpRoute, "POST", "/mcp", {}, new Request(url, init)),
      ...(authorization === undefined ? {} : { requestInit: { headers: { authorization } } }),
    }),
  );
  return client;
}

type ToolResult = {
  readonly isError?: boolean;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly structuredContent?: unknown;
  readonly _meta?: Row;
};

export function toolValue<T = Row>(result: unknown): T {
  const r = result as ToolResult;
  expect(r.isError, `the tool call succeeded: ${JSON.stringify(r.content)}`).toBeFalsy();
  expect(
    JSON.parse(r.content?.[0]?.text ?? "null"),
    "the text block equals structuredContent",
  ).toEqual(r.structuredContent);
  return r.structuredContent as T;
}

export function toolError(result: unknown): { code: string; status: number; message: string } {
  const r = result as ToolResult;
  expect(r.isError, "the tool call failed").toBe(true);
  return (r.structuredContent as { error: { code: string; status: number; message: string } })
    .error;
}

export function toolMeta(result: unknown): Row | undefined {
  return (result as ToolResult)._meta;
}
