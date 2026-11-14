import type { ReactNode } from "react";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import {
  RAID_STATUS_LABELS,
  RAID_TYPE_LABELS,
  SEVERITY_LABELS,
  VALIDATION_STATE_LABELS,
  assertNever,
  type BlockingRef,
  type RaidView,
} from "./model";
import { AgentBadge, Fact, Facts, SourceLink, Time } from "./record-parts";
import { RichText } from "./rich-text";
import { RecordLink } from "./url-state";

export function RaidRow({ item }: { item: RaidView }): ReactNode {
  return (
    <article className="record-row raid-row">
      <h3 className="row-title">
        <RecordLink kind="raid" id={item.id} className="row-link">
          {item.title}
        </RecordLink>
      </h3>
      <p className="row-summary">{item.summary}</p>
      <div className="row-meta">
        <span className="type-label">{RAID_TYPE_LABELS[item.type]}</span>
        {item.severity !== null && (
          <span className="severity" data-severity={item.severity}>
            {SEVERITY_LABELS[item.severity]}
          </span>
        )}
        <span>{RAID_STATUS_LABELS[item.status]}</span>
        {item.reviewAt !== null && (
          <span>
            Review <Time at={item.reviewAt} format="date" />
          </span>
        )}
        {item.owner !== null && <AgentBadge agent={item.owner} variant="chip" />}
        {item.task_ids.map((taskId) => (
          <RecordLink key={taskId} kind="task" id={taskId} className="id-link">
            {taskId}
          </RecordLink>
        ))}
        <code className="record-id">{item.id}</code>
      </div>
    </article>
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
          <div className="sheet-section">
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
