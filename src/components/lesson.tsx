import { useId, type ReactNode } from "react";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import { LESSON_STATUS_LABELS, type LessonView } from "./model";
import { AgentBadge, Fact, Facts, SourceLink, Time } from "./record-parts";
import { RichText } from "./rich-text";
import { RecordLink } from "./url-state";

export function LessonRow({ lesson }: { lesson: LessonView }): ReactNode {
  return (
    <article className="record-row lesson-row">
      <h3 className="row-title">
        <RecordLink kind="lesson" id={lesson.id} className="row-link">
          {lesson.title}
        </RecordLink>
      </h3>
      <p className="row-summary">{lesson.summary}</p>
      <div className="row-meta">
        <span className="status-label" data-status={lesson.status}>
          {LESSON_STATUS_LABELS[lesson.status]}
        </span>
        {lesson.status === "adopted" && (
          <span>
            Enforced by <SourceLink source={lesson.enforcedBy} compact />
          </span>
        )}
        <Tags tags={lesson.tags} />
        <code className="record-id">{lesson.id}</code>
      </div>
    </article>
  );
}

/** The closure template's four parts (SPEC 6.1), in that order. */
const SECTIONS = [
  ["situation", "Situation"],
  ["action", "Action"],
  ["outcome", "Outcome"],
  ["recommendation", "Recommendation"],
] as const;

export function LessonDetail({
  detail,
  onClose,
}: {
  detail: Detail<LessonView>;
  onClose: () => void;
}): ReactNode {
  return (
    <DetailSheet
      detail={detail}
      kind="lesson"
      title={(lesson) => lesson.title}
      summary={(lesson) => lesson.summary}
      onClose={onClose}
    >
      {(lesson) => <LessonBody lesson={lesson} />}
    </DetailSheet>
  );
}

function LessonBody({ lesson }: { lesson: LessonView }): ReactNode {
  const baseId = useId();
  return (
    <>
      {SECTIONS.map(([field, heading]) => {
        const text = lesson[field];
        if (text === null) return null;
        return (
          <section key={field} aria-labelledby={`${baseId}-${field}`} className="sheet-section">
            <h3 id={`${baseId}-${field}`}>{heading}</h3>
            <RichText source={text} />
          </section>
        );
      })}
      <Facts>
        <Fact label="Status">{LESSON_STATUS_LABELS[lesson.status]}</Fact>
        {lesson.enforcedBy !== null && (
          <Fact label="Enforced by">
            <SourceLink source={lesson.enforcedBy} />
          </Fact>
        )}
        {lesson.tags.length > 0 && (
          <Fact label="Tags">
            <Tags tags={lesson.tags} />
          </Fact>
        )}
        {lesson.applies_to !== null && <Fact label="Applies to">{lesson.applies_to}</Fact>}
        {lesson.creator !== null && (
          <Fact label="Recorded by">
            <AgentBadge agent={lesson.creator} variant="chip" />
          </Fact>
        )}
        <Fact label="Updated">
          <Time at={lesson.updatedAt} format="datetime" />
        </Fact>
        <Fact label="Source">
          <SourceLink source={lesson.source} />
        </Fact>
      </Facts>
    </>
  );
}

function Tags({ tags }: { tags: readonly string[] }): ReactNode {
  if (tags.length === 0) return null;
  return (
    <ul className="tag-list">
      {tags.map((tag) => (
        <li key={tag} className="tag">
          {tag}
        </li>
      ))}
    </ul>
  );
}
