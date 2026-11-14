import { useId, type ReactNode } from "react";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import { lists } from "./lists";
import {
  ATTENTION_LABELS,
  BLOCKED_ON_LABELS,
  REQUIREMENT_STATE_LABELS,
  TASK_GROUP_LABELS,
  attentionOf,
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
import { formatUtcDay } from "./format";
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

/** Columns in TASK_GROUP_LABELS order. Read-only: no service writes `group`, so the board offers no drag. */
export function KanbanBoard({ tasks }: { tasks: readonly TaskView[] }): ReactNode {
  const baseId = useId();
  const byGroup = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const column = byGroup.get(task.group) ?? [];
    column.push(task);
    byGroup.set(task.group, column);
  }
  return (
    <div className="kanban">
      {Object.entries(TASK_GROUP_LABELS).map(([group, label]) => {
        const column = byGroup.get(group) ?? [];
        const headingId = `${baseId}-${group}`;
        return (
          <section
            key={group}
            className="kanban-col"
            data-group={group}
            aria-labelledby={headingId}
          >
            <h3 id={headingId} className="kanban-head">
              {label} <span className="count">{column.length}</span>
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
    <article className="task-card">
      <h4 className="card-title">
        <RecordLink kind="task" id={t.id} className="row-link">
          {t.title}
        </RecordLink>
      </h4>
      <div className="card-meta">
        <code className="record-id">{t.id}</code>
        {t.assignee !== null ? (
          <AgentBadge agent={t.assignee} variant="chip" />
        ) : (
          <span className="quiet">Unassigned</span>
        )}
        <StaleBadge task={t} />
      </div>
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

/** Compact task rows: what it is, who has it, what blocks it, and how much is proven. */
export function TaskList({ tasks }: { tasks: readonly TaskView[] }): ReactNode {
  return (
    <ul className="record-list">
      {tasks.map((t) => (
        <li key={t.id}>
          <article className="record-row">
            <h3 className="row-title">
              <RecordLink kind="task" id={t.id} className="row-link">
                {t.title}
              </RecordLink>
            </h3>
            <div className="row-meta">
              <code className="record-id">{t.id}</code>
              {t.assignee !== null ? (
                <AgentBadge agent={t.assignee} variant="chip" />
              ) : (
                <span>Unassigned</span>
              )}
              <span>{t.statusLabel.label}</span>
              <StaleBadge task={t} />
            </div>
            {t.blocked_on !== "none" && (
              <p className="attention">{BLOCKED_ON_LABELS[t.blocked_on]}</p>
            )}
            <CoverageMeter progress={t.progress} compact />
          </article>
        </li>
      ))}
    </ul>
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
