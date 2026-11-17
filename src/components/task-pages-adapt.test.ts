import { describe, expect, it } from "vitest";
import { shellWith } from "@/test/ui-fixtures";
import { adaptTaskDetail, adaptTaskPages, directoryOf } from "./adapt";
import type { Agent, Requirement, StatusLabel, Task, TaskCounts, TasksPage } from "./server-types";

const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
  { id: "beacon", display_name: "Beacon", role: "agent", color: "sky", active: true },
];

const STATUSES: readonly StatusLabel[] = [
  { id: "In progress", label: "In progress", is_done: false, color: null },
  { id: "Complete", label: "Complete", is_done: true, color: null },
];

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

const COUNTS: TaskCounts = {
  total: 3,
  byAgent: { atlas: 2, beacon: 1 },
  byRepo: { "HX-CentCom": 3 },
  byAttention: { blocked: 1, owner: 0, stale: 0 },
};

const REQUIREMENT: Requirement = {
  id: "a8975406-7a84-4788-a7de-0a26b5a31197",
  task_id: "CC-02",
  requirement: "The router answers on the HX-7 route",
  source_url: null,
  proof_url: null,
  state: "NOT_RUN",
  version: 1,
  updated_by: "beacon",
  created_at: "2026-11-14T16:24:57.151Z",
};

const shell = () => shellWith({ agents: [...AGENTS], statusLabels: [...STATUSES] });

describe("adaptTaskPages", () => {
  const first: TasksPage = {
    items: [
      task({
        id: "CC-03",
        title: "Blocked first",
        blocked_on: "dependency",
        attention: ["blocked"],
      }),
      task({ id: "CC-01", title: "Wire the feed" }),
    ],
    nextCursor: "c1",
    counts: COUNTS,
  };
  const second: TasksPage = {
    items: [task({ id: "CC-02", title: "Done one", agent: "beacon", status: "Complete" })],
    nextCursor: null,
    counts: { ...COUNTS, total: 99 },
  };

  it("flattens the pages in server order and keeps the first page's counts", () => {
    const { items, counts } = adaptTaskPages([first, second], directoryOf(shell()));
    expect(items.map((t) => t.id)).toEqual(["CC-03", "CC-01", "CC-02"]);
    expect(counts).toEqual(COUNTS);
  });

  it("resolves each row's agent and status from the directory and carries no requirements", () => {
    const { items } = adaptTaskPages([first, second], directoryOf(shell()));
    const done = items[2];
    expect(done?.assignee).toEqual({ id: "beacon", name: "Beacon", tone: "sky", role: "agent" });
    expect(done?.statusLabel).toEqual({ id: "Complete", label: "Complete", isDone: true });
    expect(items.map((t) => t.requirements)).toEqual([[], [], []]);
  });

  it("has no counts before the first page arrives", () => {
    expect(adaptTaskPages([], directoryOf(shell()))).toEqual({ items: [], counts: null });
  });
});

describe("adaptTaskDetail", () => {
  it("carries the detail's requirements, resolved against the directory", () => {
    const view = adaptTaskDetail(
      {
        task: task({ id: "CC-02", title: "Done one" }),
        requirements: [REQUIREMENT],
        decisions: [],
      },
      directoryOf(shell()),
    );
    expect(view.id).toBe("CC-02");
    expect(view.requirements.map((r) => [r.requirement, r.updatedBy?.name])).toEqual([
      ["The router answers on the HX-7 route", "Beacon"],
    ]);
  });
});

describe("directoryOf", () => {
  it("maps each agent and status label by id", () => {
    expect(directoryOf(shell())).toEqual({
      agents: new Map([
        ["atlas", { id: "atlas", name: "Atlas", tone: "green", role: "agent" }],
        ["beacon", { id: "beacon", name: "Beacon", tone: "sky", role: "agent" }],
      ]),
      statuses: new Map([
        ["In progress", { id: "In progress", label: "In progress", isDone: false }],
        ["Complete", { id: "Complete", label: "Complete", isDone: true }],
      ]),
    });
  });
});
