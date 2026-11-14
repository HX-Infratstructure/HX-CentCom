import { useCallback, useId, type ReactNode } from "react";
import { ChartGantt, SquareKanban, Table2 } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
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
import type { UpdatesPage } from "@/components/server-types";
import { KanbanBoard, TaskDetail, TaskTable, UPDATE_LOG_ID } from "@/components/task";
import { TaskTimeline } from "@/components/timeline";
import { UpdateList } from "@/components/update-item";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { tasksQuery, updatePages, type UpdateQuery } from "@/lib/task-data";

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };

type TasksSearch = ReturnType<typeof lists.board.validate> &
  ReturnType<typeof lists.updateLog.validate> & { view?: "kanban" | "timeline" | undefined };

const DESCRIPTION = "Engineering tasks by group and plan, with every update agents posted.";

/** The main table is the default, so it has no `view` value. */
const VIEWS = [
  { view: undefined, label: "Main table", icon: Table2 },
  { view: "kanban", label: "Kanban", icon: SquareKanban },
  { view: "timeline", label: "Timeline", icon: ChartGantt },
] as const;

export const Route = createFileRoute("/tasks")({
  validateSearch: (raw): TasksSearch => ({
    ...lists.board.validate(raw),
    ...lists.updateLog.validate(raw),
    ...(raw["view"] === "kanban" || raw["view"] === "timeline" ? { view: raw["view"] } : {}),
  }),
  // The three views filter the workspace in the browser, so only the update log's query is a dependency.
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
        content: DESCRIPTION,
      },
      { property: "og:title", content: "Tasks | HX-CentCom" },
      {
        property: "og:description",
        content: DESCRIPTION,
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
  const view = search.view;

  return (
    <Workspace page="Tasks" description={DESCRIPTION} views={<ViewTabs />}>
      <div className="board-toolbar">
        <FilterBar
          search={lists.board}
          counts={board.counts}
          label="Filter tasks"
          agents={ws.agents}
        />
      </div>
      {board.items.length === 0 ? (
        <EmptyState>No tasks match these filters.</EmptyState>
      ) : view === "kanban" ? (
        <KanbanBoard tasks={board.items} />
      ) : view === "timeline" ? (
        <TaskTimeline tasks={board.items} />
      ) : (
        <TaskTable tasks={board.items} />
      )}
      <UpdateLog dir={ws} />
      <TaskDetail detail={detailFrom(record.id, ws.tasks)} onClose={record.close} />
    </Workspace>
  );
}

function ViewTabs(): ReactNode {
  return (
    <nav aria-label="Task view" className="view-tabs">
      <ul>
        {VIEWS.map(({ view, label, icon: Icon }) => (
          <li key={label}>
            <Link
              from={Route.fullPath}
              to="."
              search={(prev) => ({ ...prev, view })}
              resetScroll={false}
              activeOptions={{ exact: true }}
              className="view-tab"
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
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
