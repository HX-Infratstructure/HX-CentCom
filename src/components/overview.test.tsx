import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { shellWith, tasksPageWith, workspaceWith } from "@/test/ui-fixtures";
import type {
  Agent,
  Decision,
  DecisionsPage,
  GithubPrsPage,
  PullRequest,
  StatusLabel,
  Task,
  TasksPage,
  TaskUpdate,
  UpdatesPage,
  Workspace,
  WorkspaceShell,
} from "./server-types";

const server = vi.hoisted(() => ({
  listUpdates: vi.fn(),
  listTasks: vi.fn(),
  listWorkspace: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listUpdates: server.listUpdates,
  listTasks: server.listTasks,
  listWorkspace: server.listWorkspace,
}));

type TaskRequest = {
  readonly open?: boolean;
  readonly attention?: Task["attention"][number];
  readonly limit?: number;
  readonly cursor?: string;
};

/** The task read under the server's rules: open and attention filter, blocked tasks first, pages of 20 by default. */
function serveTasks(tasks: readonly Task[]) {
  server.listTasks.mockImplementation(({ data }: { data: TaskRequest }) => {
    const all = tasks.filter(
      (t) =>
        (data.open !== true || t.open) &&
        (data.attention === undefined || t.attention.includes(data.attention)),
    );
    const blocked = (t: Task) => t.attention.includes("blocked");
    const ordered = [...all.filter(blocked), ...all.filter((t) => !blocked(t))];
    const start = Number(data.cursor ?? 0);
    const end = start + (data.limit ?? 20);
    const nextCursor = end < ordered.length ? String(end) : null;
    return Promise.resolve(tasksPageWith(ordered.slice(start, end), { all: ordered, nextCursor }));
  });
}

const REPO = "HX-Infratstructure/HX-CentCom";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
  { id: "beacon", display_name: "Beacon", role: "agent", color: "sky", active: true },
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

const NO_PRS: GithubPrsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byRepo: {}, byState: {} },
};

function task(fields: Pick<Task, "id" | "title"> & Partial<Task>): Task {
  return {
    agent: "atlas",
    repository: REPO,
    host: "HX-15",
    commit_sha: null,
    status: "In progress",
    group: "in_progress",
    blocked_on: "none",
    start_date: null,
    due_date: null,
    note: null,
    source_url: `https://github.com/${REPO}/issues/12`,
    version: 1,
    updated_at: "2026-11-14T08:10:00.123456+00:00",
    progress: { proven: 0, total: 0, percent: null },
    open: true,
    stale: null,
    attention: [],
    ...fields,
  };
}

function decision(fields: Pick<Decision, "id" | "question"> & Partial<Decision>): Decision {
  return {
    subject: null,
    summary: "The owner picks the gate before the next step runs.",
    description: "The requesting agent stops until the owner records a decision.",
    gate_type: "merge",
    options: [
      { label: "Approve", recommended: false },
      { label: "Hold", recommended: false },
    ],
    blocks: [],
    recommended_by: null,
    requested_by: "atlas",
    requested_at: "2026-11-10T09:00:00.123456+00:00",
    source_url: `https://github.com/${REPO}/issues/10`,
    status: "Pending",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
    superseded_by: null,
    version: 1,
    ...fields,
  };
}

function pr(fields: Pick<PullRequest, "number" | "state"> & Partial<PullRequest>): PullRequest {
  return {
    id: 3_100_000 + fields.number,
    repo: REPO,
    title: `Change ${fields.number}`,
    draft: false,
    head_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
    merge_commit_sha: fields.state === "merged" ? "fc08970a1b2c3d4e5f60718293a4b5c6d7e8f901" : null,
    url: `https://github.com/${REPO}/pull/${fields.number}`,
    fetched_at: "2026-11-14T08:05:00.654321+00:00",
    ...fields,
  };
}

const workspace = (rows: Partial<Pick<Workspace, "tasks" | "decisions">>) =>
  workspaceWith({ agents: AGENTS, statusLabels: STATUSES, ...rows });

function pendingPageOf(decisions: readonly Decision[], total?: number): DecisionsPage {
  const items = decisions.filter((d) => d.status === "Pending");
  const all = total ?? items.length;
  return {
    items,
    nextCursor: null,
    counts: { total: all, byGateType: {}, byStatus: all === 0 ? {} : { Pending: all } },
  };
}

/** The server reads the overview's numbers and decisions come from. By default they agree with the snapshot. */
type ServerReads = {
  readonly shell?: WorkspaceShell;
  readonly pendingPage?: DecisionsPage;
  readonly taskPage?: TasksPage;
};

/**
 * The route's own loader and selects run against the stored snapshot and pages. Only the open-PR read is stored, so a
 * route that asked the server for any other PR query would fail to load. The feed asks the mocked `listUpdates`, so a
 * test can read what the feed sent. The task reads ask the mocked `listTasks`, which serves the snapshot's tasks, or
 * `reads.taskPage` for every task read.
 */
async function renderOverview(
  raw: Workspace,
  openPrs: GithubPrsPage = NO_PRS,
  url = "/",
  updates: UpdatesPage = NO_UPDATES,
  reads: ServerReads = {},
) {
  server.listUpdates.mockResolvedValue(updates);
  if (reads.taskPage === undefined) serveTasks(raw.tasks);
  else server.listTasks.mockResolvedValue(reads.taskPage);
  const pendingPage = reads.pendingPage ?? pendingPageOf(raw.decisions);
  const shell =
    reads.shell ??
    shellWith({
      agents: raw.agents,
      statusLabels: raw.statusLabels,
      tasks: raw.tasks,
      pendingDecisions: pendingPage.counts.total,
    });
  return renderApp(url, {
    heading: "Overview",
    seed: [
      [["workspace-shell"], shell],
      [["decisions", "overview", { status: "Pending", limit: 100 }], pendingPage],
      [["prs", "list", { state: "open" }], { pages: [openPrs], pageParams: [undefined] }],
    ],
  });
}

afterEach(() => {
  server.listUpdates.mockReset();
  server.listTasks.mockReset();
  server.listWorkspace.mockReset();
});

function section(name: string) {
  const region = screen.getByRole("region", { name: new RegExp(`^${name}`) });
  return {
    heading: within(region).getByRole("heading", { level: 2 }).textContent,
    rowTitles: within(region)
      .queryAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
    /** The task table's rows in document order: groups in workflow order, rows in each group's order. */
    taskTitles: within(region)
      .queryAllByRole("rowheader")
      .map((h) => within(h).getByRole("link").textContent),
    prNumbers: within(region)
      .queryAllByText(/ #\d+$/)
      .map((e) => e.textContent),
    empty: within(region).queryByRole("status")?.textContent ?? null,
  };
}

describe("the overview's open tasks", () => {
  it("groups the open tasks in workflow order, blocked tasks first in each group, and leaves out finished unblocked work", async () => {
    await renderOverview(
      workspace({
        tasks: [
          task({ id: "IRP-30", title: "Tune the shadow thresholds" }),
          task({ id: "IRP-31", title: "Draft the shadow hook config", group: "backlog" }),
          task({
            id: "IRP-32",
            title: "Wire the eval dashboard",
            blocked_on: "owner_decision",
            attention: ["blocked", "owner"],
          }),
          task({
            id: "IRP-33",
            title: "Pin the router build",
            group: "done",
            status: "Complete",
            open: false,
          }),
          task({
            id: "IRP-34",
            title: "Close the benchmark run",
            group: "done",
            status: "Complete",
            blocked_on: "dependency",
            attention: ["blocked"],
          }),
          task({
            id: "IRP-35",
            title: "Write the release notes",
            agent: null,
            group: "ready_for_owner",
            status: "Waiting",
            attention: ["owner"],
          }),
        ],
      }),
    );

    const open = section("Open tasks");
    expect(open.taskTitles).toEqual([
      "Draft the shadow hook config",
      "Wire the eval dashboard",
      "Tune the shadow thresholds",
      "Write the release notes",
      "Close the benchmark run",
    ]);
    expect(open.heading).toBe("Open tasks 5");
  });

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: `IRP-${100 + i}`, title: `Open task ${String(i).padStart(2, "0")}` }),
    );

  it("shows the first page of 20 and fetches the next page with the cursor on Show more", async () => {
    await renderOverview(workspace({ tasks: many(25) }));

    const region = screen.getByRole("region", { name: /^Open tasks/ });
    expect(section("Open tasks").taskTitles).toHaveLength(20);
    expect(section("Open tasks").heading).toBe("Open tasks 25");
    expect(region).toHaveTextContent("Showing 20 of 25 tasks.");

    await act(async () => {
      fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    });
    expect(await within(region).findByText("Showing all 25 tasks.")).toBeInTheDocument();
    expect(section("Open tasks").taskTitles).toHaveLength(25);
    expect(server.listTasks).toHaveBeenCalledWith({ data: { open: true, cursor: "20" } });
    expect(server.listWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the server's order, so a blocked task the server returns first leads its group", async () => {
    const calm = task({ id: "IRP-40", title: "Tune the shadow thresholds" });
    const stuck = task({
      id: "IRP-41",
      title: "Wire the eval dashboard",
      blocked_on: "dependency",
      attention: ["blocked"],
    });
    await renderOverview(workspace({ tasks: [calm, stuck] }), NO_PRS, "/", NO_UPDATES, {
      taskPage: tasksPageWith([stuck, calm]),
    });

    expect(section("Open tasks").taskTitles).toEqual([
      "Wire the eval dashboard",
      "Tune the shadow thresholds",
    ]);
  });

  it("counts the attention chips with the server's byAttention and never reads the whole workspace", async () => {
    const page = tasksPageWith(many(3));
    await renderOverview(workspace({ tasks: many(3) }), NO_PRS, "/", NO_UPDATES, {
      taskPage: {
        ...page,
        counts: { ...page.counts, total: 9, byAttention: { blocked: 7, owner: 4, stale: 2 } },
      },
    });

    const facet = within(screen.getByRole("group", { name: "Needs attention" }));
    expect(facet.getAllByRole("link").map((chip) => chip.textContent)).toEqual([
      "Blocked7",
      "Waiting on the owner4",
      "Stale commit2",
    ]);
    expect(section("Open tasks").heading).toBe("Open tasks 9");
    expect(server.listWorkspace).not.toHaveBeenCalled();
  });
});

describe("the overview's needs-attention filter", () => {
  const ATTENTION = workspace({
    tasks: [
      task({
        id: "IRP-71",
        title: "Close the benchmark run",
        blocked_on: "dependency",
        attention: ["blocked"],
      }),
      task({
        id: "IRP-72",
        title: "Write the release notes",
        group: "ready_for_owner",
        status: "Waiting",
        attention: ["owner"],
      }),
      task({ id: "IRP-73", title: "Wire the eval dashboard", attention: ["owner"] }),
      task({
        id: "IRP-74",
        title: "Pin the router build",
        commit_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
        stale: true,
        attention: ["stale"],
      }),
      task({
        id: "IRP-75",
        title: "Draft the shadow hook config",
        commit_sha: "fc08970a1b2c3d4e5f60718293a4b5c6d7e8f901",
        stale: false,
      }),
      task({
        id: "IRP-76",
        title: "Assign the dashboard review",
        agent: null,
        blocked_on: "assignment",
        attention: ["blocked", "owner"],
      }),
      // Finished work is not open, so its stale commit counts nowhere.
      task({
        id: "IRP-77",
        title: "Publish the release",
        group: "done",
        status: "Complete",
        stale: true,
        open: false,
      }),
    ],
    decisions: [
      decision({ id: "D-31", question: "Ship the eval dashboard?", blocks: ["IRP-73"] }),
      // Already decided, so it no longer waits on the owner even though it still lists the task.
      decision({
        id: "D-30",
        question: "Keep the shadow hook config?",
        blocks: ["IRP-75"],
        status: "Decided",
        decision_text: "Keep it.",
        decision_source_url: `https://github.com/${REPO}/issues/10#issuecomment-6875070691`,
        decided_at: "2026-11-13T15:30:00.123456+00:00",
      }),
    ],
  });

  function chips() {
    return within(screen.getByRole("group", { name: "Needs attention" }))
      .getAllByRole("link")
      .map((chip) => ({
        name: chip.textContent,
        current: chip.getAttribute("aria-current") === "true",
      }));
  }

  /** What the feed asked the server for, one entry per request. */
  function feedRequests() {
    return server.listUpdates.mock.calls.map(([request]: unknown[]) => request);
  }

  const feedNote = (label: string) => `Only updates on open tasks that need attention: ${label}`;

  it("counts each reason over the open tasks, under every reason a task has", async () => {
    await renderOverview(ATTENTION);

    expect(chips()).toEqual([
      { name: "Blocked2", current: false },
      { name: "Waiting on the owner3", current: false },
      { name: "Stale commit1", current: false },
    ]);
    expect(section("Open tasks").heading).toBe("Open tasks 6");
  });

  it.each([
    ["blocked", "Blocked", ["Close the benchmark run", "Assign the dashboard review"]],
    [
      "owner",
      "Waiting on the owner",
      ["Assign the dashboard review", "Wire the eval dashboard", "Write the release notes"],
    ],
    ["stale", "Stale commit", ["Pin the router build"]],
  ] as const)(
    "keeps only the matching rows at /?attention=%s and asks the server for the reason's updates",
    async (value, label, titles) => {
      const router = await renderOverview(ATTENTION, NO_PRS, `/?attention=${value}`);

      const open = section("Open tasks");
      expect(open.taskTitles).toEqual(titles);
      expect(open.heading).toBe(`Open tasks ${titles.length}`);
      expect(chips().filter((c) => c.current)).toEqual([
        { name: `${label}${titles.length}`, current: true },
      ]);
      expect(router.state.location.search).toEqual({ attention: value });
      expect(feedRequests()).toEqual([{ data: { attention: value } }]);
      expect(screen.getByRole("region", { name: /^Latest updates/ })).toHaveTextContent(
        feedNote(label),
      );
    },
  );

  it("writes the chosen reason to the URL and sends the reason, not its task ids, to the feed", async () => {
    const router = await renderOverview(ATTENTION);
    const facet = within(screen.getByRole("group", { name: "Needs attention" }));

    await act(async () => {
      fireEvent.click(facet.getByRole("link", { name: "Waiting on the owner 3" }));
    });
    expect(router.state.location.search).toEqual({ attention: "owner" });
    expect(section("Open tasks").heading).toBe("Open tasks 3");

    await act(async () => {
      fireEvent.click(facet.getByRole("link", { name: "Waiting on the owner 3" }));
    });
    expect(router.state.location.search).toEqual({});
    expect(section("Open tasks").heading).toBe("Open tasks 6");
    expect(feedRequests()).toEqual([{ data: {} }, { data: { attention: "owner" } }]);
  });

  it("combines with the feed's agent filter", async () => {
    await renderOverview(ATTENTION, NO_PRS, "/?attention=blocked&agent=atlas");

    expect(feedRequests()).toEqual([{ data: { agentId: "atlas", attention: "blocked" } }]);
  });

  it("asks for the chosen task alone when it needs attention for the reason", async () => {
    await renderOverview(ATTENTION, NO_PRS, "/?attention=stale&task=IRP-74");

    expect(feedRequests()).toEqual([{ data: { taskId: "IRP-74" } }]);
  });

  it("sends no feed request when the chosen task does not need attention for the reason", async () => {
    await renderOverview(ATTENTION, NO_PRS, "/?attention=stale&task=IRP-73");

    expect(feedRequests()).toEqual([]);
    expect(section("Latest updates").empty).toBe("No updates match these filters.");
    expect(screen.getByRole("region", { name: /^Latest updates/ })).toHaveTextContent(
      feedNote("Stale commit"),
    );
  });

  it("sends the reason alone when more than 100 open tasks need attention for it", async () => {
    const blocked = Array.from({ length: 101 }, (_, i) =>
      task({
        id: `IRP-${200 + i}`,
        title: `Blocked task ${i}`,
        blocked_on: "dependency",
        attention: ["blocked"],
      }),
    );
    await renderOverview(workspace({ tasks: blocked }), NO_PRS, "/?attention=blocked");

    expect(section("Open tasks").heading).toBe("Open tasks 101");
    expect(server.listTasks).toHaveBeenCalledWith({
      data: { open: true, attention: "blocked", limit: 100 },
    });
    expect(feedRequests()).toEqual([{ data: { attention: "blocked" } }]);
  });

  it("asks for the chosen task alone only while the reason's 100-row page holds every one of its tasks", async () => {
    const blocked = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        task({
          id: `IRP-${200 + i}`,
          title: `Blocked task ${i}`,
          blocked_on: "dependency",
          attention: ["blocked"],
        }),
      );
    await renderOverview(
      workspace({ tasks: blocked(100) }),
      NO_PRS,
      "/?attention=blocked&task=IRP-299",
    );
    expect(feedRequests()).toEqual([{ data: { taskId: "IRP-299" } }]);
  });

  it("sends no feed request for a chosen task when more than 100 open tasks need attention for the reason", async () => {
    const blocked = Array.from({ length: 101 }, (_, i) =>
      task({
        id: `IRP-${200 + i}`,
        title: `Blocked task ${i}`,
        blocked_on: "dependency",
        attention: ["blocked"],
      }),
    );
    await renderOverview(workspace({ tasks: blocked }), NO_PRS, "/?attention=blocked&task=IRP-201");
    expect(section("Open tasks").heading).toBe("Open tasks 101");
    expect(section("Latest updates").empty).toBe("No updates match these filters.");
    expect(feedRequests()).toEqual([]);
  });

  it("lets the server answer when no open task needs attention for the reason", async () => {
    await renderOverview(
      workspace({
        tasks: [
          task({ id: "IRP-73", title: "Wire the eval dashboard" }),
          task({
            id: "IRP-77",
            title: "Publish the release",
            group: "done",
            status: "Complete",
            stale: true,
            open: false,
          }),
        ],
      }),
      NO_PRS,
      "/?attention=stale",
    );

    expect(feedRequests()).toEqual([{ data: { attention: "stale" } }]);
    expect(section("Latest updates").empty).toBe("No updates match these filters.");
  });

  it("sends the feed's own filters alone without a reason, and says nothing about attention", async () => {
    await renderOverview(ATTENTION, NO_PRS, "/?agent=atlas&task=IRP-73");

    expect(feedRequests()).toEqual([{ data: { agentId: "atlas", taskId: "IRP-73" } }]);
    expect(screen.getByRole("region", { name: /^Latest updates/ })).not.toHaveTextContent(
      "need attention",
    );
  });

  function feedUpdate(n: number, taskId: string): TaskUpdate {
    return {
      id: `0b6f3c1e-8d4a-4c2b-9e7f-${String(n).padStart(12, "0")}`,
      task_id: taskId,
      agent_id: "atlas",
      kind: "progress",
      status: null,
      note: `Benchmark batch ${n} finished on HX-4.`,
      links: [],
      commit_sha: null,
      pr_url: null,
      source: "api",
      run_id: null,
      created_at: `2026-11-14T08:1${n}:00.123456+00:00`,
    };
  }

  const STALE_UPDATE = feedUpdate(4, "IRP-74");
  const EVERY_UPDATE = [
    STALE_UPDATE,
    feedUpdate(3, "IRP-73"),
    feedUpdate(2, "IRP-73"),
    feedUpdate(1, "IRP-71"),
  ];
  // The server's task facet leaves out its own filters, `taskIds` included, so it counts every task (reads.ts).
  const BY_TASK = { "IRP-73": 2, "IRP-71": 1, "IRP-74": 1 };
  const STALE_PAGE: UpdatesPage = {
    items: [STALE_UPDATE],
    nextCursor: null,
    counts: { total: 1, byAgent: { atlas: 1 }, byTask: BY_TASK, bySource: { api: 1 } },
  };
  const WHOLE_PAGE: UpdatesPage = {
    items: EVERY_UPDATE,
    nextCursor: null,
    counts: { total: 4, byAgent: { atlas: 4 }, byTask: BY_TASK, bySource: { api: 4 } },
  };

  function taskChips() {
    return within(screen.getByRole("group", { name: "Task" }))
      .getAllByRole("link")
      .map((chip) => ({
        name: chip.textContent,
        current: chip.getAttribute("aria-current") === "true",
      }));
  }

  it.each([
    ["/?attention=stale", STALE_PAGE, [{ name: "IRP-741", current: false }]],
    ["/?attention=stale&task=IRP-74", STALE_PAGE, [{ name: "IRP-741", current: true }]],
    // A task outside the reason's tasks sends no feed request, and still shows as the active chip.
    ["/?attention=stale&task=IRP-73", STALE_PAGE, [{ name: "IRP-730", current: true }]],
    [
      "/",
      WHOLE_PAGE,
      [
        { name: "IRP-732", current: false },
        { name: "IRP-711", current: false },
        { name: "IRP-741", current: false },
      ],
    ],
  ] as const)(
    "offers the feed's Task chips only for the reason's tasks, with the server's counts, at %s",
    async (url, updates, expected) => {
      await renderOverview(ATTENTION, NO_PRS, url, updates);

      expect(taskChips()).toEqual(expected);
    },
  );

  it("follows the reason's tasks when a refresh of the task reads changes them", async () => {
    const calm = task({ id: "IRP-73", title: "Wire the eval dashboard" });
    const router = await renderOverview(
      workspace({ tasks: [calm] }),
      NO_PRS,
      "/?attention=blocked",
    );
    expect(feedRequests()).toEqual([{ data: { attention: "blocked" } }]);

    const blockedUpdate = feedUpdate(5, "IRP-73");
    server.listUpdates.mockResolvedValue({
      items: [blockedUpdate],
      nextCursor: null,
      counts: { total: 1, byAgent: { atlas: 1 }, byTask: { "IRP-73": 1 }, bySource: { api: 1 } },
    });
    serveTasks([{ ...calm, blocked_on: "dependency", attention: ["blocked"] }]);
    await act(async () => {
      await router.options.context.queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const feed = screen.getByRole("region", { name: /^Latest updates/ });
    expect(await within(feed).findByText(blockedUpdate.note)).toBeInTheDocument();
    expect(section("Latest updates").empty).toBeNull();
    expect(section("Open tasks").taskTitles).toEqual(["Wire the eval dashboard"]);
    expect(feedRequests()).toEqual([
      { data: { attention: "blocked" } },
      { data: { attention: "blocked" } },
    ]);
  });
});

describe("the overview's number widgets", () => {
  // The seed's shape: three backlog tasks (one blocked by a dependency, two waiting for an owner to assign them), two
  // in progress (one waiting on an owner decision), two done.
  const SEED_LIKE = workspace({
    tasks: [
      task({
        id: "HX12-01",
        title: "DeepAgents source-led rebuild",
        group: "backlog",
        status: "Waiting",
        blocked_on: "dependency",
        attention: ["blocked"],
      }),
      task({
        id: "RO-01",
        title: "Qdrant live acceptance",
        agent: null,
        group: "backlog",
        status: "Waiting",
        blocked_on: "assignment",
        attention: ["blocked", "owner"],
      }),
      task({
        id: "HX14-02",
        title: "n8n Phase 2",
        agent: null,
        group: "backlog",
        status: "Waiting",
        blocked_on: "assignment",
        attention: ["blocked", "owner"],
      }),
      task({
        id: "IRP-04",
        title: "Semantic controller Stage 2 qualification",
        blocked_on: "owner_decision",
        attention: ["blocked", "owner"],
      }),
      task({ id: "CC-01", title: "HX-CentCom WU1 build" }),
      task({
        id: "IRP-05",
        title: "D3 adapter closeout",
        group: "done",
        status: "Complete",
        open: false,
      }),
      task({
        id: "IRP-UI",
        title: "Agent Lab run contract",
        group: "done",
        status: "Complete",
        open: false,
      }),
    ],
    decisions: [
      decision({ id: "D-01", question: "Merge PR #19?", blocks: ["IRP-04"] }),
      decision({ id: "D-03", question: "Exact-release deploy GO?", blocks: ["IRP-04"] }),
      decision({ id: "D-09", question: "Merge PR #83?" }),
      decision({
        id: "D-02",
        question: "Adopt the standing directive?",
        status: "Decided",
        decision_text: "Adopted.",
        decision_source_url: `https://github.com/${REPO}/issues/10#issuecomment-6870997761`,
        decided_at: "2026-11-14T09:00:00.123456+00:00",
      }),
    ],
  });
  const TWO_OPEN_PRS: GithubPrsPage = {
    items: [pr({ number: 19, state: "open", id: 1 }), pr({ number: 83, state: "open", id: 2 })],
    nextCursor: null,
    counts: { total: 2, byRepo: { [REPO]: 2 }, byState: { open: 2, merged: 1 } },
  };

  function widgets() {
    return within(screen.getByRole("region", { name: "Summary" }))
      .getAllByRole("link")
      .map((widget) => widget.textContent);
  }

  it("counts open, blocked and owner-waiting tasks, pending decisions and open PRs", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS);

    expect(widgets()).toEqual([
      "Open tasks5",
      "Blocked4",
      "Waiting on the owner3",
      "Pending decisions3",
      "Open pull requests2",
    ]);
  });

  // 250 tasks on the server, of which the page holds only SEED_LIKE's seven rows. Complete comes first to show the done
  // labels still go last.
  const SERVER_COUNTS = (() => {
    const shell = shellWith({ agents: AGENTS, statusLabels: STATUSES, pendingDecisions: 42 });
    return {
      ...shell,
      counts: {
        ...shell.counts,
        tasks: {
          total: 250,
          open: 180,
          blocked: 12,
          owner: 7,
          byStatus: { Complete: 70, Waiting: 100, "In progress": 80 },
        },
      },
    };
  })();

  it("reads every number from the server's counts, not from the task rows the page holds", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS, "/", NO_UPDATES, { shell: SERVER_COUNTS });

    expect(widgets()).toEqual([
      "Open tasks180",
      "Blocked12",
      "Waiting on the owner7",
      "Pending decisions42",
      "Open pull requests2",
    ]);
  });

  it("shows the server's tasks by status, open labels first, with each label's share", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS, "/", NO_UPDATES, { shell: SERVER_COUNTS });

    const heading = screen.getByRole("heading", { level: 3, name: /^Tasks by status/ });
    expect(heading.textContent).toBe("Tasks by status 250");
    const widget = within(heading.closest(".status-widget") as HTMLElement);
    expect(widget.getByRole("img").getAttribute("aria-label")).toBe(
      "Waiting 100, In progress 80, Complete 70",
    );
    expect(widget.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Waiting10040%",
      "In progress8032%",
      "Complete7028%",
    ]);
  });

  it("orders tasks by status by the status directory, not by the order the server's counts arrive in", async () => {
    const shell = shellWith({ agents: AGENTS, statusLabels: STATUSES });
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS, "/", NO_UPDATES, {
      shell: {
        ...shell,
        counts: {
          ...shell.counts,
          tasks: {
            total: 100,
            open: 90,
            blocked: 0,
            owner: 0,
            byStatus: { Zeta: 6, Complete: 10, "In progress": 30, Alpha: 4, Waiting: 50 },
          },
        },
      },
    });

    const heading = screen.getByRole("heading", { level: 3, name: /^Tasks by status/ });
    const widget = within(heading.closest(".status-widget") as HTMLElement);
    expect(widget.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Waiting5050%",
      "In progress3030%",
      "Alpha44%",
      "Zeta66%",
      "Complete1010%",
    ]);
  });

  it("keeps counting every open task while the open tasks list is filtered", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS, "/?attention=owner");

    expect(section("Open tasks").heading).toBe("Open tasks 3");
    expect(widgets()[0]).toBe("Open tasks5");
  });

  it("opens the matching filter from each widget", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS);

    const summary = within(screen.getByRole("region", { name: "Summary" }));
    expect(summary.getByRole("link", { name: "Blocked 4" })).toHaveAttribute(
      "href",
      "/?attention=blocked#open-tasks",
    );
    expect(summary.getByRole("link", { name: "Waiting on the owner 3" })).toHaveAttribute(
      "href",
      "/?attention=owner#open-tasks",
    );
    expect(summary.getByRole("link", { name: "Pending decisions 3" })).toHaveAttribute(
      "href",
      "/decisions",
    );
    expect(summary.getByRole("link", { name: "Open pull requests 2" })).toHaveAttribute(
      "href",
      "/pull-requests?state=open",
    );
  });

  it("opens every open task from the Open tasks widget, dropping the attention filter but keeping the feed's", async () => {
    await renderOverview(SEED_LIKE, TWO_OPEN_PRS, "/?attention=blocked&agent=CC1");

    const summary = within(screen.getByRole("region", { name: "Summary" }));
    expect(summary.getByRole("link", { name: "Open tasks 5" })).toHaveAttribute(
      "href",
      "/?agent=CC1#open-tasks",
    );
  });
});

describe("the overview's open pull requests", () => {
  it("shows the first eight in the server's order while the heading counts every open one", async () => {
    const newestFirst = [
      77, 75, 76, 71, 74, 72, 73, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58,
    ];
    await renderOverview(workspace({}), {
      items: newestFirst.map((number, i) => pr({ number, state: "open", id: 3_200_000 - i })),
      nextCursor: "page-2",
      counts: { total: 25, byRepo: { [REPO]: 25 }, byState: { open: 25, merged: 4 } },
    });

    const prs = section("Open pull requests");
    expect(prs.prNumbers).toEqual(newestFirst.slice(0, 8).map((n) => `${REPO} #${n}`));
    expect(prs.heading).toBe("Open pull requests 25");
    expect(screen.getByRole("link", { name: "All 25 open pull requests" })).toHaveAttribute(
      "href",
      "/pull-requests?state=open",
    );
  });

  it("says no sync has stored a pull request when none is stored", async () => {
    await renderOverview(workspace({}), NO_PRS);

    const prs = section("Open pull requests");
    expect(prs.empty).toBe("No GitHub sync has stored pull requests yet.");
    expect(prs.heading).toBe("Open pull requests 0");
  });

  it("says the last sync found none open when every stored pull request is closed", async () => {
    await renderOverview(workspace({}), {
      items: [],
      nextCursor: null,
      counts: { total: 0, byRepo: {}, byState: { merged: 1, closed: 1 } },
    });

    const prs = section("Open pull requests");
    expect(prs.empty).toBe("The last GitHub sync found no open pull requests.");
    expect(prs.heading).toBe("Open pull requests 0");
    expect(prs.prNumbers).toEqual([]);
  });
});

describe("the overview's decisions", () => {
  it("lists pending decisions with the one that blocks the most tasks first", async () => {
    await renderOverview(
      workspace({
        decisions: [
          decision({
            id: "D-21",
            question: "Merge the shadow hook PR?",
            blocks: ["IRP-31"],
            requested_at: "2026-11-12T10:00:00.123456+00:00",
          }),
          decision({
            id: "D-22",
            question: "Deploy release 1.2 to HX-15?",
            gate_type: "deploy",
            blocks: ["IRP-31", "IRP-32"],
            status: "Decided",
            decision_text: "Deploy after the smoke test.",
            decision_source_url: `https://github.com/${REPO}/issues/10#issuecomment-6875070691`,
            decided_at: "2026-11-13T15:30:00.123456+00:00",
          }),
          decision({
            id: "D-23",
            question: "Start Run 2 on HX-4?",
            gate_type: "live_run",
            blocks: ["IRP-31", "IRP-32", "IRP-35"],
            requested_at: "2026-11-13T09:00:00.123456+00:00",
          }),
          decision({
            id: "D-24",
            question: "Assign the dashboard review?",
            gate_type: "assignment",
            requested_at: "2026-11-01T09:00:00.123456+00:00",
          }),
        ],
      }),
    );

    const pending = section("Needs your decision");
    expect(pending.rowTitles).toEqual([
      "Start Run 2 on HX-4?",
      "Merge the shadow hook PR?",
      "Assign the dashboard review?",
    ]);
    expect(pending.heading).toBe("Needs your decision 3");
  });

  it("ranks the loaded Pending page and counts every pending decision the server holds", async () => {
    const loaded = [0, 3, 1, 5, 2, 4, 0].map((blocking, i) =>
      decision({
        id: `D-3${i}`,
        question: `Gate ${i} blocks ${blocking}?`,
        blocks: Array.from({ length: blocking }, (_, n) => `IRP-${n}`),
        requested_at: `2026-11-0${i + 1}T09:00:00.123456+00:00`,
      }),
    );
    await renderOverview(workspace({ decisions: [] }), NO_PRS, "/", NO_UPDATES, {
      pendingPage: pendingPageOf(loaded, 130),
    });

    const pending = section("Needs your decision");
    expect(pending.rowTitles).toEqual([
      "Gate 3 blocks 5?",
      "Gate 5 blocks 4?",
      "Gate 1 blocks 3?",
      "Gate 4 blocks 2?",
      "Gate 2 blocks 1?",
    ]);
    expect(pending.heading).toBe("Needs your decision 130");
    expect(screen.getByRole("link", { name: "All 130 pending decisions" })).toHaveAttribute(
      "href",
      "/decisions",
    );
  });
});
