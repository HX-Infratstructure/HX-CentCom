import { useCallback, useId, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  keepPreviousData,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptUpdatePages, adaptWorkspace, toAppError } from "@/components/adapt";
import { DecisionList } from "@/components/decision";
import { EmptyState, ErrorState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import {
  ATTENTION_LABELS,
  attentionOf,
  openTasks,
  splitInbox,
  type Attention,
  type Directory,
  type TaskView,
} from "@/components/model";
import { PullRequestList } from "@/components/pull-request";
import type { UpdateCounts, UpdatesPage } from "@/components/server-types";
import { TaskList } from "@/components/task";
import { UpdateList } from "@/components/update-item";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { prPages, tasksQuery, updatePages, type PrQuery, type UpdateQuery } from "@/lib/task-data";

type FeedFilters = { readonly agentId?: string | undefined; readonly taskId?: string | undefined };
type OverviewDeps = FeedFilters & { readonly attention?: Attention | undefined };
type OpenTaskFilters = ReturnType<typeof lists.openTasks.filters>;

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };
const DECISIONS_SHOWN = 5;
const PRS_SHOWN = 8;
const OPEN_PRS: PrQuery = { state: "open" };

/** The Open tasks list: blocked first, filtered and counted by its attention facet. */
function openTaskRows(tasks: readonly TaskView[], filters: OpenTaskFilters) {
  return lists.openTasks.local(openTasks(tasks), filters, { attention: attentionOf });
}

/** The ids of the rows the Open tasks list shows under `attention`. */
function tasksNeeding(attention: Attention, tasks: readonly TaskView[]): readonly string[] {
  return openTaskRows(tasks, { attention }).items.map((t) => t.id);
}

/**
 * The feed's read. The feed's filters and the attention filter combine with AND, so a reason narrows the feed to
 * `attentionIds`, its open tasks. null when no update can match: the feed then sends no request, and never `taskId`
 * beside `taskIds` or an empty `taskIds`.
 */
function feedQuery(
  { agentId, taskId }: FeedFilters,
  attentionIds: readonly string[] | undefined,
): UpdateQuery | null {
  if (attentionIds === undefined) return { agentId, taskId };
  if (taskId !== undefined) return attentionIds.includes(taskId) ? { agentId, taskId } : null;
  return attentionIds.length === 0 ? null : { agentId, taskIds: [...attentionIds] };
}

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
  /** Prefetches the feed read the first render derives from the same workspace, so server rendering has its data. */
  loader: async ({ context: { queryClient }, deps: { attention, ...feed } }) => {
    const workspace = queryClient.ensureQueryData(tasksQuery);
    // Only a reason makes the feed wait for the workspace, because its read names the reason's open tasks.
    const loadFeed = async () => {
      const attentionIds =
        attention === undefined
          ? undefined
          : tasksNeeding(attention, adaptWorkspace(await workspace).tasks);
      const query = feedQuery(feed, attentionIds);
      if (query !== null) await queryClient.ensureInfiniteQueryData(updatePages(query));
    };
    await Promise.all([
      workspace,
      loadFeed(),
      queryClient.ensureInfiniteQueryData(prPages(OPEN_PRS)),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Overview | HX-CentCom" },
      {
        name: "description",
        content: "The latest agent updates, the decisions waiting on the owner, and the open work.",
      },
      { property: "og:title", content: "Overview | HX-CentCom" },
      {
        property: "og:description",
        content: "The latest agent updates, the decisions waiting on the owner, and the open work.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Overview" error={error} />,
  component: Overview,
});

function Overview(): ReactNode {
  const search = Route.useSearch();
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const pending = splitInbox(ws.decisions).pending;
  const taskFilters = lists.openTasks.filters(search);
  const tasks = openTaskRows(ws.tasks, taskFilters);
  const decisionsId = useId();
  const tasksId = useId();

  return (
    <Workspace page="Overview">
      <div className="overview">
        <section aria-labelledby={decisionsId} className="overview-decisions">
          <h2 id={decisionsId} className="section-title">
            Needs your decision <span className="count">{pending.length}</span>
          </h2>
          {pending.length === 0 ? (
            <EmptyState>No decision is waiting on you.</EmptyState>
          ) : (
            <>
              <DecisionList decisions={pending.slice(0, DECISIONS_SHOWN)} />
              <Link to="/decisions" className="text-link section-link">
                {pending.length > DECISIONS_SHOWN
                  ? `All ${pending.length} pending decisions`
                  : "Decisions and history"}
              </Link>
            </>
          )}
        </section>

        <Feed dir={ws} tasks={ws.tasks} />

        <section aria-labelledby={tasksId} className="overview-tasks">
          <h2 id={tasksId} className="section-title">
            Open tasks <span className="count">{tasks.items.length}</span>
          </h2>
          <FilterBar search={lists.openTasks} counts={tasks.counts} label="Filter open tasks" />
          {tasks.items.length === 0 ? (
            <EmptyState>
              {lists.openTasks.active(taskFilters)
                ? "No open tasks match these filters."
                : "Every task is done and nothing is blocked."}
            </EmptyState>
          ) : (
            <TaskList tasks={tasks.items} />
          )}
        </section>

        <OpenPullRequests />
      </div>
    </Workspace>
  );
}

/** The first rows of the open PRs in the server's order (newest first); the heading counts all of them. */
function OpenPullRequests(): ReactNode {
  const headingId = useId();
  const { items, counts } = useSuspenseInfiniteQuery(prPages(OPEN_PRS)).data;
  const total = counts?.total ?? 0;
  const stored = counts?.stored ?? 0;
  return (
    <section aria-labelledby={headingId} className="overview-prs">
      <h2 id={headingId} className="section-title">
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
 * from the current workspace, so a refresh that changes them changes the feed's read.
 */
function Feed({ dir, tasks }: { dir: Directory; tasks: readonly TaskView[] }): ReactNode {
  const headingId = useId();
  const { attention, agentId, taskId } = Route.useLoaderDeps();
  const attentionIds = attention === undefined ? undefined : tasksNeeding(attention, tasks);
  const query = feedQuery({ agentId, taskId }, attentionIds);
  const filtered = attention !== undefined || agentId !== undefined || taskId !== undefined;
  return (
    <section aria-labelledby={headingId} className="overview-feed">
      <h2 id={headingId} className="section-title">
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
    ...updatePages(query),
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
