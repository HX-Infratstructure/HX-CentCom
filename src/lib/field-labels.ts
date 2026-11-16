import type * as S from "@/components/server-types";

/*
 * The labels the pages print for coded record fields, in display order. The UI re-exports them from
 * `src/components/model.ts`, and the live checker reads them to know what the Activity page prints.
 * `satisfies Record<Union, string>` turns a value the server adds, or a key the server drops, into a build error.
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

export const REQUIREMENT_STATE_LABELS = {
  PASS: "Proven",
  FAIL: "Failed",
  BLOCKED: "Blocked",
  NOT_RUN: "Not run",
} as const satisfies Record<S.RequirementState, string>;

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

/** The page's labels for coded fields. A task's status is a status label id, so the directory resolves it instead. */
export const FIELD_LABELS: {
  readonly [E in S.ActivityEntity]?: Readonly<Record<string, Readonly<Record<string, string>>>>;
} = {
  task: { group: TASK_GROUP_LABELS },
  requirement: { state: REQUIREMENT_STATE_LABELS },
  decision: { status: DECISION_STATUS_LABELS, gate_type: GATE_TYPE_LABELS },
  raid_item: {
    type: RAID_TYPE_LABELS,
    status: RAID_STATUS_LABELS,
    severity: SEVERITY_LABELS,
    validation_state: VALIDATION_STATE_LABELS,
  },
  lesson: { status: LESSON_STATUS_LABELS },
};

/** The value under `key` when `table` has it as its own key; inherited keys such as `constructor` are not labels. */
export function labelIn<T>(
  table: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Longer text, or text on several lines, the Activity page names as edited instead of printing it. */
const SHORT_TEXT = 40;

export type ChangeValue = string | number | boolean | null;

/** A missing key and an empty string both read as no value, so neither shows as a change from the other. */
export function valueAt(snapshot: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = snapshot[key];
  return value === undefined || value === "" ? null : value;
}

export function isShort(value: unknown): value is ChangeValue {
  if (typeof value === "string") return value.length <= SHORT_TEXT && !value.includes("\n");
  return value === null || typeof value === "number" || typeof value === "boolean";
}

/**
 * What the Activity page prints for one side of a change. A task's status is a status label id, which only the
 * workspace directory resolves, so the caller passes `statusLabel`.
 */
export function valueText(
  entity: S.ActivityEntity,
  key: string,
  value: ChangeValue,
  statusLabel: (id: string) => string,
): string {
  if (value === null) return "none";
  if (typeof value !== "string") return String(value);
  if (entity === "task" && key === "status") return statusLabel(value);
  if (key === "commit_sha") return value.slice(0, 7);
  return labelIn(labelIn(labelIn(FIELD_LABELS, entity), key), value) ?? value;
}
