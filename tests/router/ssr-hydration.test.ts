// The router dehydrates on the server and hydrates in the browser; between them the state crosses as serialized data.
import { InfiniteQueryObserver, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { getRouter } from "@/router";

const listKey = ["fixture", "list"];
const pagesKey = ["fixture", "pages"];
const listData = { rows: ["IRP-04", "CC-01"] };
const firstPage = { rows: ["D-01", "D-02"], next: null };

describe("SSR query hydration", () => {
  it("hands the server's query data to the browser, which mounts it without refetching", async () => {
    const server = getRouter();
    const serverClient = server.options.context.queryClient;
    await serverClient.fetchQuery({ queryKey: listKey, queryFn: vi.fn(async () => listData) });
    await serverClient.fetchInfiniteQuery({
      queryKey: pagesKey,
      queryFn: vi.fn(async () => firstPage),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    });
    const wire: unknown = JSON.parse(JSON.stringify((await server.options.dehydrate?.()) ?? null));

    const browser = getRouter();
    const browserClient = browser.options.context.queryClient;
    await browser.options.hydrate?.(wire as never);

    const refetchList = vi.fn(async () => ({ rows: ["refetched"] }));
    const refetchPages = vi.fn(async () => ({ rows: ["refetched"], next: null }));
    const list = new QueryObserver(browserClient, { queryKey: listKey, queryFn: refetchList });
    const pages = new InfiniteQueryObserver(browserClient, {
      queryKey: pagesKey,
      queryFn: refetchPages,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    });
    const unsubscribe = [list.subscribe(() => undefined), pages.subscribe(() => undefined)];
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      expect(list.getCurrentResult().data).toEqual(listData);
      expect(pages.getCurrentResult().data?.pages).toEqual([firstPage]);
      expect(refetchList).not.toHaveBeenCalled();
      expect(refetchPages).not.toHaveBeenCalled();
    } finally {
      for (const stop of unsubscribe) stop();
      serverClient.clear();
      browserClient.clear();
    }
  });
});
