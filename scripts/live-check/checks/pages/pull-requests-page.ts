import type { ReadOnlySession } from "../../session.ts";
import { PAGE_ROUTES } from "../shared.ts";
import { BOARD_ROWS } from "./selectors.ts";

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
    return this.#session.goto(PAGE_ROUTES.pullRequests);
  }

  groups(): Promise<BoardGroup[]> {
    return this.#session.page.evaluate(
      (rows) =>
        [...document.querySelectorAll("section.board-group")].map((group) => ({
          title: group.querySelector(".group-title button")?.textContent?.trim() ?? "",
          rows: group.querySelectorAll(rows).length,
        })),
      BOARD_ROWS,
    );
  }
}
