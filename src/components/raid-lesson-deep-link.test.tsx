import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { Agent, Lesson, LessonsPage, RaidItem, RaidPage, Workspace } from "./server-types";

const server = vi.hoisted(() => ({ getRaidItem: vi.fn(), getLesson: vi.fn() }));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  getRaidItem: server.getRaidItem,
  getLesson: server.getLesson,
}));

const REPO = "HX-Infratstructure/HX-CentCom";
const AT = "2026-11-14T08:10:00.123456+00:00";

// A name the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

const WORKSPACE: Workspace = {
  tasks: [],
  updates: [],
  updatesCursor: null,
  requirements: [],
  decisions: [],
  agents: AGENTS,
  statusLabels: [],
  repos: [],
  counts: {
    updates: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
    decisions: { total: 0, byGateType: {}, byStatus: {} },
  },
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function raidItem(n: number): RaidItem {
  return {
    id: `RAID-${pad(n)}`,
    type: "risk",
    title: `Run ${n} could miss the HX-4 window`,
    summary: "The benchmark needs HX-4 for a full day.",
    description: "HX-4 is shared with the shadow hook tests.",
    owner_agent: "atlas",
    status: "open",
    severity: "medium",
    severity_rated_by: null,
    review_at: null,
    source_url: `https://github.com/${REPO}/issues/10`,
    created_by: "atlas",
    task_ids: [],
    decision_id: null,
    probability: null,
    impact: null,
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
    version: 1,
    created_at: AT,
    updated_at: AT,
  };
}

function lesson(n: number): Lesson {
  return {
    id: `L-${pad(n)}`,
    title: `Pin the build before benchmark run ${n}`,
    summary: "An unpinned build changed between two runs.",
    situation: null,
    action: null,
    outcome: null,
    recommendation: null,
    source_url: `https://github.com/${REPO}/issues/10`,
    tags: ["benchmark"],
    applies_to: null,
    created_by: "atlas",
    status: "proposed",
    enforced_by_url: null,
    version: 1,
    created_at: AT,
    updated_at: AT,
  };
}

const FIRST_TWENTY = Array.from({ length: 20 }, (_, i) => i + 1);

/** The first page of 20 with a cursor: record 42 sits on a page the browser never loaded. */
const RAID_PAGE: RaidPage = {
  items: FIRST_TWENTY.map(raidItem),
  nextCursor: "RAID-20",
  counts: { total: 45, byType: {}, bySeverity: {}, byStatus: {}, byOwner: {}, byTask: {} },
};
const LESSONS_PAGE: LessonsPage = {
  items: FIRST_TWENTY.map(lesson),
  nextCursor: "L-20",
  counts: { total: 45, byStatus: {}, byTag: {} },
};

async function renderPage(url: string, page: string, list: readonly [QueryKey, unknown]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["task-workspace"], WORKSPACE);
  queryClient.setQueryData(list[0], { pages: [list[1]], pageParams: [undefined] });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  // As in decision-sheet.test.tsx: the root route renders the whole document, and the open sheet is modal.
  render(<RouterProvider router={router} />, { container: document as unknown as HTMLElement });
  await screen.findByRole("heading", { level: 1, name: page, hidden: true });
}

afterEach(() => {
  server.getRaidItem.mockReset();
  server.getLesson.mockReset();
});

describe("a deep link to a record past the loaded page", () => {
  it("opens the RAID item by asking the register for it", async () => {
    server.getRaidItem.mockResolvedValue(raidItem(42));
    await renderPage("/raid?item=RAID-42", "RAID register", [["raid", "list", {}], RAID_PAGE]);

    expect(
      await screen.findByRole("dialog", { name: "Run 42 could miss the HX-4 window" }),
    ).toBeInTheDocument();
    expect(server.getRaidItem).toHaveBeenCalledWith({ data: { id: "RAID-42" } });
  });

  it("says a RAID item the register does not hold is missing", async () => {
    server.getRaidItem.mockResolvedValue(null);
    await renderPage("/raid?item=RAID-99", "RAID register", [["raid", "list", {}], RAID_PAGE]);

    expect(await screen.findByText(/^RAID-99 is not in the /)).toBeInTheDocument();
    expect(server.getRaidItem).toHaveBeenCalledWith({ data: { id: "RAID-99" } });
  });

  it("opens the lesson by asking the log for it", async () => {
    server.getLesson.mockResolvedValue(lesson(42));
    await renderPage("/lessons?item=L-42", "Lessons", [["lessons", "list", {}], LESSONS_PAGE]);

    expect(
      await screen.findByRole("dialog", { name: "Pin the build before benchmark run 42" }),
    ).toBeInTheDocument();
    expect(server.getLesson).toHaveBeenCalledWith({ data: { id: "L-42" } });
  });

  it("says a lesson the log does not hold is missing", async () => {
    server.getLesson.mockResolvedValue(null);
    await renderPage("/lessons?item=L-99", "Lessons", [["lessons", "list", {}], LESSONS_PAGE]);

    expect(await screen.findByText(/^L-99 is not in the /)).toBeInTheDocument();
    expect(server.getLesson).toHaveBeenCalledWith({ data: { id: "L-99" } });
  });
});
