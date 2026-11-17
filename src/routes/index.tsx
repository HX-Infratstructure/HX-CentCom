import { useCallback, useId, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  keepPreviousData,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  adaptDecisionPages,
  adaptShell,
  adaptTaskPages,
  adaptUpdatePages,
  toAppError,
} from "@/components/adapt";
import { DecisionList } from "@/components/decision";
import { EmptyState, ErrorState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import {
  ATTENTION_LABELS,
  splitInbox,
  type Attention,
  type Directory,
  type ShellView,
  type StatusDirectory,
} from "@/components/model";
import { PullRequestList } from "@/components/pull-request";
import type {
  DecisionsPage,
  TasksPage,
  UpdateCounts,
  UpdatesPage,
} from "@/components/server-types";
import { StatusOverview, TaskTable } from "@/components/task";
import { UpdateList } from "@/components/update-item";
import { FilterBar, FilterLink } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import {
  prPages,
  shellQuery,
  taskPages,
  updatePages,
  type PrQuery,
  type UpdateQuery,
} from "@/lib/task-data";
import { listDecisions, listTasks } from "@/lib/tasks.functions";

type FeedFilters = { readonly agentId?: string | undefined; readonly taskId?: string | undefined };
type OverviewDeps = FeedFilters & { readonly attention?: Attention | undefined };
const shellView = { ...shellQuery, select: adaptShell };
const DECISIONS_SHOWN = 5;
const PRS_SHOWN = 8;
const OPEN_PRS: PrQuery = { state: "open" };

/**
 * The first page of the Pending decisions. Past 100 pending decisions only the latest 100 requests are ranked, so an
 * older request that blocks more tasks can miss the top of the list.
 */
const PENDING_PAGE = { status: "Pending", limit: 100 } as const;
const pendingDecisionsQuery = queryOptions({
  queryKey: ["decisions", "overview", PENDING_PAGE],
  queryFn: () => listDecisions({ data: PENDING_PAGE }),
});

/** The update read caps `taskIds` at 100, so the feed reads at most that many of the reason's open tasks. */
const ATTENTION_IDS = 100;

/** The first page of the reason's open tasks, which holds every one of them when the server counts at most 100. */
function attentionPageQuery(attention: Attention | undefined) {
  return queryOptions({
    queryKey: ["tasks", "attention-ids", attention],
    queryFn:
      attention === undefined
        ? skipToken
        : () => listTasks({ data: { open: true, attention, limit: ATTENTION_IDS } }),
  });
}

/** The ids of the reason's open tasks, or undefined when the server holds more than the page shows. */
function attentionIdsOf(page: TasksPage): readonly string[] | undefined {
  return page.counts.total <= ATTENTION_IDS ? page.items.map((t) => t.id) : undefined;
}

/**
 * The feed's read. The feed's filters and the attention filter combine with AND. A reason goes to the server, which
 * selects the reason's open tasks however many there are. The server refuses `taskId` beside `attention`, so a chosen
 * task is read alone when it is one of `attentionIds`; null when it is not, and the feed then sends no request.
 */
function feedQuery(
  { agentId, taskId }: FeedFilters,
  attention: Attention | undefined,
  attentionIds: readonly string[] | undefined,
): UpdateQuery | null {
  if (attention === undefined) return { agentId, taskId };
  if (taskId === undefined) return { agentId, attention };
  return attentionIds?.includes(taskId) === true ? { agentId, taskId } : null;
}

const DESCRIPTION =
  "The latest agent updates, the decisions waiting on the owner, and the open work.";

export const Route = createFileRoute("/")({
  validateSearch: (raw) => ({
    ...lists.overviewFeed.validate(raw),
    ...lists.openTasks.validate(raw),
  }),
  loaderDeps: ({ search }): OverviewDeps => {
    const feed = lists.overviewFeed.filters(search);
    return {
      agentId: feed.agent,
      taskId: feed.task,
      attention: lists.openTasks.filters(search).attention,
    };
  },
  /** Prefetches the reads the first render makes, so server rendering has their data. */
  loader: async ({ context: { queryClient }, deps: { attention, ...feed } }) => {
    // Only a reason makes the feed wait for a task read, because its read is keyed by the reason's open tasks.
    const loadFeed = async () => {
      const attentionIds =
        attention === undefined
          ? undefined
          : attentionIdsOf(await queryClient.ensureQueryData(attentionPageQuery(attention)));
      const query = feedQuery(feed, attention, attentionIds);
      if (query !== null) {
        await queryClient.ensureInfiniteQueryData(updatePages(query, attentionIds));
      }
    };
    await Promise.all([
      loadFeed(),
      queryClient.ensureInfiniteQueryData(taskPages({ open: true, attention })),
      queryClient.ensureQueryData(shellQuery),
      queryClient.ensureQueryData(pendingDecisionsQuery),
      queryClient.ensureInfiniteQueryData(prPages(OPEN_PRS)),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Overview | HX-CentCom" },
      {
        name: "description",
        content: DESCRIPTION,
      },
      { property: "og:title", content: "Overview | HX-CentCom" },
      {
        property: "og:description",
        content: DESCRIPTION,
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Overview" error={error} />,
  component: Overview,
});

const OPEN_TASKS_ID = "open-tasks";

function Overview(): ReactNode {
  const { data: shell } = useSuspenseQuery(shellView);
  const { pending, total: pendingTotal } = usePendingDecisions(shell);
  const decisionsId = useId();

  return (
    <Workspace page="Overview" description={DESCRIPTION}>
      <div className="dashboard">
        <SummaryWidgets
          counts={shell.counts}
          pendingDecisions={pendingTotal}
          statuses={shell.statuses}
        />

        <div className="dashboard-columns">
          <div className="dashboard-stack">
            <section aria-labelledby={decisionsId} className="widget overview-decisions">
              <h2 id={decisionsId} className="widget-title">
                Needs your decision <span className="count">{pendingTotal}</span>
              </h2>
              {pending.length === 0 ? (
                <EmptyState>No decision is waiting on you.</EmptyState>
              ) : (
                <>
                  <DecisionList decisions={pending.slice(0, DECISIONS_SHOWN)} />
                  <Link to="/decisions" className="text-link section-link">
                    {pendingTotal > DECISIONS_SHOWN
                      ? `All ${pendingTotal} pending decisions`
                      : "Decisions and history"}
                  </Link>
                </>
              )}
            </section>

            <OpenPullRequests />
          </div>

          <Feed dir={shell} />
        </div>

        <OpenTasks dir={shell} />
      </div>
    </Workspace>
  );
}

/**
 * The server's open tasks under the URL's reason, blocked first. The compact table groups the rows and keeps the
 * server's order in each group.
 */
function OpenTasks({ dir }: { dir: Directory }): ReactNode {
  const headingId = useId();
  const { attention } = Route.useLoaderDeps();
  const select = useCallback(
    (data: InfiniteData<TasksPage, string | undefined>) => adaptTaskPages(data.pages, dir),
    [dir],
  );
  const pages = useSuspenseInfiniteQuery({ ...taskPages({ open: true, attention }), select });
  const { items, counts } = pages.data;
  const total = counts?.total ?? 0;
  return (
    <section id={OPEN_TASKS_ID} aria-labelledby={headingId} className="overview-tasks">
      <div className="section-bar">
        <h2 id={headingId} className="section-title">
          Open tasks <span className="count">{total}</span>
        </h2>
        <FilterBar
          search={lists.openTasks}
          counts={{ attention: counts?.byAttention ?? {} }}
          label="Filter open tasks"
        />
      </div>
      {items.length === 0 ? (
        <EmptyState>
          {attention !== undefined
            ? "No open tasks match these filters."
            : "Every task is done and nothing is blocked."}
        </EmptyState>
      ) : (
        <TaskTable tasks={items} compact />
      )}
      <ShowMore
        shown={items.length}
        total={total}
        noun="tasks"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </section>
  );
}

/** The loaded Pending page ranked by `splitInbox`, and how many pending decisions the server holds. */
function usePendingDecisions({ agents }: ShellView): {
  readonly pending: ReturnType<typeof splitInbox>["pending"];
  readonly total: number;
} {
  const select = useCallback(
    (page: DecisionsPage) => ({
      pending: splitInbox(adaptDecisionPages([page], agents).items).pending,
      total: page.counts.total,
    }),
    [agents],
  );
  return useSuspenseQuery({ ...pendingDecisionsQuery, select }).data;
}

/**
 * The dashboard's numbers, from the server's counts: open tasks and their attention reasons, pending decisions, and the
 * open PR count. A blocked or owner number opens the open tasks under it. The pending count is the Pending page's
 * total, the one "Needs your decision" shows, so a refetch between the shell and that page cannot show two numbers.
 */
function SummaryWidgets({
  counts,
  pendingDecisions,
  statuses,
}: {
  counts: ShellView["counts"];
  pendingDecisions: number;
  statuses: StatusDirectory;
}): ReactNode {
  const tasks = counts.tasks;
  const openPrs = useSuspenseInfiniteQuery(prPages(OPEN_PRS)).data.counts?.total ?? 0;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="summary">
      <h2 id={headingId} className="sr-only">
        Summary
      </h2>
      <ul className="number-widgets">
        <li data-hue="blue">
          <FilterLink
            search={lists.openTasks}
            set={{ attention: undefined }}
            hash={OPEN_TASKS_ID}
            className="number-widget"
          >
            <WidgetNumber label="Open tasks" value={tasks.open} />
          </FilterLink>
        </li>
        <li data-hue="red">
          <FilterLink
            search={lists.openTasks}
            set={{ attention: "blocked" }}
            hash={OPEN_TASKS_ID}
            className="number-widget"
          >
            <WidgetNumber label={ATTENTION_LABELS.blocked} value={tasks.blocked} />
          </FilterLink>
        </li>
        <li data-hue="purple">
          <FilterLink
            search={lists.openTasks}
            set={{ attention: "owner" }}
            hash={OPEN_TASKS_ID}
            className="number-widget"
          >
            <WidgetNumber label={ATTENTION_LABELS.owner} value={tasks.owner} />
          </FilterLink>
        </li>
        <li data-hue="orange">
          <Link to="/decisions" className="number-widget">
            <WidgetNumber label="Pending decisions" value={pendingDecisions} />
          </Link>
        </li>
        <li data-hue="green">
          <Link to="/pull-requests" search={OPEN_PRS} className="number-widget">
            <WidgetNumber label="Open pull requests" value={openPrs} />
          </Link>
        </li>
      </ul>
      <div className="widget status-widget">
        <h3 className="widget-title">
          Tasks by status <span className="count">{tasks.total}</span>
        </h3>
        {tasks.total === 0 ? (
          <p className="quiet">No tasks yet.</p>
        ) : (
          <StatusOverview byStatus={tasks.byStatus} statuses={statuses} />
        )}
      </div>
    </section>
  );
}

/** One number card's content. The label comes first, so the card's link reads "Blocked 4". */
function WidgetNumber({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <>
      <span className="number-label">{label}</span>
      <span className="number-value">{value}</span>
    </>
  );
}

/** The first rows of the open PRs in the server's order (newest first); the heading counts all of them. */
function OpenPullRequests(): ReactNode {
  const headingId = useId();
  const { items, counts } = useSuspenseInfiniteQuery(prPages(OPEN_PRS)).data;
  const total = counts?.total ?? 0;
  const stored = counts?.stored ?? 0;
  return (
    <section aria-labelledby={headingId} className="widget overview-prs">
      <h2 id={headingId} className="widget-title">
        Open pull requests <span className="count">{total}</span>
      </h2>
      {total === 0 ? (
        <EmptyState>
          {stored === 0
            ? "No GitHub sync has stored pull requests yet."
            : "The last GitHub sync found no open pull requests."}
        </EmptyState>
      ) : (
        <PullRequestList prs={items.slice(0, PRS_SHOWN)} />
      )}
      {total > PRS_SHOWN ? (
        <Link to="/pull-requests" search={OPEN_PRS} className="text-link section-link">
          All {total} open pull requests
        </Link>
      ) : (
        stored > 0 && (
          <Link to="/pull-requests" className="text-link section-link">
            All pull requests
          </Link>
        )
      )}
    </section>
  );
}

/**
 * The attention control stays on the Open tasks list; the feed names the reason it applies. The reason's tasks come
 * from a bounded task read, so a refresh that changes them changes the feed's read.
 */
function Feed({ dir }: { dir: Directory }): ReactNode {
  const headingId = useId();
  const { attention, agentId, taskId } = Route.useLoaderDeps();
  const { data: attentionIds } = useQuery({
    ...attentionPageQuery(attention),
    select: attentionIdsOf,
  });
  const query = feedQuery({ agentId, taskId }, attention, attentionIds);
  const filtered = attention !== undefined || agentId !== undefined || taskId !== undefined;
  return (
    <section aria-labelledby={headingId} className="widget overview-feed">
      <h2 id={headingId} className="widget-title">
        Latest updates
      </h2>
      {attention !== undefined && (
        <p className="quiet">
          Only updates on open tasks that need attention: {ATTENTION_LABELS[attention]}
        </p>
      )}
      {query === null ? (
        <>
          <FeedFilters dir={dir} counts={null} attentionIds={attentionIds} />
          <EmptyState>No updates match these filters.</EmptyState>
        </>
      ) : (
        <FeedPages dir={dir} query={query} filtered={filtered} attentionIds={attentionIds} />
      )}
    </section>
  );
}

/**
 * Not a suspense read: the loader prefetched the first render's read, and a read a later refresh asks for loads while
 * the previous one stays on screen.
 */
function FeedPages({
  dir,
  query,
  filtered,
  attentionIds,
}: {
  dir: Directory;
  query: UpdateQuery;
  filtered: boolean;
  attentionIds: readonly string[] | undefined;
}): ReactNode {
  const select = useCallback(
    (data: InfiniteData<UpdatesPage, string | undefined>) => adaptUpdatePages(data.pages, dir),
    [dir],
  );
  const pages = useInfiniteQuery({
    ...updatePages(query, attentionIds),
    select,
    placeholderData: keepPreviousData,
  });
  const items = pages.data?.items ?? [];
  const counts = pages.data?.counts ?? null;
  return (
    <>
      <FeedFilters dir={dir} counts={counts} attentionIds={attentionIds} />
      {pages.isPending && <p className="quiet">Loading updates.</p>}
      {pages.isError && !pages.isFetchNextPageError && (
        <ErrorState error={toAppError(pages.error)} retry={() => void pages.refetch()} />
      )}
      {pages.isSuccess && items.length === 0 && (
        <EmptyState>
          {filtered ? "No updates match these filters." : "No agent has posted an update yet."}
        </EmptyState>
      )}
      {items.length > 0 && <UpdateList updates={items} />}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="updates"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </>
  );
}

/**
 * With no read (null counts), each facet shows only its active chip. Under a reason the Task chips offer only the
 * reason's tasks, because the server's task counts leave out the feed's own `taskIds`.
 */
function FeedFilters({
  dir,
  counts,
  attentionIds,
}: {
  dir: Directory;
  counts: UpdateCounts | null;
  attentionIds: readonly string[] | undefined;
}): ReactNode {
  const byTask = counts?.byTask ?? {};
  const task =
    attentionIds === undefined
      ? byTask
      : Object.fromEntries(Object.entries(byTask).filter(([id]) => attentionIds.includes(id)));
  return (
    <FilterBar
      search={lists.overviewFeed}
      counts={{ agent: counts?.byAgent ?? {}, task }}
      label="Filter updates"
      agents={dir.agents}
    />
  );
}
