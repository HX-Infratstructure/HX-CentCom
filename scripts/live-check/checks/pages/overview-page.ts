import type { ReadOnlySession } from "../../session.ts";

export class OverviewPage {
  readonly #session: ReadOnlySession;

  constructor(session: ReadOnlySession) {
    this.#session = session;
  }

  open(path = "/"): Promise<number> {
    return this.#session.goto(path);
  }

  async heading(): Promise<string> {
    const h1 = this.#session.page.locator(".board-heading h1").first();
    if ((await h1.count()) === 0) return "";
    return (await h1.innerText()).trim();
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
