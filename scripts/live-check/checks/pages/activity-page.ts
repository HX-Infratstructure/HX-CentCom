import type { ReadOnlySession } from "../../session.ts";
import { PAGE_ROUTES } from "../shared.ts";
import { ACTIVITY_ROWS, LIST_EMPTY } from "./selectors.ts";

export interface ActivityChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface ActivityRow {
  readonly actorName: string;
  readonly createdAt: string | null;
  readonly changes: readonly ActivityChange[];
}

export class ActivityPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(): Promise<number> {
    return this.#session.goto(PAGE_ROUTES.activity);
  }

  /**
   * The rows the activity list shows. An empty array means the page shows its empty state, which the route renders
   * in place of the list when no entry exists. Null means the page shows neither a row nor that state, so its
   * structure is not what this checker reads.
   */
  rows(): Promise<ActivityRow[] | null> {
    return this.#session.page.evaluate(
      ({ activityRows, listEmpty }) => {
        const rows = [...document.querySelectorAll(activityRows)].map((row) => ({
          actorName:
            row.querySelector(".activity-head .agent-person-name")?.textContent?.trim() ?? "",
          createdAt: row.querySelector(".activity-side time")?.getAttribute("datetime") ?? null,
          changes: [...row.querySelectorAll("ul.change-list > li")].map((li) => ({
            field: li.querySelector(".change-field")?.textContent?.trim() ?? "",
            from: li.querySelector(".change-from")?.textContent?.trim() ?? null,
            to: li.querySelector(".change-to")?.textContent?.trim() ?? null,
          })),
        }));
        if (rows.length > 0) return rows;
        return document.querySelector(listEmpty) ? [] : null;
      },
      { activityRows: ACTIVITY_ROWS, listEmpty: LIST_EMPTY },
    );
  }
}
