import type { Actor, Task } from "@/server/services";

export type TaskFilter = {
  readonly agentId?: string | undefined;
  readonly group?: Task["group"] | undefined;
};

export function filterTasks(tasks: readonly Task[], filter: TaskFilter): readonly Task[] {
  return tasks.filter(
    (t) =>
      (filter.agentId === undefined || t.agent === filter.agentId) &&
      (filter.group === undefined || t.group === filter.group),
  );
}

export type CallerView = { readonly agentId: string; readonly role: Actor["role"] };

export function callerView(actor: Actor | null): CallerView | null {
  return actor && { agentId: actor.agentId, role: actor.role };
}
