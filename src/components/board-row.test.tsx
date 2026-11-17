import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, type Seed } from "@/test/render-app";
import { shellWith, tasksPageWith } from "@/test/ui-fixtures";
import type { Agent, Decision, DecisionsPage, RaidItem, RaidPage, Task } from "./server-types";

const server = vi.hoisted(() => ({
  getDecision: vi.fn(),
  getRaidItem: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  getDecision: server.getDecision,
  getRaidItem: server.getRaidItem,
  listTasks: server.listTasks,
  getTask: server.getTask,
}));

const REPO = "HX-Infratstructure/HX-CentCom";
const AT = "2026-11-14T08:10:00.123456+00:00";

// A name the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

const TASK: Task = {
  id: "IRP-04",
  title: "Semantic controller · Stage 2 qualification",
  agent: "atlas",
  group: "in_progress",
  status: "In progress",
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
};

const DECISION: Decision = {
  id: "D-09",
  subject: null,
  question: "Merge the router change?",
  summary: "The owner picks the gate before the next step runs.",
  description:
    "The requesting agent stops until the owner records a decision on the router change.",
  gate_type: "merge",
  options: [
    { label: "Approve", recommended: false },
    { label: "Hold", recommended: false },
  ],
  blocks: ["IRP-04"],
  recommended_by: null,
  requested_by: "atlas",
  requested_at: AT,
  source_url: `https://github.com/${REPO}/issues/10`,
  status: "Pending",
  decision_text: null,
  decision_source_url: null,
  decided_at: null,
  superseded_by: null,
  version: 1,
};

const RAID_ITEM: RaidItem = {
  id: "RAID-01",
  type: "risk",
  title: "Run 1 could miss the HX-4 window",
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

const SHELL = shellWith({
  tasks: [TASK],
  pendingDecisions: 1,
  agents: AGENTS,
  statusLabels: [{ id: "In progress", label: "In progress", is_done: false, color: null }],
});

const DECISIONS: DecisionsPage = {
  items: [DECISION],
  nextCursor: null,
  counts: { total: 1, byGateType: { merge: 1 }, byStatus: { Pending: 1 } },
};

const RAID: RaidPage = {
  items: [RAID_ITEM],
  nextCursor: null,
  counts: { total: 1, byType: { risk: 1 }, bySeverity: {}, byStatus: {}, byOwner: {}, byTask: {} },
};

const NO_UPDATES = { items: [], nextCursor: null, counts: SHELL.counts.updates };

function pages(page: unknown) {
  return { pages: [page], pageParams: [undefined] };
}

const SEED: Seed = [
  [["workspace-shell"], SHELL],
  [["updates", {}], pages(NO_UPDATES)],
  [["decisions", "counts", {}], DECISIONS],
  [["decisions", "list", { status: "Pending" }], pages(DECISIONS)],
  [["raid", "list", {}], pages(RAID)],
];

function renderPage(url: string, page: string) {
  return renderApp(url, { heading: page, seed: SEED, onDocument: true, hidden: true });
}

/** The cell in `column` of the board row headed by `row`. */
function cell(row: string, column: string): HTMLElement {
  const header = screen.getByRole("rowheader", { name: new RegExp(row) });
  const columns = within(header.closest("table") as HTMLElement)
    .getAllByRole("columnheader")
    .map((c) => c.textContent);
  const found = (header.closest("tr") as HTMLElement).children[columns.indexOf(column)];
  if (!(found instanceof HTMLElement)) throw new Error(`no ${column} cell in row ${row}`);
  return found;
}

beforeEach(() => {
  server.getDecision.mockResolvedValue(null);
  server.getRaidItem.mockResolvedValue(null);
  server.listTasks.mockResolvedValue(tasksPageWith([TASK]));
  server.getTask.mockResolvedValue({ task: TASK, requirements: [], decisions: [] });
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  server.getDecision.mockReset();
  server.getRaidItem.mockReset();
  server.listTasks.mockReset();
  server.getTask.mockReset();
});

describe("a click anywhere on a board row opens its record", () => {
  it("Decisions: the Summary cell opens the decision sheet with the full description", async () => {
    await renderPage("/decisions", "Decisions");

    fireEvent.click(cell("D-09", "Summary"));

    const sheet = await screen.findByRole("dialog", { name: "Merge the router change?" });
    expect(within(sheet).getByRole("region", { name: "Description" })).toHaveTextContent(
      DECISION.description,
    );
  });

  it("RAID: the Severity cell opens the RAID sheet", async () => {
    await renderPage("/raid", "RAID register");

    fireEvent.click(cell("RAID-01", "Severity"));

    expect(
      await screen.findByRole("dialog", { name: "Run 1 could miss the HX-4 window" }),
    ).toBeInTheDocument();
  });

  it("Tasks: the Repository cell of the main table opens the task sheet", async () => {
    await renderPage("/tasks", "Tasks");

    fireEvent.click(cell("IRP-04", "Repository"));

    expect(await screen.findByRole("dialog", { name: TASK.title })).toBeInTheDocument();
  });

  it("an inner link goes to its own target and does not open the row's record", async () => {
    const router = await renderPage("/decisions", "Decisions");

    fireEvent.click(within(cell("D-09", "Blocks")).getByRole("link", { name: "IRP-04" }));

    expect(await screen.findByRole("dialog", { name: TASK.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/tasks");
    expect(router.state.location.search).toEqual({ item: "IRP-04" });
  });

  it("the click that ends a text selection opens nothing", async () => {
    const router = await renderPage("/decisions", "Decisions");
    const summary = cell("D-09", "Summary");

    window.getSelection()?.selectAllChildren(summary);
    await act(async () => {
      fireEvent.click(summary);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });
});
