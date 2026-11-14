import type { RecordKind } from "./open-record";
import type * as S from "./server-types";

/*
 * Vocabulary. Display order is key order. `satisfies Record<Union, string>` turns a value the server adds, or a key
 * the server drops, into a build error here, so a label map never drifts from the enum it describes.
 */
export const GATE_TYPE_LABELS = {
  merge: "Merge",
  deploy: "Deploy",
  live_run: "Live run",
  host: "Host",
  scope: "Scope",
  assignment: "Assignment",
  policy: "Policy",
} as const satisfies Record<S.GateType, string>;

export const DECISION_STATUS_LABELS = {
  Pending: "Pending",
  Decided: "Decided",
  Deferred: "Deferred",
  Superseded: "Superseded",
} as const satisfies Record<S.DecisionStatus, string>;

export const TASK_GROUP_LABELS = {
  backlog: "Backlog",
  in_progress: "In progress",
  ready_for_owner: "Ready for owner",
  done: "Done",
} as const satisfies Record<S.TaskGroup, string>;

export const BLOCKED_ON_LABELS = {
  owner_decision: "Waiting on an owner decision",
  assignment: "Needs an owner to assign it",
  dependency: "Blocked by a dependency",
} as const satisfies Record<Exclude<S.BlockedOn, "none">, string>;

/** Why an open task needs the owner's attention, in chip order. One task can have several reasons. */
export const ATTENTION_LABELS = {
  blocked: "Blocked",
  owner: "Waiting on the owner",
  stale: "Stale commit",
} as const;
export type Attention = keyof typeof ATTENTION_LABELS;

export const UPDATE_SOURCE_LABELS = {
  api: "API",
  mcp: "MCP",
  cli: "CLI",
  hook: "Hook",
  ui: "UI",
} as const satisfies Record<S.UpdateSource, string>;

export const UPDATE_KIND_LABELS = {
  progress: "Progress",
  note: "Note",
  link: "Link",
  system: "System",
} as const satisfies Record<S.UpdateKind, string>;

/**
 * The PR query's closed `state` filter. The `github_prs.state` column is still open text, so a stored row can hold a
 * value outside it; `PullRequestView.state` keeps that raw text. `gone` means GitHub answered 404 or a redirect for a
 * PR stored as open.
 */
export const PR_STATE_LABELS = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  gone: "Gone (404 or redirect on GitHub)",
} as const satisfies Record<S.GithubPrState, string>;
export type PrState = keyof typeof PR_STATE_LABELS;

export const REQUIREMENT_STATE_LABELS = {
  PASS: "Proven",
  FAIL: "Failed",
  BLOCKED: "Blocked",
  NOT_RUN: "Not run",
} as const satisfies Record<S.RequirementState, string>;

export const ACTIVITY_ENTITY_LABELS = {
  task: "Task",
  requirement: "Requirement",
  decision: "Decision",
  agent_key: "Agent key",
  raid_item: "RAID item",
  lesson: "Lesson",
} as const satisfies Record<S.ActivityEntity, string>;

export const ACTIVITY_ACTION_LABELS = {
  "task.progress": "Progress posted",
  "requirement.set": "Requirement set",
  "decision.request": "Decision requested",
  "decision.decide": "Decision recorded",
  "key.issue": "Agent key issued",
  "key.revoke": "Agent key revoked",
  "key.bootstrap": "First owner key issued",
  "raid.create": "RAID item created",
  "raid.update": "RAID item updated",
  "lesson.create": "Lesson created",
  "lesson.update": "Lesson updated",
  "activity.revert": "Change reverted",
} as const satisfies Record<S.ActivityAction, string>;

export const RAID_TYPE_LABELS = {
  risk: "Risk",
  assumption: "Assumption",
  issue: "Issue",
  dependency: "Dependency",
} as const satisfies Record<S.RaidType, string>;

export const SEVERITY_LABELS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
} as const satisfies Record<S.Severity, string>;

export const RAID_STATUS_LABELS = {
  open: "Open",
  monitoring: "Monitoring",
  closed: "Closed",
} as const satisfies Record<S.RaidStatus, string>;

export const VALIDATION_STATE_LABELS = {
  unverified: "Unverified",
  validated: "Validated",
  invalidated: "Invalidated",
} as const satisfies Record<S.ValidationState, string>;

export const LESSON_STATUS_LABELS = {
  proposed: "Proposed",
  adopted: "Adopted",
  retired: "Retired",
} as const satisfies Record<S.LessonStatus, string>;

declare const instantBrand: unique symbol;
/** ISO-8601 UTC text that every browser's Date parses. Only `toInstant` makes one. */
export type Instant = string & { readonly [instantBrand]: true };

/** PostgreSQL sends six fractional digits; ECMAScript only guarantees three, so the rest are cut. */
export function toInstant(raw: S.Timestamp): Instant {
  return raw.replace(/(\.\d{3})\d+/, "$1") as Instant;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

/**
 * `tone` is the agent's design-token name. The CSS `[data-tone]` rules are the list of known tones; any other value
 * renders neutral. `role` is null for an id that is not in the agents table.
 */
export type AgentRef = {
  readonly id: string;
  readonly name: string;
  readonly tone: string | null;
  readonly role: S.AgentRole | null;
};
export type AgentDirectory = ReadonlyMap<string, AgentRef>;

export type StatusRef = { readonly id: string; readonly label: string; readonly isDone: boolean };
export type StatusDirectory = ReadonlyMap<string, StatusRef>;

/** Only `web` ever becomes an <a href>, so a `javascript:` value posted by an agent renders as text. */
export type SourceRef =
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "hx15"; readonly path: string }
  | { readonly kind: "text"; readonly text: string };

export type Coverage = Pick<S.Progress, "proven" | "total">;

/*
 * Every view type follows one naming rule: snake_case fields are columns exactly as the server sends them, and
 * camelCase fields were resolved by adapt.ts and replace the raw column, which is omitted. Each fact has one reading.
 */
export type RequirementView = Omit<
  S.Requirement,
  "proof_url" | "source_url" | "updated_by" | "created_at"
> & {
  readonly proof: SourceRef | null;
  readonly source: SourceRef | null;
  readonly updatedBy: AgentRef | null;
  readonly createdAt: Instant;
};

export type TaskView = Omit<S.Task, "agent" | "status" | "source_url" | "updated_at"> & {
  /** null means unassigned. */
  readonly assignee: AgentRef | null;
  readonly statusLabel: StatusRef;
  readonly source: SourceRef;
  readonly updatedAt: Instant;
  readonly requirements: readonly RequirementView[];
  /** Ids of the Pending decisions that list this task in `blocks`. Complete: the workspace holds every Pending one. */
  readonly pendingDecisions: readonly string[];
};

/** Blocked tasks first, then the rest of the unfinished work in workspace order. */
export function openTasks(tasks: readonly TaskView[]): readonly TaskView[] {
  const open = tasks.filter((t) => t.blocked_on !== "none" || t.group !== "done");
  return [
    ...open.filter((t) => t.blocked_on !== "none"),
    ...open.filter((t) => t.blocked_on === "none"),
  ];
}

/**
 * The one definition of each reason. `stale` holds only for `true`: `null` means the server has no GitHub data for
 * the commit, which is not a finding.
 */
const NEEDS_ATTENTION: { readonly [A in Attention]: (task: TaskView) => boolean } = {
  blocked: (t) => t.blocked_on !== "none",
  owner: (t) =>
    t.group === "ready_for_owner" ||
    t.blocked_on === "owner_decision" ||
    t.blocked_on === "assignment" ||
    t.pendingDecisions.length > 0,
  stale: (t) => t.stale === true,
};

/** Every reason the task needs attention, in chip order. The overview filter and the stale badge both read it. */
export function attentionOf(task: TaskView): readonly Attention[] {
  return (Object.keys(ATTENTION_LABELS) as Attention[]).filter((a) => NEEDS_ATTENTION[a](task));
}

/**
 * Who posted an update. A system update is an automation post with no source; `trigger` is the agent whose action
 * caused it, not its author.
 */
export type UpdateOrigin =
  | { readonly by: "agent"; readonly author: AgentRef; readonly source: S.UpdateSource }
  | { readonly by: "system"; readonly trigger: AgentRef };

export type UpdateView = Omit<
  S.TaskUpdate,
  "agent_id" | "source" | "status" | "links" | "pr_url" | "created_at"
> & {
  readonly origin: UpdateOrigin;
  readonly statusLabel: StatusRef | null;
  readonly links: readonly { readonly label: string; readonly source: SourceRef }[];
  readonly pr: { readonly source: SourceRef; readonly number: number | null } | null;
  readonly createdAt: Instant;
};

export type Recommendation = { readonly option: string; readonly by: AgentRef };

export type DecisionView = Omit<
  S.Decision,
  | "requested_by"
  | "recommended_by"
  | "source_url"
  | "decision_source_url"
  | "requested_at"
  | "decided_at"
> & {
  readonly requester: AgentRef | null;
  /** Set only when an option is flagged recommended and `recommended_by` names who recommended it. */
  readonly recommendation: Recommendation | null;
  readonly source: SourceRef | null;
  readonly decisionSource: SourceRef | null;
  readonly requestedAt: Instant | null;
  readonly decidedAt: Instant | null;
};

/** Pending first by what they block (most blocked tasks, then oldest request); history by newest decision. */
export function splitInbox(decisions: readonly DecisionView[]): {
  readonly pending: readonly DecisionView[];
  readonly history: readonly DecisionView[];
} {
  const pending = decisions
    .filter((d) => d.status === "Pending")
    .sort((a, b) => b.blocks.length - a.blocks.length || byTime(a.requestedAt, b.requestedAt, 1));
  const history = decisions
    .filter((d) => d.status !== "Pending")
    .sort((a, b) => byTime(a.decidedAt, b.decidedAt, -1));
  return { pending, history };
}

/** `1` sorts oldest first, `-1` newest first; an unrecorded time sorts last either way. */
function byTime(a: Instant | null, b: Instant | null, direction: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * (Date.parse(a) - Date.parse(b));
}

export type BlockingRef =
  | { readonly kind: "task"; readonly id: string }
  | { readonly kind: "decision"; readonly id: string }
  | { readonly kind: "external"; readonly source: Exclude<SourceRef, { kind: "hx15" }> };

type RaidCommon = Omit<
  S.RaidItem,
  | "type"
  | "owner_agent"
  | "severity_rated_by"
  | "created_by"
  | "source_url"
  | "review_at"
  | "created_at"
  | "updated_at"
  | "probability"
  | "impact"
  | "mitigation"
  | "validation_method"
  | "validation_state"
  | "resolution"
  | "escalated"
  | "blocked_task_id"
  | "blocking_ref"
> & {
  readonly owner: AgentRef | null;
  readonly severityRatedBy: AgentRef | null;
  readonly creator: AgentRef | null;
  readonly source: SourceRef;
  readonly reviewAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

/** SPEC 6.1's per-type fields: a risk has no resolution, an issue has no mitigation. */
export type RaidView = RaidCommon &
  (
    | {
        readonly type: "risk";
        readonly probability: string | null;
        readonly impact: string | null;
        readonly mitigation: string | null;
      }
    | {
        readonly type: "assumption";
        readonly validation_method: string | null;
        readonly validation_state: S.ValidationState | null;
      }
    | {
        readonly type: "issue";
        readonly impact: string | null;
        readonly resolution: string | null;
        readonly escalated: boolean;
      }
    | {
        readonly type: "dependency";
        readonly blocked_task_id: string | null;
        readonly blocking: BlockingRef | null;
      }
  );

type LessonCommon = Omit<
  S.Lesson,
  "status" | "enforced_by_url" | "created_by" | "source_url" | "created_at" | "updated_at"
> & {
  readonly creator: AgentRef | null;
  readonly source: SourceRef;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

/** SPEC 6.1: a lesson is adopted only together with the rule, test or memory entry that enforces it. */
export type LessonView = LessonCommon &
  (
    | { readonly status: "adopted"; readonly enforcedBy: SourceRef }
    | { readonly status: "proposed" | "retired"; readonly enforcedBy: SourceRef | null }
  );

export type Directory = { readonly agents: AgentDirectory; readonly statuses: StatusDirectory };

export type PullRequestView = Omit<S.PullRequest, "state" | "url" | "fetched_at"> & {
  /** The column parsed: a known state, or the raw text of one the UI has no label for. */
  readonly state: PrState | { readonly raw: string };
  readonly source: SourceRef;
  readonly fetchedAt: Instant;
};

/**
 * The PR read's counts plus `stored`: every PR stored under the other filters, in any state, summed over `byState`
 * (which leaves out only the state filter). Under `state: "open"`, `total` is the open count and `stored` tells "no
 * sync yet" from "no open pull requests".
 */
export type PrCountsView = S.GithubPrCounts & { readonly stored: number };

/**
 * One field a logged update changed, as display text: `field` is the column name in words, and `from` and `to` use the
 * page's label where the field has a vocabulary. `edited` is a long text or a list, which is named but never printed.
 */
export type ActivityChange =
  | { readonly kind: "value"; readonly field: string; readonly from: string; readonly to: string }
  | { readonly kind: "edited"; readonly field: string };

/** One logged action. `actor`, `before`, `after` and `created_at` are resolved away. */
export type ActivityView = Omit<S.ActivityEntry, "actor" | "before" | "after" | "created_at"> & {
  readonly by: AgentRef;
  /** What the action changed, for the row and the Revert dialog. Empty for a create and for bookkeeping alone. */
  readonly changes: readonly ActivityChange[];
  /**
   * The sheet that shows the changed record: the record itself for a task, decision, RAID item or lesson; a
   * requirement's task; null for an agent key, or a requirement whose snapshots name no task.
   */
  readonly opens: { readonly kind: RecordKind; readonly id: string } | null;
  readonly createdAt: Instant;
};

export type WorkspaceView = Directory & {
  readonly tasks: readonly TaskView[];
  readonly decisions: readonly DecisionView[];
};

type WithoutStatus<T> = T extends unknown ? Omit<T, "status"> : never;

/**
 * A service error as the server types it, or a failure that never reached the service. The HTTP status is left out
 * because the code already says everything the UI needs.
 */
export type AppError =
  WithoutStatus<S.ServiceErrorBody> | { readonly code: "unreachable"; readonly message: string };

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: AppError };

/**
 * Owner capability. A route builds it only while an owner key is present, so holding one is owner mode; a component
 * that receives null has no way to offer an owner action. Every method resolves and never rejects. A resend after a
 * lost answer replays the first request instead of writing twice. After `ok` or `version_conflict` the page's data is
 * already refreshing.
 */
export interface OwnerActions {
  /** `target.version` is sent as If-Match. */
  decide(target: Pick<DecisionView, "id" | "version">, input: S.DecideInput): Promise<Outcome>;
  /** The server decides whether the change can be reverted; a refusal comes back as the outcome's error. */
  revert(activityId: string): Promise<Outcome>;
  /** Forget the owner key. Called only from an explicit action, so a refused key never discards typed text. */
  rejectKey(): void;
}
