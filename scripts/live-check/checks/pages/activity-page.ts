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

  firstRow(): Promise<ActivityRow | null> {
    return this.#session.page.evaluate(() => {
      const row = document.querySelector("ul.activity-log > li article.activity-row");
      if (!row) return null;
      return {
        actorName:
          row.querySelector(".activity-head .agent-person-name")?.textContent?.trim() ?? "",
        createdAt: row.querySelector(".activity-side time")?.getAttribute("datetime") ?? null,
        changes: [...row.querySelectorAll("ul.change-list > li")].map((li) => ({
          field: li.querySelector(".change-field")?.textContent?.trim() ?? "",
          from: li.querySelector(".change-from")?.textContent?.trim() ?? null,
          to: li.querySelector(".change-to")?.textContent?.trim() ?? null,
        })),
      };
    });
  }
}
