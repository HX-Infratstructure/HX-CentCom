import type { ReactNode } from "react";
import { PR_STATES } from "@/lib/pr-states";
import { BoardGroup, BoardTable, StatusCell, type BoardColumn } from "./board";
import {
  PR_STATE_HUES,
  PR_STATE_LABELS,
  PR_STATE_SHORT_LABELS,
  groupRows,
  type PrState,
  type PullRequestView,
} from "./model";
import { SourceLink, Time } from "./record-parts";

type PrGroup = PrState | "other";

const PR_GROUPS: readonly PrGroup[] = [...PR_STATES, "other"];

const COLUMNS: readonly BoardColumn[] = [
  { name: "Title", width: "auto" },
  { name: "Repository", width: 170 },
  { name: "Number", width: 88 },
  { name: "State", width: 116 },
  { name: "Head", width: 104 },
  { name: "Synced", width: 104 },
];

/**
 * Pull requests grouped by state. `totals` is the server's count per state under the other filters; a state the UI
 * has no label for joins "Other" with its raw text in the State cell.
 */
export function PullRequestBoard({
  prs,
  totals,
}: {
  prs: readonly PullRequestView[];
  totals: Readonly<Partial<Record<string, number>>>;
}): ReactNode {
  const groups = groupRows(PR_GROUPS, prs, (pr) =>
    typeof pr.state === "string" ? pr.state : "other",
  );
  return (
    <div className="board-groups">
      {groups.map(({ key, rows }) => {
        const total = key === "other" ? rows.length : (totals[key] ?? rows.length);
        return (
          <BoardGroup
            key={key}
            title={key === "other" ? "Other" : PR_STATE_SHORT_LABELS[key]}
            hue={key === "other" ? "grey" : PR_STATE_HUES[key]}
            count={`${total} ${total === 1 ? "pull request" : "pull requests"}`}
          >
            <BoardTable columns={COLUMNS}>
              {rows.map((pr) => (
                <PullRequestRow key={pr.id} pr={pr} />
              ))}
            </BoardTable>
          </BoardGroup>
        );
      })}
    </div>
  );
}

function PullRequestRow({ pr }: { pr: PullRequestView }): ReactNode {
  return (
    <tr>
      <th scope="row">
        <span className="task-line">
          <SourceLink source={pr.source} label={pr.title} />
          {pr.draft && (
            <span className="pr-state" data-hue="grey">
              Draft
            </span>
          )}
        </span>
      </th>
      <td className="repo-cell">{pr.repo}</td>
      <td className="center-cell">#{pr.number}</td>
      <StatusCell
        hue={typeof pr.state === "string" ? PR_STATE_HUES[pr.state] : "grey"}
        title={typeof pr.state === "string" ? PR_STATE_LABELS[pr.state] : undefined}
      >
        {typeof pr.state === "string" ? PR_STATE_SHORT_LABELS[pr.state] : pr.state.raw}
      </StatusCell>
      <td className="center-cell">
        <code className="sha" title={pr.head_sha}>
          {pr.head_sha.slice(0, 7)}
        </code>
      </td>
      <td className="center-cell">
        <Time at={pr.fetchedAt} />
      </td>
    </tr>
  );
}

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
            {pr.draft && (
              <span className="pr-state" data-hue="grey">
                Draft
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every state as a colored pill; a state the UI does not know shows its raw text in grey. */
function PrStateLabel({ state }: { state: PullRequestView["state"] }): ReactNode {
  if (typeof state === "string") {
    return (
      <span className="pr-state" data-state={state} data-hue={PR_STATE_HUES[state]}>
        {PR_STATE_LABELS[state]}
      </span>
    );
  }
  return (
    <span className="pr-state" data-hue="grey">
      {state.raw}
    </span>
  );
}
