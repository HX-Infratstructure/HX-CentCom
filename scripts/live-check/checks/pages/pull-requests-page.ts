import type { ReadOnlySession } from "../../session.ts";

export interface BoardGroup {
  readonly title: string;
  readonly rows: number;
}

export class PullRequestsPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(): Promise<number> {
    return this.#session.goto("/pull-requests");
  }

  groups(): Promise<BoardGroup[]> {
    return this.#session.page.evaluate(() =>
      [...document.querySelectorAll("section.board-group")].map((group) => ({
        title: group.querySelector(".group-title button")?.textContent?.trim() ?? "",
        rows: group.querySelectorAll("table.board-table tbody tr").length,
      })),
    );
  }
}
