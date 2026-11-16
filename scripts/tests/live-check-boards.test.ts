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

/** What the fake server answers: list endpoints by path and query, and the row IDs each page path shows. */
interface Site {
  readonly api: Map<string, ListPage>;
  readonly pages: Map<string, readonly string[]>;
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
  const shown = () => site.pages.get(current) ?? [];
  const page = {
    url: () => BASE + current,
    waitForSelector: async () => null,
    locator: () => ({
      count: async () => shown().length,
      allTextContents: async () => [...shown()],
    }),
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
