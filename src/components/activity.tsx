import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ErrorState } from "./list-states";
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ENTITY_LABELS,
  assertNever,
  type ActivityChange,
  type ActivityView,
  type AppError,
  type OwnerActions,
} from "./model";
import { AgentBadge, Time } from "./record-parts";
import { RecordLink } from "./url-state";

/** The activity log, newest first. Revert appears only in owner mode, and only on the rows that offer it. */
export function ActivityList({
  entries,
  owner,
}: {
  entries: readonly ActivityView[];
  /** null in public mode: no row offers Revert. */
  owner: OwnerActions | null;
}): ReactNode {
  return (
    <ul className="record-list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <ActivityRow entry={entry} owner={owner} />
        </li>
      ))}
    </ul>
  );
}

function ActivityRow({
  entry,
  owner,
}: {
  entry: ActivityView;
  owner: OwnerActions | null;
}): ReactNode {
  return (
    <article className="record-row">
      <h3 className="row-title">{ACTIVITY_ACTION_LABELS[entry.action]}</h3>
      {entry.changes.length > 0 && (
        <ul className="change-list">
          {entry.changes.map((change) => (
            <li key={change.field}>
              <span className="quiet">{change.field}</span> {changeText(change)}
            </li>
          ))}
        </ul>
      )}
      <div className="row-meta">
        <ChangedRecord entry={entry} />
        <AgentBadge agent={entry.by} variant="chip" />
        <Time at={entry.createdAt} />
        {entry.commit_sha !== null && (
          <code className="sha" title={entry.commit_sha}>
            {entry.commit_sha.slice(0, 7)}
          </code>
        )}
        {entry.run_id !== null && <span>Run {entry.run_id}</span>}
      </div>
      {owner !== null && entry.revertible && <RevertAction entry={entry} owner={owner} />}
    </article>
  );
}

function changeText(change: ActivityChange): string {
  switch (change.kind) {
    case "value":
      return `${change.from} → ${change.to}`;
    case "edited":
      return "edited";
    default:
      return assertNever(change);
  }
}

function restoreText(change: ActivityChange): string {
  switch (change.kind) {
    case "value":
      return `${change.field} goes back from ${change.to} to ${change.from}.`;
    case "edited":
      return `${change.field} goes back to its earlier value.`;
    default:
      return assertNever(change);
  }
}

/** The record as a person names it, for example "Task IRP-04". A requirement's id is a UUID, so it goes by its task. */
function recordName(entry: ActivityView): string {
  if (entry.entity === "requirement" && entry.opens !== null) {
    return `Requirement on ${entry.opens.id}`;
  }
  return `${ACTIVITY_ENTITY_LABELS[entry.entity]} ${entry.entity_id}`;
}

function ChangedRecord({ entry }: { entry: ActivityView }): ReactNode {
  if (entry.opens === null) return <span>{recordName(entry)}</span>;
  return (
    <RecordLink kind={entry.opens.kind} id={entry.opens.id} className="id-link">
      {recordName(entry)}
    </RecordLink>
  );
}

type RevertState =
  | { readonly phase: "idle" }
  | { readonly phase: "sending" }
  | { readonly phase: "reverted" }
  | { readonly phase: "failed"; readonly error: AppError };

function RevertAction({ entry, owner }: { entry: ActivityView; owner: OwnerActions }): ReactNode {
  const [state, setState] = useState<RevertState>({ phase: "idle" });

  async function revert() {
    setState({ phase: "sending" });
    const outcome = await owner.revert(entry.id);
    setState(outcome.ok ? { phase: "reverted" } : { phase: "failed", error: outcome.error });
  }

  if (state.phase === "reverted") {
    return (
      <p role="status" className="quiet">
        Reverted.
      </p>
    );
  }
  const sending = state.phase === "sending";
  return (
    <div className="grid justify-items-start gap-2 pt-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={sending}>
            {sending ? "Reverting" : "Revert"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {recordName(entry)} to how it was before this change?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                {entry.changes.length > 0 && (
                  <ul className="grid gap-1 text-foreground">
                    {entry.changes.map((change) => (
                      <li key={change.field}>{restoreText(change)}</li>
                    ))}
                  </ul>
                )}
                <p>The revert is logged as a new change at the top of the activity list.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revert()}>Revert</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state.phase === "failed" && (
        <ErrorState
          error={state.error}
          // A revert sends no If-Match, so its conflict means a later change replaced this one, not a stale page.
          title={
            state.error.code === "version_conflict"
              ? "This change is no longer the record's latest."
              : undefined
          }
          retry={state.error.code === "unreachable" ? () => void revert() : undefined}
        >
          {state.error.code === "version_conflict" && (
            <p>Only a record&apos;s latest change can be reverted.</p>
          )}
          {state.error.code === "unauthorized" && (
            <Button type="button" variant="outline" size="sm" onClick={() => owner.rejectKey()}>
              Forget key
            </Button>
          )}
        </ErrorState>
      )}
    </div>
  );
}
