import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route as notFound } from "@/routes/api/v1/$";
import { Route as activity } from "@/routes/api/v1/activity";
import { Route as decisions } from "@/routes/api/v1/decisions";
import { Route as decide } from "@/routes/api/v1/decisions/$id/decide";
import { Route as keys } from "@/routes/api/v1/keys";
import { Route as key } from "@/routes/api/v1/keys/$id";
import { Route as task } from "@/routes/api/v1/tasks/$id";
import { Route as requirements } from "@/routes/api/v1/tasks/$id/requirements";
import { Route as postUpdate } from "@/routes/api/v1/tasks/$id/updates";
import { Route as updates } from "@/routes/api/v1/updates";
import { Route as workspace } from "@/routes/api/v1/workspace";
import { DECISIONS } from "../services/seed-truth";
import {
  errorOf,
  SOURCE_URL,
  startApi,
  UNKNOWN_KEY,
  updatesPage,
  type Api,
  type Json,
} from "./harness";

const CC1_TASK = "CC-01";
const CC2_TASK = "IRP-04";
const update = { kind: "progress", note: "REST contract", source: "api" };

let api: Api;
let cc1: string;
let owner: string;
beforeEach(async () => {
  api = await startApi();
  cc1 = await api.authFor("CC1");
  owner = await api.authFor("Agent Zero");
});
afterEach(async () => {
  await api.close();
});

type PostInit = {
  readonly authorization?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

function post(taskId: string, init: PostInit): Promise<Response> {
  return api.rest(postUpdate, "POST", `/api/v1/tasks/${taskId}/updates`, {
    params: { id: taskId },
    ...init,
  });
}

async function taskVersion(taskId: string): Promise<number> {
  const res = await api.rest(task, "GET", `/api/v1/tasks/${taskId}`, { params: { id: taskId } });
  expect(res.status, `GET /api/v1/tasks/${taskId} is 200`).toBe(200);
  return ((await res.json()) as { task: { version: number } }).task.version;
}

async function workspaceActor(authorization?: string): Promise<unknown> {
  const res = await api.rest(workspace, "GET", "/api/v1/workspace", { authorization });
  expect(res.status, "GET /api/v1/workspace is 200").toBe(200);
  return ((await res.json()) as { actor: unknown }).actor;
}

describe("POST /api/v1/tasks/:id/updates", () => {
  it("is 201 with the created update at the top level, authored by the key's agent; an author field is ignored", async () => {
    const res = await post(CC1_TASK, {
      authorization: cc1,
      body: { ...update, agent: "CC2", agent_id: "CC2" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({
      task_id: CC1_TASK,
      agent_id: "CC1",
      kind: "progress",
      source: "api",
      note: update.note,
    });
    expect(typeof body["id"], "the update id is at the top level").toBe("string");
    expect(body, "not wrapped in WriteResult.value").not.toHaveProperty("update");
  });

  it("refuses source mcp with 400 at path source and lands no row, and keeps the caller's kind and source cli", async () => {
    const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
    const refused = await post(CC1_TASK, {
      authorization: cc1,
      body: { ...update, source: "mcp" },
    });
    expect(refused.status).toBe(400);
    const error = await errorOf(refused);
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((i) => i.path)).toContain("source");
    expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "no row landed").toBe(
      before,
    );

    const res = await post(CC1_TASK, {
      authorization: cc1,
      body: { kind: "note", note: "from the CLI", source: "cli" },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Json;
    expect(created).toMatchObject({ kind: "note", source: "cli" });
    const { items } = await updatesPage(api, `taskId=${CC1_TASK}&source=cli`);
    expect(
      items.map((u) => u["id"]),
      "the cli row reads back",
    ).toContain(created["id"]);
  });

  it("is 401 without a key and with an unknown key, and 201 with a valid one", async () => {
    expect((await errorOf(await post(CC1_TASK, { body: update }))).code).toBe("unauthorized");
    expect(
      (await errorOf(await post(CC1_TASK, { authorization: UNKNOWN_KEY, body: update }))).code,
    ).toBe("unauthorized");
    expect((await post(CC1_TASK, { authorization: cc1, body: update })).status).toBe(201);
  });

  it("is 403 for an agent on another agent's task, and 201 for the owner there", async () => {
    const refused = await post(CC2_TASK, { authorization: cc1, body: update });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("forbidden");
    expect((await post(CC2_TASK, { authorization: owner, body: update })).status).toBe(201);
  });

  it("refuses a typed progress with 400 at path progress (T8)", async () => {
    const res = await post(CC1_TASK, { authorization: cc1, body: { ...update, progress: 50 } });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((i) => i.path)).toContain("progress");
  });

  it("replays the same status and body with Idempotency-Replayed: true and lands one row", async () => {
    const before = (await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total;
    const init = {
      authorization: cc1,
      body: update,
      headers: { "idempotency-key": "rest-replay-1" },
    };
    const first = await post(CC1_TASK, init);
    const second = await post(CC1_TASK, init);
    expect(first.status).toBe(201);
    expect(
      first.headers.get("idempotency-replayed"),
      "the first answer is not a replay",
    ).toBeNull();
    expect(second.status, "a replay keeps the status").toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    expect(await second.json(), "a replay keeps the body").toEqual(await first.json());
    expect((await updatesPage(api, `taskId=${CC1_TASK}`)).counts.total, "one row landed").toBe(
      before + 1,
    );
  });

  it("is 422 for the same Idempotency-Key with a different body", async () => {
    const headers = { "idempotency-key": "rest-replay-2" };
    expect((await post(CC1_TASK, { authorization: cc1, body: update, headers })).status).toBe(201);
    const res = await post(CC1_TASK, {
      authorization: cc1,
      body: { ...update, note: "different" },
      headers,
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("idempotency_mismatch");
  });

  it("is 409 with error.currentVersion for a stale If-Match, and 201 for the current version in either form", async () => {
    expect((await post(CC1_TASK, { authorization: cc1, body: update })).status).toBe(201);
    const version = await taskVersion(CC1_TASK);
    const stale = await post(CC1_TASK, {
      authorization: cc1,
      body: update,
      headers: { "if-match": String(version - 1) },
    });
    expect(stale.status).toBe(409);
    const error = await errorOf(stale);
    expect(error.code).toBe("version_conflict");
    expect(error.currentVersion).toBe(version);
    const quoted = await post(CC1_TASK, {
      authorization: cc1,
      body: update,
      headers: { "if-match": `"${version}"` },
    });
    expect(quoted.status, 'If-Match: "<version>" is accepted').toBe(201);
    const bare = await post(CC1_TASK, {
      authorization: cc1,
      body: update,
      headers: { "if-match": String(version + 1) },
    });
    expect(bare.status, "If-Match: <version> is accepted").toBe(201);
  });

  it.each([['W/"1"'], ["abc"]])("is 400 at path If-Match for If-Match %s", async (ifMatch) => {
    const res = await post(CC1_TASK, {
      authorization: cc1,
      body: update,
      headers: { "if-match": ifMatch },
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((i) => i.path)).toContain("If-Match");
  });

  it("is 400 for bad JSON and a non-object body, and 413 for a body over 1 MiB", async () => {
    expect((await errorOf(await post(CC1_TASK, { authorization: cc1, body: "{" }))).code).toBe(
      "invalid",
    );
    expect((await errorOf(await post(CC1_TASK, { authorization: cc1, body: "[]" }))).code).toBe(
      "invalid",
    );
    const big = JSON.stringify({ ...update, note: "x".repeat(1024 * 1024) });
    const res = await post(CC1_TASK, { authorization: cc1, body: big });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe("payload_too_large");
  });
});

describe("other writes", () => {
  it("PUT /tasks/:id/requirements upserts by text, and refuses a typed progress", async () => {
    const body = { requirement: "B1 REST contract check", state: "NOT_RUN" };
    const res = await api.rest(requirements, "PUT", `/api/v1/tasks/${CC1_TASK}/requirements`, {
      params: { id: CC1_TASK },
      authorization: cc1,
      body,
    });
    expect(res.status, "a new requirement is 201").toBe(201);
    expect(await res.json()).toMatchObject({
      requirement: { task_id: CC1_TASK, requirement: body.requirement, state: "NOT_RUN" },
      task: { id: CC1_TASK },
    });
    const typed = await api.rest(requirements, "PUT", `/api/v1/tasks/${CC1_TASK}/requirements`, {
      params: { id: CC1_TASK },
      authorization: cc1,
      body: { ...body, progress: 50 },
    });
    expect(typed.status).toBe(400);
    expect((await errorOf(typed)).issues?.map((i) => i.path)).toContain("progress");
  });

  it("POST /decisions lets an agent request a decision, and needs a key", async () => {
    const body = {
      question: "Adopt the B1 REST contract?",
      summary: "Adopt the B1 REST contract.",
      description: "Requested by the REST contract test.",
      subject: "B1",
      gateType: "scope",
      options: [],
      blocks: [CC1_TASK],
      sourceUrl: SOURCE_URL,
    };
    const res = await api.rest(decisions, "POST", "/api/v1/decisions", {
      authorization: cc1,
      body,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      decision: { requested_by: "CC1", status: "Pending", blocks: [CC1_TASK] },
    });
    expect(
      (await errorOf(await api.rest(decisions, "POST", "/api/v1/decisions", { body }))).code,
    ).toBe("unauthorized");
  });
});

describe("GET /api/v1/decisions", () => {
  type DecisionRow = { readonly id: string; readonly gate_type: string; readonly status: string };
  type DecisionsPage = {
    readonly items: readonly DecisionRow[];
    readonly nextCursor: string | null;
    readonly counts: { readonly total: number };
  };

  async function decisionsPage(query: string): Promise<DecisionsPage> {
    const res = await api.rest(decisions, "GET", `/api/v1/decisions?${query}`);
    expect(res.status, `GET /api/v1/decisions?${query} is 200`).toBe(200);
    return (await res.json()) as DecisionsPage;
  }

  // The workspace holds only open decisions now, so the expected ids come from the seed's hand-copied truth.
  function seededIds(keep: (d: DecisionRow) => boolean): string[] {
    const ids = DECISIONS.map((d) => ({ id: d.id, gate_type: d.gateType, status: d.status }))
      .filter(keep)
      .map((d) => d.id);
    expect(ids.length, "the seed has matching decisions").toBeGreaterThan(0);
    return ids.sort();
  }

  it.each([
    { filter: "gateType", value: "policy", field: "gate_type" },
    { filter: "status", value: "Decided", field: "status" },
  ] as const)(
    "filtered by $filter=$value returns exactly the seeded decisions with that $field",
    async ({ filter, value, field }) => {
      const expected = seededIds((d) => d[field] === value);
      const page = await decisionsPage(`${filter}=${value}&limit=100`);
      expect(
        page.items.every((d) => d[field] === value),
        `only ${field} ${value}`,
      ).toBe(true);
      expect(page.items.map((d) => d.id).sort(), "every matching decision").toEqual(expected);
      expect(page.counts.total).toBe(expected.length);
    },
  );

  it("pages gateType=merge with limit=1 and the cursor until every matching decision is seen once", async () => {
    const expected = seededIds((d) => d.gate_type === "merge");
    expect(expected.length, "more than one page").toBeGreaterThan(1);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await decisionsPage(
        `gateType=merge&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(1);
      expect(
        page.items.every((d) => d.gate_type === "merge"),
        "only merge decisions",
      ).toBe(true);
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(seen).size, "no decision twice").toBe(seen.length);
    expect(seen.sort(), "every merge decision").toEqual(expected);
  });

  it("answers an unlisted method with 405 and Allow listing GET, HEAD and POST", async () => {
    const res = await api.rest(decisions, "DELETE", "/api/v1/decisions");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")?.split(", ").sort()).toEqual(["GET", "HEAD", "POST"]);
    expect((await errorOf(res)).code).toBe("method_not_allowed");
    expect((await api.rest(decisions, "HEAD", "/api/v1/decisions")).status, "HEAD is served").toBe(
      200,
    );
  });
});

describe("POST /api/v1/decisions/:id/decide", () => {
  const DECISION = "D-01";
  const decided = {
    status: "Decided",
    decisionText: "Decided by the REST contract test.",
    sourceUrl: SOURCE_URL,
  };

  type DecisionRow = { readonly id: string; readonly version: number };

  function decideAs(
    authorization: string,
    body: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    return api.rest(decide, "POST", `/api/v1/decisions/${DECISION}/decide`, {
      params: { id: DECISION },
      authorization,
      headers,
      body,
    });
  }

  async function decisionRow(): Promise<DecisionRow> {
    const res = await api.rest(workspace, "GET", "/api/v1/workspace");
    expect(res.status, "GET /api/v1/workspace is 200").toBe(200);
    const { decisions } = (await res.json()) as { decisions: DecisionRow[] };
    const row = decisions.find((d) => d.id === DECISION);
    if (!row) throw new Error(`seed decision ${DECISION} is missing from the workspace`);
    return row;
  }

  it("is 403 for an agent and 200 for the owner", async () => {
    const refused = await decideAs(cc1, decided);
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("forbidden");
    const res = await decideAs(owner, decided);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: { id: DECISION, status: "Decided" } });
  });

  it.each([
    { path: "decisionText", body: { status: decided.status, sourceUrl: decided.sourceUrl } },
    { path: "status", body: { ...decided, status: "Pending" } },
    { path: "sourceUrl", body: { ...decided, sourceUrl: "not a url" } },
  ])(
    "is 400 with an issue at path $path for the owner, and changes nothing",
    async ({ path, body }) => {
      const before = await decisionRow();
      const res = await decideAs(owner, body);
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe("invalid");
      expect(error.issues?.map((i) => i.path)).toContain(path);
      expect(await decisionRow(), "a refused decide changes nothing").toEqual(before);
    },
  );

  it("is 409 with error.currentVersion for a stale If-Match, and 200 for the current version", async () => {
    const read = await decisionRow();
    const other = { ...decided, decisionText: "Decided in another session." };
    const first = await decideAs(owner, other, { "if-match": String(read.version) });
    expect(first.status, "the version just read is accepted").toBe(200);
    const current = await decisionRow();
    expect(current.version, "a decide bumps the decision's version").toBeGreaterThan(read.version);

    const stale = await decideAs(owner, decided, { "if-match": String(read.version) });
    expect(stale.status).toBe(409);
    const error = await errorOf(stale);
    expect(error.code).toBe("version_conflict");
    expect(error.currentVersion).toBe(current.version);
    expect(await decisionRow(), "a refused decide changes nothing").toEqual(current);

    const retry = await decideAs(owner, decided, { "if-match": String(current.version) });
    expect(retry.status, "the current version is accepted").toBe(200);
    expect(await retry.json()).toMatchObject({ decision: { decision_text: decided.decisionText } });
  });
});

describe("keys (owner only)", () => {
  it("the owner issues a key that resolves, then revokes it so it no longer resolves", async () => {
    const res = await api.rest(keys, "POST", "/api/v1/keys", {
      authorization: owner,
      body: { agentId: "Codex", label: "REST contract test" },
    });
    expect(res.status).toBe(201);
    const issued = (await res.json()) as { keyId: string; plaintext: string };
    expect(issued.plaintext).toMatch(/^hxc_codex_[A-Za-z0-9_-]{32}$/);
    expect(await workspaceActor(`Bearer ${issued.plaintext}`)).toEqual({
      agentId: "Codex",
      role: "agent",
    });

    const revoked = await api.rest(key, "DELETE", `/api/v1/keys/${issued.keyId}`, {
      params: { id: issued.keyId },
      authorization: owner,
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      keyId: issued.keyId,
      revokedAt: expect.any(String),
    });
    expect(
      await workspaceActor(`Bearer ${issued.plaintext}`),
      "a revoked key resolves to nobody",
    ).toBeNull();
  });

  it("an agent may not issue a key", async () => {
    const res = await api.rest(keys, "POST", "/api/v1/keys", {
      authorization: cc1,
      body: { agentId: "Codex", label: "not allowed" },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("forbidden");
  });

  it("an Idempotency-Key on a key write is 400, because key writes are not idempotent", async () => {
    const headers = { "idempotency-key": "keys-1" };
    const issue = await api.rest(keys, "POST", "/api/v1/keys", {
      authorization: owner,
      headers,
      body: { agentId: "Codex", label: "with a key" },
    });
    expect(issue.status).toBe(400);
    expect((await errorOf(issue)).issues?.map((i) => i.path)).toContain("Idempotency-Key");
    const keyId = "00000000-0000-4000-8000-000000000000";
    const revoke = await api.rest(key, "DELETE", `/api/v1/keys/${keyId}`, {
      params: { id: keyId },
      authorization: owner,
      headers,
    });
    expect(revoke.status).toBe(400);
    expect((await errorOf(revoke)).issues?.map((i) => i.path)).toContain("Idempotency-Key");
  });
});

describe("GET /api/v1/workspace", () => {
  it("names the caller as actor, and is null without a key or with an unknown one", async () => {
    expect(await workspaceActor()).toBeNull();
    expect(await workspaceActor(UNKNOWN_KEY)).toBeNull();
    expect(await workspaceActor(cc1)).toEqual({ agentId: "CC1", role: "agent" });
    expect(await workspaceActor(owner)).toEqual({ agentId: "Agent Zero", role: "owner" });
  });

  it("serves the workspace to everyone", async () => {
    const res = await api.rest(workspace, "GET", "/api/v1/workspace");
    const body = (await res.json()) as { tasks: Json[] };
    expect(body.tasks.map((t) => t["id"])).toContain(CC1_TASK);
  });

  it("answers HEAD like GET, and an unlisted method with 405 and Allow", async () => {
    expect((await api.rest(workspace, "HEAD", "/api/v1/workspace")).status).toBe(200);
    const res = await api.rest(workspace, "DELETE", "/api/v1/workspace");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect((await errorOf(res)).code).toBe("method_not_allowed");
  });
});

describe("GET /api/v1/tasks/:id", () => {
  it("returns the task with its version, its requirements and the decisions that block it", async () => {
    const res = await api.rest(task, "GET", `/api/v1/tasks/${CC2_TASK}`, {
      params: { id: CC2_TASK },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: Json;
      requirements: Json[];
      decisions: { id: string; blocks: string[] }[];
    };
    expect(body.task).toMatchObject({
      id: CC2_TASK,
      version: expect.any(Number),
      progress: expect.any(Object),
    });
    expect(body.requirements).toHaveLength(3);
    expect(body.requirements.every((r) => r["task_id"] === CC2_TASK)).toBe(true);
    expect(body.decisions.map((d) => d.id)).toEqual(
      expect.arrayContaining(["D-01", "D-03", "D-05", "D-17"]),
    );
    expect(body.decisions.every((d) => d.blocks.includes(CC2_TASK))).toBe(true);
  });

  it("is a JSON 404 for an unknown task", async () => {
    const res = await api.rest(task, "GET", "/api/v1/tasks/NOPE-1", { params: { id: "NOPE-1" } });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
  });
});

describe("GET /api/v1/updates and /api/v1/activity", () => {
  it("filters by task and pages with the cursor until every row is seen once", async () => {
    for (const note of ["one", "two", "three"]) {
      expect((await post(CC1_TASK, { authorization: cc1, body: { ...update, note } })).status).toBe(
        201,
      );
    }
    expect((await post(CC2_TASK, { authorization: owner, body: update })).status).toBe(201);

    const seen: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await updatesPage(
        api,
        `taskId=${CC1_TASK}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(1);
      expect(
        page.items.every((u) => u["task_id"] === CC1_TASK),
        "only the filtered task",
      ).toBe(true);
      expect(page.counts.total).toBe(3);
      seen.push(...page.items.map((u) => u["id"]));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size, "no row twice").toBe(3);
  });

  it("is 400 for a limit over 100", async () => {
    const res = await api.rest(updates, "GET", "/api/v1/updates?limit=101");
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid");
  });

  it("lists activity filtered by actor and entity", async () => {
    expect((await post(CC1_TASK, { authorization: cc1, body: update })).status).toBe(201);
    const res = await api.rest(activity, "GET", "/api/v1/activity?actor=CC1&entity=task");
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Json[] };
    expect(items[0]).toMatchObject({
      actor: "CC1",
      action: "task.progress",
      entity: "task",
      entity_id: CC1_TASK,
    });
  });
});

describe("routing", () => {
  it("an unlisted method on a write route is 405 with Allow: POST", async () => {
    const res = await api.rest(postUpdate, "GET", `/api/v1/tasks/${CC1_TASK}/updates`, {
      params: { id: CC1_TASK },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect((await errorOf(res)).code).toBe("method_not_allowed");
  });

  it.each([["GET"], ["POST"]])("an unknown /api/v1 path is a JSON 404 for %s", async (method) => {
    const res = await api.rest(
      notFound,
      method,
      "/api/v1/nope",
      method === "POST" ? { body: {} } : {},
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
  });
});
