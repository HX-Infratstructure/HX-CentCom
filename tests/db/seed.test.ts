// Seeded decisions, labels and sources. Expected values are copied from their sources, never read off the seed:
// - DECISION-SEED.md (docs/wu1-monday-reference): D-03's summary and description, and D-17 split out of D-03;
// - the 0001 Lovable rows at 3e39a5c (lines 99-115): D-03's question, whose deploy half is kept;
// - writes.ts GROUP_BY_STATUS and NEXT-BRIEFS.md "Post-B4 cleanup and final round": the "Ready for owner" label;
// - RAID-LESSONS-SEED.md and SPEC §6.1: RAID-03 (SPEC.md:79), RAID-04 (SPEC.md:82-84) and L-09 (SPEC.md:247) cite
//   the WU1 docs, which move to /home/hxsa/HX-CentCom.wt/docs/wu1-monday-reference/.
import { sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDb } from "@/server/db/seed";
import { createTestDb, type TestDb } from "@/server/db/test-db";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

/** The PGlite driver returns `{ rows }`; Db's public type leaves the result unknown. */
async function rows<T>(query: SQL): Promise<T[]> {
  return ((await t.db.execute(query)) as { rows: T[] }).rows;
}

const D03_SUMMARY = "Authorize deploying the exact merged Stage 2 release to HX-18.";
const D03_DESCRIPTION =
  "After PR #19 merges, CC2 builds a release from `main` that contains the O-5(c) fix (`fc08970`) and the benchmark extension. Deploying it to HX-18 needs a GO for that exact SHA. Run 2 is a separate decision (D-17).";
const WU1_ROOT = "hx15:/home/hxsa/HX-CentCom.wt/docs/wu1-monday-reference/";

describe("seeded owner decisions", () => {
  it("D-03 is the deploy GO only: Run 2 is D-17", async () => {
    const [d03] = await rows<{
      question: string | null;
      summary: string;
      description: string;
      options: unknown;
    }>(sql`select question, summary, description, options from owner_decisions where id = 'D-03'`);
    expect(d03).toEqual({
      question: "Exact-release deploy GO?",
      summary: D03_SUMMARY,
      description: D03_DESCRIPTION,
      options: [],
    });
  });

  it("records no options on any decision, because the 0001 options had no source", async () => {
    const withOptions = await rows<{ id: string }>(
      sql`select id from owner_decisions where options <> '[]'::jsonb order by id`,
    );
    expect(withOptions.map((d) => d.id)).toEqual([]);
  });
});

describe("the Ready for owner status label", () => {
  it("is seeded, and is not a done label", async () => {
    const labels = await rows<{ id: string; label: string; is_done: boolean }>(
      sql`select id, label, is_done from status_labels where id = 'Ready for owner'`,
    );
    expect(labels).toEqual([{ id: "Ready for owner", label: "Ready for owner", is_done: false }]);
  });

  it("moves a task posted with it into the ready_for_owner group, with no label added by the test", async () => {
    await t.services.postProgress(await t.actorFor("CC1"), "CC-01", {
      status: "Ready for owner",
      note: "Build done; the owner decides next.",
      source: "api",
    });
    const [task] = await rows<{ status: string; group: string }>(
      sql`select status, "group" from engineering_tasks where id = 'CC-01'`,
    );
    expect(task).toEqual({ status: "Ready for owner", group: "ready_for_owner" });
  });
});

const SEEDED_TABLES = [
  "agents",
  "status_labels",
  "engineering_tasks",
  "task_requirements",
  "owner_decisions",
  "raid_items",
  "lessons",
] as const;

async function tableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of SEEDED_TABLES) {
    const [row] = await rows<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    counts[table] = row?.n ?? -1;
  }
  return counts;
}

describe("seedDb on an already seeded database", () => {
  it("inserts nothing, and the id sequences continue after the seeded rows", async () => {
    const before = await tableCounts();
    expect(await seedDb(t.db)).toEqual({
      agents: 0,
      statusLabels: 0,
      tasks: 0,
      requirements: 0,
      decisions: 0,
    });
    expect(await tableCounts()).toEqual(before);

    // D-01..D-17, RAID-01..RAID-08 and L-01..L-09 are seeded, so the next ids follow them.
    const cc1 = await t.actorFor("CC1");
    const source = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1";
    const decision = await t.services.requestDecision(cc1, {
      question: "Does the sequence follow the seed?",
      summary: "A decision after a second seed run.",
      description: "Checks the decision id sequence after seedDb runs twice.",
      subject: "seed re-run",
      gateType: "policy",
      options: [],
      blocks: [],
      sourceUrl: source,
    });
    const raid = await t.services.createRaidItem(cc1, {
      type: "risk",
      title: "A risk after a second seed run",
      summary: "Checks the RAID id sequence.",
      description: "Checks the RAID id sequence after seedDb runs twice.",
      sourceUrl: source,
    });
    const lesson = await t.services.createLesson(cc1, {
      title: "A lesson after a second seed run",
      summary: "Checks the lesson id sequence.",
      sourceUrl: source,
    });
    expect([decision.value.decision.id, raid.value.item.id, lesson.value.lesson.id]).toEqual([
      "D-18",
      "RAID-09",
      "L-10",
    ]);
  });
});

describe("seeded HX-15 sources", () => {
  it("cite the WU1 docs at their HX-CentCom.wt path", async () => {
    const wu1 = await rows<{ id: string; source: string }>(sql`
      select id, source_url as source from raid_items where source_url like '%/wu1-monday-reference/%'
      union all
      select id, source_url from lessons where source_url like '%/wu1-monday-reference/%'
      union all
      select id, enforced_by_url from lessons where enforced_by_url like '%/wu1-monday-reference/%'
      order by id`);
    expect(wu1).toEqual([
      { id: "L-09", source: `${WU1_ROOT}SPEC.md:247` },
      { id: "RAID-03", source: `${WU1_ROOT}SPEC.md:79` },
      { id: "RAID-04", source: `${WU1_ROOT}SPEC.md:82-84` },
    ]);
  });

  it("never name the old agent-activity-compass workspace", async () => {
    const stale = await rows<{ id: string }>(sql`
      select id from raid_items r where row_to_json(r)::text like '%agent-activity-compass%'
      union all
      select id from lessons l where row_to_json(l)::text like '%agent-activity-compass%'
      union all
      select id from owner_decisions d where row_to_json(d)::text like '%agent-activity-compass%'
      union all
      select id from engineering_tasks e where row_to_json(e)::text like '%agent-activity-compass%'
      order by id`);
    expect(stale.map((r) => r.id)).toEqual([]);
  });
});
