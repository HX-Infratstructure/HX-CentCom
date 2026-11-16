import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checks } from "../live-check/checks/boards.ts";
import type { ListPage } from "../live-check/checks/shared.ts";
import type { CheckContext } from "../live-check/types.ts";

const BASE = "http://h";

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
  const element = (selector: string): Record<string, unknown> => ({
    count: async () => shown().length,
    allTextContents: async () => (selector.includes("thead") ? ["ID", "Summary"] : [...shown()]),
    first: () => element(selector),
    nth: () => element(selector),
    locator: (inner: string) => element(inner),
    textContent: async () =>
      selector.includes("sheet-description")
        ? (site.sheetDescription ?? null)
        : (shown()[0] ?? null),
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
      return 200;
    },
  };
  const api = {
    getJson: async (path: string) => {
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

  test("records a decision without a description and does not fail on it", async () => {
    const outcome = await decisionSummaryClick.run(fakeContext(decisionSite(null, "")));
    assert.equal(outcome.status, "PASS", outcome.reason);
    assert.deepEqual(outcome.evidence["description"], { expected: null, shown: null });
  });
});
