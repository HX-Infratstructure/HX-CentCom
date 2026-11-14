import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, isInaccessible, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { Agent, StatusLabel, Task, UpdatesPage, Workspace } from "./server-types";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
  { id: "beacon", display_name: "Beacon", role: "agent", color: "sky", active: true },
  { id: "cinder", display_name: "Cinder", role: "agent", color: "violet", active: true },
];

const STATUSES: readonly StatusLabel[] = [
  { id: "Waiting", label: "Waiting", is_done: false, color: null },
  { id: "In progress", label: "In progress", is_done: false, color: null },
  { id: "Complete", label: "Complete", is_done: true, color: null },
];

const NO_UPDATES: UpdatesPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
};

function task(fields: Pick<Task, "id" | "title"> & Partial<Task>): Task {
  return {
    agent: "atlas",
    repository: "HX-CentCom",
    host: "HX-15",
    commit_sha: null,
    status: "In progress",
    group: "in_progress",
    blocked_on: "none",
    start_date: null,
    due_date: null,
    note: null,
    source_url: "https://github.com/HX-Infratstructure/HX-CentCom/issues/12",
    version: 1,
    updated_at: "2026-11-14T08:10:00.123456+00:00",
    progress: { proven: 0, total: 0, percent: null },
    stale: null,
    ...fields,
  };
}

function workspace(tasks: readonly Task[]): Workspace {
  return {
    tasks,
    updates: [],
    updatesCursor: null,
    requirements: [],
    decisions: [],
    agents: AGENTS,
    statusLabels: STATUSES,
    repos: [],
    counts: {
      updates: NO_UPDATES.counts,
      decisions: { total: 0, byGateType: {}, byStatus: {} },
    },
  };
}

/**
 * `updateDeps` is the route's `loaderDeps` for `url`: only the agent filter reaches the update log's query key.
 * The route's own loader and `select: adaptWorkspace` run against the stored snapshot.
 */
async function renderTasks(url: string, tasks: readonly Task[], updateDeps: object = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["task-workspace"], workspace(tasks));
  queryClient.setQueryData(["updates", updateDeps], {
    pages: [NO_UPDATES],
    pageParams: [undefined],
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Tasks" });
}

function cardTitles(): readonly (string | null)[] {
  return screen.queryAllByRole("heading", { level: 4 }).map((h) => h.textContent);
}

/** A chip reads as its label and its count, for example "Atlas 2". */
function expectChips(facet: string, names: readonly string[]): void {
  const found = within(screen.getByRole("group", { name: facet })).getAllByRole("link");
  expect(found).toHaveLength(names.length);
  names.forEach((name, i) => expect(found[i]).toHaveAccessibleName(name));
}

const ROSTER: readonly Task[] = [
  task({ id: "IRP-41", title: "Draft the shadow hook config", agent: "atlas" }),
  task({ id: "IRP-42", title: "Wire the eval dashboard", agent: "beacon" }),
  task({
    id: "IRP-43",
    title: "Route the LiteLLM hook",
    agent: "atlas",
    repository: "HX-LiteLLM",
  }),
  task({ id: "IRP-44", title: "Pin the router build", agent: "beacon" }),
  task({
    id: "IRP-45",
    title: "Write the release notes",
    agent: null,
    repository: "HX-LiteLLM",
  }),
];

describe("the task board's agent filter", () => {
  it("shows only the chosen agent's tasks", async () => {
    await renderTasks("/tasks?agent=atlas", ROSTER, { agentId: "atlas" });

    expect(cardTitles()).toEqual(["Draft the shadow hook config", "Route the LiteLLM hook"]);
  });

  it("shows every task, unassigned ones included, without the filter", async () => {
    await renderTasks("/tasks", ROSTER);

    expect(cardTitles()).toEqual([
      "Draft the shadow hook config",
      "Wire the eval dashboard",
      "Route the LiteLLM hook",
      "Pin the router build",
      "Write the release notes",
    ]);
  });

  it("says no task matches when the chosen agent has none", async () => {
    await renderTasks("/tasks?agent=cinder", ROSTER, { agentId: "cinder" });

    expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain(
      "No tasks match these filters.",
    );
    expect(cardTitles()).toEqual([]);
  });

  it("counts every agent's tasks on the agent chips and only the chosen agent's on the repository chips", async () => {
    await renderTasks("/tasks?agent=atlas", ROSTER, { agentId: "atlas" });

    expectChips("Agent", ["Atlas 2", "Beacon 2"]);
    expectChips("Repository", ["HX-CentCom 1", "HX-LiteLLM 1"]);
  });

  it("counts every task on the repository chips without the agent filter", async () => {
    await renderTasks("/tasks", ROSTER);

    expectChips("Agent", ["Atlas 2", "Beacon 2"]);
    expectChips("Repository", ["HX-CentCom 3", "HX-LiteLLM 2"]);
  });

  it("counts a repository named after an object property, such as constructor, as an ordinary value", async () => {
    await renderTasks("/tasks", [
      task({ id: "IRP-46", title: "Draft the shadow hook config", repository: "constructor" }),
      task({ id: "IRP-47", title: "Wire the eval dashboard", repository: "toString" }),
      task({ id: "IRP-48", title: "Pin the router build" }),
    ]);

    expectChips("Repository", ["constructor 1", "HX-CentCom 1", "toString 1"]);
  });
});

describe("the task board's columns", () => {
  const BOARD: readonly Task[] = [
    task({
      id: "IRP-51",
      title: "Draft the shadow hook config",
      group: "backlog",
      status: "Waiting",
    }),
    // A done status label does not move a card: the server's group decides its column.
    task({ id: "IRP-52", title: "Wire the eval dashboard", status: "Complete" }),
    task({ id: "IRP-53", title: "Pin the router build", group: "done", status: "Complete" }),
    task({ id: "IRP-54", title: "Write the release notes", group: "backlog", status: "Waiting" }),
  ];

  function column(name: string): readonly (string | null)[] {
    return within(screen.getByRole("region", { name }))
      .queryAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
  }

  it("shows four columns in workflow order, each counting its cards", async () => {
    await renderTasks("/tasks", BOARD);

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Backlog 2",
      "In progress 1",
      "Ready for owner 0",
      "Done 1",
    ]);
  });

  it("puts each card in the column of its group", async () => {
    await renderTasks("/tasks", BOARD);

    expect(column("Backlog 2")).toEqual([
      "Draft the shadow hook config",
      "Write the release notes",
    ]);
    expect(column("In progress 1")).toEqual(["Wire the eval dashboard"]);
    expect(column("Done 1")).toEqual(["Pin the router build"]);
  });

  it("says an empty column has no tasks", async () => {
    await renderTasks("/tasks", BOARD);

    expect(column("Ready for owner 0")).toEqual([]);
    expect(screen.getByRole("region", { name: "Ready for owner 0" })).toHaveTextContent("No tasks");
  });
});

describe("the task timeline", () => {
  /** The day numbers printed under the header whose range reads `range`. */
  function daysUnder(range: string): readonly (string | null)[] {
    const header = screen.getByText(range).parentElement;
    if (header === null) throw new Error(`No header around ${range}`);
    return within(header)
      .getAllByText(/^\d+$/)
      .map((day) => day.textContent);
  }

  /** The bar's grid placement, or null when the row draws no bar. */
  function barOf(title: string): string | null {
    const row = screen.getByRole("link", { name: title }).closest("li");
    if (row === null) throw new Error(`No timeline row for ${title}`);
    const label = within(row).queryByText(/ proven$|^No requirements$/);
    return label?.parentElement?.style.gridColumn ?? null;
  }

  /** The planned-dates line of the row whose title is `title`. */
  function datesOf(title: string): string | null {
    const row = screen.getByRole("link", { name: title }).closest("li");
    if (row === null) throw new Error(`No timeline row for ${title}`);
    return within(row).getByText(/planned dates|^Due |^Starts | to /).textContent;
  }

  it("spans whole weeks from the Monday before the earliest date to the Sunday after the latest", async () => {
    await renderTasks("/tasks?view=timeline", [
      task({
        id: "IRP-61",
        title: "Wire the eval dashboard",
        start_date: "2026-11-04",
        due_date: "2026-11-06",
        progress: { proven: 1, total: 2, percent: 50 },
      }),
      task({
        id: "IRP-62",
        title: "Run the shadow benchmark",
        start_date: "2026-11-09",
        due_date: "2026-11-17",
      }),
    ]);

    // Wednesday 4 Nov opens on Monday 2 Nov; Tuesday 17 Nov closes on Sunday 22 Nov.
    const days = daysUnder("2 Nov 2026 to 22 Nov 2026");
    expect(days).toHaveLength(21);
    expect([days[0], days.at(-1)]).toEqual(["2", "22"]);
    expect(barOf("Wire the eval dashboard")).toBe("3 / 6");
    expect(barOf("Run the shadow benchmark")).toBe("8 / 17");
  });

  it("widens the window for a task with one planned date but draws it no bar", async () => {
    await renderTasks("/tasks?view=timeline", [
      task({
        id: "IRP-62",
        title: "Run the shadow benchmark",
        start_date: "2026-11-09",
        due_date: "2026-11-17",
      }),
      task({ id: "IRP-63", title: "Write the release notes", due_date: "2026-11-24" }),
      task({ id: "IRP-68", title: "Pin the router build", start_date: "2026-11-12" }),
      task({ id: "IRP-69", title: "Draft the shadow hook config" }),
    ]);

    // Monday 9 Nov opens the window; the due-only Tuesday 24 Nov closes it on Sunday 29 Nov.
    const days = daysUnder("9 Nov 2026 to 29 Nov 2026");
    expect(days).toHaveLength(21);
    expect([days[0], days.at(-1)]).toEqual(["9", "29"]);
    expect(datesOf("Write the release notes")).toBe("Due 24 Nov 2026");
    expect(datesOf("Pin the router build")).toBe("Starts 12 Nov 2026");
    expect(datesOf("Draft the shadow hook config")).toBe("No planned dates");
    expect(barOf("Write the release notes")).toBeNull();
    expect(barOf("Pin the router build")).toBeNull();
    expect(barOf("Run the shadow benchmark")).toBe("1 / 10");
  });

  it("keeps a plan that already starts on a Monday and ends on a Sunday to those weeks", async () => {
    await renderTasks("/tasks?view=timeline", [
      task({
        id: "IRP-64",
        title: "Run the shadow benchmark",
        start_date: "2026-11-09",
        due_date: "2026-11-11",
      }),
      task({
        id: "IRP-67",
        title: "Write the release notes",
        start_date: "2026-11-19",
        due_date: "2026-11-22",
      }),
    ]);

    const days = daysUnder("9 Nov 2026 to 22 Nov 2026");
    expect(days).toHaveLength(14);
    expect(barOf("Run the shadow benchmark")).toBe("1 / 4");
    expect(barOf("Write the release notes")).toBe("11 / 15");
  });

  it("exposes each bar's progress to assistive technology", async () => {
    await renderTasks("/tasks?view=timeline", [
      task({
        id: "IRP-61",
        title: "Wire the eval dashboard",
        start_date: "2026-11-04",
        due_date: "2026-11-06",
        progress: { proven: 1, total: 2, percent: 50 },
      }),
    ]);

    const row = screen.getByRole("link", { name: "Wire the eval dashboard" }).closest("li");
    if (row === null) throw new Error("No timeline row for Wire the eval dashboard");
    expect(isInaccessible(within(row).getByText("1 of 2 proven"))).toBe(false);
  });

  it("says no task has planned dates when none has any", async () => {
    await renderTasks("/tasks?view=timeline", [
      task({ id: "IRP-65", title: "Draft the shadow hook config" }),
      task({ id: "IRP-66", title: "Pin the router build", agent: null }),
    ]);

    expect(screen.getByText(/planned dates/).textContent).toBe(
      "None of these tasks has planned dates.",
    );
  });
});
