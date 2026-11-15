// A whole Workspace for UI tests that mock listWorkspace, so each test passes only the rows it sets.
import type { Workspace } from "@/components/server-types";

export function workspaceWith(rows: Partial<Omit<Workspace, "counts">> = {}): Workspace {
  const decisions = rows.decisions ?? [];
  return {
    tasks: [],
    updates: [],
    updatesCursor: null,
    requirements: [],
    agents: [],
    statusLabels: [],
    repos: [],
    ...rows,
    decisions,
    counts: {
      updates: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
      decisions: { total: decisions.length, byGateType: {}, byStatus: {} },
    },
  };
}
