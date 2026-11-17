// Workspace reads for UI tests, so each test passes only the fields it sets and the counts follow from them.
import type {
  Task,
  TaskCounts,
  TasksPage,
  Workspace,
  WorkspaceShell,
  WorkspaceTaskCounts,
} from "@/components/server-types";

function tally(keys: readonly (string | null)[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Object.fromEntries(counts);
}

const attending = (tasks: readonly Task[], reason: Task["attention"][number]) =>
  tasks.filter((t) => t.attention.includes(reason)).length;

/** The workspace's task counts for these tasks, under the server's rules (`counts.tasks`). */
export function taskCountsOf(tasks: readonly Task[]): WorkspaceTaskCounts {
  return {
    total: tasks.length,
    open: tasks.filter((t) => t.open).length,
    blocked: attending(tasks, "blocked"),
    owner: attending(tasks, "owner"),
    byStatus: tally(tasks.map((t) => t.status)),
  };
}

/**
 * The pages' bounded read. `tasks` only sets `counts.tasks`; the shell carries no task rows. The decision count is
 * `pendingDecisions` Pending decisions.
 */
export function shellWith(
  fields: Partial<Omit<WorkspaceShell, "counts">> & {
    readonly tasks?: readonly Task[];
    readonly pendingDecisions?: number;
  },
): WorkspaceShell {
  const { tasks = [], pendingDecisions = 0, ...rest } = fields;
  const updates = rest.updates ?? [];
  return {
    updatesCursor: null,
    agents: [],
    statusLabels: [],
    repos: [],
    ...rest,
    updates,
    counts: {
      updates: { total: updates.length, byAgent: {}, byTask: {}, bySource: {} },
      decisions: {
        total: pendingDecisions,
        byGateType: {},
        byStatus: pendingDecisions === 0 ? {} : { Pending: pendingDecisions },
      },
      tasks: taskCountsOf(tasks),
    },
  };
}

/** One page of the task read holding `items`, with counts over `all` (the whole filtered set, default `items`). */
export function tasksPageWith(
  items: readonly Task[],
  {
    all = items,
    nextCursor = null,
  }: { readonly all?: readonly Task[]; readonly nextCursor?: string | null } = {},
): TasksPage {
  const counts: TaskCounts = {
    total: all.length,
    byAgent: tally(all.map((t) => t.agent)),
    byRepo: tally(all.map((t) => t.repository)),
    byAttention: {
      blocked: attending(all, "blocked"),
      owner: attending(all, "owner"),
      stale: attending(all, "stale"),
    },
  };
  return { items, nextCursor, counts };
}

/** The whole snapshot that REST and MCP still serve. The overview tests build the shell and task reads from it. */
export function workspaceWith(fields: Partial<Omit<Workspace, "counts">>): Workspace {
  const decisions = fields.decisions ?? [];
  const tasks = fields.tasks ?? [];
  const shell = shellWith({ ...fields, tasks });
  return {
    requirements: [],
    ...fields,
    ...shell,
    tasks,
    decisions,
    counts: {
      ...shell.counts,
      decisions: { total: decisions.length, byGateType: {}, byStatus: {} },
    },
  };
}
