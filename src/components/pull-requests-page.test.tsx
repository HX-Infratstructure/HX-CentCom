import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import type { GithubPrsPage, PullRequest } from "./server-types";

const server = vi.hoisted(() => ({ listGithubPrs: vi.fn() }));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listGithubPrs: server.listGithubPrs,
}));

const CENTCOM = "HX-Infratstructure/HX-CentCom";
const LITELLM = "HX-Infratstructure/HX-LiteLLM";

function pr(id: number, repo: string, state: string): PullRequest {
  const number = id - 3_000_000;
  return {
    id,
    repo,
    number,
    title: `Change ${number}`,
    state,
    draft: false,
    head_sha: "3e39a5c94018db85bf6f2111b2e60471053c8a20",
    merge_commit_sha: null,
    url: `https://github.com/${repo}/pull/${number}`,
    fetched_at: "2026-11-14T08:05:00.654321+00:00",
  };
}

/** The first 12 stored PRs are open, the next 9 merged and the last 4 closed, as `ALL_COUNTS` says. */
function stateAt(i: number): string {
  if (i < 12) return "open";
  if (i < 21) return "merged";
  return "closed";
}

/** 25 stored PRs, newest id first, as the server pages them: 20 a page unless the request names a limit. */
const STORED: readonly PullRequest[] = Array.from({ length: 25 }, (_, i) =>
  pr(3_000_100 - i, i % 3 === 0 ? LITELLM : CENTCOM, stateAt(i)),
);
const ALL_COUNTS = {
  total: 25,
  byRepo: { [CENTCOM]: 16, [LITELLM]: 9 },
  byState: { open: 12, merged: 9, closed: 4 },
};

function serverPage(
  rows: readonly PullRequest[],
  counts: GithubPrsPage["counts"],
  data: { cursor?: string; limit?: number },
): GithubPrsPage {
  const start =
    data.cursor === undefined ? 0 : rows.findIndex((r) => r.id === Number(data.cursor)) + 1;
  const items = rows.slice(start, start + (data.limit ?? 20));
  const last = items.at(-1);
  const more = start + items.length < rows.length;
  return { items, nextCursor: more && last !== undefined ? String(last.id) : null, counts };
}

/** Each board row as "repository #number", in board order. */
function prNumbers(): readonly string[] {
  return screen.queryAllByRole("rowheader").map((header) => {
    const [repo, number] = within(header.closest("tr") as HTMLElement).getAllByRole("cell");
    return `${repo?.textContent ?? ""} ${number?.textContent ?? ""}`;
  });
}

function chips(facet: string): readonly string[] {
  return within(screen.getByRole("group", { name: facet }))
    .getAllByRole("link")
    .map((chip) => chip.textContent ?? "");
}

afterEach(() => {
  server.listGithubPrs.mockReset();
});

describe("the pull request page", () => {
  it("shows the latest 20 with Show more, and chip counts from the server's counts", async () => {
    server.listGithubPrs.mockImplementation(async ({ data }) =>
      serverPage(STORED, ALL_COUNTS, data),
    );
    await renderApp("/pull-requests", { heading: "Pull requests" });

    expect(prNumbers()).toHaveLength(20);
    expect(prNumbers()[0]).toBe(`${LITELLM} #100`);
    expect(screen.getByText("Showing 20 of 25 pull requests.")).toBeInTheDocument();
    expect(chips("Repository")).toEqual([`${CENTCOM}16`, `${LITELLM}9`]);
    expect(chips("State")).toEqual(["Open12", "Closed4", "Merged9"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    });

    expect(await screen.findByText("Showing all 25 pull requests.")).toBeInTheDocument();
    expect(prNumbers()).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("keeps the repository and state filters in the URL and sends them to the server", async () => {
    const merged = STORED.filter((r) => r.repo === CENTCOM && r.state === "merged");
    const counts = {
      total: merged.length,
      byRepo: { [CENTCOM]: 6, [LITELLM]: 3 },
      byState: { open: 8, merged: 6, closed: 2 },
    };
    server.listGithubPrs.mockImplementation(async ({ data }) => serverPage(merged, counts, data));
    const router = await renderApp(
      `/pull-requests?repo=${encodeURIComponent(CENTCOM)}&state=merged`,
      { heading: "Pull requests" },
    );

    expect(server.listGithubPrs).toHaveBeenCalledWith({ data: { repo: CENTCOM, state: "merged" } });
    expect(prNumbers()).toEqual(merged.map((r) => `${CENTCOM} #${r.number}`));
    const state = within(screen.getByRole("group", { name: "State" }));
    expect(state.getByRole("link", { name: "Merged 6" })).toHaveAttribute("aria-current", "true");

    await act(async () => {
      fireEvent.click(state.getByRole("link", { name: "Closed 2" }));
    });

    expect(router.state.location.search).toEqual({ repo: CENTCOM, state: "closed" });
    expect(server.listGithubPrs).toHaveBeenLastCalledWith({
      data: { repo: CENTCOM, state: "closed" },
    });
  });
});
