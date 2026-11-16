import { FIELD_LABELS, labelIn } from "@/lib/field-labels";
import type * as S from "./server-types";
import {
  PR_STATE_LABELS,
  assertNever,
  toInstant,
  type ActivityChange,
  type ActivityView,
  type AgentDirectory,
  type AgentRef,
  type AppError,
  type BlockingRef,
  type DecisionView,
  type Directory,
  type LessonView,
  type PrCountsView,
  type PrState,
  type PullRequestView,
  type RaidView,
  type RequirementView,
  type SourceRef,
  type StatusDirectory,
  type StatusRef,
  type TaskView,
  type UpdateOrigin,
  type UpdateView,
  type WorkspaceView,
} from "./model";

/** Use it as a react-query `select`, so it runs once per fetched snapshot instead of once per render. */
export function adaptWorkspace(ws: S.Workspace): WorkspaceView {
  const dir: Directory = {
    agents: new Map(ws.agents.map((a) => [a.id, agentFromRow(a)] as const)),
    statuses: new Map(
      ws.statusLabels.map((s) => [s.id, { id: s.id, label: s.label, isDone: s.is_done }] as const),
    ),
  };
  const requirements = new Map<string, RequirementView[]>();
  for (const r of ws.requirements) {
    const list = requirements.get(r.task_id) ?? [];
    list.push(requirementView(r, dir.agents));
    requirements.set(r.task_id, list);
  }
  return {
    ...dir,
    tasks: ws.tasks.map((t) => taskView(t, dir, requirements.get(t.id) ?? [])),
    decisions: ws.decisions.map((d) => decisionView(d, dir.agents)),
  };
}

/** One decision, for the sheet's by-id read of a decision the workspace does not hold. */
export function adaptDecision(d: S.Decision, agents: AgentDirectory): DecisionView {
  return decisionView(d, agents);
}

/** Pages of an infinite query, newest first. Every page carries the same counts, so the first page's are used. */
export function adaptUpdatePages(
  pages: readonly S.UpdatesPage[],
  dir: Directory,
): { readonly items: readonly UpdateView[]; readonly counts: S.UpdateCounts | null } {
  return {
    items: pages.flatMap((page) => page.items.map((u) => updateView(u, dir))),
    counts: pages[0]?.counts ?? null,
  };
}

/** Pages of an infinite decisions query, in the server's order, with the first page's counts. */
export function adaptDecisionPages(
  pages: readonly S.DecisionsPage[],
  agents: AgentDirectory,
): { readonly items: readonly DecisionView[]; readonly counts: S.DecisionCounts | null } {
  return {
    items: pages.flatMap((page) => page.items.map((d) => decisionView(d, agents))),
    counts: pages[0]?.counts ?? null,
  };
}

/** Pages of the PR read, in the server's order (newest id first), with the first page's counts. */
export function adaptPullRequestPages(pages: readonly S.GithubPrsPage[]): {
  readonly items: readonly PullRequestView[];
  readonly counts: PrCountsView | null;
} {
  const counts = pages[0]?.counts;
  return {
    items: pages.flatMap((page) => page.items.map(pullRequestView)),
    counts:
      counts === undefined
        ? null
        : { ...counts, stored: Object.values(counts.byState).reduce((sum, n) => sum + n, 0) },
  };
}

/** Pages of the activity log, newest first, with the first page's counts. */
export function adaptActivityPages(
  pages: readonly S.ActivityPage[],
  dir: Directory,
): { readonly items: readonly ActivityView[]; readonly counts: S.ActivityCounts | null } {
  return {
    items: pages.flatMap((page) => page.items.map((entry) => activityView(entry, dir))),
    counts: pages[0]?.counts ?? null,
  };
}

export function adaptRaid(
  items: readonly S.RaidItem[],
  agents: AgentDirectory,
): readonly RaidView[] {
  return items.map((item) => raidView(item, agents));
}

export function adaptLessons(
  items: readonly S.Lesson[],
  agents: AgentDirectory,
): readonly LessonView[] {
  return items.map((lesson) => lessonView(lesson, agents));
}

type ErrorBody = Readonly<Record<string, unknown>>;

/**
 * One parser per service error code. A new server code does not compile until it has one, so it can never fall
 * through to `unreachable` and lose its message. A parser that returns null found the body malformed.
 */
const ERROR_PARSERS: {
  readonly [C in S.ErrorCode]: (
    body: ErrorBody,
    message: string,
  ) => Extract<AppError, { code: C }> | null;
} = {
  invalid: (body, message) => ({ code: "invalid", message, issues: parseIssues(body["issues"]) }),
  unauthorized: (_, message) => ({ code: "unauthorized", message }),
  forbidden: (_, message) => ({ code: "forbidden", message }),
  not_found: (_, message) => ({ code: "not_found", message }),
  version_conflict: (body, message) => {
    const currentVersion = body["currentVersion"];
    return typeof currentVersion === "number"
      ? { code: "version_conflict", message, currentVersion }
      : null;
  },
  not_revertible: (_, message) => ({ code: "not_revertible", message }),
  conflict: (_, message) => ({ code: "conflict", message }),
  idempotency_mismatch: (_, message) => ({ code: "idempotency_mismatch", message }),
};

function isErrorCode(value: unknown): value is S.ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_PARSERS, value);
}

/**
 * The one parser for failures. It accepts the REST error body (`{ error: { code, message } }`), a bare service error
 * body, or a thrown value; anything that is not a known service error is `unreachable`.
 */
export function toAppError(error: unknown): AppError {
  const wrapped = isRecord(error) ? error["error"] : undefined;
  const body = isRecord(wrapped) ? wrapped : error;
  if (isRecord(body)) {
    const { code, message } = body;
    const parsed =
      isErrorCode(code) && typeof message === "string" ? ERROR_PARSERS[code](body, message) : null;
    if (parsed !== null) return parsed;
  }
  if (error instanceof Error) return { code: "unreachable", message: error.message };
  return { code: "unreachable", message: "The server sent no readable answer." };
}

export function sourceRef(raw: string): SourceRef {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value) && isUrl(value)) return { kind: "web", url: value };
  const local = /^hx15:(.+)$/.exec(value)?.[1];
  if (local !== undefined) return { kind: "hx15", path: local };
  return { kind: "text", text: value };
}

function agentFromRow(a: S.Agent): AgentRef {
  return { id: a.id, name: a.display_name, tone: a.color === "" ? null : a.color, role: a.role };
}

function agentRef(id: string, agents: AgentDirectory): AgentRef {
  return agents.get(id) ?? { id, name: id, tone: null, role: null };
}

function statusRef(id: string, statuses: StatusDirectory): StatusRef {
  return statuses.get(id) ?? { id, label: id, isDone: false };
}

function optionalSource(raw: string | null): SourceRef | null {
  return raw === null ? null : sourceRef(raw);
}

function optionalInstant(raw: S.Timestamp | null) {
  return raw === null ? null : toInstant(raw);
}

function requirementView(r: S.Requirement, agents: AgentDirectory): RequirementView {
  const { proof_url, source_url, updated_by, created_at, ...rest } = r;
  return {
    ...rest,
    proof: optionalSource(proof_url),
    source: optionalSource(source_url),
    updatedBy: updated_by === null ? null : agentRef(updated_by, agents),
    createdAt: toInstant(created_at),
  };
}

function taskView(t: S.Task, dir: Directory, requirements: readonly RequirementView[]): TaskView {
  const { agent, status, source_url, updated_at, ...rest } = t;
  return {
    ...rest,
    assignee: agent === null ? null : agentRef(agent, dir.agents),
    statusLabel: statusRef(status, dir.statuses),
    source: sourceRef(source_url),
    updatedAt: toInstant(updated_at),
    requirements,
  };
}

function updateView(u: S.TaskUpdate, dir: Directory): UpdateView {
  const { agent_id, source, status, links, pr_url, created_at, ...rest } = u;
  return {
    ...rest,
    origin: updateOrigin(rest.kind, source, agentRef(agent_id, dir.agents)),
    statusLabel: status === null ? null : statusRef(status, dir.statuses),
    links: links.map((l) => ({ label: l.label, source: sourceRef(l.url) })),
    pr: pr_url === null ? null : prRef(pr_url),
    createdAt: toInstant(created_at),
  };
}

/** The CHECK task_updates_system_has_no_source makes the two tests agree; `source === null` narrows the type. */
function updateOrigin(
  kind: S.UpdateKind,
  source: S.UpdateSource | null,
  agent: AgentRef,
): UpdateOrigin {
  return kind === "system" || source === null
    ? { by: "system", trigger: agent }
    : { by: "agent", author: agent, source };
}

function decisionView(d: S.Decision, agents: AgentDirectory): DecisionView {
  const {
    requested_by,
    recommended_by,
    source_url,
    decision_source_url,
    requested_at,
    decided_at,
    ...rest
  } = d;
  return {
    ...rest,
    requester: requested_by === null ? null : agentRef(requested_by, agents),
    recommendation: recommendation(d, agents),
    source: optionalSource(source_url),
    decisionSource: optionalSource(decision_source_url),
    requestedAt: optionalInstant(requested_at),
    decidedAt: optionalInstant(decided_at),
  };
}

/**
 * The schema's CHECK makes "an option is recommended" and "recommended_by is set" equal. Requiring both here keeps
 * the page from ever showing a recommendation without its recommender, even if the two drift apart.
 */
function recommendation(d: S.Decision, agents: AgentDirectory): DecisionView["recommendation"] {
  const option = d.options.find((o) => o.recommended);
  if (option === undefined || d.recommended_by === null) return null;
  return { option: option.label, by: agentRef(d.recommended_by, agents) };
}

function activityView(entry: S.ActivityEntry, dir: Directory): ActivityView {
  const { actor, before, after, created_at, ...rest } = entry;
  return {
    ...rest,
    by: agentRef(actor, dir.agents),
    opens: recordOf(entry),
    changes: changesOf(entry, dir),
    createdAt: toInstant(created_at),
  };
}

/**
 * Keys a write sets whatever it changed, or that point at its side effects. None of them says what changed. The
 * timestamps are the write's own clock, which the row's time already shows. An `_at` field a caller sets, such as a
 * RAID item's `review_at`, is not listed, so a new value shows as a change.
 */
const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set([
  "id",
  "version",
  "created_by",
  "updated_by",
  "update_id",
  "effects",
  "reverts",
  "created_at",
  "updated_at",
  "requested_at",
  "decided_at",
  "revoked_at",
]);

/** Longer text, or text on several lines, is named as edited instead of printed. */
const SHORT_TEXT = 40;

/** Only an update has both snapshots; a create has no before, so it shows no change. */
function changesOf(entry: S.ActivityEntry, dir: Directory): readonly ActivityChange[] {
  const { before, after } = entry;
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = new Set([...Object.keys(after), ...Object.keys(before)]);
  return [...keys].flatMap((key): ActivityChange[] => {
    const from = valueAt(before, key);
    const to = valueAt(after, key);
    if (BOOKKEEPING_KEYS.has(key) || JSON.stringify(from) === JSON.stringify(to)) return [];
    const field = key.replace(/_/g, " ");
    if (!isShort(from) || !isShort(to)) return [{ kind: "edited", field }];
    return [
      {
        kind: "value",
        field,
        from: valueText(entry.entity, key, from, dir),
        to: valueText(entry.entity, key, to, dir),
      },
    ];
  });
}

/** A missing key and an empty string both read as no value, so neither shows as a change from the other. */
function valueAt(snapshot: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = snapshot[key];
  return value === undefined || value === "" ? null : value;
}

type Scalar = string | number | boolean | null;

function isShort(value: unknown): value is Scalar {
  if (typeof value === "string") return value.length <= SHORT_TEXT && !value.includes("\n");
  return value === null || typeof value === "number" || typeof value === "boolean";
}

function valueText(entity: S.ActivityEntity, key: string, value: Scalar, dir: Directory): string {
  if (value === null) return "none";
  if (typeof value !== "string") return String(value);
  if (entity === "task" && key === "status") return statusRef(value, dir.statuses).label;
  if (key === "commit_sha") return value.slice(0, 7);
  return labelIn(labelIn(FIELD_LABELS[entity], key), value) ?? value;
}

/** A requirement opens its task's sheet; `after` names it, and `before` too when the write changed a requirement. */
function recordOf(entry: S.ActivityEntry): ActivityView["opens"] {
  switch (entry.entity) {
    case "task":
      return { kind: "task", id: entry.entity_id };
    case "decision":
      return { kind: "decision", id: entry.entity_id };
    case "raid_item":
      return { kind: "raid", id: entry.entity_id };
    case "lesson":
      return { kind: "lesson", id: entry.entity_id };
    case "requirement": {
      const taskId = textField(entry.after, "task_id") ?? textField(entry.before, "task_id");
      return taskId === null ? null : { kind: "task", id: taskId };
    }
    case "agent_key":
      return null;
    default:
      return assertNever(entry.entity);
  }
}

function textField(snapshot: unknown, key: string): string | null {
  if (!isRecord(snapshot)) return null;
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
}

function pullRequestView(p: S.PullRequest): PullRequestView {
  const { state, url, fetched_at, ...rest } = p;
  return {
    ...rest,
    state: isPrState(state) ? state : { raw: state },
    source: sourceRef(url),
    fetchedAt: toInstant(fetched_at),
  };
}

function isPrState(raw: string): raw is PrState {
  return Object.hasOwn(PR_STATE_LABELS, raw);
}

function prRef(url: string): NonNullable<UpdateView["pr"]> {
  const source = sourceRef(url);
  const number = source.kind === "web" ? /\/pull\/(\d+)/.exec(source.url)?.[1] : undefined;
  return { source, number: number === undefined ? null : Number(number) };
}

/**
 * `BLOCKING_REF_PATTERN` in schema-raid.ts: `task:<id>`, `decision:<id>` or an http(s) URL. Anything else stays text.
 */
function blockingRef(raw: string): BlockingRef {
  const [, kind, id] = /^(task|decision):(\S+)$/.exec(raw) ?? [];
  if ((kind === "task" || kind === "decision") && id !== undefined) return { kind, id };
  const source = sourceRef(raw);
  return { kind: "external", source: source.kind === "web" ? source : { kind: "text", text: raw } };
}

function raidView(r: S.RaidItem, agents: AgentDirectory): RaidView {
  const common = {
    id: r.id,
    title: r.title,
    summary: r.summary,
    description: r.description,
    status: r.status,
    severity: r.severity,
    task_ids: r.task_ids,
    decision_id: r.decision_id,
    version: r.version,
    owner: r.owner_agent === null ? null : agentRef(r.owner_agent, agents),
    severityRatedBy: r.severity_rated_by === null ? null : agentRef(r.severity_rated_by, agents),
    creator: r.created_by === null ? null : agentRef(r.created_by, agents),
    source: sourceRef(r.source_url),
    reviewAt: optionalInstant(r.review_at),
    createdAt: toInstant(r.created_at),
    updatedAt: toInstant(r.updated_at),
  };
  switch (r.type) {
    case "risk":
      return {
        ...common,
        type: "risk",
        probability: r.probability,
        impact: r.impact,
        mitigation: r.mitigation,
      };
    case "assumption":
      return {
        ...common,
        type: "assumption",
        validation_method: r.validation_method,
        validation_state: r.validation_state,
      };
    case "issue":
      return {
        ...common,
        type: "issue",
        impact: r.impact,
        resolution: r.resolution,
        escalated: r.escalated,
      };
    case "dependency":
      return {
        ...common,
        type: "dependency",
        blocked_task_id: r.blocked_task_id,
        blocking: r.blocking_ref === null ? null : blockingRef(r.blocking_ref),
      };
    default:
      return assertNever(r.type);
  }
}

function lessonView(l: S.Lesson, agents: AgentDirectory): LessonView {
  const common = {
    id: l.id,
    title: l.title,
    summary: l.summary,
    situation: l.situation,
    action: l.action,
    outcome: l.outcome,
    recommendation: l.recommendation,
    tags: l.tags,
    applies_to: l.applies_to,
    version: l.version,
    creator: l.created_by === null ? null : agentRef(l.created_by, agents),
    source: sourceRef(l.source_url),
    createdAt: toInstant(l.created_at),
    updatedAt: toInstant(l.updated_at),
  };
  if (l.status === "adopted") {
    // The server refuses this state (T15), so reaching it is a defect to surface, not a row to hide.
    if (l.enforced_by_url === null) {
      throw new Error(`Lesson ${l.id} is adopted without enforced_by_url.`);
    }
    return { ...common, status: "adopted", enforcedBy: sourceRef(l.enforced_by_url) };
  }
  return { ...common, status: l.status, enforcedBy: optionalSource(l.enforced_by_url) };
}

function parseIssues(raw: unknown): readonly S.Issue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((issue: unknown) => {
    if (!isRecord(issue)) return [];
    const { path, message } = issue;
    return typeof path === "string" && typeof message === "string" ? [{ path, message }] : [];
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
