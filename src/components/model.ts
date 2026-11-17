import type { RecordKind } from "./open-record";
import type * as S from "./server-types";

export {
  GATE_TYPE_LABELS,
  DECISION_STATUS_LABELS,
  TASK_GROUP_LABELS,
  REQUIREMENT_STATE_LABELS,
  RAID_TYPE_LABELS,
  SEVERITY_LABELS,
  RAID_STATUS_LABELS,
  VALIDATION_STATE_LABELS,
  LESSON_STATUS_LABELS,
} from "@/lib/field-labels";

/**
 * The six board colors of monday.com's status palette. `[data-hue]` in styles.css maps each to a bright edge for
 * group rows and bars, and to a darker ink that white text reads on at 4.5:1.
 */
export type BoardHue = "green" | "orange" | "red" | "purple" | "blue" | "grey";

export const GROUP_HUES = {
  backlog: "grey",
  in_progress: "blue",
  ready_for_owner: "purple",
  done: "green",
} as const satisfies Record<S.TaskGroup, BoardHue>;

/** Status labels are rows with no color (seed.ts), so the board colors the seeded labels by id. */
const STATUS_HUES: ReadonlyMap<string, BoardHue> = new Map([
  ["Complete", "green"],
  ["In progress", "orange"],
  ["Blocked", "red"],
  ["Waiting", "grey"],
  ["Ready for owner", "purple"],
]);

/** Any other label is green when it counts as done, otherwise blue. */
export function statusHue(status: StatusRef): BoardHue {
  return STATUS_HUES.get(status.id) ?? (status.isDone ? "green" : "blue");
}

/** Each gate type's pill color; the pill always carries the type's name, so color is never the only signal. */
export const GATE_HUES = {
  merge: "green",
  deploy: "purple",
  live_run: "orange",
  host: "red",
  scope: "blue",
  assignment: "blue",
  policy: "grey",
} as const satisfies Record<S.GateType, BoardHue>;

/** A PR state's color; a state outside the filter vocabulary reads grey. */
export const PR_STATE_HUES = {
  open: "green",
  closed: "grey",
  merged: "purple",
  gone: "red",
} as const satisfies Record<S.GithubPrState, BoardHue>;

/** Pending waits on the owner; Decided is the outcome the register exists for; the other two are set aside. */
export const DECISION_STATUS_HUES = {
  Pending: "purple",
  Decided: "green",
  Deferred: "grey",
  Superseded: "grey",
} as const satisfies Record<S.DecisionStatus, BoardHue>;

export const RAID_TYPE_HUES = {
  risk: "red",
  assumption: "blue",
  issue: "orange",
  dependency: "purple",
} as const satisfies Record<S.RaidType, BoardHue>;

export const SEVERITY_HUES = {
  critical: "red",
  high: "orange",
  medium: "blue",
  low: "grey",
} as const satisfies Record<S.Severity, BoardHue>;

export const RAID_STATUS_HUES = {
  open: "orange",
  monitoring: "blue",
  closed: "green",
} as const satisfies Record<S.RaidStatus, BoardHue>;

export const LESSON_STATUS_HUES = {
  proposed: "blue",
  adopted: "green",
  retired: "grey",
} as const satisfies Record<S.LessonStatus, BoardHue>;

/** Values in a fixed display order, each with the rows that carry it; values with no rows are left out. */
export function groupRows<K extends string, R>(
  order: readonly K[],
  rows: readonly R[],
  keyOf: (row: R) => K,
): readonly { readonly key: K; readonly rows: readonly R[] }[] {
  const byKey = new Map<K, R[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  return order.flatMap((key) => {
    const list = byKey.get(key);
    return list === undefined ? [] : [{ key, rows: list }];
  });
}

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
} as const satisfies Record<S.Task["attention"][number], string>;
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
 * value outside it; `PullRequestView.state` keeps that raw text. `gone` means a PR stored as open is no longer in the
 * org on GitHub. GitHub answered 404, or redirected out of the org or to a Location the sync refuses. A redirect after
 * a rename inside the org is followed, and the PR keeps its real state.
 */
export const PR_STATE_LABELS = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  gone: "Gone (no longer in the HX org on GitHub)",
} as const satisfies Record<S.GithubPrState, string>;
export type PrState = keyof typeof PR_STATE_LABELS;

/** The state as a board group and cell name it; the filter keeps the longer label, which the cell shows on hover. */
export const PR_STATE_SHORT_LABELS = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  gone: "Gone",
} as const satisfies Record<PrState, string>;

export const ACTIVITY_ENTITY_LABELS = {
  task: "Task",
  requirement: "Requirement",
  decision: "Decision",
  agent_key: "Agent key",
  raid_item: "RAID item",
  lesson: "Lesson",
} as const satisfies Record<S.ActivityEntity, string>;

export const ACTIVITY_ACTION_LABELS = {
  "task.create": "Task created",
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

/** The action pill's color: what was recorded, by its kind of change, so a log reads at a glance. */
export const ACTIVITY_ACTION_HUES = {
  "task.create": "blue",
  "task.progress": "blue",
  "requirement.set": "blue",
  "decision.request": "purple",
  "decision.decide": "green",
  "key.issue": "grey",
  "key.revoke": "red",
  "key.bootstrap": "grey",
  "raid.create": "orange",
  "raid.update": "orange",
  "lesson.create": "green",
  "lesson.update": "green",
  "activity.revert": "red",
} as const satisfies Record<S.ActivityAction, BoardHue>;

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
};

/** Every reason the task needs attention. The server owns the rule; the overview filter and the stale badge read it. */
export function attentionOf(task: TaskView): readonly Attention[] {
  return task.attention;
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

/** The pages' bounded read: the directory and the shell's counts, with no task, requirement or decision. */
export type ShellView = Directory & { readonly counts: S.WorkspaceShell["counts"] };

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
