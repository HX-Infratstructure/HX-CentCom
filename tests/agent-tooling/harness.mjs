import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_KEY = `hxc_CC1_${"fake".repeat(8)}`;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const BIN = {
  cli: fileURLToPath(new URL("../../bin/centcom", import.meta.url)),
  hook: fileURLToPath(new URL("../../bin/centcom-hook", import.meta.url)),
};

const KILL_AFTER_MS = 10_000;

export function okReply(req) {
  if (req.method === "POST" && /\/api\/v1\/tasks\/[^/]+\/updates$/.test(req.path)) {
    return { status: 201, body: { id: "upd_1", ...req.body } };
  }
  if (req.method === "GET" && req.path.endsWith("/api/v1/workspace")) {
    return { status: 200, body: { actor: { agentId: "CC1", role: "agent" }, tasks: [] } };
  }
  if (req.method === "POST" && req.path.endsWith("/api/v1/raid")) {
    return {
      status: 201,
      body: { item: { id: "RAID-01", ...req.body }, decision: null, systemUpdates: [] },
    };
  }
  if (req.method === "PUT" && /\/api\/v1\/raid\/[^/]+$/.test(req.path)) {
    return {
      status: 200,
      body: { item: { id: "RAID-01", ...req.body }, decision: null, systemUpdates: [] },
    };
  }
  if (req.method === "POST" && req.path.endsWith("/api/v1/lessons")) {
    return { status: 201, body: { lesson: { id: "L-01", ...req.body } } };
  }
  if (req.method === "PUT" && /\/api\/v1\/lessons\/[^/]+$/.test(req.path)) {
    return { status: 200, body: { lesson: { id: "L-01", ...req.body } } };
  }
  return { status: 404, body: { error: { code: "not_found", message: "no such route" } } };
}

export async function startStub(t, reply = okReply) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const text = Buffer.concat(await Array.fromAsync(req)).toString("utf8");
    const recorded = {
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: parseBody(text),
    };
    requests.push(recorded);
    const answer = reply(recorded);
    if (answer === "hang") return;
    if (answer.raw !== undefined) {
      res.writeHead(answer.status, { "content-type": "text/html" });
      res.end(answer.raw);
      return;
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body ?? {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function parseBody(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function deadUrl() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return `http://127.0.0.1:${port}`;
}

export function wire(req) {
  return {
    method: req.method,
    path: req.path,
    authorization: req.headers.authorization?.replace(FAKE_KEY, "<FAKE_KEY>"),
    accept: req.headers.accept,
    contentType: req.headers["content-type"],
    body: req.body,
  };
}

export function makeHome(
  t,
  { mode = 0o600, key = FAKE_KEY, at = ".config/hx-centcom/key", write = true } = {},
) {
  const home = tempDir(t, "centcom-home-");
  const keyFile = join(home, at);
  if (write) {
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, `${key}\n`);
    chmodSync(keyFile, mode);
  }
  return { home, keyFile };
}

export function makeRepo(t, { taskFile } = {}) {
  const dir = tempDir(t, "centcom-repo-");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("-c", "init.defaultBranch=main", "init", "-q");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  if (taskFile !== undefined) writeFileSync(join(dir, ".centcom-task"), taskFile);
  return { dir, sha: git("rev-parse", "HEAD").trim() };
}

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function hookPayload({
  command,
  cwd,
  stdout = "",
  stderr = "",
  interrupted = false,
  runInBackground,
  event = "PostToolUse",
  tool = "Bash",
}) {
  return JSON.stringify({
    session_id: "test-session",
    cwd,
    hook_event_name: event,
    tool_name: tool,
    tool_input: {
      command,
      description: "test",
      ...(runInBackground === undefined ? {} : { run_in_background: runInBackground }),
    },
    tool_response: { stdout, stderr, interrupted, isImage: false },
    tool_use_id: "toolu_test",
    duration_ms: 10,
  });
}

export async function run(bin, { args = [], env = {}, stdin = "" } = {}) {
  assert.ok(env.HOME, "every run gets a temporary HOME");
  const started = performance.now();
  const child = spawn(bin, args, {
    cwd: env.HOME,
    env: {
      PATH: process.env.PATH,
      ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)),
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});
  if (stdin !== null) child.stdin.end(stdin);
  const guard = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
  const [code, signal] = await once(child, "close");
  const ms = performance.now() - started;
  clearTimeout(guard);
  child.stdin.destroy();
  assert.equal(signal, null, `${bin} was killed after ${KILL_AFTER_MS} ms`);
  assert.ok(
    !stdout.includes(FAKE_KEY) && !stderr.includes(FAKE_KEY),
    "the key never reaches stdout or stderr",
  );
  return { code, stdout, stderr, ms };
}

export function assertSilentExit(r) {
  assert.deepEqual(
    { code: r.code, stdout: r.stdout, stderr: r.stderr },
    { code: 0, stdout: "", stderr: "" },
  );
}
