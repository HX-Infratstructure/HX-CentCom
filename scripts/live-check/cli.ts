import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LiveApi } from "./api.ts";
import { allChecks } from "./checks/index.ts";
import { CheckRecorder } from "./recorder.ts";
import { ReadOnlySession } from "./session.ts";
import type { CheckContext } from "./types.ts";

export interface CliArgs {
  readonly base: string;
  readonly out: string;
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

async function runChecks(
  args: CliArgs,
  session: ReadOnlySession,
  clock: () => Date,
): Promise<0 | 1> {
  mkdirSync(args.out, { recursive: true });
  const recorder = new CheckRecorder(args.out, clock);
  const ctx: CheckContext = {
    base: args.base,
    session,
    api: new LiveApi(args.base),
    screenshot: screenshotter(session, args.out),
  };
  for (const check of allChecks) {
    await recorder.run(check, ctx);
    const result = recorder.results().at(-1);
    console.log(`${result?.status} ${check.id}${result?.reason ? ` (${result.reason})` : ""}`);
  }
  const blocked = session.blockedRequests();
  for (const request of blocked) console.log(`BLOCKED ${request}`);
  const path = recorder.write(blocked);
  const s = recorder.summary();
  console.log(
    `summary: PASS=${s.PASS} FAIL=${s.FAIL} LIVE_NOT_EXECUTED=${s.LIVE_NOT_EXECUTED} blocked=${blocked.length} -> ${path}`,
  );
  return recorder.exitCode(blocked.length);
}

export async function main(
  argv: readonly string[],
  clock: () => Date = () => new Date(),
): Promise<number> {
  let args: CliArgs;
  let session: ReadOnlySession;
  try {
    args = parseArgs(argv);
    session = await ReadOnlySession.open(args.base);
  } catch (error) {
    console.error(
      `live-check: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
    );
    return 2;
  }
  try {
    return await runChecks(args, session, clock);
  } finally {
    await session.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
