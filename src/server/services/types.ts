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
import type {
  ActivityQueryInput,
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
 * looks keys up by that hash.
 */
export type ServiceDeps = {
  readonly now: () => Date;
  readonly mintKey: (agentId: string) => MintedKey;
};

export type Agent = typeof agents.$inferSelect;
export type StatusLabel = typeof statusLabels.$inferSelect;
export type TaskRow = typeof engineeringTasks.$inferSelect;
export type TaskUpdate = typeof taskUpdates.$inferSelect;
export type Requirement = typeof taskRequirements.$inferSelect;
export type Decision = typeof ownerDecisions.$inferSelect;
export type PullRequest = typeof githubPrs.$inferSelect;
export type RepoHead = typeof githubRepos.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;

/** PASS requirements over all requirements. `percent` is null without requirements: 0/0 is not 0 %. */
export type Progress = {
  readonly proven: number;
  readonly total: number;
  readonly percent: number | null;
};
export type Task = TaskRow & { readonly progress: Progress };

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

/** A keyset page in the list's order. `nextCursor` is opaque, and null on the last page. */
export type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
export type UpdatesPage = Page<TaskUpdate> & { readonly counts: UpdateCounts };
/** Pending first, then the latest request; a decision with no recorded request time sorts last. */
export type DecisionsPage = Page<Decision> & { readonly counts: DecisionCounts };

/**
 * One snapshot. `updates`, `updatesCursor` and `counts.updates` equal `listUpdates({})` at that snapshot, and
 * `counts.decisions` equals `listDecisions({}).counts`.
 */
export type Workspace = {
  readonly tasks: readonly Task[];
  readonly updates: readonly TaskUpdate[];
  readonly updatesCursor: string | null;
  readonly requirements: readonly Requirement[];
  readonly decisions: readonly Decision[];
  readonly agents: readonly Agent[];
  readonly statusLabels: readonly StatusLabel[];
  readonly prs: readonly PullRequest[];
  readonly repos: readonly RepoHead[];
  readonly counts: { readonly updates: UpdateCounts; readonly decisions: DecisionCounts };
};

export type CreateOptions = {
  /** Same key and same request within 24 h returns the stored response with `replayed: true`. */
  readonly idempotencyKey?: string | undefined;
};
export type UpdateOptions = CreateOptions & {
  /** If-Match: compared with the addressed resource's version; a mismatch is `version_conflict` (409). */
  readonly expectedVersion?: number | undefined;
};

/** REST: status `status`, body `value`, and `Idempotency-Replayed: true` when `replayed`. */
export type WriteResult<T> = {
  readonly value: T;
  readonly status: 200 | 201;
  readonly replayed: boolean;
};

export type TaskRef = { readonly id: string; readonly version: number };
export type PostedProgress = {
  readonly update: TaskUpdate;
  readonly task: TaskRef & { readonly status: string };
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
 * SPEC §4's ten names and their arguments, plus `listDecisions`. Every write takes whatever `resolveActor` returned;
 * null is `unauthorized` (401) inside the pipeline, so no transport can forget it. Bodies are parsed at runtime.
 */
export interface Services {
  resolveActor(authHeader: string | null): Promise<Actor | null>;
  listWorkspace(): Promise<Workspace>;
  listUpdates(query?: UpdateQueryInput): Promise<UpdatesPage>;
  listActivity(query?: ActivityQueryInput): Promise<Page<ActivityEntry>>;
  listDecisions(query?: DecisionQueryInput): Promise<DecisionsPage>;
  postProgress(
    actor: Actor | null,
    taskId: string,
    input: PostProgressInput,
    opts?: UpdateOptions,
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
}
