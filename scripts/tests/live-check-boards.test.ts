import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/boards.ts";
import { BoardPage } from "../live-check/checks/pages/board-page.ts";
import type { ListPage } from "../live-check/checks/shared.ts";
import type { CheckContext } from "../live-check/types.ts";

const BASE = "http://h";
/** More reads than any check here needs, so a walk that never ends fails the test instead of starving its timeout. */
const API_READ_LIMIT = 50;

type Item = ListPage["items"][number];

function rows(prefix: string, from: number, n: number, field: string, value: string): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${from + i}`, [field]: value }));
}

function listPage(
  items: readonly Item[],
  counts: ListPage["counts"],
  nextCursor: string | null = null,
): ListPage {
  return { items, counts, nextCursor };
}

/** What the fake server answers: list endpoints by path and query, the row IDs each page path shows, and the open sheet's description text. */
interface Site {
  readonly api: Map<string, ListPage>;
  readonly pages: Map<string, readonly string[]>;
  sheetDescription?: string;
  /** A column whose cells hold their own control, such as a link to another record. */
  controlColumn?: string;
  /** The header of the route's first table when the clicked row sits in another table with other columns. */
  firstTableColumns?: readonly string[];
  /** A selector the page lacks, so reading its text times out. */
  missing?: string;
  /** A record written while `page` loads, after the check's first read of `api`, so a later read of `api` gets `answer`. */
  writeOnLoad?: { readonly page: string; readonly api: string; readonly answer: ListPage };
}

function healthySite(): Site {
  const decision = rows("D", 3, 1, "status", "Approved");
  const risk = rows("R", 1, 1, "type", "risk");
  const lesson = rows("L", 3, 1, "status", "closed");
  return {
    api: new Map([
      ["/api/v1/decisions", listPage([], { total: 3, byStatus: { Pending: 2, Approved: 1 } })],
      ["/api/v1/decisions?status=Approved", listPage(decision, { total: 1 })],
      ["/api/v1/raid", listPage([], { total: 3, byType: { risk: 1, issue: 2 } })],
      ["/api/v1/raid?type=risk", listPage(risk, { total: 1 })],
      ["/api/v1/lessons", listPage([], { total: 3, byStatus: { open: 2, closed: 1 } })],
      ["/api/v1/lessons?status=closed", listPage(lesson, { total: 1 })],
    ]),
    pages: new Map([
      ["/decisions?status=Approved", ["D-3"]],
      ["/raid?type=risk", ["R-1"]],
      ["/lessons?status=closed", ["L-3"]],
    ]),
  };
}

function fakeContext(site: Site): CheckContext {
  let current = "";
  let item: string | null = null;
  const shown = () => site.pages.get(current) ?? [];
  const at = () => (item === null ? current : `${current}?item=${item}`);
  const columns = ["ID", "Summary", ...(site.controlColumn ? [site.controlColumn] : [])];
  // Column 0 is the row's header cell, which holds the row's own link, as every board row does.
  const holdsLink = (cell: number) => cell === 0 || columns[cell] === site.controlColumn;
  const element = (selector: string, cell = -1, ownTable = false): Record<string, unknown> => ({
    count: async () => (selector.includes("a[href]") ? Number(holdsLink(cell)) : shown().length),
    and: () => ({ count: async () => Number(cell === 0) }),
    allTextContents: async () =>
      selector.includes("thead")
        ? ownTable
          ? columns
          : (site.firstTableColumns ?? columns)
        : [...shown()],
    first: () => element(selector, cell, ownTable),
    nth: (n: number) => element(selector, selector === "th, td" ? n : cell, ownTable),
    locator: (inner: string) =>
      element(inner, cell, ownTable || inner.startsWith("xpath=ancestor::table")),
    textContent: async () => {
      if (site.missing && selector.includes(site.missing)) {
        throw new Error(`locator.textContent: Timeout 10000ms exceeded (${selector})`);
      }
      return selector.includes("sheet-description")
        ? (site.sheetDescription ?? null)
        : (shown()[0] ?? null);
    },
    click: async () => {
      item = shown()[0] ?? null;
    },
    waitFor: async () => undefined,
  });
  const page = {
    url: () => BASE + at(),
    waitForSelector: async () => null,
    waitForURL: async () => undefined,
    keyboard: {
      press: async () => {
        item = null;
      },
    },
    locator: (selector: string) => element(selector),
  };
  const session = {
    page,
    goto: async (path: string) => {
      current = path;
      if (site.writeOnLoad?.page === path)
        site.api.set(site.writeOnLoad.api, site.writeOnLoad.answer);
      return 200;
    },
  };
  let reads = 0;
  const api = {
    getJson: async (path: string) => {
      if (++reads > API_READ_LIMIT) throw new Error(`more than ${API_READ_LIMIT} API reads`);
      const answer = site.api.get(path);
      if (!answer) throw new Error(`unexpected API read ${path}`);
      return answer;
    },
  };
  return {
    session,
    api,
    screenshot: async (name: string) => name,
  } as unknown as CheckContext;
}

const boardFilters = checks.find((check) => check.id === "board-filters");
assert.ok(boardFilters, "boards.ts exports the board-filters check");

describe("board-filters", () => {
  test("passes when each filtered page shows the filtered API rows", async () => {
    const outcome = await boardFilters.run(fakeContext(healthySite()));
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("expects the filtered response's total, not the facet count read before it", async () => {
    const site = healthySite();
    const grown = rows("R", 1, 2, "type", "risk");
    site.api.set("/api/v1/raid?type=risk", listPage(grown, { total: 2 }));
    site.pages.set("/raid?type=risk", ["R-1", "R-2"]);
    const outcome = await boardFilters.run(fakeContext(site));
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("fails when the page shows a full page of rows the filter excludes", async () => {
    const site = healthySite();
    site.api.set("/api/v1/raid", listPage([], { total: 50, byType: { risk: 25, issue: 25 } }));
    site.api.set(
      "/api/v1/raid?type=risk",
      listPage(rows("R", 1, 20, "type", "risk"), { total: 25 }, "next"),
    );
    const issueIds = rows("I", 1, 20, "type", "issue").map((item) => item.id);
    site.pages.set("/raid?type=risk", issueIds);
    const outcome = await boardFilters.run(fakeContext(site));
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /\/raid/);
  });

  test("reports no data, naming the route, when a filtered row is written during the page load", async () => {
    const site = healthySite();
    const grown = rows("R", 1, 2, "type", "risk");
    site.pages.set("/raid?type=risk", ["R-1", "R-2"]);
    site.writeOnLoad = {
      page: "/raid?type=risk",
      api: "/api/v1/raid?type=risk",
      answer: listPage(grown, { total: 2 }),
    };
    const outcome = await boardFilters.run(fakeContext(site));
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED", outcome.reason);
    assert.match(outcome.reason ?? "", /\/raid: .*changed/);
  });
});

const raidLessonsRows = checks.find((check) => check.id === "raid-lessons-rows");
assert.ok(raidLessonsRows, "boards.ts exports the raid-lessons-rows check");

function registerSite(raidShown: readonly string[]): Site {
  const raid = [...rows("R", 1, 1, "type", "risk"), ...rows("P", 1, 1, "type", "dependency")];
  const lessons = rows("L", 1, 1, "status", "proposed");
  return {
    api: new Map([
      ["/api/v1/raid", listPage(raid, { total: 2 })],
      ["/api/v1/lessons", listPage(lessons, { total: 1 })],
    ]),
    pages: new Map([
      ["/raid", raidShown],
      ["/lessons", ["L-1"]],
    ]),
  };
}

describe("raid-lessons-rows", () => {
  test("passes when each register shows its groups in the fixed group order", async () => {
    const outcome = await raidLessonsRows.run(fakeContext(registerSite(["R-1", "P-1"])));
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("fails when the page shows the groups out of their fixed order", async () => {
    const outcome = await raidLessonsRows.run(fakeContext(registerSite(["P-1", "R-1"])));
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /\/raid/);
  });

  test("reports no data, naming the route, when a row is written during the page load", async () => {
    const site = registerSite(["R-2", "R-1", "P-1"]);
    const grown = [...rows("R", 2, 1, "type", "risk"), ...rows("R", 1, 1, "type", "risk")];
    site.writeOnLoad = {
      page: "/raid",
      api: "/api/v1/raid",
      answer: listPage([...grown, ...rows("P", 1, 1, "type", "dependency")], { total: 3 }),
    };
    const outcome = await raidLessonsRows.run(fakeContext(site));
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED", outcome.reason);
    assert.match(outcome.reason ?? "", /\/raid: .*changed/);
  });

  test("fails when the API has no rows but the page shows one", async () => {
    const site = registerSite(["R-1"]);
    site.api.set("/api/v1/raid", listPage([], { total: 0 }));
    const outcome = await raidLessonsRows.run(fakeContext(site));
    assert.equal(outcome.status, "FAIL", outcome.reason);
    assert.match(outcome.reason ?? "", /\/raid/);
  });

  test("reports no data only when both the API and the page are empty", async () => {
    const site = registerSite([]);
    site.api.set("/api/v1/raid", listPage([], { total: 0 }));
    const outcome = await raidLessonsRows.run(fakeContext(site));
    assert.equal(outcome.status, "LIVE_NOT_EXECUTED", outcome.reason);
    assert.match(outcome.reason ?? "", /\/raid: the API has no rows/);
  });
});

const decisionSummaryClick = checks.find((check) => check.id === "decision-summary-click");
assert.ok(decisionSummaryClick, "boards.ts exports the decision-summary-click check");

const DESCRIPTION = "Ship **release 1.2** now.\n\n- run `verify.sh`\n- record the result";
const RENDERED = "Ship release 1.2 now.run verify.shrecord the result";

function decisionSite(description: string | null, sheetDescription: string): Site {
  const decision = { id: "D-1", status: "Pending", description };
  return {
    api: new Map([["/api/v1/decisions", listPage([decision], { total: 1 })]]),
    pages: new Map([["/decisions", ["D-1"]]]),
    sheetDescription,
  };
}

describe("decision-summary-click", () => {
  test("passes when the sheet shows the clicked decision's description as rendered text", async () => {
    const outcome = await decisionSummaryClick.run(
      fakeContext(decisionSite(DESCRIPTION, RENDERED)),
    );
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("fails when the sheet shows less than the full description", async () => {
    const site = decisionSite(DESCRIPTION, "Ship release 1.2 now.");
    const outcome = await decisionSummaryClick.run(fakeContext(site));
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /description/);
  });

  test("finds the clicked decision on a later page of the list", async () => {
    const site = decisionSite(DESCRIPTION, "Ship release 1.2 now.");
    const later = site.api.get("/api/v1/decisions");
    assert.ok(later);
    site.api.set("/api/v1/decisions", listPage([{ id: "D-9" }], { total: 2 }, "c2"));
    site.api.set("/api/v1/decisions?cursor=c2", later);
    const outcome = await decisionSummaryClick.run(fakeContext(site));
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /description/);
  });

  test(
    "fails, naming the cursor, when the decisions API repeats a cursor",
    { timeout: 5_000 },
    async () => {
      const site = decisionSite(DESCRIPTION, RENDERED);
      site.api.set("/api/v1/decisions", listPage([{ id: "D-9" }], { total: 3 }, "c2"));
      site.api.set("/api/v1/decisions?cursor=c2", listPage([{ id: "D-8" }], { total: 3 }, "c2"));
      const outcome = await decisionSummaryClick.run(fakeContext(site));
      assert.equal(outcome.status, "FAIL");
      assert.match(outcome.reason ?? "", /repeated cursor c2/);
    },
  );

  test("opens the row against its own table's columns when the first table's differ", async () => {
    const site = { ...decisionSite(DESCRIPTION, RENDERED), firstTableColumns: ["ID", "Age"] };
    const outcome = await decisionSummaryClick.run(fakeContext(site));
    assert.equal(outcome.status, "PASS", outcome.reason);
  });

  test("records a decision without a description and does not fail on it", async () => {
    const outcome = await decisionSummaryClick.run(fakeContext(decisionSite(null, "")));
    assert.equal(outcome.status, "PASS", outcome.reason);
    assert.deepEqual(outcome.evidence["description"], { expected: null, shown: null });
  });
});

describe("BoardPage.openRow", () => {
  test("closes the sheet and clears ?item= when the open-sheet callback throws", async () => {
    const ctx = fakeContext(decisionSite(DESCRIPTION, RENDERED));
    const page = new BoardPage(ctx.session, "/decisions");
    await page.load();
    await assert.rejects(
      page.openRow(0, "Summary", async () => {
        throw new Error("read failed");
      }),
      /read failed/,
    );
    assert.equal(new URL(ctx.session.page.url()).searchParams.has("item"), false);
  });

  test("refuses a column whose cell holds its own control, naming the route and column", async () => {
    const ctx = fakeContext({ ...decisionSite(DESCRIPTION, RENDERED), controlColumn: "Blocks" });
    const page = new BoardPage(ctx.session, "/decisions");
    await page.load();
    await assert.rejects(
      page.openRow(0, "Blocks"),
      /\/decisions column "Blocks" holds its own control/,
    );
    assert.equal(new URL(ctx.session.page.url()).searchParams.has("item"), false);
  });

  test("opens the row from its header column, whose cell holds the row's own link", async () => {
    const ctx = fakeContext({ ...decisionSite(DESCRIPTION, RENDERED), controlColumn: "Blocks" });
    const page = new BoardPage(ctx.session, "/decisions");
    await page.load();
    const visit = await page.openRow(0, "ID");
    assert.equal(visit.itemParam, visit.rowId);
    assert.equal(new URL(visit.urlClosed).searchParams.has("item"), false);
  });

  test("fails naming the sheet's record ID when that element is missing, not as an empty ID", async () => {
    const site = { ...decisionSite(DESCRIPTION, RENDERED), missing: ".detail-head" };
    const ctx = fakeContext(site);
    const page = new BoardPage(ctx.session, "/decisions");
    await page.load();
    await assert.rejects(page.openRow(0, "Summary"), /\/decisions sheet record ID not found/);
    assert.equal(new URL(ctx.session.page.url()).searchParams.has("item"), false);
  });
});
