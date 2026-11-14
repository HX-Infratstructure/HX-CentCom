import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type {
  Agent,
  Decision,
  PullRequest,
  StatusLabel,
  Task,
  UpdatesPage,
  Workspace,
} from "./server-types";

const REPO = "HX-Infratstructure/HX-CentCom";

// Names the seed roster does not use (tests/fixround/agent-roster.test.ts).
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

function workspace(rows: Partial<Pick<Workspace, "tasks" | "decisions" | "prs">>): Workspace {
  return {
    tasks: [],
    updates: [],
    updatesCursor: null,
    requirements: [],
    decisions: [],
    agents: AGENTS,
    statusLabels: STATUSES,
    prs: [],
    repos: [],
    counts: {
      updates: NO_UPDATES.counts,
      decisions: { total: rows.decisions?.length ?? 0, byGateType: {}, byStatus: {} },
    },
    ...rows,
  };
}

/** The route's own loader and `select: adaptWorkspace` run against the stored snapshot. */
async function renderOverview(raw: Workspace) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["task-workspace"], raw);
  queryClient.setQueryData(["updates", {}], { pages: [NO_UPDATES], pageParams: [undefined] });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Overview" });
}

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

describe("the overview's open pull requests", () => {
  it("lists only open pull requests, in workspace order", async () => {
    await renderOverview(
      workspace({
        prs: [
          pr({ number: 41, state: "open" }),
          pr({ number: 42, state: "merged" }),
          pr({ number: 43, state: "open" }),
          pr({ number: 44, state: "closed" }),
          pr({ number: 45, state: "gone" }),
          pr({ number: 46, state: "archived" }),
          pr({ number: 47, state: "open" }),
        ],
      }),
    );

    const prs = section("Open pull requests");
    expect(prs.prNumbers).toEqual([`${REPO} #41`, `${REPO} #43`, `${REPO} #47`]);
    expect(prs.heading).toBe("Open pull requests 3");
  });

  it("shows the first eight open pull requests while the heading counts all of them", async () => {
    await renderOverview(
      workspace({
        prs: [
          pr({ number: 50, state: "merged" }),
          ...[51, 52, 53, 54, 55, 56, 57, 58, 59].map((number) => pr({ number, state: "open" })),
        ],
      }),
    );

    const prs = section("Open pull requests");
    expect(prs.prNumbers).toEqual([
      `${REPO} #51`,
      `${REPO} #52`,
      `${REPO} #53`,
      `${REPO} #54`,
      `${REPO} #55`,
      `${REPO} #56`,
      `${REPO} #57`,
      `${REPO} #58`,
    ]);
    expect(prs.heading).toBe("Open pull requests 9");
  });

  it("says no sync has stored a pull request when none is stored", async () => {
    await renderOverview(workspace({ prs: [] }));

    const prs = section("Open pull requests");
    expect(prs.empty).toBe("No GitHub sync has stored pull requests yet.");
    expect(prs.heading).toBe("Open pull requests 0");
  });

  it("says the last sync found none open when every stored pull request is closed", async () => {
    await renderOverview(
      workspace({
        prs: [pr({ number: 61, state: "merged" }), pr({ number: 62, state: "closed" })],
      }),
    );

    const prs = section("Open pull requests");
    expect(prs.empty).toBe("The last GitHub sync found no open pull requests.");
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
