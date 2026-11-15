import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { AgentRef, BoardHue } from "./model";
import { AgentBadge } from "./record-parts";

/** A column's header text and width; `auto` takes what the fixed columns leave. */
export type BoardColumn = { readonly name: string; readonly width: number | "auto" };

/** The width the `auto` column keeps before the table scrolls sideways inside its group. */
const AUTO_MIN = 200;

/**
 * One board group: a heading in the group's color with a collapse caret and a count, and whatever the group holds.
 * The section is a region named by its heading, so "Show more" inside it belongs to the group. Pass `open` and
 * `onToggle` when the caller must know the state, as History does to fetch only once opened.
 */
export function BoardGroup({
  title,
  hue,
  count,
  open: controlled,
  onToggle,
  children,
}: {
  title: string;
  hue: BoardHue;
  count: ReactNode;
  open?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  children: ReactNode;
}): ReactNode {
  const [own, setOwn] = useState(true);
  const open = controlled ?? own;
  const headingId = useId();
  const bodyId = useId();
  return (
    <section className="board-group" data-hue={hue} aria-labelledby={headingId}>
      <h2 id={headingId} className="group-title">
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle ?? (() => setOwn(!own))}
        >
          <ChevronRight aria-hidden="true" />
          {title}
        </button>
        <span className="count">{count}</span>
      </h2>
      <div id={bodyId} className="group-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A board table with the group's colored edge down its first column. Rows lead with a `th scope="row"`. */
export function BoardTable({
  columns,
  children,
}: {
  columns: readonly BoardColumn[];
  children: ReactNode;
}): ReactNode {
  const minWidth = columns.reduce(
    (sum, { width }) => sum + (width === "auto" ? AUTO_MIN : width),
    0,
  );
  return (
    <div className="table-scroll">
      <table className="board-table" style={{ minWidth }}>
        <colgroup>
          {columns.map(({ name, width }) => (
            <col key={name} style={width === "auto" ? undefined : { width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map(({ name }) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <BoardBody>{children}</BoardBody>
      </table>
    </div>
  );
}

/** Controls that keep their own action inside a row, so a click on one does not also open the row. */
const OWN_ACTION = "a[href], button, input, select, textarea, label, summary, [role='button']";

/**
 * A board's rows. A click anywhere on a row follows the link in its header cell, which stays the keyboard's way in,
 * so the row opens what that link opens. A click on another control, a modified click and the click that ends a text
 * selection keep the browser's behavior.
 */
export function BoardBody({ children }: { children: ReactNode }): ReactNode {
  return <tbody onClick={followRowLink}>{children}</tbody>;
}

function followRowLink(event: MouseEvent<HTMLTableSectionElement>): void {
  const { target } = event;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (!(target instanceof Element) || target.closest(OWN_ACTION) !== null) return;
  if (window.getSelection()?.isCollapsed === false) return;
  target.closest("tr")?.querySelector<HTMLAnchorElement>(":scope > th a[href]")?.click();
}

/** monday's status column: the whole cell in the value's color, the label in white. An absent value stays blank. */
export function StatusCell({
  hue,
  title,
  children,
}: {
  hue: BoardHue | null;
  title?: string | undefined;
  children?: ReactNode;
}): ReactNode {
  if (hue === null) return <td className="status-cell" data-empty="true" />;
  return (
    <td className="status-cell" data-hue={hue} title={title}>
      {children}
    </td>
  );
}

/** A person column: the agent's avatar and name, or monday's empty avatar when no source names one. */
export function PersonCell({ agent, empty }: { agent: AgentRef | null; empty: string }): ReactNode {
  return (
    <td>
      {agent !== null ? (
        <AgentBadge agent={agent} variant="person" />
      ) : (
        <span className="agent-person unassigned" title={empty}>
          <span className="avatar" aria-hidden="true" />
          <span className="sr-only">{empty}</span>
        </span>
      )}
    </td>
  );
}
