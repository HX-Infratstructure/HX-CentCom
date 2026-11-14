import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export class DashError extends Error {
  constructor(code, message, status, issues = []) {
    super(message);
    this.name = "DashError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

export function openDashboard(env, { source }) {
  const root = parseRoot(env.CENTCOM_URL);
  const key = readKey(resolve(expandHome(env.CENTCOM_KEY_FILE || "~/.config/hx-centcom/key")));
  const write = (method, path, json, signal) => send({ root, key, signal, method, path, json });
  const raidWrite = (body) => ({
    id: idOf(body?.item, "RAID item", root.origin),
    decisionId: typeof body.decision?.id === "string" ? body.decision.id : null,
  });
  return {
    async postUpdate(taskId, update, { signal }) {
      const body = await write(
        "POST",
        `api/v1/tasks/${encodeURIComponent(taskId)}/updates`,
        { ...update, source },
        signal,
      );
      return idOf(body, "update", root.origin);
    },
    async whoami({ signal }) {
      const actor = (await send({ root, key, signal, method: "GET", path: "api/v1/workspace" }))
        ?.actor;
      return typeof actor?.agentId === "string"
        ? { agentId: actor.agentId, role: String(actor.role ?? "unknown") }
        : null;
    },
    async addRaidItem(item, { signal }) {
      return raidWrite(await write("POST", "api/v1/raid", item, signal));
    },
    async updateRaidItem(id, patch, { signal }) {
      return raidWrite(await write("PUT", `api/v1/raid/${encodeURIComponent(id)}`, patch, signal));
    },
    async addLesson(lesson, { signal }) {
      return idOf(
        (await write("POST", "api/v1/lessons", lesson, signal))?.lesson,
        "lesson",
        root.origin,
      );
    },
    async updateLesson(id, patch, { signal }) {
      return idOf(
        (await write("PUT", `api/v1/lessons/${encodeURIComponent(id)}`, patch, signal))?.lesson,
        "lesson",
        root.origin,
      );
    },
  };
}

function idOf(record, what, origin) {
  if (typeof record?.id !== "string" && typeof record?.id !== "number") {
    throw new DashError("bad_response", `${origin} accepted the ${what} but returned no id`);
  }
  return String(record.id);
}

const KEY_SHAPE = /^hxc_[\x21-\x7e]+$/;

function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function readKey(path) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new DashError(
        "key_missing",
        `no key file at ${path}; create it with mode 600 or set CENTCOM_KEY_FILE`,
      );
    }
    throw new DashError("key_invalid", `cannot read ${path} (${err.code})`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new DashError("key_invalid", `${path} is not a regular file`);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600)
      throw new DashError(
        "key_mode",
        `${path} has mode ${mode.toString(8)}; run: chmod 600 ${path}`,
      );
    const key = readFileSync(fd, "utf8").trim();
    if (!KEY_SHAPE.test(key))
      throw new DashError("key_invalid", `${path} must hold one hxc_ key on one line`);
    return key;
  } finally {
    closeSync(fd);
  }
}

/** @returns {URL} with a pathname ending in '/', so a proxy prefix such as /dash/ survives joining */
function parseRoot(raw) {
  if (!raw) throw new DashError("config", "CENTCOM_URL is not set");
  const root = URL.canParse(raw) ? new URL(raw) : null;
  if (root?.protocol !== "http:" && root?.protocol !== "https:") {
    throw new DashError("config", "CENTCOM_URL must be an http:// or https:// URL");
  }
  if (root.username || root.password)
    throw new DashError("config", "CENTCOM_URL must not hold a user name or password");
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  return root;
}

async function send({ root, key, signal, method, path, json }) {
  const headers = { authorization: `Bearer ${key}`, accept: "application/json" };
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = randomUUID();
  }
  let res;
  let text;
  try {
    res = await fetch(new URL(path, root), {
      method,
      headers,
      signal,
      body: json && JSON.stringify(json),
    });
    text = await res.text();
  } catch (err) {
    throw transportError(err, root.origin);
  }
  const body = parseJson(text);
  if (res.ok) {
    if (body === undefined)
      throw new DashError(
        "bad_response",
        `${root.origin} answered ${res.status} without JSON`,
        res.status,
      );
    return body;
  }
  const error = [body?.error, body].find(
    (e) => typeof e?.code === "string" && typeof e?.message === "string",
  );
  if (error) throw new DashError(error.code, error.message, res.status, parseIssues(error.issues));
  throw new DashError(
    "http_error",
    `${root.origin} answered ${res.status} ${res.statusText}`.trim(),
    res.status,
  );
}

function transportError(err, origin) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new DashError("timeout", `no answer from ${origin} before the deadline`);
  }
  return new DashError(
    "unreachable",
    `cannot reach ${origin} (${err?.cause?.code ?? err?.name ?? "error"})`,
  );
}

function parseIssues(issues) {
  return Array.isArray(issues)
    ? issues
        .filter((i) => typeof i?.path === "string" && typeof i?.message === "string")
        .map(({ path, message }) => ({ path, message }))
    : [];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
