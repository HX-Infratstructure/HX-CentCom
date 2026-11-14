import { useCallback, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptLessons, adaptWorkspace, toAppError } from "@/components/adapt";
import { detailFrom } from "@/components/detail";
import { LessonDetail, LessonRow } from "@/components/lesson";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { useOpenRecord } from "@/components/open-record";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { tasksQuery } from "@/lib/task-data";
import type { LessonQueryInput, LessonsPage } from "@/server/services";

/** The service parses the query; the validator only gives the server function its input type. */
const listLessonsPage = createServerFn({ method: "GET" })
  .validator((data: LessonQueryInput) => data)
  .handler(({ context, data }) => context.services.listLessons(data));

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };

type LessonFilters = ReturnType<typeof lists.lessons.filters>;

/** The URL's facet keys are the service's query keys; the cursor never enters the URL. */
function lessonQuery(filters: LessonFilters): LessonQueryInput {
  return { status: filters.status, tag: filters.tag };
}

function lessonPages(query: LessonQueryInput) {
  return infiniteQueryOptions({
    queryKey: ["lessons", "list", query],
    queryFn: ({ pageParam }) => listLessonsPage({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const Route = createFileRoute("/lessons")({
  validateSearch: (raw) => lists.lessons.validate(raw),
  loaderDeps: ({ search }) => lists.lessons.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery),
      queryClient.ensureInfiniteQueryData(lessonPages(lessonQuery(deps))),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Lessons | HX-CentCom" },
      {
        name: "description",
        content: "Lessons with their sources; adopted lessons show what enforces them.",
      },
      { property: "og:title", content: "Lessons | HX-CentCom" },
      {
        property: "og:description",
        content: "Lessons with their sources; adopted lessons show what enforces them.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Lessons" error={error} />,
  component: LessonsLog,
});

function LessonsLog(): ReactNode {
  const filters = Route.useLoaderDeps();
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const select = useCallback(
    (data: InfiniteData<LessonsPage, string | undefined>) => ({
      items: adaptLessons(
        data.pages.flatMap((page) => page.items),
        ws.agents,
      ),
      counts: data.pages[0]?.counts ?? null,
    }),
    [ws.agents],
  );
  const pages = useSuspenseInfiniteQuery({ ...lessonPages(lessonQuery(filters)), select });
  const record = useOpenRecord();
  const { items, counts } = pages.data;

  return (
    <Workspace page="Lessons">
      <FilterBar
        search={lists.lessons}
        counts={{ status: counts?.byStatus ?? {}, tag: counts?.byTag ?? {} }}
        label="Filter lessons"
      />
      {items.length === 0 ? (
        <EmptyState>
          {lists.lessons.active(filters)
            ? "No lessons match these filters."
            : "No lesson is recorded yet."}
        </EmptyState>
      ) : (
        <ul className="record-list">
          {items.map((lesson) => (
            <li key={lesson.id}>
              <LessonRow lesson={lesson} />
            </li>
          ))}
        </ul>
      )}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="lessons"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
      <LessonDetail detail={detailFrom(record.id, items)} onClose={record.close} />
    </Workspace>
  );
}
