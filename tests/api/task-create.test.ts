// REST POST /api/v1/tasks, the MCP tool create_task and the CLI `centcom task add` create the same row.
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as tasksRoute } from "@/routes/api/v1/tasks";
import { Route as taskRoute } from "@/routes/api/v1/tasks/$id";
import {
  errorOf,
  SOURCE_URL,
  startApi,
  toolError,
  toolValue,
  type Api,
  type Json,
} from "./harness";

const CLI = fileURLToPath(new URL("../../bin/centcom", import.meta.url));

const fields = {
  title: "Register agent work",
  sourceUrl: SOURCE_URL,
  repository: "HX-CentCom",
  host: "HX-15",
  startDate: "2026-11-15",
  dueDate: "2026-11-16",
  status: "In progress",
  note: "Created by the test",
};

let api: Api;
beforeEach(async () => {
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

async function readTask(id: string): Promise<Json> {
  const res = await api.rest(taskRoute, "GET", `/api/v1/tasks/${id}`, { params: { id } });
  expect(res.status, `GET /api/v1/tasks/${id}`).toBe(200);
  return ((await res.json()) as { task: Json }).task;
}

/** The stored task without the fields that differ per create: its id and its write time. */
function shape(task: Json): Json {
  const { id: _id, updated_at: _updatedAt, ...rest } = task;
  return rest;
}

async function restCreate(id: string, agentId: string): Promise<Json> {
  const res = await api.rest(tasksRoute, "POST", "/api/v1/tasks", {
    authorization: await api.authFor(agentId),
    body: { id, ...fields },
  });
  expect(res.status, "POST /api/v1/tasks is 201").toBe(201);
  return (await res.json()) as Json;
}

/** A loopback HTTP server that hands each request to the tasks route, so the real CLI talks to the real route. */
async function serveTasksRoute(): Promise<{ url: string; close(): void }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const headers: Record<string, string> = {};
    const key = req.headers["idempotency-key"];
    if (typeof key === "string") headers["idempotency-key"] = key;
    const answer = await api.rest(tasksRoute, req.method ?? "GET", req.url ?? "/", {
      authorization: req.headers.authorization,
      headers,
      body: text,
    });
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(await answer.text());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe("POST /api/v1/tasks", () => {
  it("returns 201 {task} with the caller as agent and version 1", async () => {
    const body = await restCreate("CC-90", "CC1");
    expect(Object.keys(body)).toEqual(["task"]);
    expect(body["task"]).toMatchObject({
      id: "CC-90",
      agent: "CC1",
      version: 1,
      group: "in_progress",
      blocked_on: "none",
      commit_sha: null,
    });
  });

  it("answers 401 without a key, 403 for another agent, 409 for a taken id", async () => {
    const anonymous = await api.rest(tasksRoute, "POST", "/api/v1/tasks", {
      body: { id: "CC-90", ...fields },
    });
    expect((await errorOf(anonymous)).code).toBe("unauthorized");
    const other = await api.rest(tasksRoute, "POST", "/api/v1/tasks", {
      authorization: await api.authFor("CC1"),
      body: { id: "CC-90", ...fields, agentId: "CC2" },
    });
    expect((await errorOf(other)).code).toBe("forbidden");
    const taken = await api.rest(tasksRoute, "POST", "/api/v1/tasks", {
      authorization: await api.authFor("Agent Zero"),
      body: { id: "CC-01", ...fields },
    });
    expect(taken.status).toBe(409);
    const error = await errorOf(taken);
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("CC-01");
  });

  it("replays an Idempotency-Key retry with Idempotency-Replayed", async () => {
    const send = async () =>
      api.rest(tasksRoute, "POST", "/api/v1/tasks", {
        authorization: await api.authFor("CC1"),
        headers: { "idempotency-key": "create-cc-90" },
        body: { id: "CC-90", ...fields },
      });
    const first = await send();
    const again = await send();
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotency-replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
  });
});

describe("create_task and centcom task add write the row REST writes", () => {
  it("MCP create_task returns {task} and stores the same row as REST", async () => {
    const rest = await restCreate("CC-90", "CC2");
    const client = await api.mcp(await api.authFor("CC2"));
    const value = toolValue(
      await client.callTool({ name: "create_task", arguments: { id: "CC-91", ...fields } }),
    );
    expect(Object.keys(value)).toEqual(["task"]);
    expect(shape(value["task"] as Json)).toEqual(shape(rest["task"] as Json));
    expect(shape(await readTask("CC-91"))).toEqual(shape(await readTask("CC-90")));
  });

  it("MCP create_task refuses another agent's assignment with forbidden", async () => {
    const client = await api.mcp(await api.authFor("CC1"));
    const error = toolError(
      await client.callTool({
        name: "create_task",
        arguments: { id: "CC-91", ...fields, agentId: "CC2" },
      }),
    );
    expect(error.code).toBe("forbidden");
  });

  it("the CLI's task add prints the task id and stores the same row as REST", async () => {
    await restCreate("CC-90", "CC1");
    const server = await serveTasksRoute();
    const dir = mkdtempSync(join(tmpdir(), "centcom-task-add-"));
    try {
      const keyFile = join(dir, "key");
      writeFileSync(keyFile, `${(await api.authFor("CC1")).replace(/^Bearer /, "")}\n`);
      chmodSync(keyFile, 0o600);
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          CLI,
          "task",
          "add",
          "--id",
          "CC-91",
          "--title",
          fields.title,
          "--source",
          fields.sourceUrl,
          "--repo",
          fields.repository,
          "--host",
          fields.host,
          "--start",
          fields.startDate,
          "--due",
          fields.dueDate,
          "--status",
          fields.status,
          "--note",
          fields.note,
        ],
        {
          env: { PATH: process.env["PATH"], CENTCOM_URL: server.url, CENTCOM_KEY_FILE: keyFile },
          timeout: 20_000,
        },
      );
      expect(stdout).toBe("CC-91\n");
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(shape(await readTask("CC-91"))).toEqual(shape(await readTask("CC-90")));
  });
});
