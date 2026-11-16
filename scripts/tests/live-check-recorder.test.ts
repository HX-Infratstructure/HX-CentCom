import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CheckRecorder } from "../live-check/recorder.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../live-check/types.ts";

const NOW = new Date("2026-11-16T20:00:00.000Z");

class FakeBrowser {
  #buffer: string[] = [];

  logError(message: string): void {
    this.#buffer.push(message);
  }

  context(): CheckContext {
    const session = {
      takeConsoleErrors: (): readonly string[] => {
        const errors = this.#buffer;
        this.#buffer = [];
        return errors;
      },
    };
    return {
      session,
      api: {},
      screenshot: async (name: string) => name,
    } as unknown as CheckContext;
  }
}

function check(id: string, outcome: CheckOutcome): LiveCheck {
  return {
    id,
    requirement: `req ${id}`,
    run: async () => outcome,
  };
}

function loggingCheck(
  browser: FakeBrowser,
  id: string,
  outcome: CheckOutcome,
  logs: readonly string[],
): LiveCheck {
  return {
    id,
    requirement: `req ${id}`,
    run: async () => {
      for (const message of logs) browser.logError(message);
      return outcome;
    },
  };
}

function resultFor(rec: CheckRecorder, id: string) {
  const result = rec.results().find((r) => r.id === id);
  assert.ok(result, `a result for ${id}`);
  return result;
}

describe("CheckRecorder console errors", () => {
  test("an error logged after a check returns is not charged to the next check", async () => {
    const browser = new FakeBrowser();
    const ctx = browser.context();
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    await rec.run(check("first", { status: "PASS", evidence: {} }), ctx);
    browser.logError("late error from first");
    await rec.run(check("second", { status: "PASS", evidence: {} }), ctx);
    const second = resultFor(rec, "second");
    assert.equal(second.status, "PASS", "second stays PASS");
    assert.deepEqual(second.consoleErrors, [], "second carries no error it did not produce");
  });

  test("an error logged between checks is kept as late evidence on the next result", async () => {
    const browser = new FakeBrowser();
    const ctx = browser.context();
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    await rec.run(check("first", { status: "PASS", evidence: {} }), ctx);
    browser.logError("late error from first");
    const second = await rec.run(
      check("second", { status: "LIVE_NOT_EXECUTED", evidence: {}, reason: "no data" }),
      ctx,
    );
    assert.deepEqual(second.lateConsoleErrors, ["late error from first"]);
    assert.equal(second.status, "LIVE_NOT_EXECUTED", "late errors change no status");
    assert.equal(second.reason, "no data", "late errors add nothing to the reason");
    assert.deepEqual(resultFor(rec, "first").lateConsoleErrors, []);
    assert.deepEqual(rec.summary(), { PASS: 1, FAIL: 0, LIVE_NOT_EXECUTED: 1 });
  });

  test("errors logged while a check runs are charged to that check and fail a PASS", async () => {
    const browser = new FakeBrowser();
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    const returned = await rec.run(
      loggingCheck(browser, "noisy", { status: "PASS", evidence: {} }, ["Uncaught TypeError: x"]),
      browser.context(),
    );
    const noisy = resultFor(rec, "noisy");
    assert.deepEqual(returned, noisy, "run returns the result it records");
    assert.equal(noisy.status, "FAIL");
    assert.deepEqual(noisy.consoleErrors, ["Uncaught TypeError: x"]);
    assert.match(noisy.reason ?? "", /1 console error/);
  });

  test("console errors keep a LIVE_NOT_EXECUTED check LIVE_NOT_EXECUTED", async () => {
    const browser = new FakeBrowser();
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    await rec.run(
      loggingCheck(
        browser,
        "empty",
        { status: "LIVE_NOT_EXECUTED", evidence: {}, reason: "no data" },
        ["hydration warning"],
      ),
      browser.context(),
    );
    const empty = resultFor(rec, "empty");
    assert.equal(empty.status, "LIVE_NOT_EXECUTED");
    assert.deepEqual(empty.consoleErrors, ["hydration warning"]);
    assert.equal(empty.reason, "no data; 1 console error(s)");
    assert.equal(rec.exitCode(0), 0, "LIVE_NOT_EXECUTED does not change the exit code");
  });

  test("console errors keep a FAIL check FAIL with its own reason first", async () => {
    const browser = new FakeBrowser();
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    await rec.run(
      loggingCheck(
        browser,
        "broken",
        { status: "FAIL", evidence: {}, reason: "3 rows, expected 4" },
        ["e1", "e2"],
      ),
      browser.context(),
    );
    const broken = resultFor(rec, "broken");
    assert.equal(broken.status, "FAIL");
    assert.equal(broken.reason, "3 rows, expected 4; 2 console error(s)");
  });
});
