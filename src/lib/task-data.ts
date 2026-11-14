import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";
import { adaptPullRequestPages } from "@/components/adapt";
import type { GithubPrQueryInput, GithubPrsPage, UpdateQueryInput } from "@/server/services";
import { listGithubPrs, listUpdates, listWorkspace } from "./tasks.functions";

export const tasksQuery = queryOptions({
  queryKey: ["task-workspace"],
  queryFn: () => listWorkspace(),
  refetchInterval: 30000,
});

/** The update feed's filters. The cursor never enters the URL. */
export type UpdateQuery = Pick<
  NonNullable<UpdateQueryInput>,
  "agentId" | "taskId" | "taskIds" | "attention" | "source" | "since" | "until"
>;

/**
 * The one update-feed read, for the overview's latest updates and the tasks page's update log. Each route adds its own
 * `select`, because adapting a page needs the workspace's directory. `refreshOn` joins only the key: the overview's
 * needs-attention feed passes the reason's open tasks, so a workspace refresh that changes them reads the feed again.
 */
export function updatePages(query: UpdateQuery, refreshOn?: readonly string[]) {
  return infiniteQueryOptions({
    queryKey: refreshOn === undefined ? ["updates", query] : ["updates", query, refreshOn],
    queryFn: ({ pageParam }) => listUpdates({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The PR read's filters. The URL's facet keys are the service's query keys; the cursor never enters the URL. */
export type PrQuery = Pick<NonNullable<GithubPrQueryInput>, "repo" | "state">;

function selectPrPages(data: InfiniteData<GithubPrsPage, string | undefined>) {
  return adaptPullRequestPages(data.pages);
}

/**
 * The one PR read, for the overview's open pull requests and the PR page. React Query drops undefined fields from the
 * key, so `/pull-requests?state=open` reuses the overview's cached first page.
 */
export function prPages(query: PrQuery) {
  return infiniteQueryOptions({
    queryKey: ["prs", "list", query],
    queryFn: ({ pageParam }) => listGithubPrs({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: selectPrPages,
  });
}
