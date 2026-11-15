import { QueryClient, dehydrate, hydrate, type DehydratedState } from "@tanstack/react-query";
import { createRouter, type Serializable } from "@tanstack/react-router";
import { QUERY_DEFAULTS } from "./lib/task-data";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // One client per request: a module-level QueryClient leaks cached data between SSR requests.
  const queryClient = new QueryClient({ defaultOptions: { queries: QUERY_DEFAULTS } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Lets Query own freshness; set caching defaults on the QueryClient, not the router.
    defaultPreloadStaleTime: 0,
    // DehydratedState types query data as unknown, which the router's serializability check rejects. Every query here
    // caches a server function result, and Start checks those for serializability already.
    dehydrate: () => ({
      queryClientState: dehydrate(queryClient) as DehydratedState & Serializable,
    }),
    hydrate: (dehydrated) => {
      hydrate(queryClient, dehydrated.queryClientState);
    },
  });

  return router;
};
