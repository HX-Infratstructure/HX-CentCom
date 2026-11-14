import { useCallback, useId, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptUpdatePages, adaptWorkspace, toAppError } from "@/components/adapt";
import { DecisionList } from "@/components/decision";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { splitInbox, type Directory, type TaskView } from "@/components/model";
import { PullRequestList } from "@/components/pull-request";
import type { UpdatesPage } from "@/components/server-types";
import { TaskList } from "@/components/task";
import { UpdateList } from "@/components/update-item";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { listUpdates } from "@/lib/tasks.functions";
import { tasksQuery } from "@/lib/task-data";

type FeedQuery = { readonly agentId?: string | undefined; readonly taskId?: string | undefined };

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };
const DECISIONS_SHOWN = 5;
const PRS_SHOWN = 8;

function updatePages(query: FeedQuery) {
  return infiniteQueryOptions({
    queryKey: ["updates", query],
    queryFn: ({ pageParam }) => listUpdates({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const Route = createFileRoute("/")({
  validateSearch: (raw) => lists.overviewFeed.validate(raw),
  loaderDeps: ({ search }): FeedQuery => {
    const feed = lists.overviewFeed.filters(search);
    return { agentId: feed.agent, taskId: feed.task };
  },
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery),
      queryClient.ensureInfiniteQueryData(updatePages(deps)),
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

/** Blocked tasks first, then the rest of the unfinished work in workspace order. */
function openTasks(tasks: readonly TaskView[]): readonly TaskView[] {
  const open = tasks.filter((t) => t.blocked_on !== "none" || t.group !== "done");
  return [
    ...open.filter((t) => t.blocked_on !== "none"),
    ...open.filter((t) => t.blocked_on === "none"),
  ];
}

function Overview(): ReactNode {
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const pending = splitInbox(ws.decisions).pending;
  const tasks = openTasks(ws.tasks);
  const prs = ws.prs.filter((pr) => pr.state === "open");
  const decisionsId = useId();
  const tasksId = useId();
  const prsId = useId();

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

        <Feed dir={ws} />

        <section aria-labelledby={tasksId} className="overview-tasks">
          <h2 id={tasksId} className="section-title">
            Open tasks <span className="count">{tasks.length}</span>
          </h2>
          {tasks.length === 0 ? (
            <EmptyState>Every task is done and nothing is blocked.</EmptyState>
          ) : (
            <TaskList tasks={tasks} />
          )}
        </section>

        <section aria-labelledby={prsId} className="overview-prs">
          <h2 id={prsId} className="section-title">
            Open pull requests <span className="count">{prs.length}</span>
          </h2>
          {prs.length === 0 ? (
            <EmptyState>
              {ws.prs.length === 0
                ? "No GitHub sync has stored pull requests yet."
                : "The last GitHub sync found no open pull requests."}
            </EmptyState>
          ) : (
            <PullRequestList prs={prs.slice(0, PRS_SHOWN)} />
          )}
        </section>
      </div>
    </Workspace>
  );
}

function Feed({ dir }: { dir: Directory }): ReactNode {
  const headingId = useId();
  const query = Route.useLoaderDeps();
  const select = useCallback(
    (data: InfiniteData<UpdatesPage, string | undefined>) => adaptUpdatePages(data.pages, dir),
    [dir],
  );
  const pages = useSuspenseInfiniteQuery({ ...updatePages(query), select });
  const { items, counts } = pages.data;
  const filtered = query.agentId !== undefined || query.taskId !== undefined;
  return (
    <section aria-labelledby={headingId} className="overview-feed">
      <h2 id={headingId} className="section-title">
        Latest updates
      </h2>
      <FilterBar
        search={lists.overviewFeed}
        counts={{ agent: counts?.byAgent ?? {}, task: counts?.byTask ?? {} }}
        label="Filter updates"
        agents={dir.agents}
      />
      {items.length === 0 ? (
        <EmptyState>
          {filtered ? "No updates match these filters." : "No agent has posted an update yet."}
        </EmptyState>
      ) : (
        <UpdateList updates={items} />
      )}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="updates"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </section>
  );
}
