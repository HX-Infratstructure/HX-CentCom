import { FIELD_LABELS, labelIn } from "../../../src/lib/field-labels.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";
import { ActivityPage } from "./pages/activity-page.ts";
import type { ActivityChange } from "./pages/activity-page.ts";
import { OverviewPage } from "./pages/overview-page.ts";
import { PullRequestsPage } from "./pages/pull-requests-page.ts";
import {
  sameOrder,
  type ActivityItem,
  type ActivityList,
  type PrList,
  type Workspace,
} from "./shared.ts";

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
  return verdict(
    [checked(sameOrder(shown, expected), "Overview open PRs differ from the API's first page")],
    {
      shown,
      expected,
      screenshot,
    },
  );
}

async function pullRequestsOpenFirst(ctx: CheckContext): Promise<CheckOutcome> {
  const api = await ctx.api.getJson<PrList>("/api/v1/github/prs?state=open&limit=100");
  const page = new PullRequestsPage(ctx.session);
  await page.open();
  const groups = await page.groups();
  const expectedRows = Math.min(api.counts.total, PR_PAGE_SIZE);
  const screenshot = await ctx.screenshot("pull-requests-open-first");
  const ok =
    expectedRows === 0
      ? groups.every((group) => group.title !== "Open")
      : groups[0]?.title === "Open" && groups[0].rows === expectedRows;
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

const SHORT_TEXT = 40;

/** What the page prints for a change, mirroring src/components/adapt.ts:306-350. */
function expectedChange(
  entity: string,
  key: string,
  rawValues: readonly [unknown, unknown],
  statuses: ReadonlyMap<string, string>,
): { readonly from: string | null; readonly to: string } {
  const [before, after] = rawValues.map((v) => (v === undefined || v === "" ? null : v));
  const isShort = (v: unknown) =>
    typeof v === "string"
      ? v.length <= SHORT_TEXT && !v.includes("\n")
      : v === null || typeof v === "number" || typeof v === "boolean";
  if (!isShort(before) || !isShort(after)) return { from: null, to: "edited" };
  const text = (v: unknown): string => {
    if (v === null) return "none";
    if (typeof v !== "string") return String(v);
    if (entity === "task" && key === "status") return statuses.get(v) ?? v;
    if (key === "commit_sha") return v.slice(0, 7);
    return labelIn(labelIn(labelIn(FIELD_LABELS, entity), key), v) ?? v;
  };
  return { from: text(before), to: text(after) };
}

/** The page labels a field by its key with spaces for underscores, and shows only a field whose value changed. */
function checkChange(
  change: ActivityChange,
  item: ActivityItem,
  statuses: ReadonlyMap<string, string>,
) {
  const key = change.field.replace(/ /g, "_");
  const before = item.before?.[key];
  const after = item.after?.[key];
  const inSnapshots = key in (item.before ?? {}) || key in (item.after ?? {});
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  const expected = expectedChange(item.entity, key, [before, after], statuses);
  const shownAgrees = change.from === expected.from && change.to === expected.to;
  return { ...change, before, after, expected, agrees: inSnapshots && changed && shownAgrees };
}

/**
 * Checks the first activity row that shows a changed field, not the first row, and matches it to the API item
 * with the same time. That is intended: rows without a change have nothing to compare.
 */
async function activityRowChanges(ctx: CheckContext): Promise<CheckOutcome> {
  const { items } = await ctx.api.getJson<ActivityList>("/api/v1/activity");
  const { agents, statusLabels } = await ctx.api.getJson<Workspace>("/api/v1/workspace");
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
  const statuses = new Map(statusLabels.map((status) => [status.id, status.label]));
  const changes = row.changes.map((change) => checkChange(change, item, statuses));
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
