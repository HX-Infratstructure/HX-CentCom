import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveApi, type FetchFn } from "./api.ts";
import { allChecks } from "./checks/index.ts";
import { CheckRecorder } from "./recorder.ts";
import { PlaywrightSession, type ReadOnlySession } from "./session.ts";
import type { CheckContext, LiveCheck } from "./types.ts";

export interface CliArgs {
  readonly base: string;
  readonly out: string;
}

export interface CliDeps {
  readonly clock?: () => Date;
  readonly fetch?: FetchFn;
  readonly openSession?: (base: string) => Promise<ReadOnlySession>;
  readonly checks?: readonly LiveCheck[];
}

type ResolvedDeps = Required<CliDeps>;

interface Run {
  readonly args: CliArgs;
  readonly session: ReadOnlySession;
}

function resolveDeps(deps: CliDeps): ResolvedDeps {
  return {
    clock: deps.clock ?? (() => new Date()),
    fetch: deps.fetch ?? fetch,
    openSession: deps.openSession ?? PlaywrightSession.open,
    checks: deps.checks ?? allChecks,
  };
}

const USAGE = "usage: npm run live-check -- --base <http(s)://host:port> --out <folder>";

function flagValue(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}

function parseBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--base is not a URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("--base must use http or https");
  return value.replace(/\/+$/, "");
}

export function parseArgs(argv: readonly string[]): CliArgs {
  return { base: parseBase(flagValue(argv, "--base")), out: flagValue(argv, "--out") };
}

function screenshotter(session: ReadOnlySession, out: string): CheckContext["screenshot"] {
  return async (name) => {
    const path = join(out, `${name}.png`);
    await session.page.screenshot({ path, fullPage: true });
    return path;
  };
}

async function setUp(
  argv: readonly string[],
  openSession: ResolvedDeps["openSession"],
): Promise<Run> {
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  return { args, session: await openSession(args.base) };
}

function writeRecord(
  recorder: CheckRecorder,
  session: ReadOnlySession,
  run: { readonly base: string; readonly trailingConsoleErrors: readonly string[] },
): number {
  const blocked = session.blockedRequests();
  for (const request of blocked) console.log(`BLOCKED ${request}`);
  const path = recorder.write({ ...run, blockedRequests: blocked });
  const s = recorder.summary();
  console.log(
    `summary: PASS=${s.PASS} FAIL=${s.FAIL} LIVE_NOT_EXECUTED=${s.LIVE_NOT_EXECUTED} blocked=${blocked.length} -> ${path}`,
  );
  return blocked.length;
}

async function runChecks({ args, session }: Run, deps: ResolvedDeps): Promise<0 | 1> {
  const recorder = new CheckRecorder(args.out, deps.clock);
  const ctx: CheckContext = {
    session,
    api: new LiveApi(args.base, deps.fetch),
    screenshot: screenshotter(session, args.out),
  };
  let blockedCount = 0;
  let trailingConsoleErrors: readonly string[] = [];
  try {
    for (const check of deps.checks) {
      const result = await recorder.run(check, ctx);
      console.log(`${result.status} ${check.id}${result.reason ? ` (${result.reason})` : ""}`);
    }
    trailingConsoleErrors = session.takeConsoleErrors();
  } finally {
    blockedCount = writeRecord(recorder, session, { base: args.base, trailingConsoleErrors });
  }
  return recorder.exitCode(blockedCount);
}

function setupError(error: unknown, hint = ""): 2 {
  console.error(`live-check: ${error instanceof Error ? error.message : String(error)}${hint}`);
  return 2;
}

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);
  let run: Run;
  try {
    run = await setUp(argv, resolved.openSession);
  } catch (error) {
    return setupError(error, `\n${USAGE}`);
  }
  try {
    try {
      return await runChecks(run, resolved);
    } finally {
      await run.session.close();
    }
  } catch (error) {
    return setupError(error);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
