import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { RecordLink } from "./url-state";

function OpenItem({ page }: { page: string }) {
  const search: Record<string, unknown> = useSearch({ strict: false });
  return (
    <p>
      {page} with {String(search["item"])} open
    </p>
  );
}

function appAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const overview = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => (
      <>
        <RecordLink kind="raid" id="RAID-07">
          RAID-07
        </RecordLink>
        <RecordLink kind="lesson" id="L-01">
          L-01
        </RecordLink>
      </>
    ),
  });
  const raid = createRoute({
    getParentRoute: () => root,
    path: "/raid",
    component: () => <OpenItem page="RAID register" />,
  });
  const lessons = createRoute({
    getParentRoute: () => root,
    path: "/lessons",
    component: () => <OpenItem page="Lessons" />,
  });
  return createRouter({
    routeTree: root.addChildren([overview, raid, lessons]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

describe("a RAID or lesson link on another page", () => {
  it.each([
    ["RAID-07", "/raid?item=RAID-07", "RAID register with RAID-07 open"],
    ["L-01", "/lessons?item=L-01", "Lessons with L-01 open"],
  ])("opens %s on its own route through the router", async (id, href, opened) => {
    const router = appAt("/");
    await act(() => router.load());
    render(<RouterProvider router={router} />);

    const link = await screen.findByRole("link", { name: id });
    expect(link).toHaveAttribute("href", href);

    fireEvent.click(link);
    expect(await screen.findByText(opened)).toBeInTheDocument();
    expect(router.state.location.href).toBe(href);
  });
});
