import type { Locator } from "playwright";
import { OWN_ACTION } from "../../../../src/lib/own-action.ts";
import type { ReadOnlySession } from "../../session.ts";
import { BOARD_ROWS, RECORD_ID } from "./selectors.ts";

const VISIBLE_ROWS = `${BOARD_ROWS}:visible`;
const ROW_ID = `th ${RECORD_ID}`;
const SHEET = "[role=dialog]";
const SHEET_ID = `.detail-head ${RECORD_ID}`;
/** The rendered description in a record's sheet (`src/components/decision.tsx:195-197`), without its heading. */
const SHEET_DESCRIPTION = ".sheet-description .rich-text";
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

/** The element's trimmed text, or null when it is empty. A missing element fails with its name instead. */
async function trimmedText(locator: Locator, name: string): Promise<string | null> {
  const value = await locator
    .first()
    .textContent({ timeout: WAIT_MS })
    .catch((error: unknown) => {
      throw new Error(`${name} not found`, { cause: error });
    });
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

  /** The column names of the table that holds visible row `index`. `/decisions` shows tables with different columns. */
  async columns(index = 0): Promise<readonly string[]> {
    const names = await this.#session.page
      .locator(VISIBLE_ROWS)
      .nth(index)
      .locator("xpath=ancestor::table[1]")
      .locator("thead th")
      .allTextContents();
    return names.map((name) => name.trim());
  }

  /** The open sheet's description text, as the DOM's `textContent` reads it. Call it while the sheet is open. */
  sheetDescription(): Promise<string | null> {
    return trimmedText(
      this.#session.page.locator(SHEET).locator(SHEET_DESCRIPTION),
      `${this.route} sheet description`,
    );
  }

  async openRow(
    index: number,
    column: string,
    whileOpen: () => Promise<unknown> = async () => undefined,
  ): Promise<SheetVisit> {
    const page = this.#session.page;
    const row = page.locator(VISIBLE_ROWS).nth(index);
    const cellIndex = (await this.columns(index)).indexOf(column);
    if (cellIndex === -1) throw new Error(`${this.route} has no column "${column}"`);
    const cell = row.locator("th, td").nth(cellIndex);
    if ((await cell.locator(OWN_ACTION).count()) > 0) {
      throw new Error(
        `${this.route} column "${column}" holds its own control, so a click there opens no sheet`,
      );
    }
    const rowId = await trimmedText(row.locator(ROW_ID), `${this.route} row ${index} record ID`);
    const sheet = page.locator(SHEET);
    const shown = await this.#observeSheet(cell, sheet, whileOpen).catch(async (error: unknown) => {
      await this.#closeSheet(sheet).catch(() => undefined);
      throw error;
    });
    await this.#closeSheet(sheet);
    return { column, rowId, ...shown, urlClosed: page.url() };
  }

  async #observeSheet(
    cell: Locator,
    sheet: Locator,
    whileOpen: () => Promise<unknown>,
  ): Promise<Pick<SheetVisit, "sheetId" | "itemParam" | "urlOpen">> {
    const page = this.#session.page;
    await cell.click();
    await sheet.waitFor({ state: "visible", timeout: WAIT_MS });
    await page.waitForURL((url) => url.searchParams.has("item"), { timeout: WAIT_MS });
    const sheetId = await trimmedText(sheet.locator(SHEET_ID), `${this.route} sheet record ID`);
    const urlOpen = page.url();
    await whileOpen();
    return { sheetId, itemParam: new URL(urlOpen).searchParams.get("item"), urlOpen };
  }

  async #closeSheet(sheet: Locator): Promise<void> {
    await this.#session.page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: WAIT_MS });
  }
}
