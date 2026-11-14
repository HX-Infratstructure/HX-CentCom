import { useCallback, useId, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  infiniteQueryOptions,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptDecision, adaptDecisionPages, adaptWorkspace, toAppError } from "@/components/adapt";
import { DecisionDetail, DecisionList } from "@/components/decision";
import { detailFrom } from "@/components/detail";
import { EmptyState, ErrorState, ShowMore } from "@/components/list-states";
import { lists } from "@/components/lists";
import { DECISION_STATUS_LABELS, splitInbox, type AgentDirectory } from "@/components/model";
import { useOpenRecord } from "@/components/open-record";
import type { Decision, DecisionsPage, DecisionStatus, GateType } from "@/components/server-types";
import { FilterBar } from "@/components/url-state";
import { RouteError, Workspace } from "@/components/workspace";
import { useOwnerActions } from "@/lib/owner-actions";
import { getDecision, listDecisions } from "@/lib/tasks.functions";
import { tasksQuery } from "@/lib/task-data";

type DecisionQuery = {
  readonly gateType?: GateType | undefined;
  readonly status?: DecisionStatus | "not_pending" | undefined;
};

const workspaceQuery = { ...tasksQuery, select: adaptWorkspace };

/** Facet counts for the filter bar: every filter applies except the facet's own (DecisionCounts). */
function countsQuery(query: DecisionQuery) {
  return queryOptions({
    queryKey: ["decisions", "counts", query],
    queryFn: () => listDecisions({ data: { ...query, limit: 1 } }),
    select: (page) => page.counts,
  });
}

/**
 * The open sheet's decision when the workspace does not hold it: a decided one from History, a "Superseded by" or
 * RAID link, or a deep link. null is a miss. It runs whenever a sheet is open, so its data is already cached when a
 * decision the owner just decided leaves the workspace.
 */
function decisionById(id: string | undefined) {
  return queryOptions({
    queryKey: ["decisions", "one", id],
    queryFn: id === undefined ? skipToken : () => getDecision({ data: { id } }),
  });
}

function decisionPages(query: DecisionQuery) {
  return infiniteQueryOptions({
    queryKey: ["decisions", "list", query],
    queryFn: ({ pageParam }) => listDecisions({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const Route = createFileRoute("/decisions")({
  validateSearch: (raw) => lists.decisions.validate(raw),
  loaderDeps: ({ search }) => lists.decisions.filters(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery),
      queryClient.ensureQueryData(countsQuery({ gateType: deps.type, status: deps.status })),
      queryClient.ensureInfiniteQueryData(
        decisionPages({ gateType: deps.type, status: deps.status ?? "Pending" }),
      ),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Decisions | HX-CentCom" },
      {
        name: "description",
        content: "Pending owner decisions, ordered by what they block, and the decided history.",
      },
      { property: "og:title", content: "Decisions | HX-CentCom" },
      {
        property: "og:description",
        content: "Pending owner decisions, ordered by what they block, and the decided history.",
      },
    ],
  }),
  errorComponent: ({ error }) => <RouteError page="Decisions" error={error} />,
  component: DecisionsPage,
});

function DecisionsPage(): ReactNode {
  const filters = Route.useLoaderDeps();
  const { data: ws } = useSuspenseQuery(workspaceQuery);
  const { data: counts } = useSuspenseQuery(
    countsQuery({ gateType: filters.type, status: filters.status }),
  );
  const owner = useOwnerActions();
  const record = useOpenRecord();
  const selectDecision = useCallback(
    (d: Decision | null) => (d === null ? null : adaptDecision(d, ws.agents)),
    [ws.agents],
  );
  const byId = useQuery({ ...decisionById(record.id), select: selectDecision });
  const filtered = lists.decisions.active(filters);

  return (
    <Workspace page="Decisions">
      <FilterBar
        search={lists.decisions}
        counts={{ type: counts.byGateType, status: counts.byStatus }}
        label="Filter decisions"
      />
      {filters.status === undefined ? (
        <>
          <DecisionSection
            title="Pending"
            query={{ gateType: filters.type, status: "Pending" }}
            agents={ws.agents}
            empty={
              filtered ? "No pending decisions of this type." : "No decision is waiting on you."
            }
          />
          <HistorySection
            gateType={filters.type}
            total={counts.total - (counts.byStatus.Pending ?? 0)}
            agents={ws.agents}
            filtered={filtered}
          />
        </>
      ) : (
        <DecisionSection
          title={DECISION_STATUS_LABELS[filters.status]}
          query={{ gateType: filters.type, status: filters.status }}
          agents={ws.agents}
          empty="No decisions match these filters."
        />
      )}
      <DecisionDetail
        detail={detailFrom(record.id, ws.decisions, byId)}
        owner={owner}
        onClose={record.close}
      />
    </Workspace>
  );
}

function DecisionSection({
  title,
  query,
  agents,
  empty,
}: {
  title: string;
  query: DecisionQuery;
  agents: AgentDirectory;
  empty: string;
}): ReactNode {
  const headingId = useId();
  const select = useCallback(
    (data: InfiniteData<DecisionsPage, string | undefined>) => {
      const adapted = adaptDecisionPages(data.pages, agents);
      // The overview's order: what a decision blocks outranks when it was asked. The server pages by request time, so
      // this is exact while every pending row is loaded; rows from "Show more" join the same order.
      return query.status === "Pending"
        ? { ...adapted, items: splitInbox(adapted.items).pending }
        : adapted;
    },
    [agents, query.status],
  );
  const pages = useSuspenseInfiniteQuery({ ...decisionPages(query), select });
  const total = pages.data.counts?.total;
  return (
    <section aria-labelledby={headingId} className="page-section">
      <h2 id={headingId} className="section-title">
        {title} {total !== undefined && <span className="count">{total}</span>}
      </h2>
      {pages.data.items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <DecisionList decisions={pages.data.items} />
      )}
      <ShowMore
        shown={pages.data.items.length}
        total={total}
        noun="decisions"
        hasMore={pages.hasNextPage}
        pending={pages.isFetchingNextPage}
        error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
        onShowMore={() => void pages.fetchNextPage()}
      />
    </section>
  );
}

/** Collapsed until asked for. The server sends only non-pending rows, so every page is history. */
function HistorySection({
  gateType,
  total,
  agents,
  filtered,
}: {
  gateType: GateType | undefined;
  total: number;
  agents: AgentDirectory;
  filtered: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const select = useCallback(
    (data: InfiniteData<DecisionsPage, string | undefined>) =>
      adaptDecisionPages(data.pages, agents),
    [agents],
  );
  const pages = useInfiniteQuery({
    ...decisionPages({ gateType, status: "not_pending" }),
    select,
    enabled: open,
  });
  const items = pages.data?.items ?? [];
  const { hasNextPage, fetchNextPage } = pages;

  return (
    <section className="page-section">
      <h2 className="section-title">
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((was) => !was)}
        >
          <ChevronRight aria-hidden="true" />
          History <span className="count">{total}</span>
        </button>
      </h2>
      <div id={listId} hidden={!open}>
        {pages.isPending && open && <p className="quiet">Loading decided history.</p>}
        {pages.isError && !pages.isFetchNextPageError && (
          <ErrorState error={toAppError(pages.error)} retry={() => void pages.refetch()} />
        )}
        {pages.isSuccess && total === 0 && (
          <EmptyState>
            {filtered ? "No decided decisions of this type." : "Nothing has been decided yet."}
          </EmptyState>
        )}
        {items.length > 0 && <DecisionList decisions={items} />}
        <ShowMore
          shown={items.length}
          total={total}
          noun="decisions"
          hasMore={hasNextPage}
          pending={pages.isFetchingNextPage}
          error={pages.isFetchNextPageError ? toAppError(pages.error) : null}
          onShowMore={() => void fetchNextPage()}
        />
      </div>
    </section>
  );
}
