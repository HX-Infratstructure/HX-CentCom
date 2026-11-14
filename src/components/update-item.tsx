import type { ReactNode } from "react";
import { Workflow } from "lucide-react";
import {
  UPDATE_KIND_LABELS,
  UPDATE_SOURCE_LABELS,
  assertNever,
  type UpdateOrigin,
  type UpdateView,
} from "./model";
import type { UpdateKind } from "./server-types";
import { AgentBadge, CommitSha, SourceLink, Time } from "./record-parts";
import { RecordLink } from "./url-state";

export function UpdateList({ updates }: { updates: readonly UpdateView[] }): ReactNode {
  return (
    <ul className="record-list">
      {updates.map((u) => (
        <li key={u.id}>
          <UpdateItem update={u} />
        </li>
      ))}
    </ul>
  );
}

/** One update: who posted it, how, when, and what it points to (SPEC 6, R5). */
export function UpdateItem({
  update,
  showTask = true,
}: {
  update: UpdateView;
  /** Off inside a list that already belongs to one task. */
  showTask?: boolean | undefined;
}): ReactNode {
  const { origin, kind, createdAt, statusLabel, note, commit_sha, pr, links } = update;
  const hasRefs = showTask || commit_sha !== null || pr !== null || links.length > 0;
  return (
    <article className="update-item" data-kind={kind}>
      <header className="update-head">
        <Origin origin={origin} kind={kind} />
        <span className="update-time">
          <Time at={createdAt} />
        </span>
      </header>
      {statusLabel !== null && <p className="update-status">Status set to {statusLabel.label}</p>}
      <p className="update-note">{note}</p>
      {hasRefs && (
        <footer className="update-refs">
          {showTask && (
            <RecordLink kind="task" id={update.task_id} className="id-link">
              {update.task_id}
            </RecordLink>
          )}
          {commit_sha !== null && <CommitSha sha={commit_sha} />}
          {pr !== null && (
            <SourceLink
              source={pr.source}
              label={pr.number === null ? "Pull request" : `PR #${pr.number}`}
            />
          )}
          {links.map((link, i) => (
            <SourceLink key={`${i}-${link.label}`} source={link.source} label={link.label} />
          ))}
        </footer>
      )}
    </article>
  );
}

function Origin({ origin, kind }: { origin: UpdateOrigin; kind: UpdateKind }): ReactNode {
  switch (origin.by) {
    case "agent":
      return (
        <>
          <AgentBadge agent={origin.author} />
          <span className="update-how">
            {`${UPDATE_KIND_LABELS[kind]} via ${UPDATE_SOURCE_LABELS[origin.source]}`}
          </span>
        </>
      );
    case "system":
      return (
        <>
          <span className="agent-badge system-badge">
            <span className="agent-mark" aria-hidden="true">
              <Workflow />
            </span>
            <span className="agent-name">System</span>
          </span>
          <span className="update-how">{`after ${origin.trigger.name}'s change`}</span>
        </>
      );
    default:
      return assertNever(origin);
  }
}
