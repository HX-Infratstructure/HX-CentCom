// Start serializes a server function's error as its message alone, so that message is what the browser shows.
import { notFound, redirect } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createTestDb } from "@/server/db/test-db";
import { isServiceError } from "@/server/services";
import { startInstance } from "@/start";

type ServerMiddleware = (ctx: { next: () => Promise<unknown> }) => Promise<unknown>;

async function serverMiddleware(): Promise<ServerMiddleware> {
  const { functionMiddleware } = await startInstance.getOptions();
  const [middleware] = (functionMiddleware ?? []) as unknown as {
    options: { server?: ServerMiddleware };
  }[];
  const server = middleware?.options.server;
  if (server === undefined) throw new Error("no global function middleware with a server part");
  return server;
}

/** Runs `work` as the downstream server function and keeps the error it threw. */
function downstream(work: () => Promise<unknown>) {
  const seen: { error?: unknown } = {};
  const next = async () => {
    try {
      return await work();
    } catch (error) {
      seen.error = error;
      throw error;
    }
  };
  return { next, seen };
}

const UNAVAILABLE = /^The data service is unavailable\. Reference ([0-9a-f]{8})\.$/;

let logged: MockInstance<typeof console.error>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
});

async function expectUnavailable(work: () => Promise<unknown>): Promise<void> {
  const server = await serverMiddleware();
  const { next, seen } = downstream(work);
  const thrown = await server({ next }).then(
    () => expect.fail("the middleware resolved"),
    (error: unknown) => error,
  );
  expect(isServiceError(seen.error), "the original is not a ServiceError").toBe(false);
  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  const ref = UNAVAILABLE.exec(message)?.[1];
  expect(ref, message).toBeDefined();
  for (const leak of ["ECONNREFUSED", "127.0.0.1", "closed"]) expect(message).not.toContain(leak);
  expect(logged).toHaveBeenCalledTimes(1);
  const [text, original] = logged.mock.calls[0] ?? [];
  expect(String(text)).toContain(ref);
  expect(original).toBe(seen.error);
}

describe("global server function middleware", () => {
  it("replaces a data layer failure with a reference, and logs the original once", async () => {
    const t = await createTestDb();
    await t.close();
    await expectUnavailable(() => t.services.listWorkspace());
  });

  it("replaces a refused connection without showing its host or port", async () => {
    await expectUnavailable(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
    });
  });

  it("passes a ServiceError through unchanged and logs nothing", async () => {
    const server = await serverMiddleware();
    const t = await createTestDb();
    try {
      const { next, seen } = downstream(() => t.services.listDecisions({ cursor: "not-a-cursor" }));
      const thrown = await server({ next }).catch((error: unknown) => error);
      expect(isServiceError(seen.error)).toBe(true);
      expect(thrown).toBe(seen.error);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      await t.close();
    }
  });

  it("passes router redirects and not-found errors through as the same object", async () => {
    const server = await serverMiddleware();
    for (const control of [redirect({ to: "/" }), notFound()]) {
      const thrown = await server({
        next: async () => {
          throw control;
        },
      }).catch((error: unknown) => error);
      expect(thrown).toBe(control);
    }
    expect(logged).not.toHaveBeenCalled();
  });

  it("returns a successful result as is", async () => {
    const server = await serverMiddleware();
    const result = { result: { ok: true } };
    expect(await server({ next: async () => result })).toBe(result);
  });
});
