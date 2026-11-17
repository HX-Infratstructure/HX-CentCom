import { LESSON_STATUS_LABELS, RAID_TYPE_LABELS } from "../../../src/lib/field-labels.ts";
import { richTextPlainText } from "../../../src/lib/rich-text.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict, type Part } from "../verdict.ts";
import { BoardPage, sheetMatchesRow, type SheetVisit } from "./pages/board-page.ts";
import { PAGE_ROUTES, pickNarrowingValue, sameOrder, type ListPage } from "./shared.ts";

/** A board route, its list endpoint, and the filter whose values come from the endpoint's facet counts. */
interface Board {
  readonly route: string;
  readonly api: string;
  readonly param: string;
  readonly facet: string;
  /** The filter value the unfiltered view already shows, so choosing it would not narrow the visible rows. */
  readonly defaultValue: string | null;
}

/** A board whose unfiltered page groups its rows by `groupBy`, with the groups in page order. A value missing from `groupOrder` groups last. */
interface Register extends Board {
  readonly groupBy: string;
  readonly groupOrder: readonly string[];
}

/**
 * Unfiltered, `/decisions` shows a Pending block and then a collapsed History block; under a status filter it shows
 * one group (`src/routes/decisions.tsx:124-150`). No check compares its unfiltered rows, so it is not a register.
 */
const DECISIONS: Board = {
  route: PAGE_ROUTES.decisions,
  api: "/api/v1/decisions",
  param: "status",
  facet: "byStatus",
  defaultValue: "Pending",
};
const RAID: Register = {
  route: PAGE_ROUTES.raid,
  api: "/api/v1/raid",
  param: "type",
  facet: "byType",
  defaultValue: null,
  groupBy: "type",
  groupOrder: Object.keys(RAID_TYPE_LABELS),
};
const LESSONS: Register = {
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
  // The filter is on the field the page groups by, so the filtered page shows one group, in the API's order.
  const filteredIds = filtered.items.map((item) => item.id);
  const reread = () => list(ctx, board, { [board.param]: value });
  const { comparison, ...rows } = await shownApiPage(page, filtered, filteredIds, reread);
  return {
    route: board.route,
    part: loadVerdict(
      board.route,
      comparison,
      checked(
        comparison === "matches",
        `${board.route}: filtered row IDs or count differ from the filtered API`,
      ),
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

type DecisionLookup = { readonly decision: ListPage["items"][number] } | { readonly miss: string };

const NOT_LISTED: DecisionLookup = { miss: "the clicked decision is not in the decisions API" };

/**
 * The decision with `id`, read page by page from the list API, which has no single-decision read. A cursor the API
 * already gave ends the walk with a miss, because following it again would never reach the last page.
 */
async function decisionById(ctx: CheckContext, id: string): Promise<DecisionLookup> {
  const followed = new Set<string>();
  let page = await list(ctx, DECISIONS);
  for (;;) {
    const decision = page.items.find((item) => item.id === id);
    if (decision !== undefined) return { decision };
    if (page.nextCursor === null) return NOT_LISTED;
    if (followed.has(page.nextCursor))
      return {
        miss: `the decisions API repeated cursor ${page.nextCursor}, so its pages never end`,
      };
    followed.add(page.nextCursor);
    page = await list(ctx, DECISIONS, { cursor: page.nextCursor });
  }
}

/** The sheet shows the clicked decision's whole description, as the page renders it to text. No description, no part. */
async function descriptionShown(ctx: CheckContext, visit: SheetVisit, shown: string | null) {
  const lookup = visit.rowId === null ? NOT_LISTED : await decisionById(ctx, visit.rowId);
  if ("miss" in lookup) return { part: checked(false, lookup.miss), expected: null, shown };
  const source = lookup.decision["description"];
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
 * A register page groups its rows by `register.groupBy`, so the expected order is the API page with each group kept
 * together, in `register.groupOrder`, and the API's order inside each group.
 */
function groupedApiOrder(items: ListPage["items"], register: Register) {
  const order: readonly unknown[] = register.groupOrder;
  const rank = (item: ListPage["items"][number]) => {
    const index = order.indexOf(item[register.groupBy]);
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b)).map((item) => item.id);
}

/** How a loaded page compares with the API page: it matches, the API rows moved during the load, or it differs. */
type LoadComparison = "matches" | "moved" | "differs";

/** No data when the API rows moved during the load, since the page could not be compared; otherwise `compared`. */
function loadVerdict(route: string, comparison: LoadComparison, compared: Part): Part {
  return comparison === "moved"
    ? noData(`${route}: the API rows changed between the API read and the page load`)
    : compared;
}

/**
 * Whether the loaded page shows the API page: its row count (the total when it is the only page) and its row IDs as
 * `expectedIds`. A record written between the API read and the page load makes a correct page differ, so a mismatch
 * reads the API again: a read that differs from the first means the rows moved, and only two agreeing reads can fail.
 */
async function shownApiPage(
  page: BoardPage,
  apiPage: ListPage,
  expectedIds: readonly string[],
  reread: () => Promise<ListPage>,
) {
  const uiRows = await page.visibleRows();
  const shownIds = await page.rowIds();
  const expected = apiPage.nextCursor === null ? apiPage.counts.total : apiPage.items.length;
  const rows = { uiRows, expected, shownIds, expectedIds };
  if (uiRows === expected && uiRows === apiPage.items.length && sameOrder(shownIds, expectedIds))
    return { comparison: "matches" as const, ...rows };
  const again = await reread();
  const ids = (read: ListPage) => read.items.map((item) => item.id);
  const moved = again.counts.total !== apiPage.counts.total || !sameOrder(ids(again), ids(apiPage));
  const comparison: LoadComparison = moved ? "moved" : "differs";
  return { comparison, ...rows };
}

/** The page shows the API's first page: the same row IDs in the grouped API order, and the first row opens its own sheet. */
async function registerRows(ctx: CheckContext, board: Register) {
  const first = await list(ctx, board);
  const page = new BoardPage(ctx.session, board.route);
  await page.load();
  const expectedIds = groupedApiOrder(first.items, board);
  const { comparison, ...rows } = await shownApiPage(page, first, expectedIds, () =>
    list(ctx, board),
  );
  const lastColumn = (await page.columns()).at(-1) ?? "";
  const visit: SheetVisit | null = rows.uiRows > 0 ? await page.openRow(0, lastColumn) : null;
  const ok = comparison === "matches" && visit !== null && sheetMatchesRow(visit);
  const empty = rows.expected === 0 && rows.uiRows === 0;
  const compared = empty
    ? noData(`${board.route}: the API has no rows`)
    : checked(ok, `${board.route}: row IDs or the first row's sheet differ from the API`);
  return {
    route: board.route,
    part: loadVerdict(board.route, comparison, compared),
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
