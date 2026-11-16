import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";
import { ActivityPage } from "./pages/activity-page.ts";
import type { ActivityChange } from "./pages/activity-page.ts";
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
    [checked(ok, "a page did not answer 200, showed no h1 or logged a console error")],
    { pages, screenshot },
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
  return verdict([checked(ok, "Overview open PRs differ from the API's first page")], {
    shown,
    expected,
    screenshot,
  });
}

async function pullRequestsOpenFirst(ctx: CheckContext): Promise<CheckOutcome> {
  const api = await ctx.api.getJson<PrList>("/api/v1/github/prs?state=open&limit=100");
  const page = new PullRequestsPage(ctx.session);
  await page.open();
  const groups = await page.groups();
  const expectedRows = Math.min(api.counts.total, PR_PAGE_SIZE);
  const screenshot = await ctx.screenshot("pull-requests-open-first");
  const ok = groups[0]?.title === "Open" && groups[0].rows === expectedRows;
  return verdict([checked(ok, "Open group is not first or its row count differs")], {
    groups,
    openTotal: api.counts.total,
    expectedRows,
    screenshot,
  });
}

/** The page prints a time to the millisecond; the API keeps microseconds. */
function toMillis(iso: string): string {
  return iso.replace(/(\.\d{3})\d+/, "$1");
}

/** The page labels a field by its key with spaces for underscores, and shows only a field whose value changed. */
function checkChange(change: ActivityChange, item: ActivityItem) {
  const key = change.field.replace(/ /g, "_");
  const before = item.before?.[key];
  const after = item.after?.[key];
  const inSnapshots = key in (item.before ?? {}) || key in (item.after ?? {});
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return { ...change, before, after, agrees: inSnapshots && changed && change.from !== change.to };
}

async function activityRowChanges(ctx: CheckContext): Promise<CheckOutcome> {
  const { items } = await ctx.api.getJson<{ items: readonly ActivityItem[] }>("/api/v1/activity");
  const { agents } = await ctx.api.getJson<AgentList>("/api/v1/workspace");
  const page = new ActivityPage(ctx.session);
  await page.open();
  const row = await page.firstChangedRow();
  const screenshot = await ctx.screenshot("activity-row-changes");
  if (!row)
    return verdict([noData("no row on the first page shows a changed field")], { screenshot });
  const item = items.find((entry) => toMillis(entry.created_at) === row.createdAt);
  if (!item)
    return verdict([checked(false, "no API item has the row's time")], { row, screenshot });
  const expectedActor = agents.find((agent) => agent.id === item.actor)?.display_name ?? item.actor;
  const changes = row.changes.map((change) => checkChange(change, item));
  return verdict(
    [
      checked(row.actorName === expectedActor, "the row's actor differs from the API item's"),
      checked(
        changes.every((change) => change.agrees),
        "a shown change disagrees with the API item's before and after",
      ),
    ],
    { row, item, expectedActor, changes, screenshot },
  );
}

export const checks: readonly LiveCheck[] = [
  { id: "pages-load", requirement: "R1", run: pagesLoad },
  { id: "overview-open-prs", requirement: "R8", run: overviewOpenPrs },
  { id: "pull-requests-open-first", requirement: "R8", run: pullRequestsOpenFirst },
  { id: "activity-row-changes", requirement: "F5", run: activityRowChanges },
];
