import {
  ServiceError,
  type Actor,
  type Decision,
  type Requirement,
  type Task,
  type Workspace,
} from "@/server/services";

export type TaskDetail = {
  readonly task: Task;
  readonly requirements: readonly Requirement[];
  readonly decisions: readonly Decision[];
};

export function taskDetail(ws: Workspace, taskId: string): TaskDetail {
  const task = ws.tasks.find((t) => t.id === taskId);
  if (!task) throw ServiceError.notFound("Task", taskId);
  return {
    task,
    requirements: ws.requirements.filter((r) => r.task_id === taskId),
    decisions: ws.decisions.filter((d) => d.blocks.includes(taskId)),
  };
}

export type MyWork = {
  readonly agentId: string;
  readonly tasks: readonly Task[];
  readonly openRequirements: readonly Requirement[];
  readonly pendingDecisions: readonly Decision[];
};

export function myWork(ws: Workspace, agentId: string): MyWork {
  if (!ws.agents.some((a) => a.id === agentId)) throw ServiceError.notFound("Agent", agentId);
  const tasks = ws.tasks.filter((t) => t.agent === agentId && t.group !== "done");
  const taskIds = new Set(tasks.map((t) => t.id));
  return {
    agentId,
    tasks,
    openRequirements: ws.requirements.filter((r) => taskIds.has(r.task_id) && r.state !== "PASS"),
    pendingDecisions: ws.decisions.filter(
      (d) =>
        d.status === "Pending" &&
        (d.requested_by === agentId || d.blocks.some((id) => taskIds.has(id))),
    ),
  };
}

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
