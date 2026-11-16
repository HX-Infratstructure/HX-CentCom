// R12 (CC1's design H1): pull requests page through listGithubPrs and REST GET /api/v1/github/prs
// in the board's state order (open, merged, closed, gone), newest GitHub id first within a state, with chip counts in
// the listUpdates and listRaid pattern: each facet applies every filter but its own. The order and the cursor use the
// state and the PR id, so a sync between two pages that changes no state repeats and skips nothing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordGithubSnapshot,
  type GithubPrInput,
  type GithubPrState,
  type PullRequest,
} from "@/server/services";
import { expectInvalidAt, rest, setup, type Fixture, type ServerRoute } from "../raid/support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const STATES: readonly GithubPrState[] = ["open", "closed", "merged", "gone"];
const EXPECTED_STATE_ORDER: readonly GithubPrState[] = ["open", "merged", "closed", "gone"];

const prInput = (
  id: number,
  state: GithubPrState,
  repo = id <= 15 ? "alpha" : "beta",
): GithubPrInput => ({
  id,
  repo,
  number: id,
  title: `PR ${id}`,
  state,
  draft: false,
  headSha: "a".repeat(40),
  mergeCommitSha: state === "merged" ? "b".repeat(40) : null,
  url: `https://github.com/HX-Infratstructure/${repo}/pull/${id}`,
});

/** 25 PRs: ids 1-15 in alpha, 16-25 in beta, states cycling open, closed, merged, gone. */
const FIXTURE: readonly GithubPrInput[] = Array.from({ length: 25 }, (_, i) =>
  prInput(i + 1, STATES[i % 4] ?? "open"),
);

/** The ids in board order: each state of EXPECTED_STATE_ORDER in turn, newest id first within it. */
const stateOrderOf = (prs: readonly GithubPrInput[]) =>
  EXPECTED_STATE_ORDER.flatMap((state) =>
    prs
      .filter((p) => p.state === state)
      .map((p) => p.id)
      .sort((a, b) => b - a),
  );

/** Open PRs with lower ids than the merged ones, and one state the board has no group for, with the highest id. */
const MIXED: readonly GithubPrInput[] = [
  prInput(1, "open"),
  prInput(2, "gone"),
  prInput(3, "closed"),
  prInput(4, "open"),
  prInput(5, "merged"),
  prInput(6, "closed"),
  prInput(7, "merged"),
  prInput(8, "gone"),
  prInput(9, "merged"),
  prInput(10, "archived" as GithubPrState),
];
const MIXED_ORDER = [4, 1, 9, 7, 5, 6, 3, 8, 2, 10];

const sync = (prs: readonly GithubPrInput[], fetchedAt: string) =>
  recordGithubSnapshot(h.db, { repos: [], prs, stateUpdates: [], fetchedAt: new Date(fetchedAt) });

const tally = (prs: readonly GithubPrInput[], key: "repo" | "state") =>
  prs.reduce<Record<string, number>>((n, pr) => ({ ...n, [pr[key]]: (n[pr[key]] ?? 0) + 1 }), {});

/** Every page's items, following nextCursor until it is null. */
async function allPages(query: Record<string, unknown>): Promise<(readonly PullRequest[])[]> {
  const pages: (readonly PullRequest[])[] = [];
  let cursor: string | null = null;
  do {
    const page = await h.svc.listGithubPrs({ ...query, ...(cursor ? { cursor } : {}) });
    pages.push(page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

describe("listGithubPrs", () => {
  it("pages 25 PRs at limit 10 in board order, each one once", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const first = await h.svc.listGithubPrs({ limit: 10 });
    expect(first.items.map((p) => p.id)).toEqual([25, 21, 17, 13, 9, 5, 1, 23, 19, 15]);
    expect(first.counts.total).toBe(25);
    const ids = (await allPages({ limit: 10 })).flat().map((p) => p.id);
    expect(ids).toEqual(stateOrderOf(FIXTURE));
  });

  it("lists open PRs first, then merged, closed and gone, newest id first in each, an unknown state last", async () => {
    await sync(MIXED, "2026-11-14T12:00:00Z");
    const page = await h.svc.listGithubPrs({ limit: 100 });
    expect(page.items.map((p) => p.id)).toEqual(MIXED_ORDER);
    expect(page.nextCursor).toBeNull();
  });

  it("pages at limit 2 across every state boundary, each row once, in board order", async () => {
    await sync(MIXED, "2026-11-14T12:00:00Z");
    const pages = (await allPages({ limit: 2 })).map((items) => items.map((p) => p.id));
    expect(pages).toEqual([
      [4, 1],
      [9, 7],
      [5, 6],
      [3, 8],
      [2, 10],
    ]);
  });

  it("repeats and skips nothing when a sync rewrites every row between two pages", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const first = await h.svc.listGithubPrs({ limit: 10 });
    await sync(
      FIXTURE.map((pr) => ({ ...pr, title: `${pr.title} (renamed)` })),
      "2026-11-14T12:05:00Z",
    );
    const rest: number[] = [];
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await h.svc.listGithubPrs({ limit: 10, cursor });
      rest.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
    }
    expect([...first.items.map((p) => p.id), ...rest]).toEqual(stateOrderOf(FIXTURE));
  });

  it("filters by repo and state, and counts each facet without its own filter", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const page = await h.svc.listGithubPrs({ repo: "alpha", state: "merged", limit: 100 });
    const expected = FIXTURE.filter((p) => p.repo === "alpha" && p.state === "merged");
    expect(page.items.map((p) => p.id)).toEqual(expected.map((p) => p.id).reverse());
    expect(page.nextCursor).toBeNull();
    expect(page.counts).toEqual({
      total: expected.length,
      byRepo: tally(
        FIXTURE.filter((p) => p.state === "merged"),
        "repo",
      ),
      byState: tally(
        FIXTURE.filter((p) => p.repo === "alpha"),
        "state",
      ),
    });
  });

  it("lists a repo filter open first, newest id first in each state, with unchanged counts", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const page = await h.svc.listGithubPrs({ repo: "beta", limit: 100 });
    const expected = FIXTURE.filter((p) => p.repo === "beta");
    expect(page.items.map((p) => p.id)).toEqual(stateOrderOf(expected));
    expect(page.nextCursor).toBeNull();
    expect(page.counts).toEqual({
      total: expected.length,
      byRepo: tally(FIXTURE, "repo"),
      byState: tally(expected, "state"),
    });
  });

  it("is an empty page with zero counts when nothing is mirrored", async () => {
    expect(await h.svc.listGithubPrs()).toEqual({
      items: [],
      nextCursor: null,
      counts: { total: 0, byRepo: {}, byState: {} },
    });
  });

  it("refuses an unknown state, a bad limit, an old-order cursor and a cursor from another list with 400", async () => {
    await expectInvalidAt(h.svc.listGithubPrs({ state: "draft" as GithubPrState }), "state");
    await expectInvalidAt(h.svc.listGithubPrs({ limit: 0 }), "limit");
    await expectInvalidAt(h.svc.listGithubPrs({ cursor: "not-a-cursor" }), "cursor");
    const oldOrderCursor = Buffer.from(JSON.stringify([25]), "utf8").toString("base64url");
    await expectInvalidAt(h.svc.listGithubPrs({ cursor: oldOrderCursor }), "cursor");
    const decisions = await h.svc.listDecisions({ limit: 1 });
    await expectInvalidAt(
      h.svc.listGithubPrs({ cursor: decisions.nextCursor ?? "missing" }),
      "cursor",
    );
  });

  it("GET /api/v1/github/prs returns what the service returns", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const { Route } = (await import("@/routes/api/v1/github/prs")) as { Route: ServerRoute };
    const res = await rest(h.svc, Route, "GET", "/api/v1/github/prs?repo=beta&state=open&limit=2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      JSON.parse(
        JSON.stringify(await h.svc.listGithubPrs({ repo: "beta", state: "open", limit: 2 })),
      ),
    );
    const bad = await rest(h.svc, Route, "GET", "/api/v1/github/prs?state=draft");
    expect(bad.status).toBe(400);
  });
});
