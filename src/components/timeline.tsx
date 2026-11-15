import type { CSSProperties, ReactNode } from "react";
import { formatUtcDay } from "./format";
import { GROUP_HUES, type TaskView } from "./model";
import { AgentBadge } from "./record-parts";
import { RecordLink } from "./url-state";

const DAY = 86_400_000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/** 52 weeks, the most whole weeks within 366 days: a stored plan of any length draws at most this many columns. */
const MAX_DAYS = 364;

type PlanWindow = { readonly start: number; readonly days: number };

const mondayOf = (t: number): number => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
const sundayOf = (t: number): number => t + ((7 - new Date(t).getUTCDay()) % 7) * DAY;

/**
 * Whole weeks, Monday to Sunday, around every planned start and due date in `tasks`. A plan longer than
 * MAX_DAYS shows MAX_DAYS from the week of its earliest date, or of the day 30 days before today when that is
 * later, and never runs past the plan's last week.
 */
function planWindow(tasks: readonly TaskView[], now: number): PlanWindow | null {
  const times = tasks.flatMap((t) =>
    [t.start_date, t.due_date].flatMap((d) => (d === null ? [] : [Date.parse(`${d}T00:00:00Z`)])),
  );
  if (times.length === 0) return null;
  const first = Math.min(...times);
  const start = mondayOf(first);
  const end = sundayOf(Math.max(...times));
  const days = Math.round((end - start) / DAY) + 1;
  if (days <= MAX_DAYS) return { start, days };
  const thirtyDaysAgo = now - (now % DAY) - 30 * DAY;
  const anchor = Math.min(Math.max(first, thirtyDaysAgo), end - (MAX_DAYS - 1) * DAY);
  return { start: mondayOf(anchor), days: MAX_DAYS };
}

function dayIndex(date: string, start: number): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / DAY);
}

/** The bar's first and last column inside the window, or null when the task has no bar there. */
function barSpan(
  { start_date: start, due_date: due }: TaskView,
  plan: PlanWindow,
): {
  readonly from: number;
  readonly to: number;
  readonly before: boolean;
  readonly after: boolean;
} | null {
  if (start === null || due === null) return null;
  const from = dayIndex(start, plan.start);
  const to = dayIndex(due, plan.start);
  if (to < 0 || from >= plan.days) return null;
  return {
    from: Math.max(from, 0),
    to: Math.min(to, plan.days - 1),
    before: from < 0,
    after: to >= plan.days,
  };
}

function Continues({ side }: { side: "before" | "after" }): ReactNode {
  return (
    <span>
      <span aria-hidden="true">{side === "before" ? "‹" : "›"}</span>
      <span className="sr-only">Continues {side} this window</span>
    </span>
  );
}

function plannedDates({ start_date: start, due_date: due }: TaskView): string {
  if (start !== null && due !== null) return `${formatUtcDay(start)} to ${formatUtcDay(due)}`;
  if (due !== null) return `Due ${formatUtcDay(due)}`;
  if (start !== null) return `Starts ${formatUtcDay(start)}`;
  return "No planned dates";
}

/** The planned dates of the given tasks as bars, in the order given. Bars take their group's color. */
export function TaskTimeline({ tasks }: { tasks: readonly TaskView[] }): ReactNode {
  const plan = planWindow(tasks, Date.now());
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
          {tasks.map((t) => {
            const bar = barSpan(t, plan);
            return (
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
                  {bar !== null && (
                    <span
                      className="gantt-bar"
                      data-hue={GROUP_HUES[t.group]}
                      style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}` }}
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
                      {bar.before && <Continues side="before" />}
                      <span className="bar-label">
                        {t.progress.total === 0
                          ? "No requirements"
                          : `${t.progress.proven} of ${t.progress.total} proven`}
                      </span>
                      {bar.after && <Continues side="after" />}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
