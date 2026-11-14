export const ERROR_STATUS = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_mismatch: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type Issue = { readonly path: string; readonly message: string };

type ExtraFor<C extends ErrorCode> = C extends "version_conflict"
  ? { readonly currentVersion: number }
  : C extends "invalid"
    ? { readonly issues: readonly Issue[] }
    : unknown;

export type ServiceErrorBody = {
  [C in ErrorCode]: {
    readonly code: C;
    readonly status: (typeof ERROR_STATUS)[C];
    readonly message: string;
  } & ExtraFor<C>;
}[ErrorCode];

export class ServiceError extends Error {
  readonly body: ServiceErrorBody;

  private constructor(body: ServiceErrorBody) {
    super(body.message);
    this.name = "ServiceError";
    this.body = body;
  }

  get code(): ErrorCode {
    return this.body.code;
  }

  get status(): ServiceErrorBody["status"] {
    return this.body.status;
  }

  toJSON(): ServiceErrorBody {
    return this.body;
  }

  static invalid(message: string, issues: readonly Issue[] = []): ServiceError {
    return new ServiceError({ code: "invalid", status: ERROR_STATUS.invalid, message, issues });
  }

  static unauthorized(): ServiceError {
    return new ServiceError({
      code: "unauthorized",
      status: ERROR_STATUS.unauthorized,
      message: "A valid bearer key is required.",
    });
  }

  static forbidden(message: string): ServiceError {
    return new ServiceError({ code: "forbidden", status: ERROR_STATUS.forbidden, message });
  }

  static notFound(what: string, id: string): ServiceError {
    return new ServiceError({
      code: "not_found",
      status: ERROR_STATUS.not_found,
      message: `${what} ${id} does not exist.`,
    });
  }

  static versionConflict(currentVersion: number): ServiceError {
    return new ServiceError({
      code: "version_conflict",
      status: ERROR_STATUS.version_conflict,
      message: `The resource is at version ${currentVersion}.`,
      currentVersion,
    });
  }

  static idempotencyMismatch(): ServiceError {
    return new ServiceError({
      code: "idempotency_mismatch",
      status: ERROR_STATUS.idempotency_mismatch,
      message: "This Idempotency-Key was already used with a different request.",
    });
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
