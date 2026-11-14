import { useCallback, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptRaid, adaptWorkspace, toAppError } from "@/components/adapt";
import { detailFrom } from "@/components/detail";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { useOpenRecord } from "@/components/open-record";
import { RaidDetail, RaidRow } from "@/components/raid";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { tasksQuery } from "@/lib/task-data";
import type { RaidPage, RaidQueryInput } from "@/server/services";

/** The service parses the query; the validator only gives the server function its input type. */
const listRaidPage = createServerFn({ method: "GET" })
  .validator((data: RaidQueryInput) => data)
  .handler(({ context, data }) => context.services.listRaid(data));

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };

type RaidFilters = ReturnType<typeof lists.raid.filters>;

/** The URL's facet keys are the service's query keys; the cursor never enters the URL. */
function raidQuery(filters: RaidFilters): RaidQueryInput {
  return {
    type: filters.type,
    severity: filters.severity,
    status: filters.status,
    owner: filters.owner,
    task: filters.task,
  };
}

function raidPages(query: RaidQueryInput) {
  return infiniteQueryOptions({
    queryKey: ["raid", "list", query],
    queryFn: ({ pageParam }) => listRaidPage({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const Route = createFileRoute("/raid")({
  validateSearch: (raw) => lists.raid.validate(raw),
  loaderDeps: ({ search }) => lists.raid.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery),
      queryClient.ensureInfiniteQueryData(raidPages(raidQuery(deps))),
    ]);
  },
  head: () => ({
    meta: [
      { title: "RAID register | HX-CentCom" },
      {
        name: "description",
        content: "Risks, assumptions, issues and dependencies, each with its source.",
      },
      { property: "og:title", content: "RAID register | HX-CentCom" },
      {
        property: "og:description",
        content: "Risks, assumptions, issues and dependencies, each with its source.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="RAID register" error={error} />,
  component: RaidRegister,
});

function RaidRegister(): ReactNode {
  const filters = Route.useLoaderDeps();
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const select = useCallback(
    (data: InfiniteData<RaidPage, string | undefined>) => ({
      items: adaptRaid(
        data.pages.flatMap((page) => page.items),
        ws.agents,
      ),
      counts: data.pages[0]?.counts ?? null,
    }),
    [ws.agents],
  );
  const pages = useSuspenseInfiniteQuery({ ...raidPages(raidQuery(filters)), select });
  const record = useOpenRecord();
  const { items, counts } = pages.data;

  return (
    <Workspace page="RAID register">
      <FilterBar
        search={lists.raid}
        counts={{
          type: counts?.byType ?? {},
          severity: counts?.bySeverity ?? {},
          status: counts?.byStatus ?? {},
          owner: counts?.byOwner ?? {},
          task: counts?.byTask ?? {},
        }}
        label="Filter the RAID register"
        agents={ws.agents}
      />
      {items.length === 0 ? (
        <EmptyState>
          {lists.raid.active(filters)
            ? "No RAID items match these filters."
            : "The RAID register is empty."}
        </EmptyState>
      ) : (
        <ul className="record-list">
          {items.map((item) => (
            <li key={item.id}>
              <RaidRow item={item} />
            </li>
          ))}
        </ul>
      )}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="RAID items"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
      <RaidDetail detail={detailFrom(record.id, items)} onClose={record.close} />
    </Workspace>
  );
}
