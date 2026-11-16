import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { ActivityPage } from "./pages/activity-page.ts";
import type { ActivityRow } from "./pages/activity-page.ts";
import { OverviewPage } from "./pages/overview-page.ts";
import { PullRequestsPage } from "./pages/pull-requests-page.ts";

const PAGE_PATHS = [
  "/",
  "/tasks",
  "/decisions",
  "/raid",
  "/lessons",
  "/pull-requests",
  "/activity",
];
const OVERVIEW_PR_LIMIT = 8;
const PR_PAGE_SIZE = 20;

interface PrList {
  readonly items: readonly { readonly title: string; readonly state: string }[];
  readonly counts: { readonly total: number };
}

interface ActivityItem {
  readonly actor: string;
  readonly created_at: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

interface AgentList {
  readonly agents: readonly { readonly id: string; readonly display_name: string }[];
}

export function verdict(
  ok: boolean,
  evidence: Record<string, unknown>,
  reason: string,
): CheckOutcome {
  return ok ? { status: "PASS", evidence } : { status: "FAIL", evidence, reason };
}

async function pagesLoad(ctx: CheckContext): Promise<CheckOutcome> {
  const page = new OverviewPage(ctx.session);
  const pages = [];
  ctx.session.takeConsoleErrors();
  for (const path of PAGE_PATHS) {
    const status = await page.open(path);
    pages.push({
      path,
      status,
      h1: await page.heading(),
      consoleErrors: ctx.session.takeConsoleErrors(),
    });
  }
  const screenshot = await ctx.screenshot("pages-load");
  const ok = pages.every(
    (entry) => entry.status === 200 && entry.h1 !== "" && entry.consoleErrors.length === 0,
  );
  return verdict(
    ok,
    { pages, screenshot },
    "a page did not answer 200, showed no h1 or logged a console error",
  );
}

async function overviewOpenPrs(ctx: CheckContext): Promise<CheckOutcome> {
  const api = await ctx.api.getJson<PrList>("/api/v1/github/prs?state=open");
  const page = new OverviewPage(ctx.session);
  await page.open();
  const shown = await page.openPrTitles();
  const expected = api.items.slice(0, OVERVIEW_PR_LIMIT).map((pr) => pr.title);
  const screenshot = await ctx.screenshot("overview-open-prs");
  const ok =
    shown.length === expected.length && shown.every((title, index) => title === expected[index]);
  return verdict(
    ok,
    { shown, expected, screenshot },
    "Overview open PRs differ from the API's first page",
  );
}

async function pullRequestsOpenFirst(ctx: CheckContext): Promise<CheckOutcome> {
  const api = await ctx.api.getJson<PrList>("/api/v1/github/prs?state=open&limit=100");
  const page = new PullRequestsPage(ctx.session);
  await page.open();
  const groups = await page.groups();
  const expectedRows = Math.min(api.counts.total, PR_PAGE_SIZE);
  const screenshot = await ctx.screenshot("pull-requests-open-first");
  const ok = groups[0]?.title === "Open" && groups[0].rows === expectedRows;
  return verdict(
    ok,
    { groups, openTotal: api.counts.total, expectedRows, screenshot },
    "Open group is not first or its row count differs",
  );
}

// The activity page hides keys a write always sets (src/components/adapt.ts BOOKKEEPING_KEYS).
const BOOKKEEPING_KEYS = new Set([
  "id",
  "version",
  "created_by",
  "updated_by",
  "update_id",
  "effects",
  "reverts",
  "created_at",
  "updated_at",
  "requested_at",
  "decided_at",
  "revoked_at",
]);

function changedFields(item: ActivityItem): string[] {
  if (!item.before || !item.after) return [];
  const { before, after } = item;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !BOOKKEEPING_KEYS.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => key.replace(/_/g, " "))
    .sort();
}

function changesMatch(row: ActivityRow, item: ActivityItem): boolean {
  const shown = row.changes.map((change) => change.field).sort();
  return shown.join() === changedFields(item).join();
}

async function activityFirstRow(ctx: CheckContext): Promise<CheckOutcome> {
  const { items } = await ctx.api.getJson<{ items: readonly ActivityItem[] }>("/api/v1/activity");
  const { agents } = await ctx.api.getJson<AgentList>("/api/v1/workspace");
  const page = new ActivityPage(ctx.session);
  await page.open();
  const row = await page.firstRow();
  const screenshot = await ctx.screenshot("activity-first-row");
  const item = items[0];
  if (!item || !row)
    return verdict(false, { row, item, screenshot }, "no activity row or API item");
  const actor = agents.find((agent) => agent.id === item.actor)?.display_name ?? item.actor;
  const sameTime = row.createdAt === item.created_at.replace(/(\.\d{3})\d+/, "$1");
  const ok = row.actorName === actor && sameTime && changesMatch(row, item);
  return verdict(
    ok,
    { row, item, expectedActor: actor, expectedFields: changedFields(item), sameTime, screenshot },
    "first activity row differs from the API",
  );
}

export const checks: readonly LiveCheck[] = [
  { id: "pages-load", requirement: "R1", run: pagesLoad },
  { id: "overview-open-prs", requirement: "R8", run: overviewOpenPrs },
  { id: "pull-requests-open-first", requirement: "R8", run: pullRequestsOpenFirst },
  { id: "activity-first-row", requirement: "R2", run: activityFirstRow },
];
