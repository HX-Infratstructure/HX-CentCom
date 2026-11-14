import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type {
  Agent,
  Decision,
  GithubPrsPage,
  PullRequest,
  StatusLabel,
  Task,
  TaskUpdate,
  UpdatesPage,
  Workspace,
} from "./server-types";

const server = vi.hoisted(() => ({ listUpdates: vi.fn() }));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listUpdates: server.listUpdates,
}));

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
    stale: null,
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

function workspace(rows: Partial<Pick<Workspace, "tasks" | "decisions">>): Workspace {
  return {
    tasks: [],
    updates: [],
    updatesCursor: null,
    requirements: [],
    decisions: [],
    agents: AGENTS,
    statusLabels: STATUSES,
    repos: [],
    counts: {
      updates: NO_UPDATES.counts,
      decisions: { total: rows.decisions?.length ?? 0, byGateType: {}, byStatus: {} },
    },
    ...rows,
  };
}

/**
 * The route's own loader and selects run against the stored snapshot and pages. Only the open-PR read is stored, so a
 * route that asked the server for any other PR query would fail to load. The feed asks the mocked `listUpdates`, so a
 * test can read what the feed sent.
 */
async function renderOverview(
  raw: Workspace,
  openPrs: GithubPrsPage = NO_PRS,
  url = "/",
  updates: UpdatesPage = NO_UPDATES,
) {
  server.listUpdates.mockResolvedValue(updates);
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["task-workspace"], raw);
  queryClient.setQueryData(["prs", "list", { state: "open" }], {
    pages: [openPrs],
    pageParams: [undefined],
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  return router;
}

afterEach(() => {
  server.listUpdates.mockReset();
});

function section(name: string) {
  const region = screen.getByRole("region", { name: new RegExp(`^${name}`) });
  return {
    heading: within(region).getByRole("heading", { level: 2 }).textContent,
    rowTitles: within(region)
      .queryAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
    prNumbers: within(region)
      .queryAllByText(/ #\d+$/)
      .map((e) => e.textContent),
    empty: within(region).queryByRole("status")?.textContent ?? null,
  };
}

describe("the overview's open tasks", () => {
  it("lists blocked tasks first, then unfinished ones, each in workspace order, and leaves out finished unblocked work", async () => {
    await renderOverview(
      workspace({
        tasks: [
          task({ id: "IRP-31", title: "Draft the shadow hook config", group: "backlog" }),
          task({
            id: "IRP-32",
            title: "Wire the eval dashboard",
            blocked_on: "owner_decision",
          }),
          task({
            id: "IRP-33",
            title: "Pin the router build",
            group: "done",
            status: "Complete",
          }),
          task({
            id: "IRP-34",
            title: "Close the benchmark run",
            group: "done",
            status: "Complete",
            blocked_on: "dependency",
          }),
          task({
            id: "IRP-35",
            title: "Write the release notes",
            agent: null,
            group: "ready_for_owner",
            status: "Waiting",
          }),
        ],
      }),
    );

    const open = section("Open tasks");
    expect(open.rowTitles).toEqual([
      "Wire the eval dashboard",
      "Close the benchmark run",
      "Draft the shadow hook config",
      "Write the release notes",
    ]);
    expect(open.heading).toBe("Open tasks 4");
  });
});

describe("the overview's needs-attention filter", () => {
  const ATTENTION = workspace({
    tasks: [
      task({ id: "IRP-71", title: "Close the benchmark run", blocked_on: "dependency" }),
      task({
        id: "IRP-72",
        title: "Write the release notes",
        group: "ready_for_owner",
        status: "Waiting",
      }),
      task({ id: "IRP-73", title: "Wire the eval dashboard" }),
      task({
        id: "IRP-74",
        title: "Pin the router build",
        commit_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
        stale: true,
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
      }),
      // Finished work is not open, so its stale commit counts nowhere.
      task({
        id: "IRP-77",
        title: "Publish the release",
        group: "done",
        status: "Complete",
        stale: true,
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
    [
      "blocked",
      "Blocked",
      ["Close the benchmark run", "Assign the dashboard review"],
      ["IRP-71", "IRP-76"],
    ],
    [
      "owner",
      "Waiting on the owner",
      ["Assign the dashboard review", "Write the release notes", "Wire the eval dashboard"],
      ["IRP-76", "IRP-72", "IRP-73"],
    ],
    ["stale", "Stale commit", ["Pin the router build"], ["IRP-74"]],
  ] as const)(
    "keeps only the matching rows at /?attention=%s and asks the feed for their updates alone",
    async (value, label, titles, taskIds) => {
      const router = await renderOverview(ATTENTION, NO_PRS, `/?attention=${value}`);

      const open = section("Open tasks");
      expect(open.rowTitles).toEqual(titles);
      expect(open.heading).toBe(`Open tasks ${titles.length}`);
      expect(chips().filter((c) => c.current)).toEqual([
        { name: `${label}${titles.length}`, current: true },
      ]);
      expect(router.state.location.search).toEqual({ attention: value });
      expect(feedRequests()).toEqual([{ data: { taskIds } }]);
      expect(screen.getByRole("region", { name: /^Latest updates/ })).toHaveTextContent(
        feedNote(label),
      );
    },
  );

  it("writes the chosen reason to the URL and narrows the feed without sending the reason itself", async () => {
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
    expect(feedRequests()).toEqual([
      { data: {} },
      { data: { taskIds: ["IRP-76", "IRP-72", "IRP-73"] } },
    ]);
  });

  it("combines with the feed's agent filter", async () => {
    await renderOverview(ATTENTION, NO_PRS, "/?attention=blocked&agent=atlas");

    expect(feedRequests()).toEqual([{ data: { agentId: "atlas", taskIds: ["IRP-71", "IRP-76"] } }]);
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

  it("sends no feed request when no open task needs attention for the reason", async () => {
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
          }),
        ],
      }),
      NO_PRS,
      "/?attention=stale",
    );

    expect(feedRequests()).toEqual([]);
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

  it("follows the reason's tasks when a workspace refresh changes them", async () => {
    const calm = task({ id: "IRP-73", title: "Wire the eval dashboard" });
    const router = await renderOverview(
      workspace({ tasks: [calm] }),
      NO_PRS,
      "/?attention=blocked",
    );
    expect(feedRequests()).toEqual([]);

    const blockedUpdate = feedUpdate(5, "IRP-73");
    server.listUpdates.mockResolvedValue({
      items: [blockedUpdate],
      nextCursor: null,
      counts: { total: 1, byAgent: { atlas: 1 }, byTask: { "IRP-73": 1 }, bySource: { api: 1 } },
    });
    act(() => {
      router.options.context.queryClient.setQueryData(
        ["task-workspace"],
        workspace({ tasks: [{ ...calm, blocked_on: "dependency" }] }),
      );
    });

    const feed = screen.getByRole("region", { name: /^Latest updates/ });
    expect(await within(feed).findByText(blockedUpdate.note)).toBeInTheDocument();
    expect(section("Latest updates").empty).toBeNull();
    expect(section("Open tasks").rowTitles).toEqual(["Wire the eval dashboard"]);
    expect(feedRequests()).toEqual([{ data: { taskIds: ["IRP-73"] } }]);
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
});
