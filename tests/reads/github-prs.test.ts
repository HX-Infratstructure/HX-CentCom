// R12 (CC1's design H1): pull requests page through listGithubPrs and REST GET /api/v1/github/prs, newest GitHub id
// first, with chip counts in the listUpdates and listRaid pattern: each facet applies every filter but its own. The
// order and the cursor use the PR id, which never changes, so a sync between two pages repeats and skips nothing.
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

/** 25 PRs: ids 1-15 in alpha, 16-25 in beta, states cycling open, closed, merged, gone. */
const FIXTURE: readonly GithubPrInput[] = Array.from({ length: 25 }, (_, i) => {
  const id = i + 1;
  const repo = id <= 15 ? "alpha" : "beta";
  const state = STATES[i % 4] ?? "open";
  return {
    id,
    repo,
    number: id,
    title: `PR ${id}`,
    state,
    draft: false,
    headSha: "a".repeat(40),
    mergeCommitSha: state === "merged" ? "b".repeat(40) : null,
    url: `https://github.com/HX-Infratstructure/${repo}/pull/${id}`,
  };
});

const sync = (prs: readonly GithubPrInput[], fetchedAt: string) =>
  recordGithubSnapshot(h.db, { repos: [], prs, stateUpdates: [], fetchedAt: new Date(fetchedAt) });

const tally = (prs: readonly GithubPrInput[], key: "repo" | "state") =>
  prs.reduce<Record<string, number>>((n, pr) => ({ ...n, [pr[key]]: (n[pr[key]] ?? 0) + 1 }), {});

async function allPages(query: Record<string, unknown>): Promise<PullRequest[]> {
  const seen: PullRequest[] = [];
  let cursor: string | null = null;
  do {
    const page = await h.svc.listGithubPrs({ ...query, ...(cursor ? { cursor } : {}) });
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return seen;
}

describe("listGithubPrs", () => {
  it("pages 25 PRs at limit 10 newest id first, each one once", async () => {
    await sync(FIXTURE, "2026-11-14T12:00:00Z");
    const first = await h.svc.listGithubPrs({ limit: 10 });
    expect(first.items.map((p) => p.id)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    expect(first.counts.total).toBe(25);
    const ids = (await allPages({ limit: 10 })).map((p) => p.id);
    expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => 25 - i));
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
    expect([...first.items.map((p) => p.id), ...rest]).toEqual(
      Array.from({ length: 25 }, (_, i) => 25 - i),
    );
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

  it("is an empty page with zero counts when nothing is mirrored", async () => {
    expect(await h.svc.listGithubPrs()).toEqual({
      items: [],
      nextCursor: null,
      counts: { total: 0, byRepo: {}, byState: {} },
    });
  });

  it("refuses an unknown state, a bad limit and a cursor from another list with 400", async () => {
    await expectInvalidAt(h.svc.listGithubPrs({ state: "draft" as GithubPrState }), "state");
    await expectInvalidAt(h.svc.listGithubPrs({ limit: 0 }), "limit");
    await expectInvalidAt(h.svc.listGithubPrs({ cursor: "not-a-cursor" }), "cursor");
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
