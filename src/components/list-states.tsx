import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { AppError } from "./model";

/** The route writes the sentence, because only it knows whether filters or an empty table caused the emptiness. */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="list-empty" role="status">
      <p>{children}</p>
      {action}
    </div>
  );
}

export const ERROR_COPY = {
  unauthorized: "The owner key was not accepted.",
  forbidden: "This key is not allowed to make that change.",
  not_found: "This record no longer exists.",
  version_conflict: "This record changed after you opened it.",
  not_revertible: "This change cannot be reverted.",
  conflict: "A record with this id already exists.",
  invalid: "Some fields need a change.",
  idempotency_mismatch: "An earlier request used the same request key with different content.",
  unreachable: "The request did not complete.",
} as const satisfies Record<AppError["code"], string>;

export function ErrorState({
  error,
  title = ERROR_COPY[error.code],
  retry,
  children,
}: {
  error: AppError;
  /** Replaces the code's generic title when the action knows the cause better. */
  title?: string | undefined;
  retry?: (() => void) | undefined;
  /** Extra guidance or actions for this error, placed under the message. */
  children?: ReactNode;
}): ReactNode {
  return (
    <div role="alert" className="error-state">
      <p className="error-title">{title}</p>
      {error.message !== "" && <p className="quiet">{error.message}</p>}
      {children}
      {retry !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** The singular of every list noun. A list that passes a new noun adds it here, or the call does not compile. */
const SINGULAR = {
  updates: "update",
  decisions: "decision",
  lessons: "lesson",
  "RAID items": "RAID item",
  "pull requests": "pull request",
  "activity entries": "activity entry",
  tasks: "task",
} as const;

export type ShowMoreProps = {
  readonly shown: number;
  readonly total?: number | undefined;
  /** Plural, for example "updates": a key of SINGULAR, which gives the word for one item. */
  readonly noun: keyof typeof SINGULAR;
  readonly hasMore: boolean;
  readonly pending: boolean;
  readonly error?: AppError | null | undefined;
  readonly onShowMore: () => void;
};

function showing(shown: number, total: number | undefined, noun: ShowMoreProps["noun"]): string {
  if (total !== undefined && shown < total) return `Showing ${shown} of ${total} ${noun}.`;
  const count = total ?? shown;
  if (count === 1) return `Showing 1 ${SINGULAR[noun]}.`;
  return total === undefined ? `Showing ${count} ${noun}.` : `Showing all ${count} ${noun}.`;
}

/** The button stays in place while new rows append above it, so keyboard focus stays on it. */
export function ShowMore({
  shown,
  total,
  noun,
  hasMore,
  pending,
  error,
  onShowMore,
}: ShowMoreProps): ReactNode {
  if (shown === 0) return null;
  return (
    <div className="show-more">
      <p aria-live="polite">{showing(shown, total, noun)}</p>
      {hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onShowMore}
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? "Loading" : "Show more"}
        </Button>
      )}
      {error && (
        <p role="alert" className="error-inline">
          Could not load more {noun}. {error.message}
        </p>
      )}
    </div>
  );
}
