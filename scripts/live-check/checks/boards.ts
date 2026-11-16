import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";
import { BoardPage, sheetMatchesRow, type SheetVisit } from "./pages/board-page.ts";
import { pickNarrowingValue, sameOrder, type ListPage } from "./shared.ts";

/** A board route, its list endpoint, and the filter whose values come from the endpoint's facet counts. */
interface Board {
  readonly route: string;
  readonly api: string;
  readonly param: string;
  readonly facet: string;
  /** The filter value the unfiltered view already shows, so choosing it would not narrow the visible rows. */
  readonly defaultValue: string | null;
}

const DECISIONS: Board = {
  route: "/decisions",
  api: "/api/v1/decisions",
  param: "status",
  facet: "byStatus",
  defaultValue: "Pending",
};
const RAID: Board = {
  route: "/raid",
  api: "/api/v1/raid",
  param: "type",
  facet: "byType",
  defaultValue: null,
};
const LESSONS: Board = {
  route: "/lessons",
  api: "/api/v1/lessons",
  param: "status",
  facet: "byStatus",
  defaultValue: null,
};

function list(ctx: CheckContext, board: Board, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return ctx.api.getJson<ListPage>(search ? `${board.api}?${search}` : board.api);
}

function narrowingValue(page: ListPage, board: Board) {
  const counts = page.counts[board.facet];
  if (typeof counts !== "object") return undefined;
  return pickNarrowingValue(Object.entries(counts), page.counts.total, board.defaultValue);
}

async function filterBoard(ctx: CheckContext, board: Board) {
  const all = await list(ctx, board);
  const choice = narrowingValue(all, board);
  if (!choice)
    return {
      route: board.route,
      part: noData(`${board.route}: no filter value narrows the rows`),
      total: all.counts.total,
    };
  const [value, facetCount] = choice;
  const filtered = await list(ctx, board, { [board.param]: value });
  const page = new BoardPage(ctx.session, board.route);
  const url = await page.load({ [board.param]: value });
  const uiRows = await page.visibleRows();
  const shownIds = await page.rowIds();
  const expectedIds = groupedApiOrder(filtered.items, shownIds, board.param);
  const expected = filtered.nextCursor === null ? filtered.counts.total : filtered.items.length;
  const ok =
    uiRows === expected && uiRows === filtered.items.length && sameOrder(shownIds, expectedIds);
  return {
    route: board.route,
    part: checked(ok, `${board.route}: filtered row IDs or count differ from the filtered API`),
    url,
    facetCount,
    uiRows,
    expected,
    shownIds,
    expectedIds,
    total: all.counts.total,
  };
}

async function boardFilters(ctx: CheckContext): Promise<CheckOutcome> {
  const boards = [];
  for (const board of [DECISIONS, RAID, LESSONS]) boards.push(await filterBoard(ctx, board));
  const screenshot = await ctx.screenshot("board-filters");
  return verdict(
    boards.map((board) => board.part),
    { boards, screenshot },
  );
}

async function decisionSummaryClick(ctx: CheckContext): Promise<CheckOutcome> {
  const page = new BoardPage(ctx.session, DECISIONS.route);
  const url = await page.load();
  const rows = await page.visibleRows();
  let screenshot = "";
  const visit =
    rows > 0
      ? await page.openRow(0, "Summary", async () => {
          screenshot = await ctx.screenshot("decision-summary-click");
        })
      : null;
  const part =
    visit === null
      ? noData("no decision row to click")
      : checked(sheetMatchesRow(visit), "the sheet does not match the clicked row");
  return verdict([part], { url, rows, visit, screenshot });
}

/**
 * A board page groups its rows by `groupBy`, so the expected order is the API's first page with each group
 * kept together, in the order the page shows the groups, and the API's order inside each group.
 */
function groupedApiOrder(items: ListPage["items"], shownIds: readonly string[], groupBy: string) {
  const groupOf = new Map(items.map((item) => [item.id, item[groupBy]]));
  const groupOrder = [...new Set(shownIds.map((id) => groupOf.get(id)))];
  const rank = (item: ListPage["items"][number]) => {
    const index = groupOrder.indexOf(item[groupBy]);
    return index === -1 ? groupOrder.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b)).map((item) => item.id);
}

/** The page shows the API's first page: the same row IDs in the grouped API order, and the first row opens its own sheet. */
async function registerRows(ctx: CheckContext, board: Board, groupBy: string) {
  const first = await list(ctx, board);
  const page = new BoardPage(ctx.session, board.route);
  await page.load();
  const uiRows = await page.visibleRows();
  const shownIds = await page.rowIds();
  const expectedIds = groupedApiOrder(first.items, shownIds, groupBy);
  const expected = first.nextCursor === null ? first.counts.total : first.items.length;
  const lastColumn = (await page.columns()).at(-1) ?? "";
  const visit: SheetVisit | null = uiRows > 0 ? await page.openRow(0, lastColumn) : null;
  const ok =
    uiRows === expected &&
    sameOrder(shownIds, expectedIds) &&
    visit !== null &&
    sheetMatchesRow(visit);
  return {
    route: board.route,
    part:
      expected > 0
        ? checked(ok, `${board.route}: row IDs or the first row's sheet differ from the API`)
        : noData(`${board.route}: the API has no rows`),
    uiRows,
    expected,
    shownIds,
    expectedIds,
    apiTotal: first.counts.total,
    visit,
  };
}

async function raidLessonsRows(ctx: CheckContext): Promise<CheckOutcome> {
  const boards = [];
  const registers = [
    [RAID, "type"],
    [LESSONS, "status"],
  ] as const;
  for (const [board, groupBy] of registers) boards.push(await registerRows(ctx, board, groupBy));
  const screenshot = await ctx.screenshot("raid-lessons-rows");
  return verdict(
    boards.map((board) => board.part),
    { boards, screenshot },
  );
}

export const checks: readonly LiveCheck[] = [
  { id: "board-filters", requirement: "R12", run: boardFilters },
  { id: "decision-summary-click", requirement: "R11", run: decisionSummaryClick },
  { id: "raid-lessons-rows", requirement: "R13", run: raidLessonsRows },
];
