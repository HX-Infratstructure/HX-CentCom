import { useId, useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert } from "lucide-react";
import { BoardBody } from "./board";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import { statusRef } from "./adapt";
import { lists } from "./lists";
import {
  ATTENTION_LABELS,
  BLOCKED_ON_LABELS,
  GROUP_HUES,
  REQUIREMENT_STATE_LABELS,
  TASK_GROUP_LABELS,
  attentionOf,
  statusHue,
  type Coverage,
  type StatusDirectory,
  type StatusRef,
  type TaskView,
} from "./model";
import {
  AgentBadge,
  CommitSha,
  CoverageMeter,
  Fact,
  Facts,
  SourceLink,
  Time,
} from "./record-parts";
import { formatUtcDay, formatUtcShort } from "./format";
import type { TaskGroup } from "./server-types";
import { FilterLink, RecordLink } from "./url-state";

/** The id of the tasks page's update log section, which "Updates for <task>" scrolls to. */
export const UPDATE_LOG_ID = "updates";

const STALE_RULE =
  "This task's commit is not its repository's head, an open pull request's head, or a merged pull request's merge commit.";

/** Shown exactly when the overview counts the task under "Stale commit"; never for an unknown (null) state. */
function StaleBadge({ task }: { task: TaskView }): ReactNode {
  if (!attentionOf(task).includes("stale")) return null;
  return (
    <span className="attention" title={STALE_RULE}>
      {ATTENTION_LABELS.stale}
    </span>
  );
}

const GROUPS = Object.keys(TASK_GROUP_LABELS) as TaskGroup[];

function byGroup(tasks: readonly TaskView[]): ReadonlyMap<TaskGroup, readonly TaskView[]> {
  const groups = new Map<TaskGroup, TaskView[]>();
  for (const task of tasks) {
    const group = groups.get(task.group) ?? [];
    group.push(task);
    groups.set(task.group, group);
  }
  return groups;
}

/** What blocks the task, as an icon that keeps the dense row on one line; the label is its title and its text. */
function BlockedMark({ task }: { task: TaskView }): ReactNode {
  if (task.blocked_on === "none") return null;
  const label = BLOCKED_ON_LABELS[task.blocked_on];
  return (
    <span className="blocked-mark" title={label}>
      <CircleAlert aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The assignee's avatar and name, or an empty avatar for an unassigned task. */
function Assignee({ task }: { task: TaskView }): ReactNode {
  if (task.assignee !== null) return <AgentBadge agent={task.assignee} variant="person" />;
  return (
    <span className="agent-person unassigned">
      <span className="avatar" aria-hidden="true" />
      Unassigned
    </span>
  );
}

/**
 * The main table: one section per group in workflow order, a colored edge on every row, a status battery per group.
 * `compact` tightens the rows for a dashboard.
 */
export function TaskTable({
  tasks,
  compact = false,
}: {
  tasks: readonly TaskView[];
  compact?: boolean | undefined;
}): ReactNode {
  const groups = byGroup(tasks);
  return (
    <div className="board-groups" data-compact={compact ? "true" : undefined}>
      {GROUPS.map((group) => {
        const rows = groups.get(group);
        return rows === undefined ? null : <GroupTable key={group} group={group} tasks={rows} />;
      })}
    </div>
  );
}

const COLUMNS = ["Task", "Agent", "Status", "Repository", "Timeline", "Requirements", "Due"];

function GroupTable({ group, tasks }: { group: TaskGroup; tasks: readonly TaskView[] }): ReactNode {
  const [open, setOpen] = useState(true);
  const headingId = useId();
  const tableId = useId();
  return (
    <section className="board-group" data-hue={GROUP_HUES[group]} aria-labelledby={headingId}>
      <h3 id={headingId} className="group-title">
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={tableId}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight aria-hidden="true" />
          {TASK_GROUP_LABELS[group]}
        </button>
        <span className="count">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </h3>
      <div id={tableId} className="table-scroll" hidden={!open}>
        <table className="board-table" aria-labelledby={headingId}>
          <colgroup>
            <col className="col-task" />
            <col className="col-agent" />
            <col className="col-status" />
            <col className="col-repo" />
            <col className="col-timeline" />
            <col className="col-reqs" />
            <col className="col-due" />
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <BoardBody>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </BoardBody>
          <tfoot>
            <tr>
              <td colSpan={2} />
              <td className="battery-cell">
                <StatusBattery parts={rowStatusParts(tasks)} />
              </td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function TaskRow({ task: t }: { task: TaskView }): ReactNode {
  return (
    <tr>
      <th scope="row" className="task-cell">
        <span className="task-line">
          <RecordLink kind="task" id={t.id} className="task-link">
            {t.title}
          </RecordLink>
          <code className="record-id">{t.id}</code>
          <StaleBadge task={t} />
          <BlockedMark task={t} />
        </span>
      </th>
      <td>
        <Assignee task={t} />
      </td>
      <td className="status-cell" data-hue={statusHue(t.statusLabel)}>
        {t.statusLabel.label}
      </td>
      <td className="repo-cell">{t.repository}</td>
      <td className="center-cell">
        <TimelinePill task={t} />
      </td>
      <td className="center-cell">
        <ProvenCount progress={t.progress} />
      </td>
      <td className="center-cell">
        {t.due_date !== null && (
          <time dateTime={t.due_date} title={formatUtcDay(t.due_date)}>
            {formatUtcShort(t.due_date)}
          </time>
        )}
      </td>
    </tr>
  );
}

/** Start to due as a pill in the group's color; a task without both dates leaves the cell empty. */
function TimelinePill({ task: t }: { task: TaskView }): ReactNode {
  if (t.start_date === null || t.due_date === null) return null;
  return (
    <span
      className="timeline-pill"
      title={`${formatUtcDay(t.start_date)} to ${formatUtcDay(t.due_date)}`}
    >
      {formatUtcShort(t.start_date)} – {formatUtcShort(t.due_date)}
    </span>
  );
}

/** "2/3" proven, with a bar that repeats it. */
function ProvenCount({ progress }: { progress: Coverage }): ReactNode {
  if (progress.total === 0) return <span className="quiet">None</span>;
  return (
    <span className="proven">
      <span>
        {progress.proven}/{progress.total}
        <span className="sr-only"> proven</span>
      </span>
      <span className="meter" aria-hidden="true">
        <span
          className="meter-fill"
          style={{ inlineSize: `${(progress.proven / progress.total) * 100}%` }}
        />
      </span>
    </span>
  );
}

type StatusPart = { readonly status: StatusRef; readonly count: number };

/**
 * Open labels first, then done ones. Within each, by `rank`; a status with no rank (one the directory does not know)
 * goes last, and ties go in id order.
 */
function ordered(
  parts: readonly StatusPart[],
  rank: (id: string) => number,
): readonly StatusPart[] {
  return [...parts].sort(
    (a, b) =>
      Number(a.status.isDone) - Number(b.status.isDone) ||
      rank(a.status.id) - rank(b.status.id) ||
      // Code-unit order, the same on the server and in the browser, so hydration sees one order.
      Number(a.status.id > b.status.id) - Number(a.status.id < b.status.id),
  );
}

/**
 * How a table's rows split across status labels. The table has no directory, so every label ranks the same and the
 * order within open and done labels is a stable order by id.
 */
function rowStatusParts(tasks: readonly TaskView[]): readonly StatusPart[] {
  const counts = new Map<string, StatusPart>();
  for (const { statusLabel } of tasks) {
    const seen = counts.get(statusLabel.id);
    counts.set(statusLabel.id, {
      status: seen?.status ?? statusLabel,
      count: (seen?.count ?? 0) + 1,
    });
  }
  return ordered([...counts.values()], () => 0);
}

/** The server's counts by status, in the directory's order. A status it does not know shows its id as an open label. */
function countStatusParts(
  byStatus: Readonly<Record<string, number>>,
  statuses: StatusDirectory,
): readonly StatusPart[] {
  const position = new Map([...statuses.keys()].map((id, i) => [id, i]));
  return ordered(
    Object.entries(byStatus).map(([id, count]) => ({ status: statusRef(id, statuses), count })),
    (id) => position.get(id) ?? Number.POSITIVE_INFINITY,
  );
}

/** Every task by status: one wide battery and a legend with each label's count and share. */
export function StatusOverview({
  byStatus,
  statuses,
}: {
  byStatus: Readonly<Record<string, number>>;
  statuses: StatusDirectory;
}): ReactNode {
  const parts = countStatusParts(byStatus, statuses);
  const total = parts.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="status-overview">
      <StatusBattery parts={parts} />
      <ul className="battery-legend">
        {parts.map((p) => (
          <li key={p.status.id} data-hue={statusHue(p.status)}>
            <span className="legend-swatch" aria-hidden="true" />
            {p.status.label}
            <span className="legend-count">{p.count}</span>
            <span className="quiet">{Math.round((p.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBattery({ parts }: { parts: readonly StatusPart[] }): ReactNode {
  const summary = parts.map((p) => `${p.status.label} ${p.count}`).join(", ");
  return (
    <span className="battery" role="img" aria-label={summary} title={summary}>
      {parts.map((p) => (
        <span key={p.status.id} data-hue={statusHue(p.status)} style={{ flexGrow: p.count }} />
      ))}
    </span>
  );
}

/** Columns in TASK_GROUP_LABELS order. Read-only: no service writes `group`, so the board offers no drag. */
export function KanbanBoard({ tasks }: { tasks: readonly TaskView[] }): ReactNode {
  const baseId = useId();
  const groups = byGroup(tasks);
  return (
    <div className="kanban">
      {GROUPS.map((group) => {
        const column = groups.get(group) ?? [];
        const headingId = `${baseId}-${group}`;
        return (
          <section
            key={group}
            className="kanban-col"
            data-hue={GROUP_HUES[group]}
            aria-labelledby={headingId}
          >
            <h3 id={headingId} className="kanban-head">
              {TASK_GROUP_LABELS[group]} <span className="count">{column.length}</span>
            </h3>
            {column.length > 0 ? (
              <ul className="kanban-cards">
                {column.map((task) => (
                  <li key={task.id}>
                    <TaskCard task={task} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet">No tasks</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ task: t }: { task: TaskView }): ReactNode {
  return (
    <article className="task-card" data-hue={statusHue(t.statusLabel)}>
      <h4 className="card-title">
        <RecordLink kind="task" id={t.id} className="row-link">
          {t.title}
        </RecordLink>
      </h4>
      <div className="card-meta">
        <span className="card-status">{t.statusLabel.label}</span>
        <code className="record-id">{t.id}</code>
        <StaleBadge task={t} />
      </div>
      <Assignee task={t} />
      <CoverageMeter progress={t.progress} compact />
      {t.blocked_on !== "none" && <p className="attention">{BLOCKED_ON_LABELS[t.blocked_on]}</p>}
      {t.due_date !== null && (
        <p className="quiet">
          Due <time dateTime={t.due_date}>{formatUtcDay(t.due_date)}</time>
        </p>
      )}
    </article>
  );
}

export function TaskDetail({
  detail,
  onClose,
}: {
  detail: Detail<TaskView>;
  onClose: () => void;
}): ReactNode {
  return (
    <DetailSheet
      detail={detail}
      kind="task"
      title={(t) => t.title}
      summary={(t) => t.note}
      onClose={onClose}
    >
      {(t) => <TaskBody task={t} />}
    </DetailSheet>
  );
}

function TaskBody({ task: t }: { task: TaskView }): ReactNode {
  const requirementsId = useId();
  const groupLabel = TASK_GROUP_LABELS[t.group];
  return (
    <>
      <p className="sheet-facts">
        <span>{t.statusLabel.label}</span>
        {groupLabel.toLowerCase() !== t.statusLabel.label.toLowerCase() && (
          <span>{groupLabel}</span>
        )}
        {t.blocked_on !== "none" && (
          <span className="attention">{BLOCKED_ON_LABELS[t.blocked_on]}</span>
        )}
        <StaleBadge task={t} />
      </p>
      <CoverageMeter progress={t.progress} />

      {t.requirements.length > 0 && (
        <section aria-labelledby={requirementsId} className="sheet-section">
          <h3 id={requirementsId}>Requirements</h3>
          <ul className="req-list">
            {t.requirements.map((r) => (
              <li key={r.id}>
                <span className="req-chip" data-state={r.state}>
                  {REQUIREMENT_STATE_LABELS[r.state]}
                </span>
                <span className="req-text">{r.requirement}</span>
                {r.proof !== null ? (
                  <SourceLink source={r.proof} label="Proof" />
                ) : (
                  r.source !== null && <SourceLink source={r.source} label="Source" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Facts>
        <Fact label="Assigned to">
          {t.assignee !== null ? <AgentBadge agent={t.assignee} variant="chip" /> : "Unassigned"}
        </Fact>
        <Fact label="Repository">{t.repository}</Fact>
        <Fact label="Host">{t.host}</Fact>
        {t.commit_sha !== null && (
          <Fact label="Commit">
            <CommitSha sha={t.commit_sha} />
          </Fact>
        )}
        {t.start_date !== null && (
          <Fact label="Planned start">
            <time dateTime={t.start_date}>{formatUtcDay(t.start_date)}</time>
          </Fact>
        )}
        {t.due_date !== null && (
          <Fact label="Due">
            <time dateTime={t.due_date}>{formatUtcDay(t.due_date)}</time>
          </Fact>
        )}
        <Fact label="Updated">
          <Time at={t.updatedAt} format="datetime" />
        </Fact>
        <Fact label="Source">
          <SourceLink source={t.source} />
        </Fact>
      </Facts>

      <FilterLink
        search={lists.updateLog}
        set={{ task: t.id }}
        hash={UPDATE_LOG_ID}
        className="text-link"
      >
        Updates for {t.id}
      </FilterLink>
    </>
  );
}
