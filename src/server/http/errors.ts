import { isServiceError, type ServiceErrorBody } from "@/server/services";

type TransportErrorBody =
  | { readonly code: "method_not_allowed"; readonly status: 405; readonly message: string }
  | { readonly code: "payload_too_large"; readonly status: 413; readonly message: string };

type InternalErrorBody = {
  readonly code: "internal";
  readonly status: 500;
  readonly message: string;
};

export type ApiErrorBody = ServiceErrorBody | TransportErrorBody | InternalErrorBody;

export class HttpError extends Error {
  readonly body: TransportErrorBody;

  private constructor(body: TransportErrorBody) {
    super(body.message);
    this.name = "HttpError";
    this.body = body;
  }

  static methodNotAllowed(method: string, allow: readonly string[]): HttpError {
    return new HttpError({
      code: "method_not_allowed",
      status: 405,
      message: `${method} is not allowed here; use ${allow.join(" or ")}.`,
    });
  }

  static payloadTooLarge(maxBytes: number): HttpError {
    return new HttpError({
      code: "payload_too_large",
      status: 413,
      message: `The request body exceeds ${maxBytes} bytes.`,
    });
  }
}

export function toErrorBody(error: unknown): ApiErrorBody {
  if (isServiceError(error)) return error.body;
  if (error instanceof HttpError) return error.body;
  console.error("unhandled API error", error);
  return { code: "internal", status: 500, message: "Internal error." };
}

export function errorResponse(error: unknown, headers?: HeadersInit): Response {
  const body = toErrorBody(error);
  const responseHeaders = new Headers(headers);
  if (body.status === 401) responseHeaders.set("WWW-Authenticate", 'Bearer realm="hx-centcom"');
  return Response.json({ error: body }, { status: body.status, headers: responseHeaders });
}
