import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { verdict } from "./overview.ts";
import { TasksPage } from "./pages/tasks-page.ts";

interface WorkspaceTask {
  readonly id: string;
  readonly repository: string | null;
  readonly stale: boolean;
}

interface Workspace {
  readonly tasks: readonly WorkspaceTask[];
  readonly updatesCursor: string | null;
}

interface UpdateList {
  readonly items: readonly { readonly task_id: string | null }[];
}

function notExecuted(reason: string, evidence: Record<string, unknown>): CheckOutcome {
  return { status: "LIVE_NOT_EXECUTED", evidence, reason };
}

async function labelsAndKanban(ctx: CheckContext): Promise<CheckOutcome> {
  const page = new TasksPage(ctx.session);
  await page.open();
  const labels = await page.statusLabels();
  await page.open("view=kanban");
  const kanban = await page.kanbanGroups();
  const screenshot = await ctx.screenshot("tasks-labels-kanban");
  const ok = labels.length > 0 && kanban.heads.length > 0 && kanban.cards > 0;
  return verdict(ok, { labels, kanban, screenshot }, "no status labels, kanban groups or cards");
}

async function feedBadges(ctx: CheckContext): Promise<CheckOutcome> {
  const { items } = await ctx.api.getJson<UpdateList>("/api/v1/updates");
  const taskId = items.find((item) => item.task_id)?.task_id;
  if (!taskId) return notExecuted("no update names a task", { items: items.length });
  const page = new TasksPage(ctx.session);
  await page.open(new URLSearchParams({ task: taskId }).toString(), "#updates");
  const feed = await page.feedItems();
  const screenshot = await ctx.screenshot("task-feed-badges");
  const ok = feed.length > 0 && feed.every((item) => item.badges > 0);
  return verdict(ok, { taskId, feed, screenshot }, "feed is empty or an update has no agent badge");
}

function narrowingRepo(tasks: readonly WorkspaceTask[]): [string, number] | undefined {
  const tally = new Map<string, number>();
  for (const task of tasks) {
    if (task.repository) tally.set(task.repository, (tally.get(task.repository) ?? 0) + 1);
  }
  return [...tally].filter(([, count]) => count < tasks.length).sort((a, b) => a[1] - b[1])[0];
}

async function filterNarrows(ctx: CheckContext): Promise<CheckOutcome> {
  const { tasks } = await ctx.api.getJson<Workspace>("/api/v1/workspace");
  const pick = narrowingRepo(tasks);
  if (!pick) return notExecuted("no repository narrows the tasks", { tasks: tasks.length });
  const [repo, expected] = pick;
  const page = new TasksPage(ctx.session);
  await page.open(new URLSearchParams({ repo }).toString());
  const rows = await page.rowCount();
  const screenshot = await ctx.screenshot("tasks-filter");
  return verdict(
    rows === expected,
    { repo, expected, rows, screenshot },
    "filtered rows differ from the API count",
  );
}

async function updatesShowMore(ctx: CheckContext): Promise<CheckOutcome> {
  const { updatesCursor } = await ctx.api.getJson<Workspace>("/api/v1/workspace");
  const page = new TasksPage(ctx.session);
  await page.open();
  const before = await page.feedCount();
  if (!updatesCursor) return notExecuted("the update log has 20 or fewer", { before });
  const after = await page.showMore();
  const screenshot = await ctx.screenshot("updates-show-more");
  return verdict(after > before, { before, after, screenshot }, "Show more added no rows");
}

async function staleBadge(ctx: CheckContext): Promise<CheckOutcome> {
  const { tasks } = await ctx.api.getJson<Workspace>("/api/v1/workspace");
  const page = new TasksPage(ctx.session);
  await page.open();
  const rows = await page.rows();
  const screenshot = await ctx.screenshot("stale-badge");
  const expected = tasks
    .filter((task) => task.stale)
    .map((task) => task.id)
    .sort();
  const shown = rows
    .filter((row) => row.stale)
    .map((row) => row.id)
    .sort();
  const ok = shown.join() === expected.join();
  return verdict(
    ok,
    { expected, shown, rows: rows.length, screenshot },
    "Stale commit badges differ from the API",
  );
}

export const checks: readonly LiveCheck[] = [
  { id: "tasks-labels-kanban", requirement: "R1", run: labelsAndKanban },
  { id: "task-feed-badges", requirement: "R5", run: feedBadges },
  { id: "tasks-filter", requirement: "R12", run: filterNarrows },
  { id: "updates-show-more", requirement: "R12", run: updatesShowMore },
  { id: "stale-badge", requirement: "R8", run: staleBadge },
];
