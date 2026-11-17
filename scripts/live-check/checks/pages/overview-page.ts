import type { ReadOnlySession } from "../../session.ts";
import { PAGE_ROUTES } from "../shared.ts";

export interface PageShown {
  readonly heading: string;
  readonly error: string | null;
}

export class OverviewPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(path: string = PAGE_ROUTES.home): Promise<number> {
    return this.#session.goto(path);
  }

  /**
   * The chrome's h1, and the error a failed loader shows in place of the page. RouteError keeps the chrome and its
   * h1 (src/components/workspace.tsx:154-161), so only the error state (src/components/list-states.tsx:47) tells.
   */
  shown(): Promise<PageShown> {
    return this.#session.page.evaluate(() => ({
      heading: document.querySelector(".board-heading h1")?.textContent?.trim() ?? "",
      error: document.querySelector("[role=alert].error-state")?.textContent?.trim() ?? null,
    }));
  }

  openPrTitles(): Promise<string[]> {
    return this.#session.page.evaluate(() =>
      [...document.querySelectorAll("section.overview-prs ul.record-list > li.record-row")].map(
        (row) => {
          const title =
            row.querySelector(".row-title a.source-link") ?? row.querySelector(".row-title");
          const clone = title?.cloneNode(true) as HTMLElement | undefined;
          clone?.querySelectorAll(".sr-only").forEach((node) => node.remove());
          return clone?.textContent?.trim() ?? "";
        },
      ),
    );
  }
}
