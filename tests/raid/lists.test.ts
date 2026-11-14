import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LESSON_STATUSES,
  RAID_STATUSES,
  RAID_TYPES,
  SEVERITIES,
  type CreateLessonInput,
  type CreateRaidItemInput,
  type LessonQueryInput,
  type RaidQueryInput,
} from "@/server/services";
import { expectInvalidAt, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;

const base = { title: "t", summary: "s", description: "d", sourceUrl: WEB_SOURCE };
const ITEMS: readonly CreateRaidItemInput[] = [
  { ...base, type: "risk", severity: "high", ownerAgent: "CC1", taskIds: ["CC-01"] },
  { ...base, type: "risk", severity: "low", ownerAgent: "CC2" },
  { ...base, type: "issue", severity: "medium", ownerAgent: "CC2", taskIds: ["IRP-04"] },
  { ...base, type: "assumption", taskIds: ["CC-01", "IRP-04"] },
  {
    ...base,
    type: "dependency",
    severity: "medium",
    ownerAgent: "CC1",
    status: "monitoring",
    blockedTaskId: "IRP-04",
    blockingRef: "decision:D-01",
  },
  { ...base, type: "issue", severity: "low", status: "closed", ownerAgent: "Agent Zero" },
];
const LESSONS: readonly CreateLessonInput[] = [
  { title: "t", summary: "s", sourceUrl: WEB_SOURCE, tags: ["review", "git"] },
  { title: "t", summary: "s", sourceUrl: WEB_SOURCE, tags: ["review"], status: "retired" },
  { title: "t", summary: "s", sourceUrl: WEB_SOURCE, status: "adopted", enforcedByUrl: WEB_SOURCE },
];

beforeAll(async () => {
  h = await setup();
  for (const item of ITEMS) await h.svc.createRaidItem(h.as.OWNER, item);
  for (const lesson of LESSONS) await h.svc.createLesson(h.as.OWNER, lesson);
});
afterAll(() => h.close());

const COLUMN = {
  type: "type",
  severity: "severity",
  status: "status",
  owner: "owner_agent",
} as const;
type RaidFilter = Partial<Record<keyof typeof COLUMN | "task", string>>;

/** The ids a filter must return, newest first, read straight from the table. */
async function truthRaid(filter: RaidFilter): Promise<string[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(filter)) {
    params.push(value);
    const placeholder = `$${params.length}`;
    where.push(
      key === "task"
        ? `${placeholder} = any(task_ids)`
        : `${COLUMN[key as keyof typeof COLUMN]} = ${placeholder}`,
    );
  }
  const rows = await h.q<{ id: string }>(
    `select id from raid_items where ${where.join(" and ") || "true"} order by created_at desc, id desc`,
    params,
  );
  return rows.map((r) => r.id);
}

async function walkRaid(query: RaidQueryInput & { limit: number }): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await h.svc.listRaid({ ...query, ...(cursor ? { cursor } : {}) });
    expect(page.items.length).toBeLessThanOrEqual(query.limit);
    ids.push(...page.items.map((i) => i.id));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("the cursor walk did not end");
}

async function walkLessons(query: LessonQueryInput & { limit: number }): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await h.svc.listLessons({ ...query, ...(cursor ? { cursor } : {}) });
    expect(page.items.length).toBeLessThanOrEqual(query.limit);
    ids.push(...page.items.map((i) => i.id));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("the cursor walk did not end");
}

async function groupBy(text: string): Promise<Record<string, number>> {
  const rows = await h.q<{ key: string; n: number }>(text);
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

describe("T15 / R12: listRaid filters, counts and cursor", () => {
  const FILTERS: RaidFilter[] = [
    ...RAID_TYPES.map((type) => ({ type })),
    ...SEVERITIES.map((severity) => ({ severity })),
    ...RAID_STATUSES.map((status) => ({ status })),
    ...["CC1", "CC2", "Agent Zero", "Codex"].map((owner) => ({ owner })),
    ...["CC-01", "IRP-04", "RO-01"].map((task) => ({ task })),
    { type: "risk", owner: "CC1" },
    { task: "IRP-04", status: "open" },
  ];
  for (const filter of FILTERS) {
    it(`returns only the rows matching ${JSON.stringify(filter)}`, async () => {
      const truth = await truthRaid(filter);
      const page = await h.svc.listRaid({ ...filter, limit: 100 } as RaidQueryInput);
      expect(page.items.map((i) => i.id)).toEqual(truth);
      expect(page.counts.total).toBe(truth.length);
    });
  }

  it("counts each facet with every filter except its own", async () => {
    const page = await h.svc.listRaid({ type: "risk", owner: "CC1" });
    expect(page.counts.byType).toEqual(
      await groupBy(
        "select type as key, count(*)::int as n from raid_items where owner_agent = 'CC1' group by type",
      ),
    );
    expect(page.counts.byOwner).toEqual(
      await groupBy(
        "select owner_agent as key, count(*)::int as n from raid_items where type = 'risk' and owner_agent is not null group by owner_agent",
      ),
    );
    expect(page.counts.bySeverity).toEqual(
      await groupBy(
        "select severity as key, count(*)::int as n from raid_items where type = 'risk' and owner_agent = 'CC1' and severity is not null group by severity",
      ),
    );
    expect(page.counts.byStatus).toEqual(
      await groupBy(
        "select status as key, count(*)::int as n from raid_items where type = 'risk' and owner_agent = 'CC1' group by status",
      ),
    );
    expect(page.counts.byTask).toEqual(
      await groupBy(
        "select t as key, count(*)::int as n from raid_items, unnest(task_ids) t where type = 'risk' and owner_agent = 'CC1' group by t",
      ),
    );
    expect((await h.svc.listRaid({ task: "CC-01" })).counts.byTask).toEqual(
      await groupBy(
        "select t as key, count(*)::int as n from raid_items, unnest(task_ids) t group by t",
      ),
    );
  });

  for (const query of [{}, { status: "open" }, { task: "IRP-04" }] as const) {
    for (const limit of [1, 2, 3]) {
      it(`walks ${JSON.stringify(query)} with limit ${limit} to each row exactly once`, async () => {
        expect(await walkRaid({ ...query, limit })).toEqual(await truthRaid(query));
      });
    }
  }

  it("returns at most 20 rows by default", async () => {
    const t = await setup();
    try {
      for (let i = 0; i < 21; i++) await t.svc.createRaidItem(t.as.CC1, { ...base, type: "risk" });
      const page = await t.svc.listRaid();
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
    } finally {
      await t.close();
    }
  });

  it("refuses limit 101, a garbage cursor and a lessons cursor", async () => {
    await expectInvalidAt(h.svc.listRaid({ limit: 101 }), "limit");
    await expectInvalidAt(h.svc.listRaid({ cursor: "garbage" }), "cursor");
    const lessonCursor = (await h.svc.listLessons({ limit: 1 })).nextCursor ?? "";
    await expectInvalidAt(h.svc.listRaid({ cursor: lessonCursor }), "cursor");
  });
});

describe("T15 / R12: listLessons filters, counts and cursor", () => {
  async function truthLessons(filter: { status?: string; tag?: string }): Promise<string[]> {
    const rows = await h.q<{ id: string }>(
      `select id from lessons where ($1::text is null or status = $1) and ($2::text is null or $2 = any(tags))
        order by created_at desc, id desc`,
      [filter.status ?? null, filter.tag ?? null],
    );
    return rows.map((r) => r.id);
  }

  const FILTERS = [
    ...LESSON_STATUSES.map((status) => ({ status })),
    { tag: "review" },
    { tag: "git" },
    { status: "proposed", tag: "review" },
  ];
  for (const filter of FILTERS) {
    it(`returns only the lessons matching ${JSON.stringify(filter)}`, async () => {
      const page = await h.svc.listLessons({ ...filter, limit: 100 } as LessonQueryInput);
      const truth = await truthLessons(filter);
      expect(page.items.map((l) => l.id)).toEqual(truth);
      expect(page.counts.total).toBe(truth.length);
    });
  }

  it("counts each facet with every filter except its own", async () => {
    const page = await h.svc.listLessons({ status: "proposed", tag: "review" });
    expect(page.counts.byStatus).toEqual(
      await groupBy(
        "select status as key, count(*)::int as n from lessons where 'review' = any(tags) group by status",
      ),
    );
    expect(page.counts.byTag).toEqual(
      await groupBy(
        "select t as key, count(*)::int as n from lessons, unnest(tags) t where status = 'proposed' group by t",
      ),
    );
  });

  for (const limit of [1, 2, 3]) {
    it(`walks every lesson with limit ${limit} exactly once`, async () => {
      expect(await walkLessons({ limit })).toEqual(await truthLessons({}));
      expect(await walkLessons({ limit, tag: "review" })).toEqual(
        await truthLessons({ tag: "review" }),
      );
    });
  }

  it("refuses limit 101 and a garbage cursor", async () => {
    await expectInvalidAt(h.svc.listLessons({ limit: 101 }), "limit");
    await expectInvalidAt(h.svc.listLessons({ cursor: "Zm9v" }), "cursor");
  });
});
