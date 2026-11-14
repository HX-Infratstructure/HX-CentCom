// F7b (CC1's design H1): a decide that commits posts {id, type: "decision.decided", occurredAt, actor, decision} to
// every configured URL, signed with HMAC-SHA256 of the raw body. The event id is the decide's activity row id. It is
// sent after the commit, each URL with a 3 s timeout and no retry, and a failed delivery never fails the decide. The
// log names the event and the receiver, never the secret, the signature or the body.
import { createHmac } from "node:crypto";
import { format } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import type { Actor, DecideInput } from "@/server/services";

/** A sentinel standing in for a secret, so a test can show it never reaches a log line. */
const SECRET = "whsec-sentinel-decide";
const A = "https://a.test/hooks/centcom";
const B = "https://user:pw@b.test/in?token=abc";
const DECIDE: DecideInput = {
  status: "Decided",
  decisionText: "Merge PR #7 as reviewed.",
  sourceUrl: "https://github.com/HX-Infratstructure/HX-CentCom/pull/7",
};

type Call = { readonly url: string; readonly init: RequestInit };
type Respond = (url: string, init: RequestInit) => Promise<Response>;

function receiver(respond: Respond) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetch };
}
const accepted: Respond = async () => new Response(null, { status: 204 });

const opened: TestDb[] = [];
async function start(
  fetch: typeof globalThis.fetch,
  webhook: { urls: string[]; secret: string } | null = { urls: [A, B], secret: SECRET },
): Promise<{ t: TestDb; owner: Actor }> {
  const t = await createTestDb(webhook === null ? { fetch } : { fetch, webhook });
  opened.push(t);
  return { t, owner: await t.actorFor("Agent Zero") };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((t) => t.close()));
});

const decideRow = async (t: TestDb, decisionId: string) => {
  const { items } = await t.services.listActivity({ entity: "decision", entityId: decisionId });
  const row = items.find((a) => a.action === "decision.decide");
  if (!row) throw new Error(`no decision.decide row for ${decisionId}`);
  return row;
};
const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe("F7b: a committed decide posts a signed webhook", () => {
  it("posts the signed event to every URL once the decide has committed", async () => {
    const committedWhenCalled: boolean[] = [];
    const opening: { t?: TestDb } = {};
    const rec = receiver(async () => {
      const decided = await opening.t?.services.listDecisions({ status: "Decided" });
      committedWhenCalled.push(decided?.items.some((d) => d.id === "D-01") ?? false);
      return new Response(null, { status: 204 });
    });
    const { t, owner } = await start(rec.fetch);
    opening.t = t;
    const result = await t.services.decide(owner, "D-01", DECIDE);
    const row = await decideRow(t, "D-01");

    expect(rec.calls.map((c) => c.url).sort()).toEqual([A, B].sort());
    expect(committedWhenCalled, "the receiver reads the decision as decided").toEqual([true, true]);
    for (const call of rec.calls) {
      expect(call.init.method).toBe("POST");
      expect(header(call, "content-type")).toBe("application/json");
      expect(header(call, "x-centcom-event-id")).toBe(row.id);
      const body = String(call.init.body);
      expect(header(call, "x-centcom-signature")).toBe(
        `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      );
      const event = JSON.parse(body) as Record<string, unknown>;
      expect(event).toEqual({
        id: row.id,
        type: "decision.decided",
        occurredAt: event["occurredAt"],
        actor: "Agent Zero",
        decision: JSON.parse(JSON.stringify(result.value.decision)),
      });
      expect(Date.parse(String(event["occurredAt"]))).toBe(Date.parse(row.created_at));
    }
  });

  it("sends nothing for a replay, a 404, a 409, or without a webhook configured", async () => {
    const rec = receiver(accepted);
    const { t, owner } = await start(rec.fetch);
    await t.services.decide(owner, "D-01", DECIDE, { idempotencyKey: "decide-d01" });
    expect(rec.calls).toHaveLength(2);
    const replay = await t.services.decide(owner, "D-01", DECIDE, { idempotencyKey: "decide-d01" });
    expect(replay.replayed).toBe(true);
    await expect(t.services.decide(owner, "D-99", DECIDE)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      t.services.decide(owner, "D-03", DECIDE, { expectedVersion: 99 }),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(rec.calls, "only the first decide sent").toHaveLength(2);

    const quiet = receiver(accepted);
    const unconfigured = await start(quiet.fetch, null);
    const decided = await unconfigured.t.services.decide(unconfigured.owner, "D-01", DECIDE);
    expect(decided.status).toBe(200);
    expect(quiet.calls).toEqual([]);
  });

  it("never fails the decide: a rejecting receiver and a 500 receiver leave it committed", async () => {
    const rec = receiver(async (url) => {
      if (url === A) throw new TypeError("fetch failed");
      return new Response("boom", { status: 500 });
    });
    const { t, owner } = await start(rec.fetch);
    const result = await t.services.decide(owner, "D-01", DECIDE);
    expect(rec.calls).toHaveLength(2);
    expect(result.status).toBe(200);
    expect(result.value.decision.status).toBe("Decided");
    const { items } = await t.services.listDecisions({ status: "Decided" });
    expect(items.map((d) => d.id)).toContain("D-01");
  });

  it("aborts a receiver that never answers at 3 s, and the decide still returns", async () => {
    const rec = receiver(
      (_, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const { t, owner } = await start(rec.fetch, { urls: [A], secret: SECRET });
    const startedAt = Date.now();
    const result = await t.services.decide(owner, "D-01", DECIDE);
    const elapsed = Date.now() - startedAt;
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.init.signal?.aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(2900);
    expect(elapsed).toBeLessThan(6000);
    expect(result.status).toBe(200);
  });

  it("logs each delivery with the event id, and never the secret, the signature, the body or a URL's credentials", async () => {
    const logged = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const rec = receiver(async (url) => {
      if (url === A) return new Response(null, { status: 204 });
      throw new TypeError(`fetch failed for ${url}`);
    });
    const { t, owner } = await start(rec.fetch);
    await t.services.decide(owner, "D-01", DECIDE);
    const row = await decideRow(t, "D-01");
    const lines = logged.flatMap((spy) => spy.mock.calls.map((args) => format(...args)));
    expect(
      lines.filter((l) => l.includes(row.id)),
      lines.join("\n"),
    ).toHaveLength(2);

    const body = String(rec.calls[0]?.init.body);
    const signature = header(rec.calls[0] as Call, "x-centcom-signature") ?? "";
    for (const hidden of [SECRET, signature, body, DECIDE.decisionText, "pw", "token=abc"]) {
      expect(
        lines.filter((l) => l.includes(hidden)),
        `a log line holds ${hidden.slice(0, 20)}`,
      ).toEqual([]);
    }
  });
});
