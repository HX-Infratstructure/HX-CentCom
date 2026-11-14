import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect } from "vitest";
import { createTestDb } from "@/server/db/test-db";
import type { Services } from "@/server/services";
import { Route as updatesRoute } from "@/routes/api/v1/updates";
import { Route as mcpRoute } from "@/routes/mcp";

export const ORIGIN = "http://centcom.test";

export const UNKNOWN_KEY = `Bearer hxc_cc1_${"A".repeat(32)}`;

export const SOURCE_URL = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";

export const READ_TOOLS = [
  "get_task",
  "list_decisions",
  "list_lessons",
  "list_raid",
  "list_tasks",
  "list_updates",
  "my_work",
];
export const WRITE_TOOLS = [
  "add_lesson",
  "add_raid_item",
  "post_progress",
  "request_decision",
  "set_requirement",
  "update_raid_item",
];

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
  readonly authorization?: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

export type WireError = {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly currentVersion?: number;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
};

export type Json = Record<string, unknown>;

export interface Api {
  authFor(agentId: string): Promise<string>;
  rest(route: ServerRoute, method: string, path: string, init?: RestInit): Promise<Response>;
  mcp(authorization?: string): Promise<Client>;
  close(): Promise<void>;
}

export async function startApi(): Promise<Api> {
  const t = await createTestDb();
  const clients: Client[] = [];

  const call = async (
    route: ServerRoute,
    request: Request,
    params: Readonly<Record<string, string>>,
  ): Promise<Response> => {
    const handlers = route.options.server?.handlers as { readonly ANY: AnyHandler };
    return handlers.ANY({
      request,
      params,
      context: { services: t.services },
      pathname: new URL(request.url).pathname,
      next: () => {
        throw new Error("B1 handlers never call next()");
      },
    });
  };

  return {
    authFor: async (agentId) => `Bearer ${await t.keyFor(agentId)}`,

    rest: (route, method, path, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.authorization !== undefined) headers.set("authorization", init.authorization);
      const body =
        init.body === undefined
          ? undefined
          : typeof init.body === "string"
            ? init.body
            : JSON.stringify(init.body);
      if (body !== undefined && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      const request = new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      return call(route, request, init.params ?? {});
    },

    mcp: async (authorization) => {
      const client = new Client({ name: "hx-centcom-tests", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
          fetch: (url, init) => call(mcpRoute, new Request(url, init), {}),
          ...(authorization === undefined ? {} : { requestInit: { headers: { authorization } } }),
        }),
      );
      clients.push(client);
      return client;
    },

    close: async () => {
      await Promise.all(clients.map((c) => c.close()));
      await t.close();
    },
  };
}

export type UpdatesPage = {
  readonly items: readonly Json[];
  readonly nextCursor: string | null;
  readonly counts: { readonly total: number };
};

export async function updatesPage(api: Api, query: string): Promise<UpdatesPage> {
  const res = await api.rest(updatesRoute, "GET", `/api/v1/updates?${query}`);
  expect(res.status, `GET /api/v1/updates?${query} is 200`).toBe(200);
  return (await res.json()) as UpdatesPage;
}

function checkEnvelope(error: WireError): WireError {
  expect(typeof error.code, "error.code is a string").toBe("string");
  expect(typeof error.message, "error.message is a string").toBe("string");
  if (error.code === "invalid") {
    expect(
      error.issues?.length,
      "an invalid error carries a non-empty error.issues",
    ).toBeGreaterThan(0);
    for (const issue of error.issues ?? []) {
      expect(issue, "each issue is {path, message}").toMatchObject({
        path: expect.any(String),
        message: expect.any(String),
      });
    }
  }
  if (error.code === "version_conflict") {
    expect(Number.isInteger(error.currentVersion), "error.currentVersion is an integer").toBe(true);
    expect(error.currentVersion, "error.currentVersion is positive").toBeGreaterThan(0);
  }
  return error;
}

export async function errorOf(res: Response): Promise<WireError> {
  expect(res.headers.get("content-type"), "an error response is JSON").toMatch(
    /^application\/json/,
  );
  const body = (await res.json()) as { error: WireError };
  expect(body.error.status, "error.status equals the HTTP status").toBe(res.status);
  return checkEnvelope(body.error);
}

type ToolResult = {
  readonly isError?: boolean;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly structuredContent?: unknown;
  readonly _meta?: Json;
};

export function toolValue(result: unknown): Json {
  const r = result as ToolResult;
  expect(r.isError, `the tool call succeeded: ${JSON.stringify(r.content)}`).toBeFalsy();
  const [block] = r.content ?? [];
  expect(JSON.parse(block?.text ?? "null"), "the text block equals structuredContent").toEqual(
    r.structuredContent,
  );
  return r.structuredContent as Json;
}

export function toolError(result: unknown): WireError {
  const r = result as ToolResult;
  expect(r.isError, "the tool call failed").toBe(true);
  return checkEnvelope((r.structuredContent as { error: WireError }).error);
}

export function toolErrorText(result: unknown): string {
  const r = result as ToolResult;
  expect(r.isError, "the tool call failed").toBe(true);
  return r.content?.map((c) => c.text ?? "").join("\n") ?? "";
}

export function metaOf(result: unknown): Json | undefined {
  return (result as ToolResult)._meta;
}
