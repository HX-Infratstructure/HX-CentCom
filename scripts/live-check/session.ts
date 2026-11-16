import { chromium } from "playwright";
import type { Browser, Page, Route } from "playwright";

const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);
const VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;

export function isReadOnlyMethod(method: string): boolean {
  return READ_ONLY_METHODS.has(method.toUpperCase());
}

export interface ReadOnlySession {
  readonly page: Page;
  goto(path: string): Promise<number>;
  blockedRequests(): readonly string[];
  takeConsoleErrors(): readonly string[];
  close(): Promise<void>;
}

export class PlaywrightSession implements ReadOnlySession {
  readonly page: Page;
  readonly #browser: Browser;
  readonly #base: string;
  readonly #blocked: string[] = [];
  #consoleErrors: string[] = [];

  private constructor(browser: Browser, page: Page, base: string) {
    this.#browser = browser;
    this.page = page;
    this.#base = base;
  }

  static async open(base: string): Promise<ReadOnlySession> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      const session = new PlaywrightSession(browser, page, base);
      await session.#watch();
      return session;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async goto(path: string): Promise<number> {
    const response = await this.page.goto(this.#base + path, {
      waitUntil: "networkidle",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    return response?.status() ?? 0;
  }

  blockedRequests(): readonly string[] {
    return [...this.#blocked];
  }

  takeConsoleErrors(): readonly string[] {
    const errors = this.#consoleErrors;
    this.#consoleErrors = [];
    return errors;
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }

  async #watch(): Promise<void> {
    await this.page.route("**/*", (route) => this.#guard(route));
    this.page.on("console", (message) => {
      if (message.type() === "error") this.#consoleErrors.push(message.text());
    });
    this.page.on("pageerror", (error) => this.#consoleErrors.push(error.message));
  }

  async #guard(route: Route): Promise<void> {
    const request = route.request();
    if (isReadOnlyMethod(request.method())) return route.continue();
    this.#blocked.push(`${request.method()} ${request.url()}`);
    return route.abort("blockedbyclient");
  }
}
