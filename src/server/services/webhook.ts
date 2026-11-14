/**
 * F7b (CC1's design H1): the signed `decision.decided` webhook. src/start.ts reads the configuration, and `fetch`
 * arrives through ServiceDeps. Delivery is DEV/TEST best effort: after the commit, every URL at once, a 3 s timeout
 * each, no retry. Receivers skip events whose actor is themselves.
 */
import { createHmac } from "node:crypto";
import type { Committed } from "./pipeline";
import type { DecidedDecision, ServiceDeps } from "./types";
import type { decidePlan } from "./writes";

export type WebhookConfig = { readonly urls: readonly string[]; readonly secret: string };

const URLS = "CENTCOM_WEBHOOK_URLS";
const SECRET_FILE = "CENTCOM_WEBHOOK_SECRET_FILE";
const TIMEOUT_MS = 3000;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Null when both variables are unset or empty. A partial or invalid setting throws an Error that names the variable,
 * and an entry by its position, never a URL (it may hold credentials) or the secret. `readSecret` refuses a secret
 * file that is not mode 600 or is empty.
 */
export function webhookConfig(
  env: Readonly<Record<string, string | undefined>>,
  readSecret: (path: string | undefined, name: string) => string,
): WebhookConfig | null {
  const list = env[URLS]?.trim() ?? "";
  const secretFile = env[SECRET_FILE]?.trim() ?? "";
  if (list === "" && secretFile === "") return null;
  if (secretFile === "") throw new Error(`${SECRET_FILE} must be set when ${URLS} is set`);
  if (list === "") throw new Error(`${URLS} must be set when ${SECRET_FILE} is set`);
  const urls = list.split(",").map((url) => url.trim());
  urls.forEach((url, i) => {
    if (!isHttpUrl(url)) throw new Error(`${URLS} entry ${i + 1} is not an http(s) URL`);
  });
  return { urls, secret: readSecret(secretFile, SECRET_FILE) };
}

type DecidePlan = ReturnType<typeof decidePlan>;

/** Adds the delivery to decide's plan as its after-commit work; without a webhook the plan is returned unchanged. */
export function withDecidedWebhook(
  plan: DecidePlan,
  deps: Pick<ServiceDeps, "fetch" | "webhook">,
): DecidePlan {
  const { fetch, webhook } = deps;
  if (webhook === null) return plan;
  return { ...plan, afterCommit: (committed) => deliver(fetch, webhook, committed) };
}

/** Origin and path only: the userinfo and query of a URL may hold credentials. */
function logTarget(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

async function deliver(
  fetch: ServiceDeps["fetch"],
  { urls, secret }: WebhookConfig,
  { activityId, at, actor, value }: Committed<DecidedDecision>,
): Promise<void> {
  const body = JSON.stringify({
    id: activityId,
    type: "decision.decided",
    occurredAt: at,
    actor: actor.agentId,
    decision: value.decision,
  });
  const headers = {
    "content-type": "application/json",
    "x-centcom-event-id": activityId,
    "x-centcom-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  };
  await Promise.all(urls.map((url) => post(fetch, url, { headers, body }, activityId)));
}

/** Settles instead of rejecting, so one receiver never stops another, and logs the outcome. */
async function post(
  fetch: ServiceDeps["fetch"],
  url: string,
  request: { readonly headers: Record<string, string>; readonly body: string },
  eventId: string,
): Promise<void> {
  const target = `webhook ${eventId} ${logTarget(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", ...request, signal: controller.signal });
    await res.body?.cancel();
    if (res.ok) console.info(`${target} -> ${res.status}`);
    else console.warn(`${target} -> ${res.status}`);
  } catch (error) {
    console.warn(`${target} -> ${error instanceof Error ? error.name : "error"}`);
  } finally {
    clearTimeout(timer);
  }
}
