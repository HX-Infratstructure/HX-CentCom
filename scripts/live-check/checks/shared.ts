/** Response shapes of the `/api/v1` endpoints the checks read, and the helpers every check module shares. */

export const PAGE_ROUTES = {
  home: "/",
  tasks: "/tasks",
  decisions: "/decisions",
  raid: "/raid",
  lessons: "/lessons",
  pullRequests: "/pull-requests",
  activity: "/activity",
} as const;

export type PageName = keyof typeof PAGE_ROUTES;

export type Facet = Readonly<Record<string, number>>;

export interface ListPage {
  readonly items: readonly { readonly id: string; readonly [field: string]: unknown }[];
  readonly nextCursor: string | null;
  readonly counts: { readonly total: number; readonly [facet: string]: Facet | number };
}

export interface WorkspaceTask {
  readonly id: string;
  readonly repository: string;
  readonly stale: boolean | null;
}

export interface Workspace {
  readonly tasks: readonly WorkspaceTask[];
  readonly agents: readonly { readonly id: string; readonly display_name: string }[];
  readonly statusLabels: readonly { readonly id: string; readonly label: string }[];
  readonly updatesCursor: string | null;
}

export interface UpdateList {
  readonly items: readonly { readonly task_id: string }[];
}

export interface PrList {
  readonly items: readonly { readonly title: string; readonly state: string }[];
  readonly counts: { readonly total: number };
}

export interface ActivityItem {
  readonly entity: string;
  readonly actor: string;
  readonly created_at: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface ActivityList {
  readonly items: readonly ActivityItem[];
}

/**
 * The filter value with the fewest rows that still narrows the view: more than 0 and fewer than `total`.
 * `shownByDefault` is the value the unfiltered view already shows, so choosing it would not narrow the rows.
 */
export function pickNarrowingValue(
  counts: Iterable<readonly [string, number]>,
  total: number,
  shownByDefault: string | null = null,
): readonly [string, number] | undefined {
  return [...counts]
    .filter(([value, n]) => value !== shownByDefault && n > 0 && n < total)
    .sort((a, b) => a[1] - b[1])[0];
}

export function sameOrder<T>(shown: readonly T[], expected: readonly T[]): boolean {
  return (
    shown.length === expected.length && shown.every((value, index) => value === expected[index])
  );
}
