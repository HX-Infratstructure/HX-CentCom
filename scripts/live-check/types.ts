import type { LiveApi } from "./api.ts";
import type { ReadOnlySession } from "./session.ts";

export type CheckStatus = "PASS" | "FAIL" | "LIVE_NOT_EXECUTED";

export interface CheckOutcome {
  readonly status: CheckStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly reason?: string;
}

export interface CheckContext {
  readonly base: string;
  readonly session: ReadOnlySession;
  readonly api: LiveApi;
  readonly screenshot: (name: string) => Promise<string>;
}

export interface LiveCheck {
  readonly id: string;
  readonly requirement: string;
  run(ctx: CheckContext): Promise<CheckOutcome>;
}
