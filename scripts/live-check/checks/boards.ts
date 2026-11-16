import { sampleContrast, type ContrastPair } from "../contrast.ts";
import type { CheckContext, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";
import { BoardPage, sheetMatchesRow, type SheetVisit } from "./pages/board-page.ts";

type Facet = Readonly<Record<string, number>>;

interface ListPage {
  readonly items: readonly unknown[];
  readonly nextCursor: string | null;
  readonly counts: { readonly total: number; readonly [facet: string]: Facet | number };
}

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
const CONTRAST_ROUTES = ["/tasks", "/decisions", "/"] as const;

function list(ctx: CheckContext, board: Board, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return ctx.api.getJson<ListPage>(search ? `${board.api}?${search}` : board.api);
}

function narrowingValue(page: ListPage, board: Board): [string, number] | undefined {
  const counts = page.counts[board.facet];
  if (typeof counts !== "object") return undefined;
  return Object.entries(counts)
    .filter(([value, n]) => value !== board.defaultValue && n > 0 && n < page.counts.total)
    .sort((a, b) => a[1] - b[1])[0];
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
  const expected = filtered.nextCursor === null ? facetCount : filtered.items.length;
  const ok = uiRows === expected && uiRows === filtered.items.length;
  return {
    route: board.route,
    part: checked(ok, `${board.route}: filtered rows differ from the API count`),
    url,
    facetCount,
    uiRows,
    expected,
    total: all.counts.total,
  };
}

const boardFilters: LiveCheck = {
  id: "board-filters",
  requirement: "R12",
  async run(ctx) {
    const boards = [];
    for (const board of [DECISIONS, RAID, LESSONS]) boards.push(await filterBoard(ctx, board));
    const screenshot = await ctx.screenshot("board-filters");
    return verdict(
      boards.map((board) => board.part),
      { boards, screenshot },
    );
  },
};

const decisionSummaryClick: LiveCheck = {
  id: "decision-summary-click",
  requirement: "R11",
  async run(ctx) {
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
  },
};

async function registerRows(ctx: CheckContext, board: Board) {
  const first = await list(ctx, board);
  const page = new BoardPage(ctx.session, board.route);
  await page.load();
  const uiRows = await page.visibleRows();
  const expected = first.nextCursor === null ? first.counts.total : first.items.length;
  const lastColumn = (await page.columns()).at(-1) ?? "";
  const visit: SheetVisit | null = uiRows > 0 ? await page.openRow(0, lastColumn) : null;
  const ok = uiRows === expected && visit !== null && sheetMatchesRow(visit);
  return {
    route: board.route,
    part:
      expected > 0
        ? checked(ok, `${board.route}: rows or the first row's sheet differ from the API`)
        : noData(`${board.route}: the API has no rows`),
    uiRows,
    expected,
    apiTotal: first.counts.total,
    visit,
  };
}

const raidLessonsRows: LiveCheck = {
  id: "raid-lessons-rows",
  requirement: "R13",
  async run(ctx) {
    const boards = [];
    for (const board of [RAID, LESSONS]) boards.push(await registerRows(ctx, board));
    const screenshot = await ctx.screenshot("raid-lessons-rows");
    return verdict(
      boards.map((board) => board.part),
      { boards, screenshot },
    );
  },
};

function describePair(pair: ContrastPair) {
  const { text, ratio, required, fg, bg, fontSize, fontWeight, selector } = pair;
  return {
    text: text.slice(0, 60),
    ratio: Number(ratio.toFixed(2)),
    required,
    fg,
    bg,
    fontSize,
    fontWeight,
    selector,
  };
}

async function contrastOn(ctx: CheckContext, route: string) {
  await ctx.session.goto(route);
  const pairs = await sampleContrast(ctx.session.page);
  const lowest = pairs.reduce<ContrastPair | null>(
    (low, p) => (!low || p.ratio < low.ratio ? p : low),
    null,
  );
  const failing = pairs.filter((pair) => !pair.pass);
  return {
    route,
    part:
      pairs.length > 0
        ? checked(failing.length === 0, `${route}: a text pair is below WCAG AA contrast`)
        : noData(`${route}: no text pair was sampled`),
    checked: pairs.length,
    lowest: lowest && describePair(lowest),
    failing: failing.slice(0, 10).map(describePair),
  };
}

const contrast: LiveCheck = {
  id: "contrast",
  requirement: "R7",
  async run(ctx) {
    const pages = [];
    for (const route of CONTRAST_ROUTES) pages.push(await contrastOn(ctx, route));
    const screenshot = await ctx.screenshot("contrast");
    return verdict(
      pages.map((page) => page.part),
      { pages, screenshot },
    );
  },
};

export const checks: readonly LiveCheck[] = [
  boardFilters,
  decisionSummaryClick,
  raidLessonsRows,
  contrast,
];
