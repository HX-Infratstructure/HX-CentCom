import { fireEvent, isInaccessible, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { shellWith, tasksPageWith } from "@/test/ui-fixtures";
import type {
  Agent,
  Requirement,
  StatusLabel,
  Task,
  TaskCounts,
  TasksPage,
  UpdatesPage,
} from "./server-types";

const server = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listTasks: server.listTasks,
  getTask: server.getTask,
}));

beforeEach(() => {
  server.listTasks.mockReset();
  server.getTask.mockReset();
});

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

/** The board's filters as the route sends them: the URL's agent and repository, never `open`. */
type BoardQuery = { readonly agentId?: string; readonly repo?: string };

/**
 * Seeds the bounded reads for `url`: the shell, the first page of the task read for `query`, and the update log, whose
 * query key carries only the agent filter. `page` is what the server returns for the URL's filters.
 */
async function renderTasks(
  url: string,
  page: TasksPage | readonly Task[],
  query: BoardQuery = {},
): Promise<void> {
  const first = Array.isArray(page) ? tasksPageWith(page) : (page as TasksPage);
  // The page renders the whole document, so every test mounts it on `document` as the app does: mixing that with the
  // <div> mount in one file loops React's event dispatch (render-app.tsx). An open sheet is modal: the h1 behind it is
  // hidden.
  const sheet = new URL(url, "http://localhost").searchParams.has("item");
  await renderApp(url, {
    heading: "Tasks",
    onDocument: true,
    hidden: sheet,
    seed: [
      [["workspace-shell"], shellWith({ agents: AGENTS, statusLabels: STATUSES })],
      [["tasks", "list", query], { pages: [first], pageParams: [undefined] }],
      [["updates", { agentId: query.agentId }], { pages: [NO_UPDATES], pageParams: [undefined] }],
    ],
  });
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

const ATLAS = ROSTER.filter((t) => t.agent === "atlas");

/** The server's facet counts: each facet ignores its own filter, so the agent chips count every agent's tasks. */
const ATLAS_COUNTS: TaskCounts = {
  total: 2,
  byAgent: { atlas: 2, beacon: 2 },
  byRepo: { "HX-CentCom": 1, "HX-LiteLLM": 1 },
  byAttention: { blocked: 0, owner: 0, stale: 0 },
};

describe("the task board's agent filter", () => {
  it("shows the server's rows for the chosen agent", async () => {
    await renderTasks(
      "/tasks?agent=atlas",
      { items: ATLAS, nextCursor: null, counts: ATLAS_COUNTS },
      { agentId: "atlas" },
    );

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
    await renderTasks("/tasks?agent=cinder", tasksPageWith([]), { agentId: "cinder" });

    expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain(
      "No tasks match these filters.",
    );
    expect(taskTitles()).toEqual([]);
  });

  it("shows the server's counts on the chips, not a count of the loaded rows", async () => {
    await renderTasks(
      "/tasks?agent=atlas",
      {
        items: ATLAS,
        nextCursor: "after-IRP-43",
        counts: {
          ...ATLAS_COUNTS,
          total: 31,
          byAgent: { atlas: 31, beacon: 9 },
          byRepo: { "HX-CentCom": 24, "HX-LiteLLM": 7 },
        },
      },
      { agentId: "atlas" },
    );

    expectChips("Agent", ["Atlas 31", "Beacon 9"]);
    expectChips("Repository", ["HX-CentCom 24", "HX-LiteLLM 7"]);
  });

  it("names the chosen agent and its count on the Agent toolbar button, and leaves Repository unset", async () => {
    await renderTasks(
      "/tasks?agent=atlas",
      { items: ATLAS, nextCursor: null, counts: ATLAS_COUNTS },
      { agentId: "atlas" },
    );

    const buttons = screen.getByRole("group", { name: "Filter tasks" }).querySelectorAll("summary");
    expect([...buttons].map((b) => b.textContent)).toEqual(["AgentAtlas2", "Repository"]);
  });

  it("sends both board filters to the task read", async () => {
    const both = ATLAS.filter((t) => t.repository === "HX-LiteLLM");
    await renderTasks(
      "/tasks?agent=atlas&repo=HX-LiteLLM",
      { items: both, nextCursor: null, counts: { ...ATLAS_COUNTS, total: 1 } },
      { agentId: "atlas", repo: "HX-LiteLLM" },
    );

    expect(taskTitles()).toEqual(["Route the LiteLLM hook"]);
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

describe("the board's Show more", () => {
  const ALL: readonly Task[] = Array.from({ length: 25 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return task({ id: `IRP-1${n}`, title: `Task number ${n}` });
  });
  const FIRST = tasksPageWith(ALL.slice(0, 20), { all: ALL, nextCursor: "after-IRP-120" });
  const REST = tasksPageWith(ALL.slice(20), { all: ALL });

  it("shows the first 20 of 25 tasks, then the next page from the first page's cursor", async () => {
    server.listTasks.mockResolvedValue(REST);
    await renderTasks("/tasks", FIRST);

    expect(taskTitles()).toHaveLength(20);
    expect(screen.getByText("Showing 20 of 25 tasks.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Showing all 25 tasks.")).toBeInTheDocument();
    expect(server.listTasks).toHaveBeenCalledWith({
      data: { agentId: undefined, repo: undefined, cursor: "after-IRP-120" },
    });
    expect(taskTitles()).toEqual(ALL.map((t) => t.title));
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("serves the kanban from the same loaded page", async () => {
    await renderTasks("/tasks?view=kanban", FIRST);

    const cards = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(cards).toEqual(ALL.slice(0, 20).map((t) => t.title));
    expect(screen.getByText("Showing 20 of 25 tasks.")).toBeInTheDocument();
  });
});

describe("the timeline's order", () => {
  // The server's order: blocked first, then start date.
  const SERVER_ORDER: readonly Task[] = [
    task({
      id: "IRP-84",
      title: "Unblock the router",
      start_date: "2026-11-12",
      attention: ["blocked"],
    }),
    task({ id: "IRP-83", title: "Write the release notes" }),
    task({ id: "IRP-82", title: "Pin the router build", start_date: "2026-11-02" }),
    task({ id: "IRP-81", title: "Wire the eval dashboard", start_date: "2026-11-02" }),
  ];

  it("shows the loaded tasks by start date, missing dates last, then id", async () => {
    await renderTasks("/tasks?view=timeline", SERVER_ORDER);

    const titles = new Set(SERVER_ORDER.map((t) => t.title));
    const rows = screen
      .getAllByRole("link")
      .map((link) => link.textContent)
      .filter((text) => text !== null && titles.has(text));
    expect(rows).toEqual([
      "Wire the eval dashboard",
      "Pin the router build",
      "Unblock the router",
      "Write the release notes",
    ]);
  });

  it("shows the same tasks on the kanban", async () => {
    await renderTasks("/tasks?view=kanban", SERVER_ORDER);

    const cards = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect([...cards].sort()).toEqual(SERVER_ORDER.map((t) => t.title).sort());
  });
});

describe("the task sheet", () => {
  const ON_PAGE = task({ id: "IRP-91", title: "Wire the eval dashboard" });
  const BEYOND = task({ id: "IRP-99", title: "Rotate the agent keys" });
  const REQUIREMENT: Requirement = {
    id: "a8975406-7a84-4788-a7de-0a26b5a31197",
    task_id: "IRP-99",
    requirement: "Every agent key rotates within a day",
    source_url: null,
    proof_url: null,
    state: "NOT_RUN",
    version: 1,
    updated_by: "atlas",
    created_at: "2026-11-14T16:24:57.151Z",
  };

  it("opens a task that is not on the loaded page by its id, with its requirements", async () => {
    server.getTask.mockResolvedValue({ task: BEYOND, requirements: [REQUIREMENT], decisions: [] });
    await renderTasks("/tasks?item=IRP-99", [ON_PAGE]);

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Every agent key rotates within a day"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Rotate the agent keys")).toBeInTheDocument();
    expect(server.getTask).toHaveBeenCalledWith({ data: { id: "IRP-99" } });
  });

  it("reads a task on the loaded page by its id too, because list rows carry no requirements", async () => {
    server.getTask.mockResolvedValue({
      task: ON_PAGE,
      requirements: [{ ...REQUIREMENT, task_id: "IRP-91" }],
      decisions: [],
    });
    await renderTasks("/tasks?item=IRP-91", [ON_PAGE]);

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Every agent key rotates within a day"),
    ).toBeInTheDocument();
  });

  it("says the task is missing when the by-id read finds none", async () => {
    server.getTask.mockResolvedValue(null);
    await renderTasks("/tasks?item=IRP-98", [ON_PAGE]);

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/IRP-98 is not in the/)).toBeInTheDocument();
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
