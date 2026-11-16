export type FetchFn = (
  url: string,
  init: { method: "GET"; signal: AbortSignal },
) => Promise<Response>;

export const DEFAULT_API_TIMEOUT_MS = 30_000;

export class LiveApi {
  readonly #base: string;
  readonly #fetchFn: FetchFn;
  readonly #timeoutMs: number;

  constructor(base: string, fetchFn: FetchFn, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
    this.#base = base;
    this.#fetchFn = fetchFn;
    this.#timeoutMs = timeoutMs;
  }

  async getJson<T>(path: string): Promise<T> {
    const url = this.#base + path;
    // One signal spans the request and the body read, so a body that never ends still stops.
    // A ref'd timer, unlike AbortSignal.timeout, fires even when nothing else holds the event loop.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetchFn(url, { method: "GET", signal: deadline.signal });
      if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
      const body = await response.text();
      try {
        return JSON.parse(body) as T;
      } catch (error) {
        throw new Error(`GET ${path} returned a body that is not JSON`, { cause: error });
      }
    } catch (error) {
      if (deadline.signal.aborted) {
        throw new Error(`GET ${path} timed out after ${this.#timeoutMs} ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
