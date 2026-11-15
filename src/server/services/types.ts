import type {
  activityLog,
  agents,
  engineeringTasks,
  githubPrs,
  githubRepos,
  ownerDecisions,
  statusLabels,
  taskRequirements,
  taskUpdates,
  DecisionStatus,
  GateType,
  UpdateSource,
} from "@/server/db/schema";
import type { Actor } from "./actor";
import type { GithubPrQueryInput, GithubPrsPage } from "./github";
import type { WebhookConfig } from "./webhook";
import type {
  ActivityQueryInput,
  CreateTaskInput,
  DecideInput,
  DecisionQueryInput,
  PostProgressInput,
  RequestDecisionInput,
  SetRequirementInput,
  UpdateQueryInput,
} from "./inputs";

export type MintedKey = { readonly plaintext: string; readonly keyHash: string };

/**
 * What `createServices` takes besides the database. `now` is read once per write, and every timestamp that write
 * stores comes from that one reading. `mintKey` must return a new key per call, its `plaintext` in the
 * `hxc_<slug>_<32 url-safe chars>` format and its `keyHash` the sha256 hex of it: resolveActor checks that format and
 * looks keys up by that hash. `fetch` sends the decided webhook to `webhook`'s URLs; a null `webhook` sends nothing.
 */
export type ServiceDeps = {
  readonly now: () => Date;
  readonly mintKey: (agentId: string) => MintedKey;
  readonly fetch: typeof fetch;
  readonly webhook: WebhookConfig | null;
};

export type Agent = typeof agents.$inferSelect;
export type StatusLabel = typeof statusLabels.$inferSelect;
export type TaskRow = typeof engineeringTasks.$inferSelect;
export type TaskUpdate = typeof taskUpdates.$inferSelect;
export type Requirement = typeof taskRequirements.$inferSelect;
export type Decision = typeof ownerDecisions.$inferSelect;
export type PullRequest = typeof githubPrs.$inferSelect;
export type RepoHead = typeof githubRepos.$inferSelect;
/** `revertible`: the row's own content allows a revert (`revertRefusal`). The version check still runs at revert time. */
export type ActivityEntry = typeof activityLog.$inferSelect & { readonly revertible: boolean };

/** PASS requirements over all requirements. `percent` is null without requirements: 0/0 is not 0 %. */
export type Progress = {
  readonly proven: number;
  readonly total: number;
  readonly percent: number | null;
};
/**
 * `open`: the task is blocked or not done. The workspace keeps a decision that blocks an open task, and myWork lists
 * an agent's open tasks.
 * `stale` (F9): null without a commit_sha or a GitHub mirror row for the task's repository; false when the SHA is a
 * case-insensitive prefix of that repository's head, an open PR's head or a merged PR's merge commit; else true.
 * `attention`: why the open task needs the owner's attention, in the order blocked, owner, stale; empty for a task that
 * is not open. listUpdates' `attention` filter selects the updates of exactly the tasks that list the reason.
 */
export type Task = TaskRow & {
  readonly progress: Progress;
  readonly open: boolean;
  readonly stale: boolean | null;
  readonly attention: readonly NonNullable<NonNullable<UpdateQueryInput>["attention"]>[];
};

/** Facet counts for filter chips (R12). Each facet applies every filter except its own; none uses the cursor. */
export type UpdateCounts = {
  readonly total: number;
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byTask: Readonly<Record<string, number>>;
  /** System updates have no source; they count in `total` only. */
  readonly bySource: Readonly<Partial<Record<UpdateSource, number>>>;
};

/** Decision facet counts, under the same rule as UpdateCounts. */
export type DecisionCounts = {
  readonly total: number;
  readonly byGateType: Readonly<Partial<Record<GateType, number>>>;
  readonly byStatus: Readonly<Partial<Record<DecisionStatus, number>>>;
};

/** Activity facet counts, under the same rule as UpdateCounts; `entityId` and `since` apply to every count. */
export type ActivityCounts = {
  readonly total: number;
  readonly byActor: Readonly<Record<string, number>>;
  readonly byEntity: Readonly<Record<string, number>>;
};

/** A keyset page in the list's order. `nextCursor` is opaque, and null on the last page. */
export type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
export type UpdatesPage = Page<TaskUpdate> & { readonly counts: UpdateCounts };
export type ActivityPage = Page<ActivityEntry> & { readonly counts: ActivityCounts };
/**
 * Pending first, then the latest request; a decision with no recorded request time sorts last. A status filter that
 * admits no Pending decision lists the newest decision first instead, with a cursor the default order refuses.
 */
export type DecisionsPage = Page<Decision> & { readonly counts: DecisionCounts };

/**
 * One snapshot. `updates`, `updatesCursor` and `counts.updates` equal `listUpdates({})` at that snapshot, and
 * `counts.decisions` equals `listDecisions({}).counts`. Tasks, requirements, agents, status labels and repository heads
 * are whole. `createTask` creates tasks; only the seed creates agents and status labels, and the GitHub sync writes the
 * repository heads. `setRequirement` creates requirements, so they grow through the API; they stay whole because the
 * task sheet reads them from this snapshot and has no read of its own. `decisions` holds every Pending decision and
 * every decision whose `blocks` holds a task that is not done; `listDecisions` pages the rest, and `listGithubPrs` the
 * pull requests.
 */
export type Workspace = {
  readonly tasks: readonly Task[];
  readonly updates: readonly TaskUpdate[];
  readonly updatesCursor: string | null;
  readonly requirements: readonly Requirement[];
  readonly decisions: readonly Decision[];
  readonly agents: readonly Agent[];
  readonly statusLabels: readonly StatusLabel[];
  readonly repos: readonly RepoHead[];
  readonly counts: { readonly updates: UpdateCounts; readonly decisions: DecisionCounts };
};

/** One task with its requirements and every decision whose `blocks` holds it, whatever its status. */
export type TaskDetail = {
  readonly task: Task;
  readonly requirements: readonly Requirement[];
  readonly decisions: readonly Decision[];
};

/**
 * The agent's tasks that are not done, their requirements that are not PASS, and the Pending decisions it requested or
 * that block one of those tasks.
 */
export type MyWork = {
  readonly agentId: string;
  readonly tasks: readonly Task[];
  readonly openRequirements: readonly Requirement[];
  readonly pendingDecisions: readonly Decision[];
};

export type CreateOptions = {
  /** Same key and same request within 24 h returns the stored response with `replayed: true`. */
  readonly idempotencyKey?: string | undefined;
};
export type UpdateOptions = CreateOptions & {
  /** If-Match: compared with the addressed resource's version; a mismatch is `version_conflict` (409). */
  readonly expectedVersion?: number | undefined;
};
/** `via` is set only by the MCP adapter. REST builds its options from headers alone, so no body can set it. */
export type PostProgressOptions = UpdateOptions & {
  /** Admits source mcp, which any other caller gets 400 for. */
  readonly via?: "mcp" | undefined;
};

/** REST: status `status`, body `value`, and `Idempotency-Replayed: true` when `replayed`. */
export type WriteResult<T> = {
  readonly value: T;
  readonly status: 200 | 201;
  readonly replayed: boolean;
};

export type TaskRef = { readonly id: string; readonly version: number };
/** The stored row: the caller's fields, blocked_on none, no commit, version 1. */
export type CreatedTask = { readonly task: TaskRow };
export type PostedProgress = {
  readonly update: TaskUpdate;
  readonly task: TaskRef & { readonly status: string };
  /** Present only when this update opened a Pending decision by moving the task into Ready for owner (F7a). */
  readonly decision?: Decision;
};
export type SetRequirementResult = {
  readonly requirement: Requirement;
  readonly task: TaskRef & { readonly progress: Progress };
};
export type RequestedDecision = { readonly decision: Decision };
export type DecidedDecision = {
  readonly decision: Decision;
  readonly systemUpdates: readonly TaskUpdate[];
};
/** `plaintext` exists only in this return value: never stored, logged or kept for replay. */
export type IssuedKey = { readonly keyId: string; readonly plaintext: string };
export type RevokedKey = { readonly keyId: string; readonly revokedAt: string };
/**
 * F5. `reverted` is the target activity id, `version` the entity's version after the revert (a requirement's own), and
 * `systemUpdates` the one update a task revert posts.
 */
export type RevertResult = {
  readonly reverted: string;
  readonly entity: "task" | "requirement" | "raid_item" | "lesson";
  readonly entityId: string;
  readonly version: number;
  readonly systemUpdates: readonly TaskUpdate[];
};

/**
 * SPEC §4's ten names and their arguments, plus `listDecisions` and `createTask`. Every write takes whatever
 * `resolveActor` returned; null is `unauthorized` (401) inside the pipeline, so no transport can forget it. Bodies are
 * parsed at runtime.
 */
export interface Services {
  resolveActor(authHeader: string | null): Promise<Actor | null>;
  listWorkspace(): Promise<Workspace>;
  listUpdates(query?: UpdateQueryInput): Promise<UpdatesPage>;
  listActivity(query?: ActivityQueryInput): Promise<ActivityPage>;
  listDecisions(query?: DecisionQueryInput): Promise<DecisionsPage>;
  /** One decision, whatever its status; 404 for an unknown id. */
  getDecision(decisionId: string): Promise<Decision>;
  /** 404 for an unknown task. */
  getTask(taskId: string): Promise<TaskDetail>;
  /** The work of `agentId`, else of the actor's agent; 400 at agentId with neither, 404 for an unknown agent. */
  myWork(actor: Actor | null, agentId?: string): Promise<MyWork>;
  listGithubPrs(query?: GithubPrQueryInput): Promise<GithubPrsPage>;
  /**
   * F-TASKS. 401, 403 for an agent that names another agent, 400, 409 `conflict` for a taken id. An agent's task is
   * its own; the owner assigns any active agent or none.
   */
  createTask(
    actor: Actor | null,
    input: CreateTaskInput,
    opts?: CreateOptions,
  ): Promise<WriteResult<CreatedTask>>;
  postProgress(
    actor: Actor | null,
    taskId: string,
    input: PostProgressInput,
    opts?: PostProgressOptions,
  ): Promise<WriteResult<PostedProgress>>;
  setRequirement(
    actor: Actor | null,
    taskId: string,
    input: SetRequirementInput,
    opts?: UpdateOptions,
  ): Promise<WriteResult<SetRequirementResult>>;
  requestDecision(
    actor: Actor | null,
    input: RequestDecisionInput,
    opts?: CreateOptions,
  ): Promise<WriteResult<RequestedDecision>>;
  decide(
    actor: Actor | null,
    decisionId: string,
    input: DecideInput,
    opts?: UpdateOptions,
  ): Promise<WriteResult<DecidedDecision>>;
  /** Not idempotent by design: a replay would have to store the plaintext. */
  issueKey(actor: Actor | null, agentId: string, label: string): Promise<IssuedKey>;
  revokeKey(actor: Actor | null, keyId: string): Promise<RevokedKey>;
  /** Owner only. 401, 403, then 400 for a non-uuid id, 404, 409 not_revertible, then the writer's checks. */
  revertActivity(
    actor: Actor | null,
    activityId: string,
    opts?: CreateOptions,
  ): Promise<WriteResult<RevertResult>>;
}
