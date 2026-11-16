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
    // The abort stops a fetch that honours its signal, request and body alike. The race keeps the
    // deadline for one that does not. A ref'd timer, unlike AbortSignal.timeout, fires even when
    // nothing else holds the event loop.
    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`GET ${path} timed out after ${this.#timeoutMs} ms`));
        deadline.abort();
      }, this.#timeoutMs);
    });
    try {
      return await Promise.race([this.#read<T>(path, deadline.signal), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #read<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await this.#fetchFn(this.#base + path, { method: "GET", signal });
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch (error) {
      throw new Error(`GET ${path} returned a body that is not JSON`, { cause: error });
    }
  }
}
