import { useIsFetching, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  Gavel,
  GitPullRequest,
  GraduationCap,
  History,
  LayoutDashboard,
  ListTodo,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toAppError } from "./adapt";
import { formatUtc, relativeAge } from "./format";
import { Button } from "./ui/button";
import { ErrorState } from "./list-states";
import { toInstant } from "./model";
import { OwnerKeyControl } from "./owner-session";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/tasks", label: "Tasks", icon: ListTodo, exact: false },
  { to: "/decisions", label: "Decisions", icon: Gavel, exact: false },
  { to: "/raid", label: "RAID", icon: TriangleAlert, exact: false },
  { to: "/lessons", label: "Lessons", icon: GraduationCap, exact: false },
  { to: "/pull-requests", label: "Pull requests", icon: GitPullRequest, exact: false },
  { to: "/activity", label: "Activity", icon: History, exact: false },
] as const;

/**
 * The app chrome: the page nav, then the page on a white board surface under a board header. `page` is the page's h1,
 * `description` its one-line purpose, and `views` the page's view tabs. The active nav item comes from the router.
 */
export function Workspace({
  page,
  description,
  views,
  children,
}: {
  page: string;
  description?: string | undefined;
  views?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="app-shell">
      <aside className="workspace-rail">
        <Link to="/" className="brand" aria-label="HX-CentCom overview">
          <span className="brand-mark" aria-hidden="true">
            HX
          </span>
          {/* At phone width the seven nav icons need the brand's room, so only the mark stays. */}
          <span className="brand-name max-[480px]:hidden">
            HX-CentCom<small>Hana-X Central Command</small>
          </span>
        </Link>
        <nav className="rail-nav" aria-label="Pages">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact, includeSearch: false }}
              aria-label={label}
              className="rail-link"
            >
              <Icon aria-hidden="true" />
              <span className="nav-text">{label}</span>
            </Link>
          ))}
        </nav>
        <p className="env-label">Dev/test environment</p>
      </aside>
      <div className="work-area">
        <div className="board-surface">
          <header className="board-header">
            <div className="board-heading">
              {/* Focusable so a sheet whose opener is gone can return focus to the page. */}
              <h1 tabIndex={-1}>{page}</h1>
              {description !== undefined && <p className="board-description">{description}</p>}
              <Freshness />
            </div>
            <OwnerKeyControl />
            {views}
          </header>
          <main className="page">{children}</main>
        </div>
      </div>
    </div>
  );
}

/**
 * How current the page is: "failed" when a query it shows failed its last read, else the oldest `dataUpdatedAt` among
 * them, so one list that has not reloaded keeps the page from reading as just updated. Null before any has data.
 */
function pageFreshness(queryClient: QueryClient): number | "failed" | null {
  let oldest: number | null = null;
  for (const query of queryClient.getQueryCache().getAll()) {
    if (!query.isActive()) continue;
    if (query.state.status === "error") return "failed";
    if (query.state.status === "success") {
      oldest = Math.min(oldest ?? Infinity, query.state.dataUpdatedAt);
    }
  }
  return oldest;
}

/** When the page's data last arrived, and a button that re-checks every query the page shows now. */
function Freshness(): ReactNode {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = () => pageFreshness(queryClient);
  const freshness = useSyncExternalStore(subscribe, read, read);
  const fetching = useIsFetching() > 0;
  // The age reads in whole minutes, so a 15-second tick keeps it within a quarter minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);
  const at = typeof freshness === "number" ? toInstant(new Date(freshness).toISOString()) : null;

  return (
    <p className="board-freshness">
      {freshness === "failed" && <span>Update failed</span>}
      {at !== null && (
        <span>
          Updated{" "}
          {/* The server renders its own clock's age, so the first client render may differ by a tick. */}
          <time dateTime={at} title={formatUtc(at)} suppressHydrationWarning>
            {relativeAge(at, now)}
          </time>
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-busy={fetching}
        onClick={() => void queryClient.invalidateQueries()}
      >
        <RefreshCw aria-hidden="true" />
        Refresh
      </Button>
    </p>
  );
}

/** A route's `errorComponent`: the failure inside the app chrome, with a retry that reruns the route's loaders. */
export function RouteError({ page, error }: { page: string; error: unknown }): ReactNode {
  const router = useRouter();
  return (
    <Workspace page={page}>
      <ErrorState error={toAppError(error)} retry={() => void router.invalidate()} />
    </Workspace>
  );
}
