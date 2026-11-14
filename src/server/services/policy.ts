import type { ActivityAction } from "@/server/db/schema";
import type { Actor } from "./actor";
import { ServiceError } from "./errors";
import type { LockedRoot } from "./pipeline";

/** "own-row" admits the owner and any agent that the locked row names as one of its editors (`rowScope`). */
type Rule = "owner" | "own-row" | "any";

export const POLICY: Readonly<Record<ActivityAction, Rule>> = {
  "task.progress": "own-row",
  "requirement.set": "own-row",
  "decision.request": "any",
  "decision.decide": "owner",
  "key.issue": "owner",
  "key.revoke": "owner",
  "key.bootstrap": "owner",
  "raid.create": "any",
  "raid.update": "own-row",
  "lesson.create": "any",
  "lesson.update": "own-row",
  "activity.revert": "owner",
};

/** An agent calling an owner action gets 403 before its body is parsed or its idempotency key claimed. */
export function gate(actor: Actor, action: ActivityAction): void {
  if (POLICY[action] === "owner" && actor.role !== "owner") {
    throw ServiceError.forbidden(`${action} is owner-only.`);
  }
}

type Scope = { readonly editors: readonly (string | null)[]; readonly refusal: string };

const taskRefusal = (agentId: string, taskId: string) =>
  `${agentId} may write only its own tasks; ${taskId} is not one.`;

/**
 * SPEC §6.1 actor scope: the agents besides the owner who may write the row, and the refusal for anyone else. Seed
 * RAID items and lessons have created_by null. No agent edits a decision.
 */
function rowScope(root: LockedRoot, agentId: string, action: ActivityAction): Scope {
  const { id } = root.row;
  switch (root.kind) {
    case "task":
      return { editors: [root.row.agent], refusal: taskRefusal(agentId, id) };
    case "raid_item":
      return {
        editors: [root.row.owner_agent, root.row.created_by, root.blockedTaskAgent],
        refusal: `${agentId} may edit only RAID items it owns or created; ${id} is not one.`,
      };
    case "lesson":
      return {
        editors: [root.row.created_by],
        refusal: `${agentId} may edit only lessons it created; ${id} is not one.`,
      };
    case "decision":
      return { editors: [], refusal: `${action} is owner-only.` };
  }
}

export function authorize(actor: Actor, action: ActivityAction, root: LockedRoot | null): void {
  if (POLICY[action] !== "own-row" || actor.role === "owner") return;
  if (root === null) {
    throw ServiceError.forbidden(
      `${actor.agentId} may write only its own tasks; this task is not one.`,
    );
  }
  const { editors, refusal } = rowScope(root, actor.agentId, action);
  if (!editors.includes(actor.agentId)) throw ServiceError.forbidden(refusal);
}

/** A write that changes a task's state through another row (a RAID dependency) needs the owner or the task's agent. */
export function authorizeTaskWrite(
  actor: Actor,
  task: { readonly id: string; readonly agent: string | null },
): void {
  if (actor.role === "owner" || task.agent === actor.agentId) return;
  throw ServiceError.forbidden(taskRefusal(actor.agentId, task.id));
}
