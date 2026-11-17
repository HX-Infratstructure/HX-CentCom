import {
  infiniteQueryOptions,
  queryOptions,
  skipToken,
  type DefaultOptions,
  type InfiniteData,
} from "@tanstack/react-query";
import { adaptPullRequestPages } from "@/components/adapt";
import type {
  GithubPrQueryInput,
  GithubPrsPage,
  TaskQueryInput,
  UpdateQueryInput,
} from "@/server/services";
import {
  getTask,
  listGithubPrs,
  listTasks,
  listUpdates,
  listWorkspace,
  listWorkspaceShell,
} from "./tasks.functions";

/**
 * The query client's defaults, which the router and the tests share. Every active query re-checks the server every 60
 * seconds while the tab is visible, and at once when the tab returns with data older than `staleTime`. An infinite list
 * re-reads every page it has loaded, from the first, so Show more pages stay and their cursors stay consistent.
 */
export const QUERY_DEFAULTS = {
  // With the default staleTime of 0, data hydrated from the server is stale at once and every mounting query refetches
  // it.
  staleTime: 30_000,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} satisfies DefaultOptions["queries"];

export const tasksQuery = queryOptions({
  queryKey: ["task-workspace"],
  queryFn: () => listWorkspace(),
});

/** The pages' bounded workspace read: agents, status labels, repository heads, the latest updates and the counts. */
export const shellQuery = queryOptions({
  queryKey: ["workspace-shell"],
  queryFn: () => listWorkspaceShell(),
});

/** The task read's filters. The cursor never enters the URL. */
export type TaskQuery = Pick<
  NonNullable<TaskQueryInput>,
  "agentId" | "repo" | "attention" | "open"
>;

/** The one task read. Each route adapts the pages with its directory (`adaptTaskPages`), so there is no `select`. */
export function taskPages(query: TaskQuery) {
  return infiniteQueryOptions({
    queryKey: ["tasks", "list", query],
    queryFn: ({ pageParam }) => listTasks({ data: { ...query, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One task with its requirements, for the task sheet. null is a miss. */
export function taskById(id: string | undefined) {
  return queryOptions({
    queryKey: ["tasks", "one", id],
    queryFn: id === undefined ? skipToken : () => getTask({ data: { id } }),
  });
}

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
