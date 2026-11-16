import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveApi, type FetchFn } from "../live-check/api.ts";

const BASE = "http://centcom.test";

// Like Node's fetch, the body errors once the request's signal aborts, and never ends otherwise.
function endlessBody(signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("["));
      signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  });
}

test("getJson names the path when the body outlasts the deadline", { timeout: 2_000 }, async () => {
  const fetchFn: FetchFn = async (_url, init) => new Response(endlessBody(init.signal));
  const api = new LiveApi(BASE, fetchFn, 50);
  await assert.rejects(api.getJson("/api/v1/tasks"), {
    message: "GET /api/v1/tasks timed out after 50 ms",
  });
});

test("getJson names the path when a 2xx body is not JSON", async () => {
  const api = new LiveApi(BASE, async () => new Response("<!doctype html><title>app</title>"));
  await assert.rejects(api.getJson("/api/v1/tasks"), {
    message: "GET /api/v1/tasks returned a body that is not JSON",
  });
});

test("getJson keeps the status error for a non-OK response", async () => {
  const api = new LiveApi(BASE, async () => new Response("{}", { status: 503 }));
  await assert.rejects(api.getJson("/api/v1/tasks"), { message: "GET /api/v1/tasks -> 503" });
});
