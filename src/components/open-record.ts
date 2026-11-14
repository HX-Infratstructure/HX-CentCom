import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { ITEM, patch, toParam } from "./list-search";

/** Which route shows each record's detail sheet. The open record is always `?item=<id>` on that route. */
export const RECORD_ROUTES = {
  task: "/tasks",
  decision: "/decisions",
  raid: "/raid",
  lesson: "/lessons",
} as const;

export type RecordKind = keyof typeof RECORD_ROUTES;

declare module "@tanstack/history" {
  interface HistoryState {
    /** Set by a RecordLink that opened a sheet on its own route, so closing goes Back instead of adding an entry. */
    openedInPlace?: true;
  }
}

/** The open record on the current route, and how to close it. */
export function useOpenRecord(): { readonly id: string | undefined; close(): void } {
  const raw: Record<string, unknown> = useSearch({ strict: false });
  const openedInPlace = useLocation({
    select: (location) => location.state.openedInPlace === true,
  });
  const router = useRouter();
  const navigate = useNavigate();
  return {
    id: toParam(raw[ITEM]),
    close() {
      // Back after an in-place open lands on the list. A deep link has no list entry to go back to, so it replaces.
      if (openedInPlace) router.history.back();
      else
        void navigate({
          to: ".",
          search: patch({ [ITEM]: undefined }),
          replace: true,
          resetScroll: false,
        });
    },
  };
}
