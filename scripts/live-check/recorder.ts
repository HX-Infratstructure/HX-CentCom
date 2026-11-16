import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckContext, CheckOutcome, CheckStatus, LiveCheck } from "./types.ts";

export interface CheckResult extends CheckOutcome {
  readonly id: string;
  readonly requirement: string;
  readonly consoleErrors: readonly string[];
  readonly at: string;
}

export type CheckSummary = Readonly<Record<CheckStatus, number>>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function outcomeOf(check: LiveCheck, ctx: CheckContext): Promise<CheckOutcome> {
  try {
    return await check.run(ctx);
  } catch (error) {
    return { status: "FAIL", evidence: {}, reason: `threw: ${errorMessage(error)}` };
  }
}

function withConsoleErrors(outcome: CheckOutcome, consoleErrors: readonly string[]): CheckOutcome {
  if (consoleErrors.length === 0) return outcome;
  const reason = [outcome.reason, `${consoleErrors.length} console error(s)`]
    .filter(Boolean)
    .join("; ");
  return { ...outcome, status: "FAIL", reason };
}

export class CheckRecorder {
  readonly #outDir: string;
  readonly #clock: () => Date;
  readonly #results: CheckResult[] = [];

  constructor(outDir: string, clock: () => Date) {
    this.#outDir = outDir;
    this.#clock = clock;
  }

  async run(check: LiveCheck, ctx: CheckContext): Promise<void> {
    const at = this.#clock().toISOString();
    const outcome = await outcomeOf(check, ctx);
    const consoleErrors = ctx.session.takeConsoleErrors();
    const final = withConsoleErrors(outcome, consoleErrors);
    this.#results.push({
      ...final,
      id: check.id,
      requirement: check.requirement,
      consoleErrors,
      at,
    });
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

  write(blockedRequests: readonly string[] = []): string {
    mkdirSync(this.#outDir, { recursive: true });
    const path = join(this.#outDir, "live-check.json");
    const record = {
      writtenAt: this.#clock().toISOString(),
      summary: this.summary(),
      blockedRequests,
      results: this.#results,
    };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    return path;
  }
}
