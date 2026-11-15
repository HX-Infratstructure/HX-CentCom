import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type {
  Agent,
  GithubPrsPage,
  StatusLabel,
  Task,
  UpdatesPage,
  Workspace,
} from "./server-types";

const REPO = "HX-Infratstructure/HX-CentCom";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

const STATUSES: readonly StatusLabel[] = [
  { id: "In progress", label: "In progress", is_done: false, color: null },
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

function task(fields: Pick<Task, "id" | "title" | "stale"> & Partial<Task>): Task {
  return {
    agent: "atlas",
    repository: REPO,
    host: "HX-15",
    commit_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
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
    attention: [],
    ...fields,
  };
}

/** A commit behind every head, one at a head, and one the server has no GitHub data for. */
const TASKS: readonly Task[] = [
  task({ id: "IRP-81", title: "Pin the router build", stale: true, attention: ["stale"] }),
  task({ id: "IRP-82", title: "Wire the eval dashboard", stale: false }),
  task({ id: "IRP-83", title: "Write the release notes", stale: null, commit_sha: null }),
];

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

async function renderPage(url: string, page: string, tasks: readonly Task[] = TASKS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["task-workspace"], workspace(tasks));
  queryClient.setQueryData(["updates", {}], { pages: [NO_UPDATES], pageParams: [undefined] });
  queryClient.setQueryData(["prs", "list", { state: "open" }], {
    pages: [NO_PRS],
    pageParams: [undefined],
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await act(() => router.load());
  // The root route renders the whole document, so it mounts on `document` as the app does; a sheet needs that.
  render(<RouterProvider router={router} />, { container: document as unknown as HTMLElement });
  await screen.findByRole("heading", { level: 1, name: page, hidden: true });
}

/** The rendered task (a card, a list row, or a main-table row) whose link names `title`. */
function taskNamed(title: string): HTMLElement {
  const found = screen
    .getAllByRole("link", { name: title })
    .map((link) => link.closest<HTMLElement>("article, tr"))
    .find((task) => task !== null);
  if (found === undefined || found === null) throw new Error(`No task titled ${title}`);
  return found;
}

const RULE =
  "This task's commit is not its repository's head, an open pull request's head, or a merged pull request's merge commit.";

describe("the stale badge", () => {
  it("marks only the stale task's row in the main table, and says what stale means", async () => {
    await renderPage("/tasks", "Tasks");

    expect(within(taskNamed("Pin the router build")).getByText("Stale commit")).toHaveAttribute(
      "title",
      RULE,
    );
    expect(within(taskNamed("Wire the eval dashboard")).queryByText("Stale commit")).toBeNull();
    expect(within(taskNamed("Write the release notes")).queryByText("Stale commit")).toBeNull();
  });

  it("marks only the stale task's row in the overview's open tasks", async () => {
    await renderPage("/", "Overview");

    expect(within(taskNamed("Pin the router build")).getByText("Stale commit")).toBeInTheDocument();
    expect(within(taskNamed("Wire the eval dashboard")).queryByText("Stale commit")).toBeNull();
    expect(within(taskNamed("Write the release notes")).queryByText("Stale commit")).toBeNull();
  });

  it.each([
    ["IRP-81", "Pin the router build", true],
    ["IRP-82", "Wire the eval dashboard", false],
    ["IRP-83", "Write the release notes", false],
  ] as const)("shows on the detail sheet of %s (%s): %s", async (id, title, shown) => {
    await renderPage(`/tasks?item=${id}`, "Tasks");

    const sheet = await screen.findByRole("dialog", { name: title });
    expect(within(sheet).queryByText("Stale commit") !== null).toBe(shown);
  });
});

describe("the task sheet's status and group", () => {
  const PILOT = "Close out the router pilot";

  it.each(["In progress", "In Progress"])(
    "names the status once when the group In progress says the same (status %s)",
    async (status) => {
      const tasks = [task({ id: "IRP-84", title: PILOT, stale: null, status })];
      await renderPage("/tasks?item=IRP-84", "Tasks", tasks);

      const sheet = await screen.findByRole("dialog", { name: PILOT });
      expect(
        within(sheet)
          .getAllByText(/^in progress$/i)
          .map((el) => el.textContent),
      ).toEqual([status]);
    },
  );

  it("names both when the status Complete differs from the group In progress", async () => {
    const tasks = [task({ id: "IRP-84", title: PILOT, stale: null, status: "Complete" })];
    await renderPage("/tasks?item=IRP-84", "Tasks", tasks);

    const sheet = await screen.findByRole("dialog", { name: PILOT });
    expect(
      within(sheet)
        .getAllByText(/^(complete|in progress)$/i)
        .map((el) => el.textContent),
    ).toEqual(["Complete", "In progress"]);
  });
});
