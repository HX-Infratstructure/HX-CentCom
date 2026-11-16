import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckContext, CheckOutcome, CheckStatus, LiveCheck } from "./types.ts";

export interface CheckResult extends CheckOutcome {
  readonly id: string;
  readonly requirement: string;
  readonly consoleErrors: readonly string[];
  /** Logged after the previous check returned. Kept as evidence; they never change the status. */
  readonly lateConsoleErrors: readonly string[];
  readonly at: string;
}

export type CheckSummary = Readonly<Record<CheckStatus, number>>;

export interface RunEvidence {
  readonly base: string;
  readonly blockedRequests: readonly string[];
  /** Logged after the last check returned. Kept as evidence; they never change a status or the exit code. */
  readonly trailingConsoleErrors: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function screenshotOrNull(ctx: CheckContext, name: string): Promise<string | null> {
  try {
    return await ctx.screenshot(name);
  } catch {
    return null;
  }
}

async function outcomeOf(check: LiveCheck, ctx: CheckContext): Promise<CheckOutcome> {
  try {
    return await check.run(ctx);
  } catch (error) {
    const message = errorMessage(error);
    const screenshot = await screenshotOrNull(ctx, check.id);
    return {
      status: "FAIL",
      evidence: { error: message, screenshot },
      reason: `threw: ${message}`,
    };
  }
}

function withConsoleErrors(outcome: CheckOutcome, consoleErrors: readonly string[]): CheckOutcome {
  if (consoleErrors.length === 0) return outcome;
  const reason = [outcome.reason, `${consoleErrors.length} console error(s)`]
    .filter(Boolean)
    .join("; ");
  return { ...outcome, status: outcome.status === "PASS" ? "FAIL" : outcome.status, reason };
}

export class CheckRecorder {
  readonly #outDir: string;
  readonly #clock: () => Date;
  readonly #results: CheckResult[] = [];

  constructor(outDir: string, clock: () => Date) {
    this.#outDir = outDir;
    this.#clock = clock;
  }

  async run(check: LiveCheck, ctx: CheckContext): Promise<CheckResult> {
    const at = this.#clock().toISOString();
    const lateConsoleErrors = ctx.session.takeConsoleErrors();
    const outcome = await outcomeOf(check, ctx);
    const consoleErrors = ctx.session.takeConsoleErrors();
    const result: CheckResult = {
      ...withConsoleErrors(outcome, consoleErrors),
      id: check.id,
      requirement: check.requirement,
      consoleErrors,
      lateConsoleErrors,
      at,
    };
    this.#results.push(result);
    return result;
  }

  results(): readonly CheckResult[] {
    return [...this.#results];
  }

  summary(): CheckSummary {
    const counts = { PASS: 0, FAIL: 0, LIVE_NOT_EXECUTED: 0 };
    for (const result of this.#results) counts[result.status] += 1;
    return counts;
  }

  exitCode(blockedCount: number): 0 | 1 {
    return this.summary().FAIL === 0 && blockedCount === 0 ? 0 : 1;
  }

  write(run: RunEvidence): string {
    mkdirSync(this.#outDir, { recursive: true });
    const path = join(this.#outDir, "live-check.json");
    const record = {
      base: run.base,
      writtenAt: this.#clock().toISOString(),
      summary: this.summary(),
      blockedRequests: run.blockedRequests,
      trailingConsoleErrors: run.trailingConsoleErrors,
      results: this.#results,
    };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    return path;
  }
}
