import { useCallback, useId, type ReactNode } from "react";
import { ChartGantt, SquareKanban, Table2 } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  adaptShell,
  adaptTaskDetail,
  adaptTaskPages,
  adaptUpdatePages,
  toAppError,
} from "@/components/adapt";
import { detailFrom } from "@/components/detail";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import type { Directory, TaskView } from "@/components/model";
import { useOpenRecord } from "@/components/open-record";
import type { TaskDetail as TaskRead, TasksPage, UpdatesPage } from "@/components/server-types";
import { KanbanBoard, TaskDetail, TaskTable, UPDATE_LOG_ID } from "@/components/task";
import { TaskTimeline } from "@/components/timeline";
import { UpdateList } from "@/components/update-item";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import {
  shellQuery,
  taskById,
  taskPages,
  updatePages,
  type TaskQuery,
  type UpdateQuery,
} from "@/lib/task-data";

const directoryQuery = { ...shellQuery, select: adaptShell };

/** The loader's dependencies: the board's task read and the update log's read, both from the URL's filters. */
type TasksDeps = { readonly board: TaskQuery; readonly log: UpdateQuery };

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
  // The server filters the board and the update log, so both reads' filters are dependencies. The board sends no `open`
  // filter, because it shows done tasks too.
  loaderDeps: ({ search }): TasksDeps => {
    const board = lists.board.filters(search);
    const log = lists.updateLog.filters(search);
    return {
      board: { agentId: board.agent, repo: board.repo },
      log: {
        agentId: board.agent,
        taskId: log.task,
        source: log.source,
        since: log.posted?.since,
        until: log.posted?.until,
      },
    };
  },
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(shellQuery),
      queryClient.ensureInfiniteQueryData(taskPages(deps.board)),
      queryClient.ensureInfiniteQueryData(updatePages(deps.log)),
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
  const { data: dir } = useSuspenseQuery(directoryQuery);
  const record = useOpenRecord();
  const selectTask = useCallback(
    (t: TaskRead | null) => (t === null ? null : adaptTaskDetail(t, dir)),
    [dir],
  );
  // List rows carry no requirements, so the sheet always reads its task by id, even one on the loaded page.
  const byId = useQuery({ ...taskById(record.id), select: selectTask });

  return (
    <Workspace page="Tasks" description={DESCRIPTION} views={<ViewTabs />}>
      <Board dir={dir} />
      <UpdateLog dir={dir} />
      <TaskDetail detail={detailFrom(record.id, [], byId)} onClose={record.close} />
    </Workspace>
  );
}

/** Start date, missing dates last, then id: a Gantt reads by date, while the server's order puts blocked tasks first. */
function byStartDate(a: TaskView, b: TaskView): number {
  if (a.start_date !== b.start_date) {
    if (a.start_date === null) return 1;
    if (b.start_date === null) return -1;
    return a.start_date < b.start_date ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The table, kanban and timeline show the same loaded tasks, so one Show more serves all three. */
function Board({ dir }: { dir: Directory }): ReactNode {
  const view = Route.useSearch({ select: (search) => search.view });
  const { board: query } = Route.useLoaderDeps();
  const select = useCallback(
    (data: InfiniteData<TasksPage, string | undefined>) => adaptTaskPages(data.pages, dir),
    [dir],
  );
  const pages = useSuspenseInfiniteQuery({ ...taskPages(query), select });
  const { items, counts } = pages.data;

  return (
    <>
      <div className="board-toolbar">
        <FilterBar
          search={lists.board}
          counts={{ agent: counts?.byAgent ?? {}, repo: counts?.byRepo ?? {} }}
          label="Filter tasks"
          agents={dir.agents}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState>No tasks match these filters.</EmptyState>
      ) : view === "kanban" ? (
        <KanbanBoard tasks={items} />
      ) : view === "timeline" ? (
        <TaskTimeline tasks={[...items].sort(byStartDate)} />
      ) : (
        <TaskTable tasks={items} />
      )}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="tasks"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </>
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
  const { log: query } = Route.useLoaderDeps();
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
