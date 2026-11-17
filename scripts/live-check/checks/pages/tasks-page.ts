import type { ReadOnlySession } from "../../session.ts";
import { PAGE_ROUTES } from "../shared.ts";
import {
  BOARD_ROWS,
  RECORD_ID,
  SHOW_MORE_BUTTON,
  STATUS_CELLS,
  UPDATE_ITEMS,
} from "./selectors.ts";

const SHOW_MORE_TIMEOUT_MS = 20_000;

export interface TaskRow {
  readonly id: string;
  readonly stale: boolean;
}

export interface FeedItem {
  readonly kind: string | null;
  readonly system: boolean;
  readonly badges: number;
}

export class TasksPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(query: Readonly<Record<string, string>> = {}, fragment = ""): Promise<number> {
    const search = new URLSearchParams(query).toString();
    return this.#session.goto(
      `${PAGE_ROUTES.tasks}${search ? `?${search}` : ""}${fragment ? `#${fragment}` : ""}`,
    );
  }

  async statusLabels(): Promise<string[]> {
    const labels = await this.#session.page.locator(STATUS_CELLS).allInnerTexts();
    return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  }

  async kanbanGroups(): Promise<{ heads: string[]; cards: number }> {
    const page = this.#session.page;
    const heads = await page.locator(".kanban-head").allInnerTexts();
    const cards = await page.locator(".kanban .task-card").count();
    return { heads: heads.map((head) => head.replace(/\s+/g, " ").trim()), cards };
  }

  rows(): Promise<TaskRow[]> {
    return this.#session.page.evaluate(
      ({ rows, id }) =>
        [...document.querySelectorAll(rows)].map((tr) => ({
          id: tr.querySelector(id)?.textContent?.trim() ?? "",
          stale: tr.querySelector("span.attention") !== null,
        })),
      { rows: BOARD_ROWS, id: RECORD_ID },
    );
  }

  feedItems(): Promise<FeedItem[]> {
    return this.#session.page.evaluate(
      (items) =>
        [...document.querySelectorAll(items)].map((item) => ({
          kind: item.getAttribute("data-kind"),
          system: item.querySelector(".update-head .system-person") !== null,
          badges: item.querySelectorAll(".update-head .agent-person:not(.system-person)").length,
        })),
      UPDATE_ITEMS,
    );
  }

  feedCount(): Promise<number> {
    return this.#session.page.locator(UPDATE_ITEMS).count();
  }

  async showMore(): Promise<number> {
    const page = this.#session.page;
    const before = await this.feedCount();
    const button = page.locator(SHOW_MORE_BUTTON);
    if ((await button.count()) === 0) throw new Error("the update log has no Show more button");
    await button.click();
    await page.waitForFunction(
      ({ items, count }) => document.querySelectorAll(items).length > count,
      { items: UPDATE_ITEMS, count: before },
      { timeout: SHOW_MORE_TIMEOUT_MS },
    );
    return this.feedCount();
  }
}
