import { useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toAppError } from "@/components/adapt";
import type { OwnerActions, Outcome } from "@/components/model";
import { forgetOwnerKey, useOwnerKey } from "@/components/owner-key";

/**
 * The only module that sends the owner key. Owner mode exists only while this tab holds one, and the REST routes check
 * it on every write. Writes go through REST, never a server function, which carries no bearer header.
 */
export function useOwnerActions(): OwnerActions | null {
  const key = useOwnerKey();
  const queryClient = useQueryClient();
  return useMemo(() => (key === null ? null : ownerActions(key, queryClient)), [key, queryClient]);
}

type OwnerRequest = {
  readonly path: string;
  /** One write target. A resend to the same scope with the same input reuses the Idempotency-Key. */
  readonly scope: string;
  readonly input: unknown;
  readonly ifMatch?: number | undefined;
  /** Sent as JSON when present; revert sends no body. */
  readonly body?: unknown;
};

type Attempt = { readonly input: string; readonly key: string };

function ownerActions(ownerKey: string, queryClient: QueryClient): OwnerActions {
  const attempts = new Map<string, Attempt>();
  // A write can touch any read, so every active query refetches; no list of keys has to keep up with the writes.
  const refresh = () => void queryClient.invalidateQueries();
  const send = (request: OwnerRequest) => sendOwnerRequest(ownerKey, request, attempts, refresh);
  return {
    decide: (target, input) =>
      send({
        path: `/api/v1/decisions/${encodeURIComponent(target.id)}/decide`,
        scope: `decide:${target.id}`,
        // The server hashes If-Match with the body, so a resend under a new version needs a new key.
        input: [target.version, input],
        ifMatch: target.version,
        body: input,
      }),
    revert: (activityId) =>
      send({
        path: `/api/v1/activity/${encodeURIComponent(activityId)}/revert`,
        scope: `revert:${activityId}`,
        input: null,
      }),
    rejectKey: forgetOwnerKey,
  };
}

/**
 * The key lives only until the server answers. A request that may never have arrived (a network failure, or an answer
 * with no readable body) keeps it, so the resend replays instead of writing twice. Any answer drops it, so a later
 * deliberate write never replays an old one: the server stores a key's response for 24 hours.
 */
async function sendOwnerRequest(
  ownerKey: string,
  request: OwnerRequest,
  attempts: Map<string, Attempt>,
  refresh: () => void,
): Promise<Outcome> {
  const input = JSON.stringify(request.input);
  const prior = attempts.get(request.scope);
  const key = prior?.input === input ? prior.key : newIdempotencyKey();
  attempts.set(request.scope, { input, key });
  const outcome = await post(ownerKey, request, key);
  if (outcome.ok || outcome.error.code !== "unreachable") attempts.delete(request.scope);
  if (outcome.ok || outcome.error.code === "version_conflict") refresh();
  return outcome;
}

async function post(ownerKey: string, request: OwnerRequest, key: string): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch(request.path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerKey}`,
        "Idempotency-Key": key,
        ...(request.ifMatch === undefined ? {} : { "If-Match": String(request.ifMatch) }),
        ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
  if (response.ok) return { ok: true };
  const body: unknown = await response.json().catch(() => null);
  return { ok: false, error: toAppError(body) };
}

/**
 * HX-7 serves plain HTTP, which is not a secure context, so `crypto.randomUUID` does not exist there;
 * `getRandomValues` does.
 */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
