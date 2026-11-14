import type * as S from "./server-types";
import {
  PR_STATE_LABELS,
  assertNever,
  toInstant,
  type AgentDirectory,
  type AgentRef,
  type AppError,
  type BlockingRef,
  type DecisionView,
  type Directory,
  type LessonView,
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
    prs: ws.prs.map(pullRequestView),
  };
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

/**
 * The one parser for failures. It accepts the REST error body (`{ error: { code, message } }`), a bare service error
 * body, or a thrown value; anything that is not a known service error is `unreachable`.
 */
export function toAppError(error: unknown): AppError {
  const wrapped = isRecord(error) ? error["error"] : undefined;
  const body = isRecord(wrapped) ? wrapped : error;
  const message = isRecord(body) ? body["message"] : undefined;
  if (isRecord(body) && typeof message === "string") {
    switch (body["code"]) {
      case "version_conflict": {
        const currentVersion = body["currentVersion"];
        if (typeof currentVersion === "number") {
          return { code: "version_conflict", message, currentVersion };
        }
        break;
      }
      case "invalid":
        return { code: "invalid", message, issues: parseIssues(body["issues"]) };
      case "unauthorized":
        return { code: "unauthorized", message };
      case "forbidden":
        return { code: "forbidden", message };
      case "not_found":
        return { code: "not_found", message };
      case "idempotency_mismatch":
        return { code: "idempotency_mismatch", message };
    }
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

/** B4's `BLOCKING_REF_PATTERN`: `task:<id>`, `decision:<id>` or an http(s) URL. Anything else stays text. */
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
