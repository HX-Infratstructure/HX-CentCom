import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { BoardTable, PersonCell, StatusCell, type BoardColumn } from "./board";
import type { Detail } from "./detail";
import { DetailSheet } from "./detail-sheet";
import { ErrorState } from "./list-states";
import {
  DECISION_STATUS_HUES,
  DECISION_STATUS_LABELS,
  GATE_HUES,
  GATE_TYPE_LABELS,
  type AppError,
  type DecisionView,
  type OwnerActions,
} from "./model";
import { OwnerKeyPrompt } from "./owner-session";
import { AgentBadge, Fact, Facts, SourceLink, Time } from "./record-parts";
import { RichText } from "./rich-text";
import type { DecideInput, OwnerDecisionStatus } from "./server-types";
import { RecordLink } from "./url-state";

/** The question when one was recorded; otherwise the summary stands as the title. */
function decisionTitle(d: DecisionView): string {
  return d.question ?? d.summary;
}

export function DecisionRow({ decision: d }: { decision: DecisionView }): ReactNode {
  return (
    <article className="record-row decision-row" data-status={d.status}>
      <span className="type-pill" data-hue={GATE_HUES[d.gate_type]}>
        {GATE_TYPE_LABELS[d.gate_type]}
      </span>
      <div className="decision-main">
        <h3 className="row-title">
          <RecordLink kind="decision" id={d.id} className="row-link">
            {decisionTitle(d)}
          </RecordLink>
        </h3>
        {d.question !== null && <p className="row-summary">{d.summary}</p>}
      </div>
      <div className="row-meta">
        {d.status === "Pending" ? (
          d.requestedAt !== null && (
            <span>
              Requested <Time at={d.requestedAt} />
            </span>
          )
        ) : (
          <span className="status-label" data-status={d.status}>
            {DECISION_STATUS_LABELS[d.status]}
            {d.decidedAt !== null && (
              <>
                {" "}
                <Time at={d.decidedAt} format="date" />
              </>
            )}
          </span>
        )}
        {d.blocks.length > 0 && (
          <span className="row-blocks">
            Blocks
            {d.blocks.map((taskId) => (
              <RecordLink key={taskId} kind="task" id={taskId} className="id-link">
                {taskId}
              </RecordLink>
            ))}
          </span>
        )}
        <code className="record-id">{d.id}</code>
      </div>
    </article>
  );
}

export function DecisionList({ decisions }: { decisions: readonly DecisionView[] }): ReactNode {
  return (
    <ul className="record-list">
      {decisions.map((d) => (
        <li key={d.id}>
          <DecisionRow decision={d} />
        </li>
      ))}
    </ul>
  );
}

function decisionColumns(when: "age" | "decided"): readonly BoardColumn[] {
  return [
    { name: "Question", width: "auto" },
    { name: "Type", width: 108 },
    { name: "Summary", width: 220 },
    { name: "Blocks", width: 110 },
    { name: "Requested by", width: 160 },
    { name: when === "age" ? "Age" : "Decided at", width: 96 },
    { name: "Status", width: 120 },
  ];
}

/** Decisions as a board table. `when` picks the time column, the request's age or the decision date. */
export function DecisionTable({
  decisions,
  when,
}: {
  decisions: readonly DecisionView[];
  when: "age" | "decided";
}): ReactNode {
  return (
    <BoardTable columns={decisionColumns(when)}>
      {decisions.map((d) => (
        <tr key={d.id}>
          <th scope="row">
            <span className="task-line">
              <RecordLink kind="decision" id={d.id} className="task-link">
                {decisionTitle(d)}
              </RecordLink>
              <code className="record-id">{d.id}</code>
            </span>
          </th>
          <td className="center-cell">
            <span className="type-pill" data-hue={GATE_HUES[d.gate_type]}>
              {GATE_TYPE_LABELS[d.gate_type]}
            </span>
          </td>
          <td className="clip-cell" title={d.question === null ? undefined : d.summary}>
            {d.question !== null && d.summary}
          </td>
          <td className="clip-cell">
            <span className="id-run">
              {d.blocks.map((taskId) => (
                <RecordLink key={taskId} kind="task" id={taskId} className="id-link">
                  {taskId}
                </RecordLink>
              ))}
            </span>
          </td>
          <PersonCell agent={d.requester} empty="No requester recorded" />
          <td className="center-cell">
            {when === "age"
              ? d.requestedAt !== null && <Time at={d.requestedAt} />
              : d.decidedAt !== null && <Time at={d.decidedAt} format="date" />}
          </td>
          <StatusCell hue={DECISION_STATUS_HUES[d.status]}>
            {DECISION_STATUS_LABELS[d.status]}
          </StatusCell>
        </tr>
      ))}
    </BoardTable>
  );
}

/** The complete view of one decision (R11), with the decide form in owner mode while it is pending. */
export function DecisionDetail({
  detail,
  owner,
  onClose,
}: {
  detail: Detail<DecisionView>;
  /** null in public mode: the sheet then offers no owner action at all. */
  owner: OwnerActions | null;
  onClose: () => void;
}): ReactNode {
  return (
    <DetailSheet
      detail={detail}
      kind="decision"
      title={decisionTitle}
      summary={(d) => (d.question === null ? null : d.summary)}
      onClose={onClose}
    >
      {(d) => <DecisionBody decision={d} owner={owner} />}
    </DetailSheet>
  );
}

function DecisionBody({
  decision: d,
  owner,
}: {
  decision: DecisionView;
  owner: OwnerActions | null;
}) {
  const descriptionId = useId();
  const optionsId = useId();
  const blocksId = useId();
  const firstChoice = useRef<HTMLInputElement>(null);
  const pending =
    owner === null ? (
      <OwnerKeyPrompt focusAfter={firstChoice}>Deciding needs the owner key.</OwnerKeyPrompt>
    ) : (
      <DecideForm key={d.id} decision={d} owner={owner} firstChoice={firstChoice} />
    );
  return (
    <>
      <div className="sheet-pills">
        <span className="type-pill" data-hue={GATE_HUES[d.gate_type]}>
          {GATE_TYPE_LABELS[d.gate_type]}
        </span>
        <span className="status-pill" data-hue={DECISION_STATUS_HUES[d.status]}>
          {DECISION_STATUS_LABELS[d.status]}
        </span>
      </div>

      <section aria-labelledby={descriptionId} className="sheet-section sheet-description">
        <h3 id={descriptionId}>Description</h3>
        <RichText source={d.description} />
      </section>

      {d.options.length > 0 && (
        <section aria-labelledby={optionsId} className="sheet-section">
          <h3 id={optionsId}>Options</h3>
          <ul className="option-list">
            {d.options.map((option, i) => (
              <li key={`${i}-${option.label}`}>
                <p className="option-label">{option.label}</p>
                {option.description !== undefined && option.description !== "" && (
                  <p className="quiet">{option.description}</p>
                )}
                {d.recommendation?.option === option.label && (
                  <p className="recommended">
                    Recommended by <AgentBadge agent={d.recommendation.by} variant="chip" />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.blocks.length > 0 && (
        <section aria-labelledby={blocksId} className="sheet-section">
          <h3 id={blocksId}>Blocks</h3>
          <ul className="id-list">
            {d.blocks.map((taskId) => (
              <li key={taskId}>
                <RecordLink kind="task" id={taskId} className="id-link">
                  {taskId}
                </RecordLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Facts>
        {d.subject !== null && <Fact label="Subject">{d.subject}</Fact>}
        {d.requester !== null && (
          <Fact label="Requested by">
            <AgentBadge agent={d.requester} variant="chip" />
          </Fact>
        )}
        {d.requestedAt !== null && (
          <Fact label="Requested">
            <Time at={d.requestedAt} format="datetime" />
          </Fact>
        )}
        {d.source !== null && (
          <Fact label="Source">
            <SourceLink source={d.source} />
          </Fact>
        )}
      </Facts>

      {d.status === "Pending" ? pending : <OwnerOutcome decision={d} />}
    </>
  );
}

function OwnerOutcome({ decision: d }: { decision: DecisionView }): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="sheet-section owner-outcome">
      <h3 id={headingId}>Owner decision</h3>
      {d.decision_text !== null && (
        <blockquote className="owner-words">
          <p>{d.decision_text}</p>
        </blockquote>
      )}
      <Facts>
        <Fact label="Outcome">{DECISION_STATUS_LABELS[d.status]}</Fact>
        {d.decidedAt !== null && (
          <Fact label="Decided">
            <Time at={d.decidedAt} format="datetime" />
          </Fact>
        )}
        {d.decisionSource !== null && (
          <Fact label="Decision source">
            <SourceLink source={d.decisionSource} />
          </Fact>
        )}
        {d.superseded_by !== null && (
          <Fact label="Superseded by">
            <RecordLink kind="decision" id={d.superseded_by} inSheet className="id-link">
              {d.superseded_by}
            </RecordLink>
          </Fact>
        )}
      </Facts>
    </section>
  );
}

const OUTCOMES: readonly OwnerDecisionStatus[] = ["Decided", "Deferred", "Superseded"];

type FormState =
  | { readonly phase: "editing" }
  | { readonly phase: "sending" }
  | { readonly phase: "recorded" }
  | { readonly phase: "failed"; readonly error: AppError };

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Keyed by decision id, not version, so the refetch after a conflict keeps every typed field. The If-Match is the
 * version the owner saw: the one the form opened at, until the owner takes the version the sheet shows now. A refetch
 * that moves the decision on only shows a note, so a submit conflicts instead of overwriting a change the owner never
 * read, and after a conflict the owner records again only once they have taken the version on screen.
 */
function DecideForm({
  decision,
  owner,
  firstChoice,
}: {
  decision: DecisionView;
  owner: OwnerActions;
  firstChoice: RefObject<HTMLInputElement | null>;
}): ReactNode {
  const [state, setState] = useState<FormState>({ phase: "editing" });
  const [seenVersion, setSeenVersion] = useState(decision.version);
  const headingId = useId();
  const wordsId = useId();
  const sourceId = useId();
  const sourceHintId = useId();

  const issue = (path: keyof DecideInput) =>
    state.phase === "failed" && state.error.code === "invalid"
      ? state.error.issues.find((i) => i.path === path)?.message
      : undefined;
  const statusIssue = issue("status");
  const wordsIssue = issue("decisionText");
  const sourceIssue = issue("sourceUrl");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = OUTCOMES.find((o) => o === form.get("status"));
    if (status === undefined) return;
    const input: DecideInput = {
      status,
      decisionText: formText(form, "decisionText"),
      sourceUrl: formText(form, "sourceUrl"),
    };
    setState({ phase: "sending" });
    const outcome = await owner.decide({ id: decision.id, version: seenVersion }, input);
    setState(outcome.ok ? { phase: "recorded" } : { phase: "failed", error: outcome.error });
  }

  const sending = state.phase === "sending";
  const conflicted = state.phase === "failed" && state.error.code === "version_conflict";
  return (
    <form
      className="decide-form"
      aria-labelledby={headingId}
      onSubmit={(event) => void submit(event)}
    >
      <h3 id={headingId}>Record your decision</h3>
      {decision.version !== seenVersion && (
        <div className="form-actions">
          <p className="field-hint">
            This decision changed after you opened it. Review it before you decide.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => {
              setSeenVersion(decision.version);
              setState({ phase: "editing" });
            }}
          >
            Use the latest version
          </Button>
        </div>
      )}

      <fieldset className="field" aria-invalid={statusIssue !== undefined || undefined}>
        <legend>Outcome</legend>
        <div className="radio-row status-picker">
          {OUTCOMES.map((outcome, i) => (
            <label key={outcome} className="radio" data-hue={DECISION_STATUS_HUES[outcome]}>
              <input
                ref={i === 0 ? firstChoice : undefined}
                type="radio"
                name="status"
                value={outcome}
                required
              />
              {DECISION_STATUS_LABELS[outcome]}
            </label>
          ))}
        </div>
        {statusIssue !== undefined && <p className="field-error">{statusIssue}</p>}
      </fieldset>

      <div className="field">
        <label htmlFor={wordsId}>Your words</label>
        <textarea
          id={wordsId}
          name="decisionText"
          required
          maxLength={4000}
          rows={5}
          aria-invalid={wordsIssue !== undefined || undefined}
          aria-describedby={wordsIssue !== undefined ? `${wordsId}-error` : undefined}
        />
        {wordsIssue !== undefined && (
          <p id={`${wordsId}-error`} className="field-error">
            {wordsIssue}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={sourceId}>Source link</label>
        <p id={sourceHintId} className="field-hint">
          The issue comment or page where you gave this decision.
        </p>
        <input
          id={sourceId}
          name="sourceUrl"
          type="url"
          inputMode="url"
          required
          aria-invalid={sourceIssue !== undefined || undefined}
          aria-describedby={
            sourceIssue !== undefined ? `${sourceHintId} ${sourceId}-error` : sourceHintId
          }
        />
        {sourceIssue !== undefined && (
          <p id={`${sourceId}-error`} className="field-error">
            {sourceIssue}
          </p>
        )}
      </div>

      {state.phase === "failed" && (
        <ErrorState error={state.error}>
          {state.error.code === "version_conflict" && (
            <p>
              It is now at version {state.error.currentVersion}. Review it above, then record again.
            </p>
          )}
          {state.error.code === "unauthorized" && (
            <Button type="button" variant="outline" size="sm" onClick={() => owner.rejectKey()}>
              Forget key
            </Button>
          )}
        </ErrorState>
      )}

      <div className="form-actions">
        <Button type="submit" disabled={sending || conflicted}>
          {sending ? "Recording" : "Record decision"}
        </Button>
        <p role="status" className="quiet">
          {state.phase === "recorded" ? "Decision recorded." : ""}
        </p>
      </div>
    </form>
  );
}
