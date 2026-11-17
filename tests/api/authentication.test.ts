import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Route as activity } from "@/routes/api/v1/activity";
import { Route as decisions } from "@/routes/api/v1/decisions";
import { Route as decide } from "@/routes/api/v1/decisions/$id/decide";
import { Route as keys } from "@/routes/api/v1/keys";
import { Route as key } from "@/routes/api/v1/keys/$id";
import { Route as tasks } from "@/routes/api/v1/tasks";
import { Route as task } from "@/routes/api/v1/tasks/$id";
import { Route as requirements } from "@/routes/api/v1/tasks/$id/requirements";
import { Route as postUpdate } from "@/routes/api/v1/tasks/$id/updates";
import { Route as updates } from "@/routes/api/v1/updates";
import { Route as workspace } from "@/routes/api/v1/workspace";
import { Route as mcpRoute } from "@/routes/mcp";
import { errorOf, startApi, UNKNOWN_KEY, type Api, type ServerRoute } from "./harness";

const CHALLENGE = 'Bearer realm="hx-centcom"';
const KEY_ID = "00000000-0000-4000-8000-000000000000";
const OVER_CAP = JSON.stringify({ note: "x".repeat(1024 * 1024) });

type Call = {
  readonly name: string;
  readonly route: ServerRoute;
  readonly method: string;
  readonly path: string;
  readonly params?: Readonly<Record<string, string>>;
};

const BODY_WRITES: readonly Call[] = [
  {
    name: "POST /api/v1/tasks/:id/updates",
    route: postUpdate,
    method: "POST",
    path: "/api/v1/tasks/CC-01/updates",
    params: { id: "CC-01" },
  },
  {
    name: "PUT /api/v1/tasks/:id/requirements",
    route: requirements,
    method: "PUT",
    path: "/api/v1/tasks/CC-01/requirements",
    params: { id: "CC-01" },
  },
  { name: "POST /api/v1/decisions", route: decisions, method: "POST", path: "/api/v1/decisions" },
  {
    name: "POST /api/v1/decisions/:id/decide",
    route: decide,
    method: "POST",
    path: "/api/v1/decisions/D-01/decide",
    params: { id: "D-01" },
  },
  { name: "POST /api/v1/keys", route: keys, method: "POST", path: "/api/v1/keys" },
];

const REVOKE: Call = {
  name: "DELETE /api/v1/keys/:id",
  route: key,
  method: "DELETE",
  path: `/api/v1/keys/${KEY_ID}`,
  params: { id: KEY_ID },
};

const PUBLIC_READS: readonly Call[] = [
  { name: "GET /api/v1/workspace", route: workspace, method: "GET", path: "/api/v1/workspace" },
  { name: "HEAD /api/v1/workspace", route: workspace, method: "HEAD", path: "/api/v1/workspace" },
  {
    name: "GET /api/v1/tasks/:id",
    route: task,
    method: "GET",
    path: "/api/v1/tasks/CC-01",
    params: { id: "CC-01" },
  },
  { name: "GET /api/v1/tasks", route: tasks, method: "GET", path: "/api/v1/tasks" },
  { name: "GET /api/v1/updates", route: updates, method: "GET", path: "/api/v1/updates" },
  { name: "GET /api/v1/activity", route: activity, method: "GET", path: "/api/v1/activity" },
  { name: "GET /api/v1/decisions", route: decisions, method: "GET", path: "/api/v1/decisions" },
];

const NO_KEY = [
  ["no Authorization header", undefined],
  ["an unknown key", UNKNOWN_KEY],
] as const;

let api: Api;
let owner: string;
// Nothing in this file writes, so one database serves every test.
beforeAll(async () => {
  api = await startApi();
  owner = await api.authFor("Agent Zero");
});
afterAll(async () => {
  await api.close();
});

function send(call: Call, authorization: string | undefined, body?: unknown): Promise<Response> {
  return api.rest(call.route, call.method, call.path, {
    params: call.params ?? {},
    authorization,
    ...(body === undefined ? {} : { body }),
  });
}

async function expectChallenge(res: Response, label: string): Promise<void> {
  expect(res.status, `${label} is 401`).toBe(401);
  expect(res.headers.get("www-authenticate"), `${label} carries the Bearer challenge`).toBe(
    CHALLENGE,
  );
  expect((await errorOf(res)).code, `${label} is unauthorized`).toBe("unauthorized");
}

describe("401 challenge", () => {
  it("every REST 401 carries WWW-Authenticate: Bearer realm=hx-centcom", async () => {
    for (const [caller, authorization] of NO_KEY) {
      for (const call of BODY_WRITES) {
        await expectChallenge(await send(call, authorization, {}), `${call.name} with ${caller}`);
      }
      await expectChallenge(await send(REVOKE, authorization), `${REVOKE.name} with ${caller}`);
    }
  });

  it("the /mcp 401 for a key that does not resolve carries the same challenge", async () => {
    const res = await api.rest(mcpRoute, "POST", "/mcp", {
      authorization: UNKNOWN_KEY,
      headers: { accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    await expectChallenge(res, "POST /mcp with an unknown key");
  });
});

describe("authentication before the body", () => {
  it("a write without a valid key is 401 even when its body is not JSON", async () => {
    for (const [caller, authorization] of NO_KEY) {
      for (const call of BODY_WRITES) {
        await expectChallenge(await send(call, authorization, "{"), `${call.name} with ${caller}`);
      }
    }
  });

  it("a write without a valid key is 401 even when its body is over 1 MiB", async () => {
    for (const [caller, authorization] of NO_KEY) {
      for (const call of BODY_WRITES) {
        await expectChallenge(
          await send(call, authorization, OVER_CAP),
          `${call.name} with ${caller}`,
        );
      }
    }
  });

  it("with a valid key the body is still checked: 400 for bad JSON and 413 over 1 MiB", async () => {
    for (const call of BODY_WRITES) {
      const bad = await send(call, owner, "{");
      expect(bad.status, `${call.name} with bad JSON`).toBe(400);
      expect((await errorOf(bad)).code).toBe("invalid");
      const big = await send(call, owner, OVER_CAP);
      expect(big.status, `${call.name} over 1 MiB`).toBe(413);
      expect((await errorOf(big)).code).toBe("payload_too_large");
    }
  });

  it("public reads stay public with no key and with an unknown key", async () => {
    for (const [caller, authorization] of NO_KEY) {
      for (const call of PUBLIC_READS) {
        const res = await send(call, authorization);
        expect(res.status, `${call.name} with ${caller}`).toBe(200);
      }
    }
  });
});
