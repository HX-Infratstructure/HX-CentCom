import { Link, useRouter } from "@tanstack/react-router";
import { Gavel, GraduationCap, LayoutDashboard, ListTodo, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { toAppError } from "./adapt";
import { ErrorState } from "./list-states";
import { OwnerKeyControl } from "./owner-session";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/tasks", label: "Tasks", icon: ListTodo, exact: false },
  { to: "/decisions", label: "Decisions", icon: Gavel, exact: false },
  { to: "/raid", label: "RAID", icon: TriangleAlert, exact: false },
  { to: "/lessons", label: "Lessons", icon: GraduationCap, exact: false },
] as const;

/** The app chrome. `page` is the page's h1; the active nav item comes from the router. */
export function Workspace({ page, children }: { page: string; children: ReactNode }): ReactNode {
  return (
    <div className="app-shell">
      <aside className="workspace-rail">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            HX
          </span>
          <span className="brand-name">
            HX-CentCom<small>Hana-X Central Command</small>
          </span>
        </Link>
        <nav className="rail-nav" aria-label="Pages">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
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
        <header className="topbar">
          {/* Focusable so a sheet whose opener is gone can return focus to the page. */}
          <h1 tabIndex={-1}>{page}</h1>
          <OwnerKeyControl />
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
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
