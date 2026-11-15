import { useId, type ReactNode } from "react";
import { BoardGroup, BoardTable, PersonCell, StatusCell, type BoardColumn } from "./board";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import { LESSON_STATUS_HUES, LESSON_STATUS_LABELS, groupRows, type LessonView } from "./model";
import { AgentBadge, Fact, Facts, SourceLink, Time } from "./record-parts";
import { RichText } from "./rich-text";
import { RecordLink } from "./url-state";

const STATUSES = Object.keys(LESSON_STATUS_LABELS) as LessonView["status"][];

const COLUMNS: readonly BoardColumn[] = [
  { name: "Title", width: "auto" },
  { name: "Tags", width: 260 },
  { name: "Recorded by", width: 170 },
  { name: "Status", width: 124 },
  { name: "Updated", width: 104 },
];

/** Lessons grouped by status. `totals` is the server's count per status under the other filters. */
export function LessonBoard({
  lessons,
  totals,
}: {
  lessons: readonly LessonView[];
  totals: Readonly<Partial<Record<LessonView["status"], number>>>;
}): ReactNode {
  return (
    <div className="board-groups">
      {groupRows(STATUSES, lessons, (lesson) => lesson.status).map(({ key, rows }) => {
        const total = totals[key] ?? rows.length;
        return (
          <BoardGroup
            key={key}
            title={LESSON_STATUS_LABELS[key]}
            hue={LESSON_STATUS_HUES[key]}
            count={`${total} ${total === 1 ? "lesson" : "lessons"}`}
          >
            <BoardTable columns={COLUMNS}>
              {rows.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} />
              ))}
            </BoardTable>
          </BoardGroup>
        );
      })}
    </div>
  );
}

function LessonRow({ lesson }: { lesson: LessonView }): ReactNode {
  return (
    <tr>
      <th scope="row">
        <span className="task-line">
          <RecordLink kind="lesson" id={lesson.id} className="task-link">
            {lesson.title}
          </RecordLink>
          <code className="record-id">{lesson.id}</code>
        </span>
      </th>
      <td className="clip-cell">
        <Tags tags={lesson.tags} />
      </td>
      <PersonCell agent={lesson.creator} empty="Not recorded" />
      <StatusCell hue={LESSON_STATUS_HUES[lesson.status]}>
        {LESSON_STATUS_LABELS[lesson.status]}
      </StatusCell>
      <td className="center-cell">
        <Time at={lesson.updatedAt} />
      </td>
    </tr>
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
      <div className="sheet-pills">
        <span className="status-pill" data-hue={LESSON_STATUS_HUES[lesson.status]}>
          {LESSON_STATUS_LABELS[lesson.status]}
        </span>
      </div>
      {SECTIONS.map(([field, heading]) => {
        const text = lesson[field];
        if (text === null) return null;
        return (
          <section
            key={field}
            aria-labelledby={`${baseId}-${field}`}
            className="sheet-section sheet-description"
          >
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
