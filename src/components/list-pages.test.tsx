import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type {
  ActivityEntry,
  ActivityPage,
  Agent,
  Decision,
  DecisionsPage,
  GithubPrsPage,
  Lesson,
  LessonsPage,
  PullRequest,
  RaidItem,
  RaidPage,
  StatusLabel,
  Task,
  TaskUpdate,
  UpdatesPage,
  Workspace,
} from "./server-types";

/**
 * T14: every list page's default view shows at most 20 rows and keeps its filters in the URL. A paged list's first
 * page holds 20 rows and a cursor, as the server's default page does; the kanban shows the whole task set.
 */

const PAGE_SIZE = 20;
const REPO = "HX-Infratstructure/HX-CentCom";
const LITELLM = "HX-Infratstructure/HX-LiteLLM";
const AT = "2026-11-14T08:10:00.123456+00:00";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
  { id: "beacon", display_name: "Beacon", role: "agent", color: "sky", active: true },
  { id: "cinder", display_name: "Cinder", role: "agent", color: "violet", active: true },
];

const STATUSES: readonly StatusLabel[] = [
  { id: "Waiting", label: "Waiting", is_done: false, color: null },
  { id: "In progress", label: "In progress", is_done: false, color: null },
  { id: "Ready for owner", label: "Ready for owner", is_done: false, color: null },
  { id: "Complete", label: "Complete", is_done: true, color: null },
];

function range<T>(count: number, row: (n: number) => T): readonly T[] {
  return Array.from({ length: count }, (_, i) => row(i + 1));
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function task(
  fields: Pick<Task, "id" | "title" | "agent" | "group" | "status"> & Partial<Task>,
): Task {
  return {
    repository: REPO,
    host: "HX-15",
    commit_sha: null,
    blocked_on: "none",
    start_date: null,
    due_date: null,
    note: null,
    source_url: `https://github.com/${REPO}/issues/12`,
    version: 1,
    updated_at: AT,
    progress: { proven: 0, total: 0, percent: null },
    open: true,
    stale: null,
    attention: [],
    ...fields,
  };
}

/**
 * The seed's seven tasks, their ids and titles, with invented agents. No API creates tasks (docs/ARCHITECTURE.md), so
 * the board shows this whole set.
 */
const TASKS: readonly Task[] = [
  task({
    id: "IRP-04",
    title: "Semantic controller · Stage 2 qualification",
    agent: "beacon",
    group: "in_progress",
    status: "In progress",
    blocked_on: "owner_decision",
    attention: ["blocked", "owner"],
  }),
  task({
    id: "IRP-05",
    title: "D3 adapter · O-5(c) closeout",
    agent: "atlas",
    group: "ready_for_owner",
    status: "Ready for owner",
    attention: ["owner"],
  }),
  task({
    id: "HX12-01",
    title: "DeepAgents · source-led rebuild",
    agent: "cinder",
    group: "backlog",
    status: "Waiting",
    blocked_on: "dependency",
    attention: ["blocked"],
  }),
  task({
    id: "RO-01",
    title: "Qdrant · live acceptance",
    agent: null,
    group: "backlog",
    status: "Waiting",
    blocked_on: "assignment",
    attention: ["blocked", "owner"],
  }),
  task({
    id: "IRP-UI",
    title: "Agent Lab · run contract & model picker",
    agent: "atlas",
    group: "in_progress",
    status: "In progress",
  }),
  task({
    id: "HX14-02",
    title: "n8n · Phase 2",
    agent: null,
    group: "backlog",
    status: "Waiting",
    blocked_on: "assignment",
    attention: ["blocked", "owner"],
  }),
  task({
    id: "CC-01",
    title: "HX-CentCom WU1 build",
    agent: "atlas",
    group: "done",
    status: "Complete",
    open: false,
  }),
];

const WORKSPACE: Workspace = {
  tasks: TASKS,
  updates: [],
  updatesCursor: null,
  requirements: [],
  decisions: [],
  agents: AGENTS,
  statusLabels: STATUSES,
  repos: [],
  counts: {
    updates: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
    decisions: { total: 0, byGateType: {}, byStatus: {} },
  },
};

function update(n: number, fields: Partial<TaskUpdate> = {}): TaskUpdate {
  return {
    id: `0b6f3c1e-8d4a-4c2b-9e7f-${pad(n, 12)}`,
    task_id: "IRP-04",
    agent_id: n % 2 === 0 ? "atlas" : "beacon",
    kind: "progress",
    status: null,
    note: `Shadow benchmark batch ${n} finished on HX-4.`,
    links: [],
    commit_sha: null,
    pr_url: null,
    source: "api",
    run_id: null,
    created_at: `2026-11-14T08:${pad(59 - n)}:00.123456+00:00`,
    ...fields,
  };
}

function decision(n: number, fields: Partial<Decision> = {}): Decision {
  return {
    id: `D-${100 + n}`,
    subject: null,
    question: `Merge the router change ${n}?`,
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
    requested_at: `2026-11-1${n % 4}T09:${pad(n)}:00.123456+00:00`,
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

function raidItem(n: number, fields: Partial<RaidItem> = {}): RaidItem {
  return {
    id: `RAID-${pad(n)}`,
    type: "risk",
    title: `Run ${n} could miss the HX-4 window`,
    summary: "The benchmark needs HX-4 for a full day.",
    description: "HX-4 is shared with the shadow hook tests.",
    owner_agent: "atlas",
    status: "open",
    severity: "medium",
    severity_rated_by: "beacon",
    review_at: null,
    source_url: `https://github.com/${REPO}/issues/10`,
    created_by: "atlas",
    task_ids: ["IRP-04"],
    decision_id: null,
    probability: "Medium",
    impact: "One day of delay",
    mitigation: "Book HX-4 ahead.",
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
    version: 1,
    created_at: AT,
    updated_at: AT,
    ...fields,
  };
}

function lesson(n: number, fields: Partial<Lesson> = {}): Lesson {
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
    ...fields,
  };
}

function activity(n: number, fields: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: `7f3c2a10-0000-4000-8000-${pad(n, 12)}`,
    actor: n % 2 === 0 ? "atlas" : "beacon",
    action: "task.progress",
    entity: "task",
    entity_id: "IRP-04",
    before: null,
    after: null,
    run_id: null,
    commit_sha: null,
    created_at: AT,
    revertible: false,
    ...fields,
  };
}

function pullRequest(n: number, fields: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 3_000_100 - n,
    repo: n % 3 === 0 ? LITELLM : REPO,
    number: 100 - n,
    title: `Change ${100 - n}`,
    state: "open",
    draft: false,
    head_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
    merge_commit_sha: null,
    url: `https://github.com/${REPO}/pull/${100 - n}`,
    fetched_at: AT,
    ...fields,
  };
}

/** An infinite query's cache entry holding the first page only. */
function firstPage(page: unknown) {
  return { pages: [page], pageParams: [undefined] };
}

const NO_PRS: GithubPrsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byRepo: {}, byState: {} },
};

function updates(items: readonly TaskUpdate[], total: number): UpdatesPage {
  return {
    items,
    nextCursor: items.length < total ? (items.at(-1)?.id ?? null) : null,
    counts: {
      total,
      byAgent: { atlas: 24, beacon: 21 },
      byTask: { "IRP-04": 45 },
      bySource: { api: 33, cli: 12 },
    },
  };
}

function decisions(items: readonly Decision[], total: number): DecisionsPage {
  return {
    items,
    nextCursor: items.length < total ? (items.at(-1)?.id ?? null) : null,
    counts: { total, byGateType: { merge: 26, deploy: 6 }, byStatus: { Pending: 26, Decided: 6 } },
  };
}

function raid(items: readonly RaidItem[], total: number): RaidPage {
  return {
    items,
    nextCursor: items.length < total ? (items.at(-1)?.id ?? null) : null,
    counts: {
      total,
      byType: { risk: 27 },
      bySeverity: { medium: 23, high: 4 },
      byStatus: { open: 27 },
      byOwner: { atlas: 27 },
      byTask: { "IRP-04": 27 },
    },
  };
}

function lessons(items: readonly Lesson[], total: number): LessonsPage {
  return {
    items,
    nextCursor: items.length < total ? (items.at(-1)?.id ?? null) : null,
    counts: { total, byStatus: { proposed: 22, retired: 3 }, byTag: { benchmark: 25 } },
  };
}

function activities(items: readonly ActivityEntry[], total: number): ActivityPage {
  return {
    items,
    nextCursor: items.length < total ? (items.at(-1)?.id ?? null) : null,
    counts: { total, byActor: { atlas: 25, beacon: 20 }, byEntity: { task: 45 } },
  };
}

function prs(items: readonly PullRequest[], total: number): GithubPrsPage {
  return {
    items,
    nextCursor: items.length < total ? String(items.at(-1)?.id ?? "") : null,
    counts: {
      total,
      byRepo: { [REPO]: 17, [LITELLM]: 9 },
      byState: { open: 18, merged: 5, closed: 3 },
    },
  };
}

type Seed = readonly (readonly [QueryKey, unknown])[];

async function renderList(url: string, page: string, seed: Seed) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["task-workspace"], WORKSPACE);
  queryClient.setQueryData(["prs", "list", { state: "open" }], firstPage(NO_PRS));
  for (const [key, data] of seed) queryClient.setQueryData(key, data);
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: page });
  return router;
}

function region(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function articlesIn(container: () => HTMLElement) {
  return () => within(container()).queryAllByRole("article");
}

type ListPage = {
  readonly page: string;
  readonly url: string;
  readonly seed: Seed;
  /** Where the list and its "Show more" sit on the page. */
  readonly list: () => HTMLElement;
  readonly rows: () => readonly HTMLElement[];
  /** false for a view that shows a whole bounded set and so never pages. */
  readonly paged: boolean;
  readonly filtered: {
    readonly url: string;
    readonly seed: Seed;
    readonly facet: string;
    readonly chip: string;
    readonly search: Readonly<Record<string, string>>;
    readonly rows: number;
  };
};

const main = () => screen.getByRole("main");

const LIST_PAGES: Readonly<Record<string, ListPage>> = {
  "overview feed": {
    page: "Overview",
    url: "/",
    seed: [[["updates", {}], firstPage(updates(range(PAGE_SIZE, update), 45))]],
    list: () => region(/^Latest updates/),
    rows: articlesIn(() => region(/^Latest updates/)),
    paged: true,
    filtered: {
      url: "/?agent=atlas",
      seed: [
        [
          ["updates", { agentId: "atlas" }],
          firstPage(
            updates(
              range(4, (n) => update(2 * n)),
              4,
            ),
          ),
        ],
      ],
      facet: "Agent",
      chip: "Atlas 24",
      search: { agent: "atlas" },
      rows: 4,
    },
  },
  "tasks update log": {
    page: "Tasks",
    url: "/tasks",
    seed: [[["updates", {}], firstPage(updates(range(PAGE_SIZE, update), 45))]],
    list: () => region(/^Update log/),
    rows: articlesIn(() => region(/^Update log/)),
    paged: true,
    filtered: {
      url: "/tasks?source=cli",
      seed: [
        [
          ["updates", { source: "cli" }],
          firstPage(
            updates(
              range(12, (n) => update(n, { source: "cli" })),
              12,
            ),
          ),
        ],
      ],
      facet: "Source",
      chip: "CLI 12",
      search: { source: "cli" },
      rows: 12,
    },
  },
  kanban: {
    page: "Tasks",
    url: "/tasks",
    seed: [[["updates", {}], firstPage(updates([], 0))]],
    list: main,
    rows: () => within(main()).queryAllByRole("rowheader"),
    paged: false,
    filtered: {
      url: "/tasks?agent=atlas",
      seed: [[["updates", { agentId: "atlas" }], firstPage(updates([], 0))]],
      facet: "Agent",
      chip: "Atlas 3",
      search: { agent: "atlas" },
      rows: 3,
    },
  },
  decisions: {
    page: "Decisions",
    url: "/decisions",
    seed: [
      [["decisions", "counts", {}], decisions([], 32)],
      [
        ["decisions", "list", { status: "Pending" }],
        firstPage(decisions(range(PAGE_SIZE, decision), 26)),
      ],
    ],
    list: () => region(/^Pending/),
    rows: articlesIn(() => region(/^Pending/)),
    paged: true,
    filtered: {
      url: "/decisions?type=deploy",
      seed: [
        [["decisions", "counts", { gateType: "deploy" }], decisions([], 6)],
        [
          ["decisions", "list", { gateType: "deploy", status: "Pending" }],
          firstPage(
            decisions(
              range(2, (n) => decision(n, { gate_type: "deploy" })),
              2,
            ),
          ),
        ],
      ],
      facet: "Type",
      chip: "Deploy 6",
      search: { type: "deploy" },
      rows: 2,
    },
  },
  RAID: {
    page: "RAID register",
    url: "/raid",
    seed: [[["raid", "list", {}], firstPage(raid(range(PAGE_SIZE, raidItem), 27))]],
    list: main,
    rows: articlesIn(main),
    paged: true,
    filtered: {
      url: "/raid?severity=high",
      seed: [
        [
          ["raid", "list", { severity: "high" }],
          firstPage(
            raid(
              range(4, (n) => raidItem(n, { severity: "high" })),
              4,
            ),
          ),
        ],
      ],
      facet: "Severity",
      chip: "High 4",
      search: { severity: "high" },
      rows: 4,
    },
  },
  lessons: {
    page: "Lessons",
    url: "/lessons",
    seed: [[["lessons", "list", {}], firstPage(lessons(range(PAGE_SIZE, lesson), 25))]],
    list: main,
    rows: articlesIn(main),
    paged: true,
    filtered: {
      url: "/lessons?status=retired",
      seed: [
        [
          ["lessons", "list", { status: "retired" }],
          firstPage(
            lessons(
              range(3, (n) => lesson(n, { status: "retired" })),
              3,
            ),
          ),
        ],
      ],
      facet: "Status",
      chip: "Retired 3",
      search: { status: "retired" },
      rows: 3,
    },
  },
  activity: {
    page: "Activity",
    url: "/activity",
    seed: [[["activity", "list", {}], firstPage(activities(range(PAGE_SIZE, activity), 45))]],
    list: main,
    rows: articlesIn(main),
    paged: true,
    filtered: {
      url: "/activity?actor=atlas",
      seed: [
        [
          ["activity", "list", { actor: "atlas" }],
          firstPage(
            activities(
              range(5, (n) => activity(2 * n)),
              5,
            ),
          ),
        ],
      ],
      facet: "Actor",
      chip: "Atlas 25",
      search: { actor: "atlas" },
      rows: 5,
    },
  },
  "GitHub PRs": {
    page: "Pull requests",
    url: "/pull-requests",
    seed: [[["prs", "list", {}], firstPage(prs(range(PAGE_SIZE, pullRequest), 26))]],
    list: main,
    rows: () => within(main()).queryAllByText(/ #\d+$/),
    paged: true,
    filtered: {
      url: "/pull-requests?state=merged",
      seed: [
        [
          ["prs", "list", { state: "merged" }],
          firstPage(
            prs(
              range(5, (n) => pullRequest(n, { state: "merged" })),
              5,
            ),
          ),
        ],
      ],
      facet: "State",
      chip: "Merged 5",
      search: { state: "merged" },
      rows: 5,
    },
  },
};

describe.each(Object.entries(LIST_PAGES))("T14 %s", (_, list) => {
  it("shows at most 20 rows by default, with Show more when the list pages", async () => {
    await renderList(list.url, list.page, list.seed);

    const shown = list.rows().length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(PAGE_SIZE);
    expect(within(list.list()).queryByRole("button", { name: "Show more" }) !== null).toBe(
      list.paged,
    );
  });

  it("reads its filter from the URL, marks the chip and keeps the filter there", async () => {
    const { filtered } = list;
    const router = await renderList(filtered.url, list.page, filtered.seed);

    expect(list.rows()).toHaveLength(filtered.rows);
    const facet = within(screen.getByRole("group", { name: filtered.facet }));
    expect(facet.getByRole("link", { name: filtered.chip })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(router.state.location.search).toEqual(filtered.search);
  });
});
