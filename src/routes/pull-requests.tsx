import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { toAppError } from "@/components/adapt";
import { EmptyState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { PullRequestBoard } from "@/components/pull-request";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { prPages, type PrQuery } from "@/lib/task-data";

type PrFilters = ReturnType<typeof lists.prs.filters>;

function prQuery(filters: PrFilters): PrQuery {
  return { repo: filters.repo, state: filters.state };
}

const DESCRIPTION = "Pull requests as the last GitHub sync stored them, newest first.";

export const Route = createFileRoute("/pull-requests")({
  validateSearch: (raw) => lists.prs.validate(raw),
  loaderDeps: ({ search }) => lists.prs.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.ensureInfiniteQueryData(prPages(prQuery(deps)));
  },
  head: () => ({
    meta: [
      { title: "Pull requests | HX-CentCom" },
      {
        name: "description",
        content: DESCRIPTION,
      },
      { property: "og:title", content: "Pull requests | HX-CentCom" },
      {
        property: "og:description",
        content: DESCRIPTION,
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Pull requests" error={error} />,
  component: PullRequestsPage,
});

function PullRequestsPage(): ReactNode {
  const filters = Route.useLoaderDeps();
  const pages = useSuspenseInfiniteQuery(prPages(prQuery(filters)));
  const { items, counts } = pages.data;

  return (
    <Workspace page="Pull requests" description={DESCRIPTION}>
      <FilterBar
        search={lists.prs}
        counts={{ repo: counts?.byRepo ?? {}, state: counts?.byState ?? {} }}
        label="Filter pull requests"
      />
      {items.length === 0 ? (
        <EmptyState>
          {lists.prs.active(filters)
            ? "No pull requests match these filters."
            : "No GitHub sync has stored pull requests yet."}
        </EmptyState>
      ) : (
        <PullRequestBoard prs={items} totals={counts?.byState ?? {}} />
      )}
      <ShowMore
        shown={items.length}
        total={counts?.total}
        noun="pull requests"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </Workspace>
  );
}
