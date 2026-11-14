import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import {
  agentKeys,
  agents,
  engineeringTasks,
  ownerDecisions,
  statusLabels,
  taskRequirements,
  type TaskGroup,
} from "@/server/db/schema";
import { ServiceError, type Issue } from "./errors";
import {
  decideInput,
  issueKeyInput,
  postProgressInput,
  requestDecisionInput,
  revokeKeyInput,
  setRequirementInput,
} from "./inputs";
import type { BootstrapPlan, CreatePlan, UpdatePlan } from "./pipeline";
import { computeProgress, NO_REQUIREMENTS } from "./reads";
import type {
  DecidedDecision,
  IssuedKey,
  MintedKey,
  PostedProgress,
  RequestedDecision,
  RevokedKey,
  SetRequirementResult,
  StatusLabel,
} from "./types";

type TaskRoot = { readonly kind: "task"; readonly id: string };
type DecisionRoot = { readonly kind: "decision"; readonly id: string };

// A Map, so a label id such as `constructor` finds no prototype key.
const GROUP_BY_STATUS: ReadonlyMap<string, TaskGroup> = new Map<string, TaskGroup>([
  ["In progress", "in_progress"],
  ["Waiting", "backlog"],
  ["Ready for owner", "ready_for_owner"],
]);

/** A done label moves the task to `done`, a mapped label to its group; any other label keeps the current group. */
export function groupForStatus(label: StatusLabel, current: TaskGroup): TaskGroup {
  if (label.is_done) return "done";
  return GROUP_BY_STATUS.get(label.id) ?? current;
}

/** padStart never truncates (D-100), unlike SQL lpad. */
export function formatDecisionId(n: number): string {
  return `D-${String(n).padStart(2, "0")}`;
}

/** Drawn after validation and the idempotency claim, so replays and invalid requests never use a number. */
async function nextDecisionId(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ n: sql<number>`nextval('owner_decision_id_seq')::int`.mapWith(Number) })
    .from(sql`(select 1) as one`);
  if (!row) throw new Error("nextval returned no row");
  return formatDecisionId(row.n);
}

export function postProgressPlan(
  taskId: string,
): UpdatePlan<typeof postProgressInput, TaskRoot, PostedProgress> {
  return {
    action: "task.progress",
    input: postProgressInput,
    root: { kind: "task", id: taskId },
    async apply(tx, { input, before, bumpedVersion, insertUpdates }) {
      let label: StatusLabel | undefined;
      if (input.status !== undefined) {
        [label] = await tx.select().from(statusLabels).where(eq(statusLabels.id, input.status));
        if (!label) {
          throw ServiceError.invalid("The status is unknown.", [
            { path: "status", message: `no status ${input.status}` },
          ]);
        }
      }
      const [update] = await insertUpdates([
        {
          task_id: before.id,
          kind: input.kind,
          status: label?.id ?? null,
          note: input.note,
          links: input.links ?? [],
          commit_sha: input.commitSha ?? null,
          pr_url: input.prUrl ?? null,
          source: input.source,
          run_id: input.runId ?? null,
        },
      ]);
      if (!update) throw new Error("task update insert returned no row");
      const status = label?.id ?? before.status;
      const group = label ? groupForStatus(label, before.group) : before.group;
      if (label) {
        await tx
          .update(engineeringTasks)
          .set({ status, group })
          .where(eq(engineeringTasks.id, before.id));
      }
      return {
        status: 201,
        value: { update, task: { id: before.id, version: bumpedVersion, status } },
        activity: {
          entity: "task",
          entityId: before.id,
          before: { status: before.status, group: before.group, version: before.version },
          after: { status, group, version: bumpedVersion, update_id: update.id },
          runId: input.runId,
          commitSha: input.commitSha,
        },
      };
    },
  };
}

export function setRequirementPlan(
  taskId: string,
): UpdatePlan<typeof setRequirementInput, TaskRoot, SetRequirementResult> {
  return {
    action: "requirement.set",
    input: setRequirementInput,
    root: { kind: "task", id: taskId },
    async apply(tx, { actor, input, at, before, bumpedVersion }) {
      const { target } = input;
      const [existing] = await tx
        .select()
        .from(taskRequirements)
        .where(
          and(
            eq(taskRequirements.task_id, before.id),
            target.kind === "id"
              ? eq(taskRequirements.id, target.id)
              : eq(taskRequirements.requirement, target.text),
          ),
        );
      if (!existing && target.kind === "id") {
        throw ServiceError.notFound(`Requirement of task ${before.id}`, target.id);
      }
      const [requirement] = existing
        ? await tx
            .update(taskRequirements)
            .set({
              state: input.state,
              proof_url: input.proofUrl,
              updated_by: actor.agentId,
              version: sql`${taskRequirements.version} + 1`,
            })
            .where(eq(taskRequirements.id, existing.id))
            .returning()
        : await tx
            .insert(taskRequirements)
            .values({
              task_id: before.id,
              requirement: target.kind === "text" ? target.text : "",
              state: input.state,
              proof_url: input.proofUrl,
              updated_by: actor.agentId,
              created_at: at,
            })
            .returning();
      if (!requirement) throw new Error("requirement write returned no row");
      const states = await tx
        .select({ task_id: taskRequirements.task_id, state: taskRequirements.state })
        .from(taskRequirements)
        .where(eq(taskRequirements.task_id, before.id));
      const progress = computeProgress(states).get(before.id) ?? NO_REQUIREMENTS;
      return {
        status: existing ? 200 : 201,
        value: { requirement, task: { id: before.id, version: bumpedVersion, progress } },
        activity: {
          entity: "requirement",
          entityId: requirement.id,
          before: existing ?? null,
          after: requirement,
        },
      };
    },
  };
}

export const requestDecisionPlan: CreatePlan<typeof requestDecisionInput, RequestedDecision> = {
  action: "decision.request",
  input: requestDecisionInput,
  async apply(tx, { actor, input, at }) {
    const issues: Issue[] = [];
    const known =
      input.blocks.length === 0
        ? new Set<string>()
        : new Set(
            (
              await tx
                .select({ id: engineeringTasks.id })
                .from(engineeringTasks)
                .where(inArray(engineeringTasks.id, input.blocks))
            ).map((t) => t.id),
          );
    input.blocks.forEach((taskId, i) => {
      if (!known.has(taskId)) issues.push({ path: `blocks.${i}`, message: `no task ${taskId}` });
    });
    if (input.recommendedBy !== undefined) {
      const [recommender] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, input.recommendedBy));
      if (!recommender) {
        issues.push({ path: "recommendedBy", message: `no agent ${input.recommendedBy}` });
      }
    }
    if (issues.length > 0) throw ServiceError.invalid("The request body is invalid.", issues);
    const id = await nextDecisionId(tx);
    const [decision] = await tx
      .insert(ownerDecisions)
      .values({
        id,
        question: input.question,
        subject: input.subject,
        summary: input.summary,
        description: input.description,
        gate_type: input.gateType,
        options: input.options,
        blocks: input.blocks,
        recommended_by: input.recommendedBy ?? null,
        requested_by: actor.agentId,
        requested_at: at,
        source_url: input.sourceUrl,
        status: "Pending",
      })
      .returning();
    if (!decision) throw new Error("decision insert returned no row");
    return {
      status: 201,
      value: { decision },
      activity: { entity: "decision", entityId: id, before: null, after: decision },
    };
  },
};

export function decidePlan(
  decisionId: string,
): UpdatePlan<typeof decideInput, DecisionRoot, DecidedDecision> {
  return {
    action: "decision.decide",
    input: decideInput,
    root: { kind: "decision", id: decisionId },
    async apply(tx, { input, at, before, insertUpdates }) {
      const [decision] = await tx
        .update(ownerDecisions)
        .set({
          status: input.status,
          decision_text: input.decisionText,
          decision_source_url: input.sourceUrl,
          decided_at: at,
        })
        .where(eq(ownerDecisions.id, before.id))
        .returning();
      if (!decision) throw new Error("decision update returned no row");
      // The blocked tasks' versions stay: a write versions only the resource it addresses.
      const blocked =
        decision.blocks.length === 0
          ? []
          : await tx
              .select({ id: engineeringTasks.id })
              .from(engineeringTasks)
              .where(inArray(engineeringTasks.id, decision.blocks));
      const systemUpdates = await insertUpdates(
        blocked.map((task) => ({
          task_id: task.id,
          kind: "system" as const,
          status: null,
          note: `${decision.id} ${decision.status}: ${input.decisionText}`,
          links: [{ label: `${decision.id} decision source`, url: input.sourceUrl }],
          source: null,
        })),
      );
      return {
        status: 200,
        value: { decision, systemUpdates },
        activity: { entity: "decision", entityId: decision.id, before, after: decision },
      };
    },
  };
}

async function insertKey(
  tx: Tx,
  mintKey: (agentId: string) => MintedKey,
  agentId: string,
  label: string,
  at: string,
): Promise<{ id: string; agent_id: string; label: string; created_at: string; plaintext: string }> {
  const minted = mintKey(agentId);
  const [row] = await tx
    .insert(agentKeys)
    .values({ agent_id: agentId, key_hash: minted.keyHash, label, created_at: at })
    .returning({
      id: agentKeys.id,
      agent_id: agentKeys.agent_id,
      label: agentKeys.label,
      created_at: agentKeys.created_at,
    });
  if (!row) throw new Error("key insert returned no row");
  return { ...row, plaintext: minted.plaintext };
}

export const issueKeyPlan: CreatePlan<typeof issueKeyInput, IssuedKey> = {
  action: "key.issue",
  input: issueKeyInput,
  async apply(tx, { input, at, mintKey }) {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.active, true)));
    if (!agent) throw ServiceError.notFound("Agent", input.agentId);
    const { plaintext, ...key } = await insertKey(tx, mintKey, input.agentId, input.label, at);
    return {
      status: 201,
      value: { keyId: key.id, plaintext },
      activity: { entity: "agent_key", entityId: key.id, before: null, after: key },
    };
  },
};

export const revokeKeyPlan: CreatePlan<typeof revokeKeyInput, RevokedKey> = {
  action: "key.revoke",
  input: revokeKeyInput,
  async apply(tx, { input, at }) {
    const [row] = await tx
      .update(agentKeys)
      .set({ revoked_at: at })
      .where(and(eq(agentKeys.id, input.keyId), isNull(agentKeys.revoked_at)))
      .returning({ id: agentKeys.id, revoked_at: agentKeys.revoked_at });
    if (!row?.revoked_at) throw ServiceError.notFound("Active key", input.keyId);
    return {
      status: 200,
      value: { keyId: row.id, revokedAt: row.revoked_at },
      activity: {
        entity: "agent_key",
        entityId: row.id,
        before: { revoked_at: null },
        after: { revoked_at: row.revoked_at },
      },
    };
  },
};

export const bootstrapOwnerKeyPlan: BootstrapPlan<typeof issueKeyInput, IssuedKey> = {
  action: "key.bootstrap",
  input: issueKeyInput,
  async apply(tx, { input, at, mintKey }) {
    // Two concurrent bootstraps cannot both see "no owner key yet".
    await tx.execute(sql`lock table ${agentKeys} in share row exclusive mode`);
    const [agent] = await tx
      .select({ role: agents.role })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.active, true)));
    if (!agent) throw ServiceError.notFound("Agent", input.agentId);
    if (agent.role !== "owner") throw ServiceError.forbidden(`${input.agentId} is not the owner.`);
    const [active] = await tx
      .select({ id: agentKeys.id })
      .from(agentKeys)
      .innerJoin(agents, eq(agents.id, agentKeys.agent_id))
      .where(and(eq(agents.role, "owner"), isNull(agentKeys.revoked_at)))
      .limit(1);
    if (active) throw ServiceError.forbidden("An owner key already exists; issue keys with it.");
    const { plaintext, ...key } = await insertKey(tx, mintKey, input.agentId, input.label, at);
    return {
      status: 201,
      value: { keyId: key.id, plaintext },
      activity: { entity: "agent_key", entityId: key.id, before: null, after: key },
      actorId: input.agentId,
    };
  },
};
