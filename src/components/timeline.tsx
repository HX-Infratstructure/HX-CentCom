import type { CSSProperties, ReactNode } from "react";
import { formatUtcDay } from "./format";
import { GROUP_HUES, type TaskView } from "./model";
import { AgentBadge } from "./record-parts";
import { RecordLink } from "./url-state";

const DAY = 86_400_000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Whole weeks, Monday to Sunday, around every planned start and due date in `tasks`. */
function planWindow(
  tasks: readonly TaskView[],
): { readonly start: number; readonly days: number } | null {
  const times = tasks.flatMap((t) =>
    [t.start_date, t.due_date].flatMap((d) => (d === null ? [] : [Date.parse(`${d}T00:00:00Z`)])),
  );
  if (times.length === 0) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY;
  const end = last + ((7 - new Date(last).getUTCDay()) % 7) * DAY;
  return { start, days: Math.round((end - start) / DAY) + 1 };
}

function dayIndex(date: string, start: number): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / DAY);
}

function plannedDates({ start_date: start, due_date: due }: TaskView): string {
  if (start !== null && due !== null) return `${formatUtcDay(start)} to ${formatUtcDay(due)}`;
  if (due !== null) return `Due ${formatUtcDay(due)}`;
  if (start !== null) return `Starts ${formatUtcDay(start)}`;
  return "No planned dates";
}

/** The planned dates of the given tasks as bars, in the order given. Bars take their group's color. */
export function TaskTimeline({ tasks }: { tasks: readonly TaskView[] }): ReactNode {
  const plan = planWindow(tasks);
  if (plan === null) {
    return <p className="quiet">None of these tasks has planned dates.</p>;
  }
  const dates = Array.from({ length: plan.days }, (_, i) => new Date(plan.start + i * DAY));
  const columns = { "--gantt-days": plan.days } as CSSProperties;
  return (
    <div className="gantt-scroll">
      <div className="gantt" style={columns}>
        <div className="gantt-header" aria-hidden="true">
          <span className="gantt-label-head">
            {formatUtcDay(dates[0]?.toISOString() ?? "")} to{" "}
            {formatUtcDay(dates.at(-1)?.toISOString() ?? "")}
          </span>
          <div className="gantt-days">
            {dates.map((d) => (
              <span key={d.getTime()} data-weekend={d.getUTCDay() % 6 === 0 || undefined}>
                {WEEKDAYS[d.getUTCDay()]}
                <b>{d.getUTCDate()}</b>
              </span>
            ))}
          </div>
        </div>
        <ul className="gantt-rows">
          {tasks.map((t) => (
            <li key={t.id} className="gantt-row">
              <div className="gantt-label">
                <RecordLink kind="task" id={t.id} className="gantt-title">
                  {t.title}
                </RecordLink>
                <span className="gantt-meta">
                  <code className="record-id">{t.id}</code>
                  {t.assignee !== null && <AgentBadge agent={t.assignee} variant="person" />}
                </span>
                <span className="gantt-dates">{plannedDates(t)}</span>
              </div>
              <div className="gantt-track">
                <span className="gantt-cells" aria-hidden="true">
                  {dates.map((d) => (
                    <span key={d.getTime()} data-weekend={d.getUTCDay() % 6 === 0 || undefined} />
                  ))}
                </span>
                {t.start_date !== null && t.due_date !== null && (
                  <span
                    className="gantt-bar"
                    data-hue={GROUP_HUES[t.group]}
                    style={{
                      gridColumn: `${dayIndex(t.start_date, plan.start) + 1} / ${dayIndex(t.due_date, plan.start) + 2}`,
                    }}
                  >
                    <span
                      className="bar-fill"
                      style={{
                        inlineSize:
                          t.progress.total === 0
                            ? 0
                            : `${(t.progress.proven / t.progress.total) * 100}%`,
                      }}
                    />
                    <span className="bar-label">
                      {t.progress.total === 0
                        ? "No requirements"
                        : `${t.progress.proven} of ${t.progress.total} proven`}
                    </span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
