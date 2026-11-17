/** Start has no 405 of its own (an unhandled method falls through to SSR). */
import { readRequestBody } from "@modelcontextprotocol/sdk/server/requestBody.js";
import {
  ServiceError,
  type Actor,
  type Services,
  type UpdateOptions,
  type WriteResult,
} from "@/server/services";
import { errorResponse, HttpError } from "./errors";

export const MAX_BODY_BYTES = 1024 * 1024;

const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];

export type RouteCtx = {
  readonly request: Request;
  readonly context: { readonly services: Services };
};

export type ApiRequest = {
  readonly services: Services;
  actor(): Promise<Actor | null>;
  json(): Promise<Record<string, unknown>>;
  readonly opts: UpdateOptions;
  readonly query: Readonly<Record<string, string>>;
};

export type WriteWithBody = { readonly result: WriteResult<unknown>; readonly body: unknown };
export type Outcome = Response | WriteResult<unknown> | WriteWithBody;
export type Methods = Readonly<Partial<Record<Method, (req: ApiRequest) => Promise<Outcome>>>>;

export async function endpoint(ctx: RouteCtx, methods: Methods): Promise<Response> {
  const { method } = ctx.request;
  const name = method === "HEAD" ? "GET" : method;
  const handler = isMethod(name) ? methods[name] : undefined;
  if (!handler) {
    const allow = allowed(methods);
    return errorResponse(HttpError.methodNotAllowed(method, allow), { Allow: allow.join(", ") });
  }
  try {
    const req = apiRequest(ctx);
    // Writes need a key; check it before the body so a parse error never outranks the 401.
    if (name !== "GET" && (await req.actor()) === null) throw ServiceError.unauthorized();
    return send(await handler(req));
  } catch (error) {
    return errorResponse(error);
  }
}

export function unparsed<T>(value: unknown): T {
  return value as T;
}

export function rejectIdempotencyKey(req: ApiRequest): void {
  if (req.opts.idempotencyKey !== undefined) {
    throw ServiceError.invalid("This endpoint does not accept an Idempotency-Key.", [
      {
        path: "Idempotency-Key",
        message: "key writes are not idempotent; send no Idempotency-Key",
      },
    ]);
  }
}

function send(outcome: Outcome): Response {
  if (outcome instanceof Response) return outcome;
  const { result, body } = "result" in outcome ? outcome : { result: outcome, body: outcome.value };
  return Response.json(body, {
    status: result.status,
    ...(result.replayed ? { headers: { "Idempotency-Replayed": "true" } } : {}),
  });
}

function apiRequest({ request, context: { services } }: RouteCtx): ApiRequest {
  let actor: Promise<Actor | null> | undefined;
  return {
    services,
    actor: () => (actor ??= services.resolveActor(request.headers.get("authorization"))),
    json: () => readJsonObject(request),
    opts: writeOptions(request.headers),
    query: Object.fromEntries(new URL(request.url).searchParams),
  };
}

function writeOptions(headers: Headers): UpdateOptions {
  return {
    idempotencyKey: headers.get("idempotency-key") ?? undefined,
    expectedVersion: expectedVersion(headers.get("if-match")),
  };
}

/** The If-Match version: undefined when absent, NaN when malformed, which the services refuse with a 400. */
function expectedVersion(ifMatch: string | null): number | undefined {
  if (ifMatch === null) return undefined;
  const version = /^(?:(\d+)|"(\d+)")$/.exec(ifMatch);
  if (version === null) return Number.NaN;
  return Number(version[1] ?? version[2]);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const read = await readRequestBody(request, MAX_BODY_BYTES);
  if (read.tooLarge) throw HttpError.payloadTooLarge(MAX_BODY_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(read.text);
  } catch {
    throw ServiceError.invalid("The request body is not valid JSON.", [
      { path: "(body)", message: "must be JSON" },
    ]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw ServiceError.invalid("The request body must be a JSON object.", [
      { path: "(body)", message: "must be a JSON object" },
    ]);
  }
  return value as Record<string, unknown>;
}

function allowed(methods: Methods): string[] {
  const names: string[] = METHODS.filter((m) => methods[m] !== undefined);
  return names.includes("GET") ? [...names, "HEAD"] : names;
}

function isMethod(name: string): name is Method {
  return (METHODS as readonly string[]).includes(name);
}
