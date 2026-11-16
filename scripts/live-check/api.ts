export type FetchFn = (url: string, init: { method: "GET" }) => Promise<Response>;

export class LiveApi {
  readonly #base: string;
  readonly #fetchFn: FetchFn;

  constructor(base: string, fetchFn: FetchFn) {
    this.#base = base;
    this.#fetchFn = fetchFn;
  }

  async getJson<T>(path: string): Promise<T> {
    const url = this.#base + path;
    const response = await this.#fetchFn(url, { method: "GET" });
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
    return (await response.json()) as T;
  }
}
