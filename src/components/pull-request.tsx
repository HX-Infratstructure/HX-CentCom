import type { ReactNode } from "react";
import { PR_STATE_LABELS, type PullRequestView } from "./model";
import { SourceLink } from "./record-parts";

/** Pull requests as the last GitHub sync saw them; each title links to GitHub. */
export function PullRequestList({ prs }: { prs: readonly PullRequestView[] }): ReactNode {
  return (
    <ul className="record-list">
      {prs.map((pr) => (
        <li key={pr.id} className="record-row">
          <span className="row-title">
            <SourceLink source={pr.source} label={pr.title} />
          </span>
          <span className="row-meta">
            <span>
              {pr.repo} #{pr.number}
            </span>
            <PrStateLabel state={pr.state} />
            {pr.draft && <span>Draft</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Open is the normal case and goes unlabeled; a state the UI does not know shows its raw text. */
function PrStateLabel({ state }: { state: PullRequestView["state"] }): ReactNode {
  if (state === "open") return null;
  if (typeof state === "string") {
    return (
      <span className="pr-state" data-state={state}>
        {PR_STATE_LABELS[state]}
      </span>
    );
  }
  return <span className="pr-state">{state.raw}</span>;
}
