import { LESSON_STATUS_LABELS, RAID_TYPE_LABELS } from "../../../src/lib/field-labels.ts";
import { richTextPlainText } from "../../../src/lib/rich-text.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";
import { BoardPage, sheetMatchesRow, type SheetVisit } from "./pages/board-page.ts";
import { PAGE_ROUTES, pickNarrowingValue, sameOrder, type ListPage } from "./shared.ts";

/**
 * A board route, its list endpoint, the filter whose values come from the endpoint's facet counts, and the field
 * the page groups its rows by, with the groups in page order. A value missing from `groupOrder` groups last.
 */
interface Board {
  readonly route: string;
  readonly api: string;
  readonly param: string;
  readonly facet: string;
  /** The filter value the unfiltered view already shows, so choosing it would not narrow the visible rows. */
  readonly defaultValue: string | null;
  readonly groupBy: string;
  readonly groupOrder: readonly string[];
}

const DECISIONS: Board = {
  route: PAGE_ROUTES.decisions,
  api: "/api/v1/decisions",
  param: "status",
  facet: "byStatus",
  defaultValue: "Pending",
  groupBy: "status",
  groupOrder: ["Pending"],
};
const RAID: Board = {
  route: PAGE_ROUTES.raid,
  api: "/api/v1/raid",
  param: "type",
  facet: "byType",
  defaultValue: null,
  groupBy: "type",
  groupOrder: Object.keys(RAID_TYPE_LABELS),
};
const LESSONS: Board = {
  route: PAGE_ROUTES.lessons,
  api: "/api/v1/lessons",
  param: "status",
  facet: "byStatus",
  defaultValue: null,
  groupBy: "status",
  groupOrder: Object.keys(LESSON_STATUS_LABELS),
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
  const { matches, ...rows } = await shownApiPage(page, filtered, board);
  return {
    route: board.route,
    part: checked(
      matches,
      `${board.route}: filtered row IDs or count differ from the filtered API`,
    ),
    url,
    facetCount,
    ...rows,
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

/** The decision with `id`, read page by page from the list API, which has no single-decision read. */
async function decisionById(ctx: CheckContext, id: string) {
  let page = await list(ctx, DECISIONS);
  for (;;) {
    const found = page.items.find((item) => item.id === id);
    if (found !== undefined || page.nextCursor === null) return found;
    page = await list(ctx, DECISIONS, { cursor: page.nextCursor });
  }
}

/** The sheet shows the clicked decision's whole description, as the page renders it to text. No description, no part. */
async function descriptionShown(ctx: CheckContext, visit: SheetVisit, shown: string | null) {
  const decision = visit.rowId === null ? undefined : await decisionById(ctx, visit.rowId);
  if (decision === undefined)
    return {
      part: checked(false, "the clicked decision is not in the decisions API"),
      expected: null,
      shown,
    };
  const source = decision["description"];
  const expected = typeof source === "string" ? richTextPlainText(source).trim() || null : null;
  if (expected === null) return { part: null, expected, shown };
  const part = checked(shown === expected, "the sheet's description differs from the decision's");
  return { part, expected, shown };
}

async function decisionSummaryClick(ctx: CheckContext): Promise<CheckOutcome> {
  const page = new BoardPage(ctx.session, DECISIONS.route);
  const url = await page.load();
  const rows = await page.visibleRows();
  const open: { description: string | null; screenshot: string } = {
    description: null,
    screenshot: "",
  };
  const visit =
    rows > 0
      ? await page.openRow(0, "Summary", async () => {
          open.description = await page.sheetDescription();
          open.screenshot = await ctx.screenshot("decision-summary-click");
        })
      : null;
  if (visit === null)
    return verdict([noData("no decision row to click")], { url, rows, visit, screenshot: "" });
  const { part, ...description } = await descriptionShown(ctx, visit, open.description);
  const identity = checked(sheetMatchesRow(visit), "the sheet does not match the clicked row");
  return verdict(part === null ? [identity] : [identity, part], {
    url,
    rows,
    visit,
    description,
    screenshot: open.screenshot,
  });
}

/**
 * A board page groups its rows by `board.groupBy`, so the expected order is the API page with each group kept
 * together, in `board.groupOrder`, and the API's order inside each group.
 */
function groupedApiOrder(items: ListPage["items"], board: Board) {
  const order: readonly unknown[] = board.groupOrder;
  const rank = (item: ListPage["items"][number]) => {
    const index = order.indexOf(item[board.groupBy]);
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b)).map((item) => item.id);
}

/** The loaded page shows the API page: its row count (the total when it is the only page) and its row IDs in grouped order. */
async function shownApiPage(page: BoardPage, apiPage: ListPage, board: Board) {
  const uiRows = await page.visibleRows();
  const shownIds = await page.rowIds();
  const expectedIds = groupedApiOrder(apiPage.items, board);
  const expected = apiPage.nextCursor === null ? apiPage.counts.total : apiPage.items.length;
  const matches =
    uiRows === expected && uiRows === apiPage.items.length && sameOrder(shownIds, expectedIds);
  return { matches, uiRows, expected, shownIds, expectedIds };
}

/** The page shows the API's first page: the same row IDs in the grouped API order, and the first row opens its own sheet. */
async function registerRows(ctx: CheckContext, board: Board) {
  const first = await list(ctx, board);
  const page = new BoardPage(ctx.session, board.route);
  await page.load();
  const { matches, ...rows } = await shownApiPage(page, first, board);
  const lastColumn = (await page.columns()).at(-1) ?? "";
  const visit: SheetVisit | null = rows.uiRows > 0 ? await page.openRow(0, lastColumn) : null;
  const ok = matches && visit !== null && sheetMatchesRow(visit);
  return {
    route: board.route,
    part:
      rows.expected > 0
        ? checked(ok, `${board.route}: row IDs or the first row's sheet differ from the API`)
        : noData(`${board.route}: the API has no rows`),
    ...rows,
    apiTotal: first.counts.total,
    visit,
  };
}

async function raidLessonsRows(ctx: CheckContext): Promise<CheckOutcome> {
  const boards = [];
  for (const board of [RAID, LESSONS]) boards.push(await registerRows(ctx, board));
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
