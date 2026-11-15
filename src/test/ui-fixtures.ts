// A whole Workspace for UI tests that mock listWorkspace, so each test passes only the fields it sets.
import type { Workspace } from "@/components/server-types";

export function workspaceWith(fields: Partial<Omit<Workspace, "counts">>): Workspace {
  const updates = fields.updates ?? [];
  const decisions = fields.decisions ?? [];
  return {
    tasks: [],
    updatesCursor: null,
    requirements: [],
    agents: [],
    statusLabels: [],
    repos: [],
    ...fields,
    updates,
    decisions,
    counts: {
      updates: { total: updates.length, byAgent: {}, byTask: {}, bySource: {} },
      decisions: { total: decisions.length, byGateType: {}, byStatus: {} },
    },
  };
}
