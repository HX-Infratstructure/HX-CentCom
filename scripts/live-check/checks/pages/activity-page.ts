import type { ReadOnlySession } from "../../session.ts";

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
    return this.#session.goto("/activity");
  }

  /** The first row on the page that shows at least one changed field. */
  async firstChangedRow(): Promise<ActivityRow | null> {
    const rows = await this.#rows();
    return rows.find((row) => row.changes.length > 0) ?? null;
  }

  #rows(): Promise<ActivityRow[]> {
    return this.#session.page.evaluate(() =>
      [...document.querySelectorAll("ul.activity-log > li article.activity-row")].map((row) => ({
        actorName:
          row.querySelector(".activity-head .agent-person-name")?.textContent?.trim() ?? "",
        createdAt: row.querySelector(".activity-side time")?.getAttribute("datetime") ?? null,
        changes: [...row.querySelectorAll("ul.change-list > li")].map((li) => ({
          field: li.querySelector(".change-field")?.textContent?.trim() ?? "",
          from: li.querySelector(".change-from")?.textContent?.trim() ?? null,
          to: li.querySelector(".change-to")?.textContent?.trim() ?? null,
        })),
      })),
    );
  }
}
