import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { BoardPage, sheetMatchesRow } from "../live-check/checks/pages/board-page.ts";
import type { ReadOnlySession } from "../live-check/session.ts";

const BASE = "http://board.test";

/**
 * A board with the app's row markup (`src/components/raid.tsx:74-82`): the header cell holds the row's own link, and
 * another cell links to another record. The tbody follows the header link as `src/components/board.tsx` does, and the
 * sheet opens from `?item=` and closes on Escape.
 */
const BOARD = `<!doctype html><main>
<table class="board-table">
  <thead><tr><th>Title</th><th>Blocks</th></tr></thead>
  <tbody><tr>
    <th scope="row"><a href="/raid?item=R-1">Risk one</a> <code class="record-id">R-1</code></th>
    <td><a href="/raid?item=R-9">R-9</a></td>
  </tr></tbody>
</table>
<div role="dialog" hidden><div class="detail-head"><code class="record-id"></code></div></div>
</main>
<script>
  const dialog = document.querySelector("[role=dialog]");
  const item = new URLSearchParams(location.search).get("item");
  if (item) {
    dialog.hidden = false;
    dialog.querySelector("code").textContent = item;
  }
  document.querySelector("tbody").addEventListener("click", (event) => {
    if (event.target.closest("a[href]")) return;
    event.target.closest("tr").querySelector(":scope > th a[href]").click();
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    dialog.hidden = true;
    history.replaceState(null, "", location.pathname);
  });
</script>`;

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route(`${BASE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: BOARD }),
  );
});

after(async () => {
  await browser.close();
});

function boardSession(): ReadOnlySession {
  return {
    page,
    goto: async (path) => (await page.goto(BASE + path))?.status() ?? 0,
    blockedRequests: () => [],
    takeConsoleErrors: () => [],
    close: async () => undefined,
  };
}

describe("BoardPage.openRow in Chromium", () => {
  test("opens the row's sheet from the header cell, whose link is the row's own", async () => {
    const board = new BoardPage(boardSession(), "/raid");
    await board.load();
    const visit = await board.openRow(0, "Title");
    assert.equal(visit.rowId, "R-1");
    assert.ok(
      sheetMatchesRow(visit),
      `the sheet matches the clicked row: ${JSON.stringify(visit)}`,
    );
  });

  test("refuses a cell that holds a link to another record", async () => {
    const board = new BoardPage(boardSession(), "/raid");
    await board.load();
    await assert.rejects(
      board.openRow(0, "Blocks"),
      /\/raid column "Blocks" holds its own control/,
    );
    assert.equal(new URL(page.url()).searchParams.has("item"), false);
  });
});
