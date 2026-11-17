import type { CheckOutcome } from "./types.ts";

/** One thing a check compared, or could not compare. The reason says why it failed or why it had no data. */
export type Part =
  | { readonly executed: true; readonly ok: boolean; readonly reason: string }
  | { readonly executed: false; readonly reason: string };

export function checked(ok: boolean, reason: string): Part {
  return { executed: true, ok, reason };
}

export function noData(reason: string): Part {
  return { executed: false, reason };
}

function reasons(parts: readonly Part[]): string {
  return [...new Set(parts.map((part) => part.reason))].join("; ");
}

/** Any failed part gives FAIL. Otherwise any part without data, or no part at all, gives LIVE_NOT_EXECUTED. */
export function verdict(parts: readonly Part[], evidence: Record<string, unknown>): CheckOutcome {
  const failed = parts.filter((part) => part.executed && !part.ok);
  if (failed.length > 0) return { status: "FAIL", evidence, reason: reasons(failed) };
  const missing = parts.filter((part) => !part.executed);
  if (missing.length > 0)
    return { status: "LIVE_NOT_EXECUTED", evidence, reason: reasons(missing) };
  if (parts.length === 0)
    return { status: "LIVE_NOT_EXECUTED", evidence, reason: "nothing was checked" };
  return { status: "PASS", evidence };
}
