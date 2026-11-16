// Renders the whole app at a URL, as a browser loads it, and waits for the page's h1.
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
  type Router,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { routeTree } from "@/routeTree.gen";

export async function renderApp(
  url: string,
  {
    heading,
    seed = [],
    onDocument = false,
  }: {
    readonly heading: string;
    readonly seed?: readonly (readonly [QueryKey, unknown])[];
    readonly onDocument?: boolean;
  },
): Promise<Router<typeof routeTree>> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [key, data] of seed) queryClient.setQueryData(key, data);
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  if (onDocument) {
    // The root route renders the whole document, so it mounts on `document` as the app does. Inside a <div>, React maps
    // <body> onto an ancestor of its own container, and the focus a dialog restores on close never finishes dispatching.
    render(<RouterProvider router={router} />, { container: document as unknown as HTMLElement });
  } else {
    render(<RouterProvider router={router} />);
  }
  await screen.findByRole("heading", { level: 1, name: heading, hidden: onDocument });
  return router;
}
