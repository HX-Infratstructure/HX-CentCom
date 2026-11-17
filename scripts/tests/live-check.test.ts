import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { fileURLToPath } from "node:url";
import { isReadOnlyMethod } from "../live-check/session.ts";
import { contrastRatio, isLargeText } from "../live-check/contrast.ts";
import { main, parseArgs } from "../live-check/cli.ts";
import type { CliDeps } from "../live-check/cli.ts";
import type { ReadOnlySession } from "../live-check/session.ts";
import { CheckRecorder } from "../live-check/recorder.ts";
import { checked, noData, verdict } from "../live-check/verdict.ts";
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

function fakeCheck(id: string, run: (ctx: CheckContext) => Promise<CheckOutcome>): LiveCheck {
  return { id, requirement: `req ${id}`, run };
}

function fakeContext(): { ctx: CheckContext; logError: (message: string) => void } {
  let buffer: string[] = [];
  const session = {
    takeConsoleErrors: () => {
      const errors = buffer;
      buffer = [];
      return errors;
    },
  };
  const ctx = {
    session,
    api: {},
    screenshot: async (n: string) => n,
  } as unknown as CheckContext;
  return { ctx, logError: (message) => buffer.push(message) };
}

describe("CheckRecorder", () => {
  test("records statuses, the UTC time and the exit code", async () => {
    const out = mkdtempSync(join(tmpdir(), "live-check-"));
    try {
      const rec = new CheckRecorder(out, () => NOW);
      const { ctx, logError } = fakeContext();
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
        fakeCheck("console", async () => {
          logError("Uncaught TypeError: x");
          return { status: "PASS", evidence: {} };
        }),
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
      rec.write({ base: "http://h", blockedRequests: [], trailingConsoleErrors: [] });
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.equal(written.results.length, 4);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  test("exits 0 with no FAIL and no blocked request, 1 with a blocked request", async () => {
    const rec = new CheckRecorder("/nonexistent", () => NOW);
    const { ctx } = fakeContext();
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

describe("verdict", () => {
  const evidence = { rows: 2 };
  test("every part checked and ok gives PASS with no reason", () => {
    assert.deepEqual(verdict([checked(true, "a"), checked(true, "b")], evidence), {
      status: "PASS",
      evidence,
    });
  });
  test("a failed part gives FAIL with the failed parts' reasons, even beside a part without data", () => {
    const outcome = verdict(
      [checked(true, "fine"), noData("no rows"), checked(false, "rows differ")],
      evidence,
    );
    assert.deepEqual(outcome, { status: "FAIL", evidence, reason: "rows differ" });
  });
  test("a part without data and none failed gives LIVE_NOT_EXECUTED with its reason", () => {
    const outcome = verdict([checked(true, "fine"), noData("no rows"), noData("no PRs")], evidence);
    assert.deepEqual(outcome, {
      status: "LIVE_NOT_EXECUTED",
      evidence,
      reason: "no rows; no PRs",
    });
  });
  test("no parts gives LIVE_NOT_EXECUTED", () => {
    assert.equal(verdict([], evidence).status, "LIVE_NOT_EXECUTED");
  });
});

function fakeSession(blocked: readonly string[] = []): ReadOnlySession & { closed: boolean } {
  const page = {
    screenshot: async ({ path }: { path: string }) => writeFileSync(path, "png"),
  };
  return {
    closed: false,
    page: page as unknown as ReadOnlySession["page"],
    goto: async () => 200,
    blockedRequests: () => blocked,
    takeConsoleErrors: () => [],
    async close() {
      this.closed = true;
    },
  };
}

function fakeDeps(session: ReadOnlySession, checks: readonly LiveCheck[]): CliDeps {
  return {
    clock: () => NOW,
    fetch: async () => new Response("{}"),
    openSession: async () => session,
    checks,
  };
}

async function inTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "live-check-main-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = "http://live-check.invalid";
const passing = fakeCheck("ok", async () => ({ status: "PASS", evidence: {} }));

describe("main", () => {
  test("exits 2 when --out cannot be created", async () => {
    await inTempDir(async (dir) => {
      const file = join(dir, "file");
      writeFileSync(file, "");
      const session = fakeSession();
      const code = await main(
        ["--base", BASE, "--out", join(file, "out")],
        fakeDeps(session, [passing]),
      );
      assert.equal(code, 2);
    });
  });

  test("records a check that throws as FAIL with its error and a screenshot, and exits 1", async () => {
    await inTempDir(async (out) => {
      const throwing = fakeCheck("throws", async () => {
        throw new Error("boom");
      });
      const session = fakeSession();
      const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [throwing]));
      assert.equal(code, 1);
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      const [result] = written.results;
      assert.equal(result.status, "FAIL");
      assert.equal(result.evidence.error, "boom");
      assert.equal(result.evidence.screenshot, join(out, "throws.png"));
      assert.equal(existsSync(join(out, "throws.png")), true);
      assert.equal(session.closed, true);
    });
  });

  test("exits 1 when the session blocked a request", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession([`POST ${BASE}/api/v1/tasks`]);
      const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [passing]));
      assert.equal(code, 1);
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.deepEqual(written.blockedRequests, [`POST ${BASE}/api/v1/tasks`]);
    });
  });

  test("exits 0 and writes live-check.json when every check is PASS or LIVE_NOT_EXECUTED", async () => {
    await inTempDir(async (out) => {
      const lne = fakeCheck("lne", async () => ({ status: "LIVE_NOT_EXECUTED", evidence: {} }));
      const api = fakeCheck("api", async (ctx) => {
        const body = await ctx.api.getJson<object>("/api/v1/health");
        return { status: "PASS", evidence: { body } };
      });
      const session = fakeSession();
      const code = await main(
        ["--base", BASE, "--out", out],
        fakeDeps(session, [passing, lne, api]),
      );
      assert.equal(code, 0);
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.deepEqual(written.summary, { PASS: 2, FAIL: 0, LIVE_NOT_EXECUTED: 1 });
      assert.equal(written.writtenAt, NOW.toISOString());
      assert.equal(session.closed, true);
    });
  });

  test("exits 2 and still writes the completed checks when a later step throws", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession();
      let crashed = false;
      session.takeConsoleErrors = () => {
        if (crashed) throw new Error("page crashed");
        return [];
      };
      const second = fakeCheck("second", async () => {
        crashed = true;
        return { status: "PASS", evidence: {} };
      });
      const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [passing, second]));
      assert.equal(code, 2);
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.deepEqual(
        written.results.map((result: { id: string }) => result.id),
        ["ok"],
      );
      assert.equal(session.closed, true);
    });
  });

  test("exits 1 when a LIVE_NOT_EXECUTED check logged console errors while it ran", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession();
      let buffer: string[] = [];
      session.takeConsoleErrors = () => {
        const errors = buffer;
        buffer = [];
        return errors;
      };
      const empty = fakeCheck("empty", async () => {
        buffer.push("Uncaught TypeError: x");
        return { status: "LIVE_NOT_EXECUTED", evidence: {}, reason: "no data" };
      });
      const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [empty]));
      assert.equal(code, 1);
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.equal(written.results[0].status, "FAIL");
      assert.equal(written.results[0].reason, "no data; 1 console error(s)");
      assert.deepEqual(written.summary, { PASS: 0, FAIL: 1, LIVE_NOT_EXECUTED: 0 });
    });
  });

  test("records the base URL the run checked", async () => {
    await inTempDir(async (out) => {
      await main(["--base", BASE, "--out", out], fakeDeps(fakeSession(), [passing]));
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.equal(written.base, BASE);
    });
  });

  test("records console errors logged after the last check without changing the verdict", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession();
      let buffer: string[] = [];
      let arrivingAfterDrain: string[] = [];
      session.takeConsoleErrors = () => {
        const errors = buffer;
        buffer = arrivingAfterDrain;
        arrivingAfterDrain = [];
        return errors;
      };
      const last = fakeCheck("last", async () => {
        arrivingAfterDrain.push("Uncaught Error: after the last check");
        return { status: "PASS", evidence: {} };
      });
      const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [last]));
      assert.equal(code, 0, "trailing errors change no exit code");
      const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
      assert.deepEqual(written.trailingConsoleErrors, ["Uncaught Error: after the last check"]);
      assert.equal(written.results[0].status, "PASS");
      assert.deepEqual(written.results[0].consoleErrors, []);
      assert.deepEqual(written.summary, { PASS: 1, FAIL: 0, LIVE_NOT_EXECUTED: 0 });
    });
  });
});

function captureStderr(): { text: () => string; restore: () => void } {
  const spy = mock.method(console, "error", () => {});
  return {
    text: () => spy.mock.calls.map((call) => format(...call.arguments)).join("\n"),
    restore: () => spy.mock.restore(),
  };
}

function crashAfterSecondCheck(session: ReadOnlySession): LiveCheck {
  let crashed = false;
  session.takeConsoleErrors = () => {
    if (crashed) throw new Error("page crashed");
    return [];
  };
  return fakeCheck("second", async () => {
    crashed = true;
    return { status: "PASS", evidence: {} };
  });
}

function turnIntoFile(path: string): void {
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, "");
}

const STACK_LINE = /\n\s+at /;

describe("main after setup", () => {
  test("reports a crash with its stack on stderr and exits 2", async () => {
    await inTempDir(async (dir) => {
      const session = fakeSession();
      const stderr = captureStderr();
      try {
        const code = await main(
          ["--base", BASE, "--out", join(dir, "out")],
          fakeDeps(session, [passing, crashAfterSecondCheck(session)]),
        );
        assert.equal(code, 2);
        assert.match(stderr.text(), /running the checks failed: Error: page crashed/);
        assert.match(stderr.text(), STACK_LINE);
      } finally {
        stderr.restore();
      }
    });
  });

  test("a close() failure does not replace the crash, and is still reported", async () => {
    await inTempDir(async (dir) => {
      const session = fakeSession();
      session.close = async () => {
        throw new Error("close failed");
      };
      const stderr = captureStderr();
      try {
        const code = await main(
          ["--base", BASE, "--out", join(dir, "out")],
          fakeDeps(session, [passing, crashAfterSecondCheck(session)]),
        );
        assert.equal(code, 2);
        assert.match(stderr.text(), /page crashed/);
        assert.match(stderr.text(), /close failed/);
      } finally {
        stderr.restore();
      }
    });
  });

  test("a record write failure does not replace the crash, and is still reported", async () => {
    await inTempDir(async (dir) => {
      const out = join(dir, "out");
      const session = fakeSession();
      const crashing = crashAfterSecondCheck(session);
      const sabotage = fakeCheck("sabotage", async (ctx) => {
        turnIntoFile(out);
        return crashing.run(ctx);
      });
      const stderr = captureStderr();
      try {
        const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [sabotage]));
        assert.equal(code, 2);
        assert.match(stderr.text(), /page crashed/);
        assert.match(stderr.text(), /live-check\.json/);
        assert.match(stderr.text(), /EEXIST|ENOTDIR/);
        assert.equal(session.closed, true);
      } finally {
        stderr.restore();
      }
    });
  });

  test("keeps the console errors logged before a crash in trailingConsoleErrors", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession();
      let pending: string[] = [];
      let crashNext = false;
      session.takeConsoleErrors = () => {
        if (crashNext) {
          crashNext = false;
          throw new Error("page crashed");
        }
        const errors = pending;
        pending = [];
        return errors;
      };
      const crashing = fakeCheck("crashing", async () => {
        pending.push("Uncaught Error: before the crash");
        crashNext = true;
        return { status: "PASS", evidence: {} };
      });
      const stderr = captureStderr();
      try {
        const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [crashing]));
        assert.equal(code, 2);
        assert.match(stderr.text(), /page crashed/);
        const written = JSON.parse(readFileSync(join(out, "live-check.json"), "utf8"));
        assert.deepEqual(written.trailingConsoleErrors, ["Uncaught Error: before the crash"]);
      } finally {
        stderr.restore();
      }
    });
  });

  test("a passing run whose browser cannot close exits 2 and names that step", async () => {
    await inTempDir(async (out) => {
      const session = fakeSession();
      session.close = async () => {
        throw new Error("close failed");
      };
      const stderr = captureStderr();
      try {
        const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [passing]));
        assert.equal(code, 2);
        assert.match(stderr.text(), /closing the browser failed: Error: close failed/);
        assert.doesNotMatch(stderr.text(), /after setup/);
      } finally {
        stderr.restore();
      }
    });
  });

  test("a passing run whose record cannot be written exits 2 with the write error and its stack", async () => {
    await inTempDir(async (dir) => {
      const out = join(dir, "out");
      const session = fakeSession();
      const sabotage = fakeCheck("sabotage", async () => {
        turnIntoFile(out);
        return { status: "PASS", evidence: {} };
      });
      const stderr = captureStderr();
      try {
        const code = await main(["--base", BASE, "--out", out], fakeDeps(session, [sabotage]));
        assert.equal(code, 2);
        assert.match(stderr.text(), /writing live-check\.json failed: Error: (EEXIST|ENOTDIR)/);
        assert.match(stderr.text(), STACK_LINE);
        assert.equal(session.closed, true);
      } finally {
        stderr.restore();
      }
    });
  });
});

describe("live-check executable", () => {
  test("runs main when started through a symlink", async () => {
    await inTempDir(async (dir) => {
      const link = join(dir, "cli.ts");
      symlinkSync(fileURLToPath(new URL("../live-check/cli.ts", import.meta.url)), link);
      const child = spawnSync(process.execPath, [link], { encoding: "utf8", timeout: 30_000 });
      assert.equal(child.status, 2, child.stderr);
      assert.match(child.stderr, /--base is required/);
    });
  });
});
