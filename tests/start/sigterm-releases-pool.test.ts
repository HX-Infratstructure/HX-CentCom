// src/start.ts opens the database pool on the first request and must end its connections on SIGTERM (AGENTS.md:
// whatever admits work releases it). This builds the app as `npm run build` does, runs `.output/server/index.mjs` with
// the systemd unit's environment, and watches the connections from the database's side of the wire.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";

const ROOT = path.resolve(__dirname, "../..");
const NOT_BUILD_INPUT = new Set(["node_modules", ".git", ".output", ".tanstack", ".nitro", "dist"]);
/** The frontend's Terminate message. postgres.js sends it when it ends a connection; a killed process never does. */
const TERMINATE = "X".charCodeAt(0);

interface Connection {
  terminated: boolean;
  closed: boolean;
}

/** The unit's environment. Vitest sets TEST, and Nitro skips its graceful shutdown when TEST or CI is set. */
function unitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", ...extra };
  delete env["TEST"];
  delete env["CI"];
  return env;
}

/** Serves one PGlite database over the PostgreSQL wire protocol and records how each connection ends. */
function serveWire(pg: PGlite, connections: Connection[]): Server {
  let queue: Promise<void> = Promise.resolve();
  return createServer((socket) => {
    const connection: Connection = { terminated: false, closed: false };
    connections.push(connection);
    socket.on("close", () => (connection.closed = true));
    socket.on("error", () => {});
    let pending = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const messages: Uint8Array[] = [];
      for (;;) {
        // The startup message is the only one without a type byte before its length.
        if (pending.length < (started ? 5 : 4)) break;
        const size = started ? 1 + pending.readInt32BE(1) : pending.readInt32BE(0);
        if (pending.length < size) break;
        const message = new Uint8Array(pending.subarray(0, size));
        pending = pending.subarray(size);
        if (started && message[0] === TERMINATE) connection.terminated = true;
        else messages.push(message);
        started = true;
      }
      queue = queue.then(async () => {
        for (const message of messages) {
          const reply = await pg.execProtocolRaw(message);
          if (reply.length > 0 && !socket.destroyed) socket.write(reply);
        }
      });
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function exitWithin(app: ChildProcess, ms: number): Promise<object | string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(`still running ${ms} ms after SIGTERM`), ms);
    app.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("SIGTERM to the built server", () => {
  const connections: Connection[] = [];
  let build: string;
  let db: TestDb;
  let wire: Server;
  let app: ChildProcess | undefined;

  beforeAll(async () => {
    build = mkdtempSync(path.join(tmpdir(), "centcom-build-"));
    cpSync(ROOT, build, {
      recursive: true,
      filter: (source) => !NOT_BUILD_INPUT.has(path.relative(ROOT, source).split(path.sep)[0]!),
    });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(build, "node_modules"));
    const vite = path.join(build, "node_modules", "vite", "bin", "vite.js");
    [db] = await Promise.all([
      createTestDb(),
      promisify(execFile)(process.execPath, [vite, "build"], {
        cwd: build,
        env: unitEnv(),
        maxBuffer: 16 * 1024 * 1024,
      }),
    ]);
    wire = serveWire((db.db as unknown as { $client: PGlite }).$client, connections);
    await new Promise<void>((resolve) => wire.listen(0, "127.0.0.1", resolve));
  });

  // A test that times out never reaches its own cleanup, so the server is killed here.
  afterAll(async () => {
    app?.kill("SIGKILL");
    wire?.close();
    await db?.close();
    if (build) rmSync(build, { recursive: true, force: true });
  });

  it("ends every pool connection, and the process then exits by itself", async () => {
    const { port } = wire.address() as AddressInfo;
    const appPort = await freePort();
    app = spawn(process.execPath, [path.join(".output", "server", "index.mjs")], {
      cwd: build,
      env: unitEnv({
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: String(appPort),
        DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
      }),
      stdio: "ignore",
    });
    const response = await vi.waitFor(() => fetch(`http://127.0.0.1:${appPort}/api/v1/workspace`), {
      timeout: 10_000,
      interval: 100,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { tasks: unknown[] }).tasks.length).toBeGreaterThan(0);
    const opened = connections.length;
    expect(opened, "the request opened pool connections").toBeGreaterThan(0);
    expect(
      connections.filter((c) => c.closed),
      "the pool keeps them open",
    ).toEqual([]);

    app.kill("SIGTERM");
    expect(await exitWithin(app, 10_000)).toEqual({ code: 0, signal: null });
    const ended = Array.from({ length: opened }, () => ({ terminated: true, closed: true }));
    await vi.waitFor(() => expect(connections).toEqual(ended));
  });
});
