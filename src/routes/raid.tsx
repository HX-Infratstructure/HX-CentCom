import { useCallback, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  infiniteQueryOptions,
  queryOptions,
  skipToken,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptRaid, adaptShell, toAppError } from "@/components/adapt";
import { detailFrom } from "@/components/detail";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { useOpenRecord } from "@/components/open-record";
import { RaidBoard, RaidDetail } from "@/components/raid";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { shellQuery } from "@/lib/task-data";
import { getRaidItem } from "@/lib/tasks.functions";
import type { RaidItem, RaidPage, RaidQueryInput } from "@/server/services";

/** The service parses the query; the validator only gives the server function its input type. */
const listRaidPage = createServerFn({ method: "GET" })
  .validator((data: RaidQueryInput) => data)
  .handler(({ context, data }) => context.services.listRaid(data));

const directoryQuery = { ...shellQuery, select: adaptShell };

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

/** The open sheet's item when the loaded pages do not hold it: a deep link past them or outside the filters. */
function raidItemById(id: string | undefined) {
  return queryOptions({
    queryKey: ["raid", "one", id],
    queryFn: id === undefined ? skipToken : () => getRaidItem({ data: { id } }),
  });
}

const DESCRIPTION = "Risks, assumptions, issues and dependencies, each with its source.";

export const Route = createFileRoute("/raid")({
  validateSearch: (raw) => lists.raid.validate(raw),
  loaderDeps: ({ search }) => lists.raid.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(shellQuery),
      queryClient.ensureInfiniteQueryData(raidPages(raidQuery(deps))),
    ]);
  },
  head: () => ({
    meta: [
      { title: "RAID register | HX-CentCom" },
      {
        name: "description",
        content: DESCRIPTION,
      },
      { property: "og:title", content: "RAID register | HX-CentCom" },
      {
        property: "og:description",
        content: DESCRIPTION,
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="RAID register" error={error} />,
  component: RaidRegister,
});

function RaidRegister(): ReactNode {
  const filters = Route.useLoaderDeps();
  const { data: shell } = useSuspenseQuery(directoryQuery);
  const select = useCallback(
    (data: InfiniteData<RaidPage, string | undefined>) => ({
      items: adaptRaid(
        data.pages.flatMap((page) => page.items),
        shell.agents,
      ),
      counts: data.pages[0]?.counts ?? null,
    }),
    [shell.agents],
  );
  const pages = useSuspenseInfiniteQuery({ ...raidPages(raidQuery(filters)), select });
  const record = useOpenRecord();
  const selectItem = useCallback(
    (item: RaidItem | null) =>
      item === null ? null : (adaptRaid([item], shell.agents)[0] ?? null),
    [shell.agents],
  );
  const byId = useQuery({ ...raidItemById(record.id), select: selectItem });
  const { items, counts } = pages.data;

  return (
    <Workspace page="RAID register" description={DESCRIPTION}>
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
        agents={shell.agents}
      />
      {items.length === 0 ? (
        <EmptyState>
          {lists.raid.active(filters)
            ? "No RAID items match these filters."
            : "The RAID register is empty."}
        </EmptyState>
      ) : (
        <RaidBoard items={items} totals={counts?.byType ?? {}} />
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
      <RaidDetail detail={detailFrom(record.id, items, byId)} onClose={record.close} />
    </Workspace>
  );
}
