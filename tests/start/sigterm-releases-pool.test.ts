// src/start.ts opens the database pool on the first request and must end its connections on SIGTERM (AGENTS.md:
// whatever admits work releases it). This builds the app as `npm run build` does, runs `.output/server/index.mjs` with
// the systemd unit's environment, and watches the connections from the database's side of the wire.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
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

/** While `until` is set, the database answers nothing until it settles; `queued` counts the messages it held. */
interface Hold {
  until?: Promise<void> | undefined;
  queued: number;
}

/** The unit's environment. Vitest sets TEST, and Nitro skips its graceful shutdown when TEST or CI is set. */
function unitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", ...extra };
  delete env["TEST"];
  delete env["CI"];
  return env;
}

/** Serves one PGlite database over the PostgreSQL wire protocol and records how each connection ends. */
function serveWire(pg: PGlite, connections: Connection[], hold: Hold): Server {
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
      const until = hold.until;
      if (until) hold.queued += messages.length;
      queue = queue.then(async () => {
        await until;
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

/** Resolves once nothing listens on `port`: the server has run its SIGTERM listeners. */
function refused(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("still listening"));
    });
    socket.once("error", () => resolve());
  });
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
  const hold: Hold = { queued: 0 };
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
    wire = serveWire((db.db as unknown as { $client: PGlite }).$client, connections, hold);
    await new Promise<void>((resolve) => wire.listen(0, "127.0.0.1", resolve));
  });

  // A test that times out never reaches its own cleanup, so the server is killed here.
  afterAll(async () => {
    app?.kill("SIGKILL");
    wire?.close();
    await db?.close();
    if (build) rmSync(build, { recursive: true, force: true });
  });

  /** Starts the built server and answers its first request, which opens the pool. */
  async function launch(): Promise<{ app: ChildProcess; appPort: number; response: Response }> {
    const { port } = wire.address() as AddressInfo;
    const appPort = await freePort();
    const child = spawn(process.execPath, [path.join(".output", "server", "index.mjs")], {
      cwd: build,
      env: unitEnv({
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: String(appPort),
        DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
      }),
      stdio: "ignore",
    });
    app = child;
    const response = await vi.waitFor(() => fetch(`http://127.0.0.1:${appPort}/api/v1/workspace`), {
      timeout: 10_000,
      interval: 100,
    });
    return { app: child, appPort, response };
  }

  it("ends every pool connection, and the process then exits by itself", async () => {
    const { app, response } = await launch();
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

  it("lets a write admitted before SIGTERM finish before the pool ends", async () => {
    connections.length = 0;
    const { app, appPort, response } = await launch();
    expect(response.status).toBe(200);
    const key = await db.keyFor("CC1");
    let release = (): void => {};
    hold.until = new Promise((resolve) => (release = resolve));
    const write = fetch(`http://127.0.0.1:${appPort}/api/v1/tasks/CC-01/updates`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "progress", note: "in flight at SIGTERM", source: "api" }),
    });
    await vi.waitFor(() =>
      expect(hold.queued, "the key lookup reached the database").toBeGreaterThan(0),
    );

    app.kill("SIGTERM");
    await vi.waitFor(() => refused(appPort), { timeout: 5_000, interval: 50 });
    hold.until = undefined;
    release();

    const written = await write;
    expect(written.status, await written.clone().text()).toBe(201);
    expect(await written.json()).toMatchObject({ task_id: "CC-01", note: "in flight at SIGTERM" });
    expect(await exitWithin(app, 10_000)).toEqual({ code: 0, signal: null });
    await vi.waitFor(() => expect(connections.every((c) => c.terminated && c.closed)).toBe(true));
  });
});
