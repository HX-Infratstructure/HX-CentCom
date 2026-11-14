import { useCallback, useId, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptUpdatePages, adaptWorkspace, toAppError } from "@/components/adapt";
import { detailFrom } from "@/components/detail";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import type { Directory } from "@/components/model";
import { useOpenRecord } from "@/components/open-record";
import type { UpdateSource, UpdatesPage } from "@/components/server-types";
import { KanbanBoard, TaskDetail, UPDATE_LOG_ID } from "@/components/task";
import { TaskTimeline } from "@/components/timeline";
import { UpdateList } from "@/components/update-item";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { listUpdates } from "@/lib/tasks.functions";
import { tasksQuery } from "@/lib/task-data";

type UpdateQuery = {
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly source?: UpdateSource | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
};

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };

function updatePages(query: UpdateQuery) {
  return infiniteQueryOptions({
    queryKey: ["updates", query],
    queryFn: ({ pageParam }) => listUpdates({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

type TasksSearch = ReturnType<typeof lists.board.validate> &
  ReturnType<typeof lists.updateLog.validate> & { view?: "timeline" | undefined };

export const Route = createFileRoute("/tasks")({
  validateSearch: (raw): TasksSearch => ({
    ...lists.board.validate(raw),
    ...lists.updateLog.validate(raw),
    ...(raw["view"] === "timeline" ? { view: "timeline" } : {}),
  }),
  // The board and the timeline filter the workspace in the browser, so only the update log's query is a dependency.
  loaderDeps: ({ search }): UpdateQuery => {
    const log = lists.updateLog.filters(search);
    return {
      agentId: lists.board.filters(search).agent,
      taskId: log.task,
      source: log.source,
      since: log.posted?.since,
      until: log.posted?.until,
    };
  },
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery),
      queryClient.ensureInfiniteQueryData(updatePages(deps)),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Tasks | HX-CentCom" },
      {
        name: "description",
        content: "Engineering tasks by group and plan, with every update agents posted.",
      },
      { property: "og:title", content: "Tasks | HX-CentCom" },
      {
        property: "og:description",
        content: "Engineering tasks by group and plan, with every update agents posted.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Tasks" error={error} />,
  component: TasksPage,
});

function TasksPage(): ReactNode {
  const search = Route.useSearch();
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const record = useOpenRecord();
  const boardFilters = lists.board.filters(search);
  const board = lists.board.local(ws.tasks, boardFilters, {
    agent: (t) => t.assignee?.id ?? null,
    repo: (t) => t.repository,
  });
  const view = search.view ?? "board";

  return (
    <Workspace page="Tasks">
      <FilterBar
        search={lists.board}
        counts={board.counts}
        label="Filter tasks"
        agents={ws.agents}
      />
      <nav aria-label="Task view" className="facet-tabs view-tabs">
        <ul>
          <li>
            <Link
              from={Route.fullPath}
              to="."
              search={(prev) => ({ ...prev, view: undefined })}
              resetScroll={false}
              activeOptions={{ exact: true }}
              className="facet-tab"
            >
              Board
            </Link>
          </li>
          <li>
            <Link
              from={Route.fullPath}
              to="."
              search={(prev) => ({ ...prev, view: "timeline" as const })}
              resetScroll={false}
              activeOptions={{ exact: true }}
              className="facet-tab"
            >
              Timeline
            </Link>
          </li>
        </ul>
      </nav>
      {board.items.length === 0 ? (
        <EmptyState>No tasks match these filters.</EmptyState>
      ) : view === "board" ? (
        <KanbanBoard tasks={board.items} />
      ) : (
        <TaskTimeline tasks={board.items} />
      )}
      <UpdateLog dir={ws} />
      <TaskDetail detail={detailFrom(record.id, ws.tasks)} onClose={record.close} />
    </Workspace>
  );
}

function UpdateLog({ dir }: { dir: Directory }): ReactNode {
  const headingId = useId();
  const query = Route.useLoaderDeps();
  const select = useCallback(
    (data: InfiniteData<UpdatesPage, string | undefined>) => adaptUpdatePages(data.pages, dir),
    [dir],
  );
  const pages = useSuspenseInfiniteQuery({ ...updatePages(query), select });
  const { items, counts } = pages.data;
  const filtered =
    query.taskId !== undefined ||
    query.source !== undefined ||
    query.since !== undefined ||
    query.until !== undefined;
  return (
    <section id={UPDATE_LOG_ID} aria-labelledby={headingId} className="page-section">
      <h2 id={headingId} className="section-title">
        Update log {counts !== null && <span className="count">{counts.total}</span>}
      </h2>
      <FilterBar
        search={lists.updateLog}
        counts={{ task: counts?.byTask ?? {}, source: counts?.bySource ?? {} }}
        label="Filter updates"
      />
      {items.length === 0 ? (
        <EmptyState>
          {filtered || query.agentId !== undefined
            ? "No updates match these filters."
            : "No agent has posted an update yet."}
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
