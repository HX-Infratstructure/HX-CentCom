import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isReadOnlyMethod } from "../live-check/session.ts";
import { contrastRatio, isLargeText } from "../live-check/contrast.ts";
import { parseArgs } from "../live-check/cli.ts";
import { CheckRecorder } from "../live-check/recorder.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../live-check/types.ts";

const NOW = new Date("2026-11-16T17:00:00.000Z");

describe("isReadOnlyMethod", () => {
  test("allows GET and HEAD in any case", () => {
    for (const m of ["GET", "HEAD", "get", "head"]) assert.equal(isReadOnlyMethod(m), true, m);
  });
  test("refuses every write method and OPTIONS", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      assert.equal(isReadOnlyMethod(m), false, m);
  });
});

describe("contrast", () => {
  test("black on white is 21, equal colors are 1", () => {
    assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
    assert.equal(contrastRatio([119, 119, 119], [119, 119, 119]), 1);
  });
  test("#767676 on white is about 4.54", () => {
    assert.equal(Math.round(contrastRatio([118, 118, 118], [255, 255, 255]) * 100) / 100, 4.54);
  });
  test("large text is 24px, or 18.66px bold", () => {
    assert.equal(isLargeText(24, 400), true);
    assert.equal(isLargeText(23.9, 400), false);
    assert.equal(isLargeText(18.66, 700), true);
    assert.equal(isLargeText(18.66, 600), false);
  });
});

describe("parseArgs", () => {
  test("reads --base and --out", () => {
    assert.deepEqual(parseArgs(["--base", "http://h:8420", "--out", "/tmp/x"]), {
      base: "http://h:8420",
      out: "/tmp/x",
    });
  });
  test("refuses a missing argument", () => {
    assert.throws(() => parseArgs(["--base", "http://h:8420"]), /--out/);
    assert.throws(() => parseArgs(["--out", "/tmp/x"]), /--base/);
  });
  test("refuses a base that is not http or https", () => {
    assert.throws(() => parseArgs(["--base", "ftp://h", "--out", "/tmp/x"]), /http/);
    assert.throws(() => parseArgs(["--base", "not a url", "--out", "/tmp/x"]), /--base/);
  });
});

function fakeCheck(id: string, run: () => Promise<CheckOutcome>): LiveCheck {
  return { id, requirement: `req ${id}`, run };
}

function fakeContext(consoleErrors: string[][]): CheckContext {
  const session = { takeConsoleErrors: () => consoleErrors.shift() ?? [] };
  return {
    base: "http://h",
    session,
    api: {},
    screenshot: async (n: string) => n,
  } as unknown as CheckContext;
}

describe("CheckRecorder", () => {
  test("records statuses, the UTC time and the exit code", async () => {
    const out = mkdtempSync(join(tmpdir(), "live-check-"));
    try {
      const rec = new CheckRecorder(out, () => NOW);
      const ctx = fakeContext([[], [], ["Uncaught TypeError: x"], []]);
      await rec.run(
        fakeCheck("pass", async () => ({ status: "PASS", evidence: { rows: 3 } })),
        ctx,
      );
      await rec.run(
        fakeCheck("lne", async () => ({
          status: "LIVE_NOT_EXECUTED",
          evidence: {},
          reason: "no data",
        })),
        ctx,
      );
      await rec.run(
        fakeCheck("console", async () => ({ status: "PASS", evidence: {} })),
        ctx,
      );
      await rec.run(
        fakeCheck("throws", async () => {
          throw new Error("boom");
        }),
        ctx,
      );
      const byId = Object.fromEntries(rec.results().map((r) => [r.id, r]));
      assert.equal(byId["pass"]?.status, "PASS");
      assert.equal(byId["pass"]?.at, NOW.toISOString());
      assert.equal(byId["lne"]?.status, "LIVE_NOT_EXECUTED");
      assert.equal(byId["console"]?.status, "FAIL");
      assert.deepEqual(byId["console"]?.consoleErrors, ["Uncaught TypeError: x"]);
      assert.equal(byId["throws"]?.status, "FAIL");
      assert.match(byId["throws"]?.reason ?? "", /boom/);
      assert.deepEqual(rec.summary(), { PASS: 1, FAIL: 2, LIVE_NOT_EXECUTED: 1 });
      assert.equal(rec.exitCode(0), 1);
      rec.write();
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.equal(written.results.length, 4);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  test("exits 0 with no FAIL and no blocked request, 1 with a blocked request", async () => {
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    const ctx = fakeContext([]);
    await rec.run(
      fakeCheck("pass", async () => ({ status: "PASS", evidence: {} })),
      ctx,
    );
    await rec.run(
      fakeCheck("lne", async () => ({ status: "LIVE_NOT_EXECUTED", evidence: {} })),
      ctx,
    );
    assert.equal(rec.exitCode(0), 0);
    assert.equal(rec.exitCode(1), 1);
  });
});
