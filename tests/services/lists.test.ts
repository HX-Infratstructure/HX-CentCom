// @vitest-environment node
// T14 (R12): filtered lists with cursor pagination, default 20, at most 100. SPEC §4 listUpdates/listActivity/listWorkspace.
// The expected rows come from plain SQL over the same table, so each check compares the service with the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityQueryInput, UpdateQueryInput } from "@/server/services";
import { IDS, setup, type ActorName, type Harness } from "./support";

let h: Harness;
const SOURCES = ["api", "mcp", "cli", "hook", "ui"] as const;
// Writers and tasks each actor may post to (seed owners: IRP-05 and IRP-UI are CC1's, IRP-04 is CC2's).
const WRITERS: readonly (readonly [ActorName, string])[] = [
  ["CC1", "IRP-05"],
  ["CC1", "IRP-UI"],
  ["CC2", "IRP-04"],
  ["OWNER", "HX12-01"],
];
const FIXTURES = 47;
const BASE = Date.parse("2026-11-01T00:00:00Z");
const hour = (n: number) => new Date(BASE + n * 3_600_000).toISOString();

beforeAll(async () => {
  h = await setup();
  for (let i = 0; i < FIXTURES; i++) {
    const writer = WRITERS[i % WRITERS.length];
    const source = SOURCES[i % SOURCES.length];
    if (!writer || !source) throw new Error("fixture tables are empty");
    const [name, taskId] = writer;
    await h.svc.postProgress(h.as[name], taskId, { note: `t14 fixture ${i}`, source }, {});
  }
  // Give the fixtures known times: pairs share a timestamp, so a cursor that orders by time alone loses or repeats rows.
  const rows = await h.q<{ id: string; note: string }>(
    "select id, note from task_updates where note like 't14 fixture %'",
  );
  expect(rows).toHaveLength(FIXTURES);
  for (const r of rows) {
    const i = Number(r.note.replace("t14 fixture ", ""));
    await h.q("update task_updates set created_at = $1 where id = $2", [
      hour(Math.floor(i / 2)),
      r.id,
    ]);
  }
}, 120_000);
afterAll(async () => {
  await h.close();
});

type Page = {
  readonly items: readonly { readonly id: string }[];
  readonly nextCursor: string | null;
};

type Filters<Q> = Omit<NonNullable<Q>, "limit" | "cursor">;

// Follows nextCursor to the end and returns every id in order. Fails if a page exceeds the limit or the walk loops.
async function walk<Q>(
  list: (query: Q) => Promise<Page>,
  filters: Filters<Q>,
  limit: number,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const res = await list({ ...filters, limit, ...(cursor ? { cursor } : {}) } as Q);
    expect(res.items.length).toBeLessThanOrEqual(limit);
    ids.push(...res.items.map((i) => String(i.id)));
    if (!res.nextCursor) return ids;
    expect(res.items.length, "a page with a next cursor must not be empty").toBeGreaterThan(0);
    cursor = res.nextCursor;
  }
  throw new Error("cursor walk did not end after 200 pages");
}

const sqlIds = async (where: string, params: unknown[] = []) =>
  (await h.q<{ id: string }>(`select id from task_updates where ${where}`, params))
    .map((r) => String(r.id))
    .sort();

const expectExactlyOnce = (walked: string[], expected: string[]) => {
  expect(new Set(walked).size, "a row was returned twice").toBe(walked.length);
  expect([...walked].sort()).toEqual(expected);
};

const listUpdates = (query: UpdateQueryInput) => h.svc.listUpdates(query);
const listActivity = (query: ActivityQueryInput) => h.svc.listActivity(query);

describe("T14 (R12): listUpdates filters and pages", () => {
  it("returns the latest 20 by default and at most `limit`", async () => {
    // Catches: a list that loads the whole table into the browser (SPEC §6: no page loads a whole table).
    expect((await sqlIds("true")).length).toBeGreaterThan(20);
    expect((await listUpdates({})).items).toHaveLength(20);
    expect((await listUpdates({ limit: 5 })).items).toHaveLength(5);
  });

  it("never returns more than 100 rows, even when asked for more", async () => {
    // Catches: an unbounded limit passed straight to SQL (SPEC §4: limit <= 100).
    try {
      const res = await listUpdates({ limit: 1000 });
      expect(res.items.length).toBeLessThanOrEqual(100);
    } catch (err) {
      expect((err as { code?: unknown }).code).toBe("invalid");
    }
  });

  it("reaches every row exactly once through the cursor, newest first, even when timestamps tie", async () => {
    // Catches: offset paging or a time-only cursor, which skip or repeat rows that share created_at.
    const walked = await walk(listUpdates, {}, 7);
    expectExactlyOnce(walked, await sqlIds("true"));

    const times = new Map(
      (
        await h.q<{ id: string; t: number }>(
          "select id, extract(epoch from created_at)::float8 as t from task_updates",
        )
      ).map((r) => [String(r.id), Number(r.t)]),
    );
    const seq = walked.map((id) => times.get(id) ?? Number.NaN);
    for (let i = 1; i < seq.length; i++)
      expect(seq[i]).toBeLessThanOrEqual(seq[i - 1] ?? Number.NaN);
  });

  it("filters by agent and returns only that agent's rows, all of them", async () => {
    // Catches: "my work" per agent showing another agent's updates, or missing some of its own.
    for (const agentId of [IDS.CC1, IDS.CC2, IDS.OWNER]) {
      expectExactlyOnce(
        await walk(listUpdates, { agentId }, 6),
        await sqlIds("agent_id = $1", [agentId]),
      );
    }
  });

  it("filters by task", async () => {
    // Catches: the task update log mixing tasks.
    for (const taskId of ["IRP-05", "IRP-04", "HX12-01"]) {
      expectExactlyOnce(
        await walk(listUpdates, { taskId }, 6),
        await sqlIds("task_id = $1", [taskId]),
      );
    }
  });

  it("filters by source", async () => {
    // Catches: the source chip (API, MCP, CLI, hook, UI) not filtering.
    for (const source of SOURCES) {
      expectExactlyOnce(
        await walk(listUpdates, { source }, 4),
        await sqlIds("source = $1", [source]),
      );
    }
  });

  it("filters by date range, with bounds that fall between rows", async () => {
    // Catches: since/until ignored or swapped. Bounds sit at half hours so inclusive and exclusive agree.
    const since = new Date(BASE + 5.5 * 3_600_000).toISOString();
    const until = new Date(BASE + 15.5 * 3_600_000).toISOString();
    const expected = await sqlIds("created_at > $1 and created_at < $2", [since, until]);
    expect(expected.length).toBeGreaterThan(0);
    expectExactlyOnce(await walk(listUpdates, { since, until }, 4), expected);
    expectExactlyOnce(
      await walk(listUpdates, { since }, 9),
      await sqlIds("created_at > $1", [since]),
    );
    expectExactlyOnce(
      await walk(listUpdates, { until }, 9),
      await sqlIds("created_at < $1", [until]),
    );
  });

  it("combines filters", async () => {
    // Catches: only the first filter applied when several are given.
    const expected = await sqlIds("agent_id = $1 and task_id = $2 and source = $3", [
      IDS.CC1,
      "IRP-05",
      "api",
    ]);
    expect(expected.length).toBeGreaterThan(0);
    expectExactlyOnce(
      await walk(listUpdates, { agentId: IDS.CC1, taskId: "IRP-05", source: "api" }, 2),
      expected,
    );
  });
});

describe("T14 (R12): listActivity and listWorkspace are bounded too", () => {
  it("filters activity by actor and reaches every row exactly once", async () => {
    // Catches: the activity log list loading everything or paging inconsistently.
    const all = (await h.q<{ id: string }>("select id from activity_log"))
      .map((r) => String(r.id))
      .sort();
    expect(all.length).toBeGreaterThan(20);
    expect((await listActivity({})).items).toHaveLength(20);
    expectExactlyOnce(await walk(listActivity, {}, 8), all);
    const cc1 = (
      await h.q<{ id: string }>("select id from activity_log where actor = $1", [IDS.CC1])
    )
      .map((r) => String(r.id))
      .sort();
    expect(cc1.length).toBeGreaterThan(0);
    expectExactlyOnce(await walk(listActivity, { actor: IDS.CC1 }, 5), cc1);
  });

  it("shows only the latest 20 updates in the workspace", async () => {
    // Catches: listWorkspace returning the full update history to the overview page.
    const ws = await h.svc.listWorkspace();
    const got = ws.updates.map((u) => String(u.id));
    expect(got).toHaveLength(20);
    const newest = await h.q<{ id: string; t: number }>(
      "select id, extract(epoch from created_at)::float8 as t from task_updates order by created_at desc",
    );
    // Ties at the 20th place may go either way; every returned row must be at least as new as the 20th newest.
    const cutoff = Number(newest[19]?.t);
    const times = new Map(newest.map((r) => [String(r.id), Number(r.t)]));
    for (const id of got) expect(times.get(id)).toBeGreaterThanOrEqual(cutoff);
  });
});
