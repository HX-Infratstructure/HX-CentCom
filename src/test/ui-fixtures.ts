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
 * The pages' bounded read. `tasks` only sets `counts.tasks`; the shell carries no task rows. `counts.decisions` models
 * only the Pending count, `pendingDecisions` Pending decisions; no page reads it now, because the Overview takes its
 * pending count from the Pending page. The server's `counts.decisions.total` counts every decision, whatever its status.
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

/**
 * One page of the task read holding `items`, with counts over `all` (default `items`). `all` is the set before the
 * agent, repo and attention filters, so the counts match the server's only while none of them is active; the server
 * counts `byAgent`, `byRepo` and `byAttention` each without its own filter. A test that filters by agent, repo or
 * attention sets the counts it needs on the page.
 */
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

/**
 * The whole snapshot that REST and MCP still serve. The overview tests build the shell and task reads from it.
 * `counts.decisions` counts `decisions`, as `listDecisions({}).counts` does for those rows.
 */
export function workspaceWith(fields: Partial<Omit<Workspace, "counts">>): Workspace {
  const { tasks = [], requirements = [], decisions = [], ...shellFields } = fields;
  const shell = shellWith({ ...shellFields, tasks });
  return {
    ...shell,
    tasks,
    requirements,
    decisions,
    counts: {
      ...shell.counts,
      decisions: {
        total: decisions.length,
        byGateType: tally(decisions.map((d) => d.gate_type)),
        byStatus: tally(decisions.map((d) => d.status)),
      },
    },
  };
}
