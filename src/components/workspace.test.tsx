import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { shellWith, tasksPageWith } from "@/test/ui-fixtures";
import type { DecisionsPage, GithubPrsPage, UpdatesPage } from "./server-types";

const server = vi.hoisted(() => ({
  listWorkspaceShell: vi.fn(),
  listTasks: vi.fn(),
  listDecisions: vi.fn(),
  listUpdates: vi.fn(),
  listGithubPrs: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspaceShell: server.listWorkspaceShell,
  listTasks: server.listTasks,
  listDecisions: server.listDecisions,
  listUpdates: server.listUpdates,
  listGithubPrs: server.listGithubPrs,
}));

const NO_UPDATES: UpdatesPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
};

const NO_DECISIONS: DecisionsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byGateType: {}, byStatus: {} },
};

const NO_PRS: GithubPrsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byRepo: {}, byState: {} },
};

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const SHELL = shellWith({
  agents: [{ id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true }],
});

async function renderPage(url: string, h1: string) {
  server.listWorkspaceShell.mockResolvedValue(SHELL);
  server.listTasks.mockResolvedValue(tasksPageWith([]));
  server.listDecisions.mockResolvedValue(NO_DECISIONS);
  server.listUpdates.mockResolvedValue(NO_UPDATES);
  server.listGithubPrs.mockResolvedValue(NO_PRS);
  await renderApp(url, { heading: h1 });
}

function currentRailItems(): readonly (string | null)[] {
  return within(screen.getByRole("navigation", { name: "Pages" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("aria-label"));
}

afterEach(() => {
  server.listWorkspaceShell.mockReset();
  server.listTasks.mockReset();
  server.listDecisions.mockReset();
  server.listUpdates.mockReset();
  server.listGithubPrs.mockReset();
});

describe("the rail's current page", () => {
  it.each(["/", "/?attention=stale", "/?agent=atlas"])(
    "marks Overview at %s, whatever filter the overview's URL holds",
    async (url) => {
      await renderPage(url, "Overview");

      expect(currentRailItems()).toEqual(["Overview"]);
    },
  );

  it("marks Tasks and not Overview on /tasks", async () => {
    await renderPage("/tasks", "Tasks");

    expect(currentRailItems()).toEqual(["Tasks"]);
  });
});
