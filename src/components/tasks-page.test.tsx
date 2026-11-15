import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, isInaccessible, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { workspaceWith } from "@/test/ui-fixtures";
import type { Agent, StatusLabel, Task, UpdatesPage } from "./server-types";

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
    open: true,
    stale: null,
    attention: [],
    ...fields,
  };
}

const workspace = (tasks: readonly Task[]) =>
  workspaceWith({ tasks, agents: AGENTS, statusLabels: STATUSES });

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

/** The task names in the main table, top to bottom. */
function taskTitles(): readonly (string | null)[] {
  return screen
    .queryAllByRole("rowheader")
    .map((cell) => within(cell).getByRole("link").textContent);
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

    expect(taskTitles()).toEqual(["Draft the shadow hook config", "Route the LiteLLM hook"]);
  });

  it("shows every task, unassigned ones included, without the filter", async () => {
    await renderTasks("/tasks", ROSTER);

    expect(taskTitles()).toEqual([
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
    expect(taskTitles()).toEqual([]);
  });

  it("counts every agent's tasks on the agent chips and only the chosen agent's on the repository chips", async () => {
    await renderTasks("/tasks?agent=atlas", ROSTER, { agentId: "atlas" });

    expectChips("Agent", ["Atlas 2", "Beacon 2"]);
    expectChips("Repository", ["HX-CentCom 1", "HX-LiteLLM 1"]);
  });

  it("names the chosen agent and its count on the Agent toolbar button, and leaves Repository unset", async () => {
    await renderTasks("/tasks?agent=atlas", ROSTER, { agentId: "atlas" });

    const buttons = screen.getByRole("group", { name: "Filter tasks" }).querySelectorAll("summary");
    expect([...buttons].map((b) => b.textContent)).toEqual(["AgentAtlas2", "Repository"]);
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

describe("the tasks main table", () => {
  const TABLE: readonly Task[] = [
    task({
      id: "IRP-61",
      title: "Draft the shadow hook config",
      group: "backlog",
      status: "Waiting",
      start_date: "2026-11-02",
      due_date: "2026-11-13",
    }),
    task({
      id: "IRP-62",
      title: "Wire the eval dashboard",
      status: "In progress",
      progress: { proven: 2, total: 3, percent: 67 },
    }),
    task({ id: "IRP-63", title: "Pin the router build", group: "backlog", status: "Waiting" }),
    task({
      id: "IRP-64",
      title: "Write the release notes",
      group: "done",
      status: "Complete",
      open: false,
    }),
  ];

  function group(name: RegExp): HTMLElement {
    return screen.getByRole("region", { name });
  }

  /** The row's cells after the task name, in column order: Agent, Status, Repository, Timeline, Requirements, Due. */
  function cellsOf(title: string): readonly HTMLElement[] {
    const row = screen.getByRole("link", { name: title }).closest("tr");
    if (row === null) throw new Error(`No table row for ${title}`);
    return within(row).getAllByRole("cell");
  }

  it("is the default view, with the Main table tab current", async () => {
    await renderTasks("/tasks", TABLE);

    const tabs = within(screen.getByRole("navigation", { name: "Task view" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main table", "Kanban", "Timeline"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
  });

  it("groups the rows in workflow order and leaves out a group with no tasks", async () => {
    await renderTasks("/tasks", TABLE);

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Backlog2 tasks",
      "In progress1 task",
      "Done1 task",
    ]);
    expect(
      within(group(/^Backlog/))
        .getAllByRole("rowheader")
        .map((h) => within(h).getByRole("link").textContent),
    ).toEqual(["Draft the shadow hook config", "Pin the router build"]);
  });

  it("fills each status cell with its label in the status color", async () => {
    await renderTasks("/tasks", TABLE);

    const [, waiting] = cellsOf("Draft the shadow hook config");
    const [, working] = cellsOf("Wire the eval dashboard");
    const [, complete] = cellsOf("Write the release notes");
    expect(waiting).toHaveTextContent("Waiting");
    expect(waiting).toHaveAttribute("data-hue", "grey");
    expect(working).toHaveTextContent("In progress");
    expect(working).toHaveAttribute("data-hue", "orange");
    expect(complete).toHaveTextContent("Complete");
    expect(complete).toHaveAttribute("data-hue", "green");
  });

  it("shows the agent, the planned dates, and the proven requirements in their columns", async () => {
    await renderTasks("/tasks", TABLE);

    const [agent, , repo, timeline] = cellsOf("Draft the shadow hook config");
    expect(agent).toHaveTextContent("Atlas");
    expect(repo).toHaveTextContent("HX-CentCom");
    expect(timeline).toHaveTextContent("2 Nov – 13 Nov");
    const [, , , , requirements] = cellsOf("Wire the eval dashboard");
    expect(requirements).toHaveTextContent("2/3 proven");
  });

  it("ends each group with a battery of its status split", async () => {
    await renderTasks("/tasks", TABLE);

    expect(within(group(/^Backlog/)).getByRole("img")).toHaveAccessibleName("Waiting 2");
    expect(within(group(/^Done/)).getByRole("img")).toHaveAccessibleName("Complete 1");
  });

  it("collapses a group from its caret and opens it again", async () => {
    await renderTasks("/tasks", TABLE);

    const caret = within(group(/^Backlog/)).getByRole("button", { name: "Backlog" });
    expect(caret).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "false");
    expect(isInaccessible(within(group(/^Backlog/)).getByRole("table", { hidden: true }))).toBe(
      true,
    );
    fireEvent.click(caret);
    expect(within(group(/^Backlog/)).getByRole("table")).toBeVisible();
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
    task({
      id: "IRP-53",
      title: "Pin the router build",
      group: "done",
      status: "Complete",
      open: false,
    }),
    task({ id: "IRP-54", title: "Write the release notes", group: "backlog", status: "Waiting" }),
  ];

  function column(name: string): readonly (string | null)[] {
    return within(screen.getByRole("region", { name }))
      .queryAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
  }

  it("shows four columns in workflow order, each counting its cards", async () => {
    await renderTasks("/tasks?view=kanban", BOARD);

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Backlog 2",
      "In progress 1",
      "Ready for owner 0",
      "Done 1",
    ]);
  });

  it("puts each card in the column of its group", async () => {
    await renderTasks("/tasks?view=kanban", BOARD);

    expect(column("Backlog 2")).toEqual([
      "Draft the shadow hook config",
      "Write the release notes",
    ]);
    expect(column("In progress 1")).toEqual(["Wire the eval dashboard"]);
    expect(column("Done 1")).toEqual(["Pin the router build"]);
  });

  it("says an empty column has no tasks", async () => {
    await renderTasks("/tasks?view=kanban", BOARD);

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

  /** The bar of the row whose title is `title`, or null when the row draws no bar. */
  function barElementOf(title: string): HTMLElement | null {
    const row = screen.getByRole("link", { name: title }).closest("li");
    if (row === null) throw new Error(`No timeline row for ${title}`);
    return within(row).queryByText(/ proven$|^No requirements$/)?.parentElement ?? null;
  }

  /** The bar's grid placement, or null when the row draws no bar. */
  function barOf(title: string): string | null {
    return barElementOf(title)?.style.gridColumn ?? null;
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

  describe("over a plan longer than a year", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Today is Sunday 15 Nov 2026; only `Date` is faked, so the router and the query client keep real timers. */
    function onTheFifteenth() {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    }

    function continues(title: string, side: "before" | "after"): boolean {
      const row = screen.getByRole("link", { name: title }).closest("li");
      if (row === null) throw new Error(`No timeline row for ${title}`);
      return within(row).queryByText(`Continues ${side} this window`) !== null;
    }

    /** The sides on which the window cuts the bar of the row whose title is `title`. */
    function cutSides(title: string): readonly ("before" | "after")[] {
      const bar = barElementOf(title);
      if (bar === null) throw new Error(`No bar for ${title}`);
      return (["before", "after"] as const).filter((side) => bar.hasAttribute(`data-cut-${side}`));
    }

    it("a bar marks each side the window cuts", async () => {
      onTheFifteenth();
      await renderTasks("/tasks?view=timeline", [
        task({
          id: "IRP-70",
          title: "Run the three-year migration",
          start_date: "2026-01-05",
          due_date: "2028-12-29",
        }),
        task({
          id: "IRP-71",
          title: "Wire the eval dashboard",
          start_date: "2026-11-16",
          due_date: "2026-11-20",
        }),
        task({
          id: "IRP-75",
          title: "Rotate the agent keys",
          start_date: "2026-09-01",
          due_date: "2026-12-31",
        }),
      ]);

      // The window opens on Monday 12 Oct 2026, so the key rotation is cut only at its start.
      expect(cutSides("Run the three-year migration")).toEqual(["before", "after"]);
      expect(cutSides("Rotate the agent keys")).toEqual(["before"]);
      expect(cutSides("Wire the eval dashboard")).toEqual([]);
      expect(continues("Rotate the agent keys", "before")).toBe(true);
      expect(continues("Rotate the agent keys", "after")).toBe(false);
    });

    it("draws at most a year of days from the week 30 days before today and clips longer bars", async () => {
      onTheFifteenth();
      await renderTasks("/tasks?view=timeline", [
        task({
          id: "IRP-70",
          title: "Run the three-year migration",
          start_date: "2026-01-05",
          due_date: "2028-12-29",
        }),
        task({
          id: "IRP-71",
          title: "Wire the eval dashboard",
          start_date: "2026-11-16",
          due_date: "2026-11-20",
        }),
        task({
          id: "IRP-72",
          title: "Pin the router build",
          start_date: "2026-02-02",
          due_date: "2026-02-06",
        }),
      ]);

      // 30 days before Sunday 15 Nov is Friday 16 Oct, whose week opens on Monday 12 Oct; 52 weeks end on Sunday 10 Oct.
      const days = daysUnder("12 Oct 2026 to 10 Oct 2027");
      expect(days.length).toBeLessThanOrEqual(366);
      expect(days).toHaveLength(364);
      expect(datesOf("Run the three-year migration")).toBe("5 Jan 2026 to 29 Dec 2028");
      expect(barOf("Run the three-year migration")).toBe("1 / 365");
      expect(continues("Run the three-year migration", "before")).toBe(true);
      expect(continues("Run the three-year migration", "after")).toBe(true);
      expect(barOf("Wire the eval dashboard")).toBe("36 / 41");
      expect(continues("Wire the eval dashboard", "before")).toBe(false);
      expect(datesOf("Pin the router build")).toBe("2 Feb 2026 to 6 Feb 2026");
      expect(barOf("Pin the router build")).toBeNull();
    });

    it("ends the window at the latest date when every task ended before today", async () => {
      onTheFifteenth();
      await renderTasks("/tasks?view=timeline", [
        task({
          id: "IRP-73",
          title: "Run the two-year migration",
          start_date: "2024-01-01",
          due_date: "2025-12-31",
        }),
      ]);

      // Wednesday 31 Dec 2025 closes on Sunday 4 Jan 2026, and 52 weeks back opens on Monday 6 Jan 2025.
      expect(daysUnder("6 Jan 2025 to 4 Jan 2026")).toHaveLength(364);
      expect(barOf("Run the two-year migration")).toBe("1 / 361");
      expect(continues("Run the two-year migration", "before")).toBe(true);
      expect(continues("Run the two-year migration", "after")).toBe(false);
    });

    it("keeps a stored task from year 0001 to year 9999 to one year of days", async () => {
      onTheFifteenth();
      await renderTasks("/tasks?view=timeline", [
        task({
          id: "IRP-74",
          title: "Plan forever",
          start_date: "0001-01-01",
          due_date: "9999-12-31",
        }),
      ]);

      expect(daysUnder("12 Oct 2026 to 10 Oct 2027")).toHaveLength(364);
      expect(datesOf("Plan forever")).toBe("1 Jan 1 to 31 Dec 9999");
      expect(barOf("Plan forever")).toBe("1 / 365");
    });
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
