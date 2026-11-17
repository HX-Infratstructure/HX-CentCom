import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PlaywrightSession } from "../live-check/session.ts";

const PAGE = `<!doctype html><title>session</title>
<form method="post" action="/write" target="_blank"><button id="write">write</button></form>
<button id="open">open</button>
<script>
  document.getElementById("open").onclick = () => {
    console.error("opener console error");
    setTimeout(() => { throw new Error("opener page error"); });
    window.open("/popup");
  };
</script>`;
const POPUP = `<!doctype html><title>popup</title>
<script>console.error("popup console error"); throw new Error("popup page error");</script>`;

interface TestServer {
  readonly base: string;
  readonly writes: readonly string[];
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const writes: string[] = [];
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") writes.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/popup" ? POPUP : PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    writes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
}

describe("PlaywrightSession read-only guard", () => {
  test("blocks and records a POST form that a popup submits", { timeout: 60_000 }, async () => {
    const server = await startServer();
    const session = await PlaywrightSession.open(server.base);
    try {
      assert.equal(await session.goto("/"), 200, "GET page load is allowed");
      const popup = session.page.waitForEvent("popup");
      await session.page.click("#write");
      await popup;
      const write = `POST ${server.base}/write`;
      await until(
        () => server.writes.length > 0 || session.blockedRequests().includes(write),
        5_000,
      );
      assert.deepEqual(server.writes, [], "the popup's POST never reaches the server");
      assert.deepEqual(
        session.blockedRequests(),
        [write],
        "the popup's POST is recorded as blocked",
      );
    } finally {
      await session.close();
      await server.close();
    }
  });

  test("collects opener and popup errors exactly once", { timeout: 60_000 }, async () => {
    const server = await startServer();
    const session = await PlaywrightSession.open(server.base);
    try {
      assert.equal(await session.goto("/"), 200);
      assert.deepEqual(session.takeConsoleErrors(), [], "the opener logs no errors on load");
      const popupOpened = session.page.waitForEvent("popup");
      await session.page.click("#open");
      const popup = await popupOpened;
      const errors: string[] = [];
      await until(() => {
        errors.push(...session.takeConsoleErrors());
        return errors.length >= 4;
      }, 5_000);
      await popup.waitForLoadState("load");
      errors.push(...session.takeConsoleErrors());
      assert.deepEqual([...errors].sort(), [
        "opener console error",
        "opener page error",
        "popup console error",
        "popup page error",
      ]);
    } finally {
      await session.close();
      await server.close();
    }
  });
});
