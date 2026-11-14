import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { GithubPrsPage, UpdatesPage, Workspace } from "./server-types";

const server = vi.hoisted(() => ({
  listWorkspace: vi.fn(),
  listUpdates: vi.fn(),
  listGithubPrs: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspace: server.listWorkspace,
  listUpdates: server.listUpdates,
  listGithubPrs: server.listGithubPrs,
}));

const NO_UPDATES: UpdatesPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
};

const NO_PRS: GithubPrsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byRepo: {}, byState: {} },
};

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const WORKSPACE: Workspace = {
  tasks: [],
  updates: [],
  updatesCursor: null,
  requirements: [],
  decisions: [],
  agents: [{ id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true }],
  statusLabels: [],
  repos: [],
  counts: {
    updates: NO_UPDATES.counts,
    decisions: { total: 0, byGateType: {}, byStatus: {} },
  },
};

async function renderPage(url: string, h1: string) {
  server.listWorkspace.mockResolvedValue(WORKSPACE);
  server.listUpdates.mockResolvedValue(NO_UPDATES);
  server.listGithubPrs.mockResolvedValue(NO_PRS);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: h1 });
}

function currentRailItems(): readonly (string | null)[] {
  return within(screen.getByRole("navigation", { name: "Pages" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("aria-label"));
}

afterEach(() => {
  server.listWorkspace.mockReset();
  server.listUpdates.mockReset();
  server.listGithubPrs.mockReset();
});

describe("the rail's current page", () => {
  it.each(["/", "/?attention=stale", "/?agent=atlas"])(
    "marks Overview at %s, whatever filter the overview's URL holds",
    async (url) => {
      await renderPage(url, "Overview");

      expect(currentRailItems()).toEqual(["Overview"]);
    },
  );

  it("marks Tasks and not Overview on /tasks", async () => {
    await renderPage("/tasks", "Tasks");

    expect(currentRailItems()).toEqual(["Tasks"]);
  });
});
