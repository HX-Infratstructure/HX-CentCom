import { useCallback, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { ActivityList } from "@/components/activity";
import { adaptActivityPages, adaptShell, toAppError } from "@/components/adapt";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { useOwnerActions } from "@/lib/owner-actions";
import { listActivity } from "@/lib/tasks.functions";
import { shellQuery } from "@/lib/task-data";
import type { ActivityPage, ActivityQueryInput } from "@/server/services";

const directoryQuery = { ...shellQuery, select: adaptShell };

type ActivityFilters = ReturnType<typeof lists.activity.filters>;

/** The URL's facet keys are the service's query keys; the cursor never enters the URL. */
function activityQuery(filters: ActivityFilters): ActivityQueryInput {
  return { actor: filters.actor, entity: filters.entity };
}

function activityPages(query: ActivityQueryInput) {
  return infiniteQueryOptions({
    queryKey: ["activity", "list", query],
    queryFn: ({ pageParam }) => listActivity({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

const DESCRIPTION = "Every logged change, newest first: who changed which record, and when.";

export const Route = createFileRoute("/activity")({
  validateSearch: (raw) => lists.activity.validate(raw),
  loaderDeps: ({ search }) => lists.activity.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(shellQuery),
      queryClient.ensureInfiniteQueryData(activityPages(activityQuery(deps))),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Activity | HX-CentCom" },
      {
        name: "description",
        content: DESCRIPTION,
      },
      { property: "og:title", content: "Activity | HX-CentCom" },
      {
        property: "og:description",
        content: DESCRIPTION,
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Activity" error={error} />,
  component: ActivityPage,
});

function ActivityPage(): ReactNode {
  const filters = Route.useLoaderDeps();
  const { data: shell } = useSuspenseQuery(directoryQuery);
  const select = useCallback(
    (data: InfiniteData<ActivityPage, string | undefined>) => adaptActivityPages(data.pages, shell),
    [shell],
  );
  const pages = useSuspenseInfiniteQuery({ ...activityPages(activityQuery(filters)), select });
  const owner = useOwnerActions();
  const { items: entries, counts } = pages.data;

  return (
    <Workspace page="Activity" description={DESCRIPTION}>
      <FilterBar
        search={lists.activity}
        counts={{ actor: counts?.byActor ?? {}, entity: counts?.byEntity ?? {} }}
        label="Filter activity"
        agents={shell.agents}
      />
      {entries.length === 0 ? (
        <EmptyState>
          {lists.activity.active(filters)
            ? "No activity matches these filters."
            : "No change has been logged yet."}
        </EmptyState>
      ) : (
        <ActivityList entries={entries} owner={owner} />
      )}
      <ShowMore
        shown={entries.length}
        total={counts?.total}
        noun="activity entries"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </Workspace>
  );
}
