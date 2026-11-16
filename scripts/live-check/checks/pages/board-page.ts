import type { Locator } from "playwright";
import type { ReadOnlySession } from "../../session.ts";

const TABLE = "table.board-table";
const VISIBLE_ROWS = `${TABLE} tbody tr:visible`;
const ROW_ID = "th code.record-id";
const SHEET = "[role=dialog]";
const SHEET_ID = ".detail-head code.record-id";
const WAIT_MS = 10_000;

export interface SheetVisit {
  readonly column: string;
  readonly rowId: string | null;
  readonly sheetId: string | null;
  readonly itemParam: string | null;
  readonly urlOpen: string;
  readonly urlClosed: string;
}

export function sheetMatchesRow(visit: SheetVisit): boolean {
  return (
    visit.rowId !== null &&
    visit.itemParam === visit.rowId &&
    visit.sheetId === visit.rowId &&
    !new URL(visit.urlClosed).searchParams.has("item")
  );
}

async function trimmedText(locator: Locator): Promise<string | null> {
  const value = await locator
    .first()
    .textContent({ timeout: WAIT_MS })
    .catch(() => null);
  return value?.trim() || null;
}

/** One board route (/decisions, /raid, /lessons): its rows and the sheet a row click opens. Reads only; presses only Escape. */
export class BoardPage {
  readonly route: string;
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession, route: string) {
    this.#session = session;
    this.route = route;
  }

  async load(query: Readonly<Record<string, string>> = {}): Promise<string> {
    const search = new URLSearchParams(query).toString();
    await this.#session.goto(search ? `${this.route}?${search}` : this.route);
    await this.#session.page.waitForSelector("main", { timeout: WAIT_MS });
    return this.#session.page.url();
  }

  visibleRows(): Promise<number> {
    return this.#session.page.locator(VISIBLE_ROWS).count();
  }

  async rowIds(): Promise<readonly string[]> {
    const ids = await this.#session.page.locator(`${VISIBLE_ROWS} ${ROW_ID}`).allTextContents();
    return ids.map((id) => id.trim());
  }

  async columns(): Promise<readonly string[]> {
    const names = await this.#session.page
      .locator(TABLE)
      .first()
      .locator("thead th")
      .allTextContents();
    return names.map((name) => name.trim());
  }

  async openRow(
    index: number,
    column: string,
    whileOpen: () => Promise<unknown> = async () => undefined,
  ): Promise<SheetVisit> {
    const page = this.#session.page;
    const row = page.locator(VISIBLE_ROWS).nth(index);
    const cellIndex = (await this.columns()).indexOf(column);
    if (cellIndex === -1) throw new Error(`${this.route} has no column "${column}"`);
    const rowId = await trimmedText(row.locator(ROW_ID));
    await row.locator("th, td").nth(cellIndex).click();
    const sheet = page.locator(SHEET);
    await sheet.waitFor({ state: "visible", timeout: WAIT_MS });
    await page.waitForURL((url) => url.searchParams.has("item"), { timeout: WAIT_MS });
    const sheetId = await trimmedText(sheet.locator(SHEET_ID));
    const urlOpen = page.url();
    await whileOpen();
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: WAIT_MS });
    const itemParam = new URL(urlOpen).searchParams.get("item");
    return { column, rowId, sheetId, itemParam, urlOpen, urlClosed: page.url() };
  }
}
