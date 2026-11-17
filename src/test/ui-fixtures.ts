// A whole Workspace for UI tests that mock listWorkspace, so each test passes only the fields it sets.
import type { Workspace } from "@/components/server-types";

export function workspaceWith(fields: Partial<Omit<Workspace, "counts">>): Workspace {
  const updates = fields.updates ?? [];
  const decisions = fields.decisions ?? [];
  const tasks = fields.tasks ?? [];
  const needing = (reason: "blocked" | "owner") =>
    tasks.filter((t) => t.attention.includes(reason)).length;
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  return {
    updatesCursor: null,
    requirements: [],
    agents: [],
    statusLabels: [],
    repos: [],
    ...fields,
    tasks,
    updates,
    decisions,
    counts: {
      updates: { total: updates.length, byAgent: {}, byTask: {}, bySource: {} },
      decisions: { total: decisions.length, byGateType: {}, byStatus: {} },
      tasks: {
        total: tasks.length,
        open: tasks.filter((t) => t.open).length,
        blocked: needing("blocked"),
        owner: needing("owner"),
        byStatus,
      },
    },
  };
}
