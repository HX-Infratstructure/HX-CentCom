import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { adaptUpdatePages } from "./adapt";
import type { AgentRef, Directory } from "./model";
import type { TaskUpdate } from "./server-types";
import { UpdateItem } from "./update-item";

// A name the seed roster does not use, so this file restates no agent (tests/fixround/agent-roster.test.ts).
const CC1: AgentRef = { id: "CC1", name: "Orchestrator", tone: "green", role: "agent" };
const OWNER: AgentRef = { id: "Agent Zero", name: "Agent Zero", tone: "stone", role: "owner" };
const DIRECTORY: Directory = {
  agents: new Map([CC1, OWNER].map((a) => [a.id, a] as const)),
  statuses: new Map(),
};

function row(fields: Pick<TaskUpdate, "agent_id" | "kind" | "source" | "note">): TaskUpdate {
  return {
    id: "0b6f3c1e-8d4a-4c2b-9e7f-1a2b3c4d5e6f",
    task_id: "IRP-04",
    status: null,
    links: [],
    commit_sha: null,
    pr_url: null,
    run_id: null,
    created_at: "2026-11-14T08:10:00.123456+00:00",
    ...fields,
  };
}

/** Renders one stored row through the same parse the routes use. */
function renderUpdate(stored: TaskUpdate) {
  const page = {
    items: [stored],
    nextCursor: null,
    counts: { total: 1, byAgent: {}, byTask: {}, bySource: {} },
  };
  const [update] = adaptUpdatePages([page], DIRECTORY).items;
  if (update === undefined) throw new Error("The row did not adapt.");
  return render(<UpdateItem update={update} showTask={false} />);
}

describe("who an update says posted it", () => {
  it("marks a system update as System, after the change of the agent that triggered it", () => {
    const { container } = renderUpdate(
      row({
        agent_id: "Agent Zero",
        kind: "system",
        source: null,
        note: "D-17 Decided: run the benchmark without HX-4 snapshots.",
      }),
    );
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("after Agent Zero's change")).toBeInTheDocument();
    expect(screen.queryByText(/via/)).not.toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toBeNull();
  });

  it("marks an update with no source as System, so no row shows an empty source", () => {
    renderUpdate(row({ agent_id: "CC1", kind: "progress", source: null, note: "Run 2 queued." }));
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("after Orchestrator's change")).toBeInTheDocument();
    expect(screen.queryByText(/via/)).not.toBeInTheDocument();
  });

  it("shows an agent update's badge and the source it came through", () => {
    const { container } = renderUpdate(
      row({ agent_id: "CC1", kind: "progress", source: "cli", note: "Run 2 queued on HX-4." }),
    );
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("Progress via CLI")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="green"]')).toHaveTextContent("Orchestrator");
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });
});
