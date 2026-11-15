import { RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "@/router";
import type { ActivityEntry, ActivityPage, Workspace } from "./server-types";

const server = vi.hoisted(() => ({ listWorkspace: vi.fn(), listActivity: vi.fn() }));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspace: server.listWorkspace,
  listActivity: server.listActivity,
}));

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
    updates: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
    decisions: { total: 0, byGateType: {}, byStatus: {} },
  },
};

const NO_ACTIVITY: ActivityPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byActor: {}, byEntity: {} },
};

function decisionRequest(id: string, serial: number): ActivityEntry {
  return {
    id: `7f3c2a10-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    actor: "atlas",
    action: "decision.request",
    entity: "decision",
    entity_id: id,
    before: null,
    after: null,
    run_id: null,
    commit_sha: null,
    created_at: "2026-11-15T08:00:00.000000+00:00",
    revertible: false,
  };
}

const FIRST_PAGE: ActivityPage = {
  items: [decisionRequest("D-21", 1)],
  nextCursor: "cursor-1",
  counts: { total: 2, byActor: { atlas: 2 }, byEntity: { decision: 2 } },
};

const SECOND_PAGE: ActivityPage = {
  ...FIRST_PAGE,
  items: [decisionRequest("D-22", 2)],
  nextCursor: null,
};

const START = new Date("2026-11-15T09:00:00.000Z");

/** Sets what `document.visibilityState` reads and tells listeners, as a browser does when the tab hides or shows. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

/** The app's own router and query client, so the tests run on the defaults production uses. */
async function renderActivity() {
  window.history.replaceState(null, "", "/activity");
  const router = getRouter();
  const { queryClient } = router.options.context;
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Activity" });
}

/** Moves the clock and every interval forward, then lets the fetches they start settle. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  // Only intervals and the clock: React Query's notify batching and Testing Library's waits keep real timeouts.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(START);
  server.listWorkspace.mockResolvedValue(WORKSPACE);
  server.listActivity.mockResolvedValue(NO_ACTIVITY);
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
  server.listWorkspace.mockReset();
  server.listActivity.mockReset();
});

describe("a page keeps itself current", () => {
  it("re-checks the activity list and the workspace every 60 seconds while the tab is visible", async () => {
    await renderActivity();
    const activity = server.listActivity.mock.calls.length;
    const workspace = server.listWorkspace.mock.calls.length;

    await elapse(59_000);
    expect(server.listActivity).toHaveBeenCalledTimes(activity);

    await elapse(1_000);
    expect(server.listActivity).toHaveBeenCalledTimes(activity + 1);
    expect(server.listWorkspace).toHaveBeenCalledTimes(workspace + 1);
  });

  it("does not re-check while the tab is hidden, and resumes once it shows again", async () => {
    await renderActivity();
    const calls = server.listActivity.mock.calls.length;

    setVisibility("hidden");
    await elapse(5 * 60_000);
    expect(server.listActivity).toHaveBeenCalledTimes(calls);

    setVisibility("visible");
    await elapse(0);
    expect(server.listActivity).toHaveBeenCalledTimes(calls + 1);
    await elapse(60_000);
    expect(server.listActivity).toHaveBeenCalledTimes(calls + 2);
  });

  it("re-checks every query at once from the header's Refresh button", async () => {
    await renderActivity();
    const activity = server.listActivity.mock.calls.length;
    const workspace = server.listWorkspace.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await elapse(0);

    expect(server.listActivity).toHaveBeenCalledTimes(activity + 1);
    expect(server.listWorkspace).toHaveBeenCalledTimes(workspace + 1);
  });

  it("keeps the pages Show more loaded when it re-checks a list, reading each again from the first", async () => {
    server.listActivity.mockImplementation(({ data }: { data: { cursor?: string } }) =>
      Promise.resolve(data.cursor === undefined ? FIRST_PAGE : SECOND_PAGE),
    );
    await renderActivity();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.queryAllByText(/D-22/)).not.toHaveLength(0));
    server.listActivity.mockClear();

    await elapse(60_000);

    expect(
      server.listActivity.mock.calls.map(
        ([arg]) => (arg as { data: { cursor?: string } }).data.cursor,
      ),
    ).toEqual([undefined, "cursor-1"]);
    expect(screen.queryAllByText(/D-21/)).not.toHaveLength(0);
    expect(screen.queryAllByText(/D-22/)).not.toHaveLength(0);
  });

  it("dates the header by the page's oldest data, so a list still reloading does not read as just updated", async () => {
    await renderActivity();
    let release: (page: ActivityPage) => void = () => {};
    server.listActivity.mockReturnValue(
      new Promise<ActivityPage>((resolve) => (release = resolve)),
    );

    await elapse(60_000);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(server.listWorkspace).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated 1 min ago");

    await act(async () => release(NO_ACTIVITY));
    await waitFor(() => expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated just now"));
  });

  it("says the update failed when a query on the page fails to reload, and recovers from Refresh", async () => {
    await renderActivity();
    server.listActivity.mockRejectedValue(new Error("The server sent no readable answer."));

    await elapse(60_000);
    await waitFor(() => expect(screen.getByText("Update failed")).toBeInTheDocument());
    expect(screen.queryByText(/^Updated/)).toBeNull();

    server.listActivity.mockResolvedValue(NO_ACTIVITY);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated just now"));
    expect(screen.queryByText("Update failed")).toBeNull();
  });

  it("shows when the page's data last arrived, and the new time after a re-check", async () => {
    await renderActivity();
    expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated just now");
    expect(screen.getByText("just now")).toHaveAttribute("datetime", START.toISOString());

    await elapse(60_000);
    await waitFor(() =>
      expect(screen.getByText("just now")).toHaveAttribute(
        "datetime",
        new Date(START.getTime() + 60_000).toISOString(),
      ),
    );

    setVisibility("hidden");
    await elapse(5 * 60_000);
    expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated 5 min ago");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText(/^Updated/)).toHaveTextContent("Updated just now"));
  });
});
