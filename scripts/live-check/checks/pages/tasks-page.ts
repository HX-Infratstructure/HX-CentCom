import type { ReadOnlySession } from "../../session.ts";
import { PAGE_ROUTES } from "../shared.ts";

const SHOW_MORE_TIMEOUT_MS = 20_000;

export interface TaskRow {
  readonly id: string;
  readonly stale: boolean;
}

export interface FeedItem {
  readonly kind: string | null;
  readonly badges: number;
}

export class TasksPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(query = "", hash = ""): Promise<number> {
    return this.#session.goto(`${PAGE_ROUTES.tasks}${query ? `?${query}` : ""}${hash}`);
  }

  rowCount(): Promise<number> {
    return this.#session.page.locator("table.board-table tbody tr").count();
  }

  async statusLabels(): Promise<string[]> {
    const labels = await this.#session.page
      .locator("table.board-table .status-cell")
      .allInnerTexts();
    return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  }

  async kanbanGroups(): Promise<{ heads: string[]; cards: number }> {
    const page = this.#session.page;
    const heads = await page.locator(".kanban-head").allInnerTexts();
    const cards = await page.locator(".kanban .task-card").count();
    return { heads: heads.map((head) => head.replace(/\s+/g, " ").trim()), cards };
  }

  rows(): Promise<TaskRow[]> {
    return this.#session.page.evaluate(() =>
      [...document.querySelectorAll("table.board-table tbody tr")].map((tr) => ({
        id: tr.querySelector("code.record-id")?.textContent?.trim() ?? "",
        stale: tr.querySelector('span.attention[title^="This task\'s commit"]') !== null,
      })),
    );
  }

  feedItems(): Promise<FeedItem[]> {
    return this.#session.page.evaluate(() =>
      [...document.querySelectorAll("#updates .update-item")].map((item) => ({
        kind: item.getAttribute("data-kind"),
        badges: item.querySelectorAll(".update-head .agent-person").length,
      })),
    );
  }

  feedCount(): Promise<number> {
    return this.#session.page.locator("#updates .update-item").count();
  }

  async showMore(): Promise<number> {
    const page = this.#session.page;
    const before = await this.feedCount();
    await page.locator("#updates .show-more button", { hasText: "Show more" }).click();
    await page.waitForFunction(
      (count) => document.querySelectorAll("#updates .update-item").length > count,
      before,
      { timeout: SHOW_MORE_TIMEOUT_MS },
    );
    return this.feedCount();
  }
}
