import type { ReactNode } from "react";
import { BoardGroup, BoardTable, PersonCell, StatusCell, type BoardColumn } from "./board";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import {
  RAID_STATUS_HUES,
  RAID_STATUS_LABELS,
  RAID_TYPE_HUES,
  RAID_TYPE_LABELS,
  SEVERITY_HUES,
  SEVERITY_LABELS,
  VALIDATION_STATE_LABELS,
  assertNever,
  groupRows,
  type BlockingRef,
  type RaidView,
} from "./model";
import { AgentBadge, Fact, Facts, SourceLink, Time } from "./record-parts";
import { RichText } from "./rich-text";
import { RecordLink } from "./url-state";

const RAID_TYPES = Object.keys(RAID_TYPE_LABELS) as RaidView["type"][];

const COLUMNS: readonly BoardColumn[] = [
  { name: "Item", width: "auto" },
  { name: "Severity", width: 120 },
  { name: "Status", width: 120 },
  { name: "Owner", width: 170 },
  { name: "Tasks", width: 130 },
  { name: "Review date", width: 112 },
  { name: "Updated", width: 104 },
];

/** The register grouped by type in SPEC order. `totals` is the server's count per type under the other filters. */
export function RaidBoard({
  items,
  totals,
}: {
  items: readonly RaidView[];
  totals: Readonly<Partial<Record<RaidView["type"], number>>>;
}): ReactNode {
  return (
    <div className="board-groups">
      {groupRows(RAID_TYPES, items, (item) => item.type).map(({ key, rows }) => {
        const total = totals[key] ?? rows.length;
        return (
          <BoardGroup
            key={key}
            title={RAID_PLURALS[key]}
            hue={RAID_TYPE_HUES[key]}
            count={`${total} ${total === 1 ? "item" : "items"}`}
          >
            <BoardTable columns={COLUMNS}>
              {rows.map((item) => (
                <RaidRow key={item.id} item={item} />
              ))}
            </BoardTable>
          </BoardGroup>
        );
      })}
    </div>
  );
}

const RAID_PLURALS = {
  risk: "Risks",
  assumption: "Assumptions",
  issue: "Issues",
  dependency: "Dependencies",
} as const satisfies Record<RaidView["type"], string>;

function RaidRow({ item }: { item: RaidView }): ReactNode {
  return (
    <tr>
      <th scope="row">
        <span className="task-line">
          <RecordLink kind="raid" id={item.id} className="task-link">
            {item.title}
          </RecordLink>
          <code className="record-id">{item.id}</code>
        </span>
      </th>
      <StatusCell hue={item.severity === null ? null : SEVERITY_HUES[item.severity]}>
        {item.severity !== null && SEVERITY_LABELS[item.severity]}
      </StatusCell>
      <StatusCell hue={RAID_STATUS_HUES[item.status]}>{RAID_STATUS_LABELS[item.status]}</StatusCell>
      <PersonCell agent={item.owner} empty="No owner" />
      <td className="clip-cell">
        <span className="id-run">
          {item.task_ids.map((taskId) => (
            <RecordLink key={taskId} kind="task" id={taskId} className="id-link">
              {taskId}
            </RecordLink>
          ))}
        </span>
      </td>
      <td className="center-cell">
        {item.reviewAt !== null && <Time at={item.reviewAt} format="date" />}
      </td>
      <td className="center-cell">
        <Time at={item.updatedAt} />
      </td>
    </tr>
  );
}

export function RaidDetail({
  detail,
  onClose,
}: {
  detail: Detail<RaidView>;
  onClose: () => void;
}): ReactNode {
  return (
    <DetailSheet
      detail={detail}
      kind="raid"
      title={(item) => item.title}
      summary={(item) => item.summary}
      onClose={onClose}
    >
      {(item) => (
        <>
          <div className="sheet-pills">
            <span className="type-pill" data-hue={RAID_TYPE_HUES[item.type]}>
              {RAID_TYPE_LABELS[item.type]}
            </span>
            {item.severity !== null && (
              <span className="status-pill" data-hue={SEVERITY_HUES[item.severity]}>
                {SEVERITY_LABELS[item.severity]}
              </span>
            )}
            <span className="status-pill" data-hue={RAID_STATUS_HUES[item.status]}>
              {RAID_STATUS_LABELS[item.status]}
            </span>
          </div>
          <div className="sheet-section sheet-description">
            <RichText source={item.description} />
          </div>
          <Facts>
            <Fact label="Type">{RAID_TYPE_LABELS[item.type]}</Fact>
            <Fact label="Status">{RAID_STATUS_LABELS[item.status]}</Fact>
            {item.severity !== null && (
              <Fact label="Severity">
                {SEVERITY_LABELS[item.severity]}
                {item.severityRatedBy !== null && (
                  <span className="rated-by">
                    rated by <AgentBadge agent={item.severityRatedBy} variant="chip" />
                  </span>
                )}
              </Fact>
            )}
            <TypeFacts item={item} />
            {item.owner !== null && (
              <Fact label="Owner">
                <AgentBadge agent={item.owner} variant="chip" />
              </Fact>
            )}
            {item.reviewAt !== null && (
              <Fact label="Review date">
                <Time at={item.reviewAt} format="date" />
              </Fact>
            )}
            {item.task_ids.length > 0 && (
              <Fact label="Tasks">
                <span className="id-list">
                  {item.task_ids.map((taskId) => (
                    <RecordLink key={taskId} kind="task" id={taskId} className="id-link">
                      {taskId}
                    </RecordLink>
                  ))}
                </span>
              </Fact>
            )}
            {item.decision_id !== null && (
              <Fact label="Decision">
                <RecordLink kind="decision" id={item.decision_id} className="id-link">
                  {item.decision_id}
                </RecordLink>
              </Fact>
            )}
            {item.creator !== null && (
              <Fact label="Recorded by">
                <AgentBadge agent={item.creator} variant="chip" />
              </Fact>
            )}
            <Fact label="Updated">
              <Time at={item.updatedAt} format="datetime" />
            </Fact>
            <Fact label="Source">
              <SourceLink source={item.source} />
            </Fact>
          </Facts>
        </>
      )}
    </DetailSheet>
  );
}

/** SPEC 6.1's fields for each RAID type. A null field is left out. */
function TypeFacts({ item }: { item: RaidView }): ReactNode {
  switch (item.type) {
    case "risk":
      return (
        <>
          {item.probability !== null && <Fact label="Probability">{item.probability}</Fact>}
          {item.impact !== null && <Fact label="Impact">{item.impact}</Fact>}
          {item.mitigation !== null && <Fact label="Mitigation">{item.mitigation}</Fact>}
        </>
      );
    case "assumption":
      return (
        <>
          {item.validation_method !== null && (
            <Fact label="How it is validated">{item.validation_method}</Fact>
          )}
          {item.validation_state !== null && (
            <Fact label="Validation">{VALIDATION_STATE_LABELS[item.validation_state]}</Fact>
          )}
        </>
      );
    case "issue":
      return (
        <>
          {item.impact !== null && <Fact label="Impact">{item.impact}</Fact>}
          {item.resolution !== null && <Fact label="Resolution">{item.resolution}</Fact>}
          <Fact label="Escalated">{item.escalated ? "Yes" : "No"}</Fact>
        </>
      );
    case "dependency":
      return (
        <>
          {item.blocked_task_id !== null && (
            <Fact label="Blocked task">
              <RecordLink kind="task" id={item.blocked_task_id} className="id-link">
                {item.blocked_task_id}
              </RecordLink>
            </Fact>
          )}
          {item.blocking !== null && (
            <Fact label="Waiting on">
              <Blocking blocking={item.blocking} />
            </Fact>
          )}
        </>
      );
    default:
      return assertNever(item);
  }
}

function Blocking({ blocking }: { blocking: BlockingRef }): ReactNode {
  if (blocking.kind === "external") return <SourceLink source={blocking.source} />;
  return (
    <RecordLink kind={blocking.kind} id={blocking.id} className="id-link">
      {blocking.id}
    </RecordLink>
  );
}
