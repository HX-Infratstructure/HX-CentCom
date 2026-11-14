import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { connectDb, requireEnv, type DbHandle } from "@/server/db/client";
import { createServices, isServiceError, webhookConfig, type Services } from "@/server/services";
import { readSecretFile } from "../scripts/secret-file";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// It cannot live in createStart's options factory, which runs on every request.
let services: Services | undefined;
let inFlight = 0;
let draining = false;
/** Nitro's graceful shutdown force-closes the HTTP connections after 5 s by default, so a later write has no client. */
const DRAIN_MS = 5_000;

async function drainThenClose(handle: DbHandle): Promise<void> {
  draining = true;
  const deadline = Date.now() + DRAIN_MS;
  while (inFlight > 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  await handle.close();
}

function openServices(): Services {
  // Read before the pool opens, so a bad webhook setting fails like a missing DATABASE_URL and leaves nothing open.
  const webhook = webhookConfig(process.env, readSecretFile);
  const handle = connectDb(requireEnv("DATABASE_URL"));
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    // A listener replaces Node's default exit, so one is added only where another (Nitro's graceful shutdown) already
    // did. That one closes the HTTP server without exiting; the process ends when the pool's sockets close too.
    if (process.listenerCount(signal) > 0) process.once(signal, () => void drainThenClose(handle));
  }
  return createServices(handle.db, { webhook });
}

// The client build strips `.server()`, and the server imports with it.
const servicesMiddleware = createMiddleware().server(async ({ next }) => {
  if (draining) throw new Error("The server is shutting down.");
  services ??= openServices();
  inFlight++;
  try {
    return await next({ context: { services } });
  } finally {
    inFlight--;
  }
});

// The browser gets a server function's error as its message alone, so a driver error would show the database's host
// and port. A ServiceError is the caller's answer, and a redirect or notFound is router control flow.
const unavailableMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isServiceError(error) || isRedirect(error) || isNotFound(error)) throw error;
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`data service unavailable, reference ${ref}`, error);
    throw new Error(`The data service is unavailable. Reference ${ref}.`);
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware, servicesMiddleware],
  functionMiddleware: [unavailableMiddleware],
}));
