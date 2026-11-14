import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CC1_SEVERITY_RATINGS, seedRaidLessons } from "@/server/db/seed-raid";
import { SOURCE_REF_PATTERN } from "@/server/services";
import { setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

type RaidRow = {
  id: string;
  type: string;
  severity: string | null;
  severity_rated_by: string | null;
  source_url: string;
  created_by: string | null;
  task_ids: string[];
  decision_id: string | null;
  blocked_task_id: string | null;
  blocking_ref: string | null;
  escalated: boolean;
};
type LessonRow = {
  id: string;
  status: string;
  source_url: string;
  enforced_by_url: string | null;
  created_by: string | null;
};

const raid = () => h.q<RaidRow>("select * from raid_items order by id");
const lessonRows = () => h.q<LessonRow>("select * from lessons order by id");
const source = new RegExp(SOURCE_REF_PATTERN);

describe("RAID and lessons seed (RAID-LESSONS-SEED.md, SPEC §6.1)", () => {
  it("seeds the 8 RAID rows and 9 lessons", async () => {
    expect((await raid()).map((r) => r.id)).toEqual([
      "RAID-01",
      "RAID-02",
      "RAID-03",
      "RAID-04",
      "RAID-05",
      "RAID-06",
      "RAID-07",
      "RAID-08",
    ]);
    expect((await lessonRows()).map((l) => l.id)).toEqual([
      "L-01",
      "L-02",
      "L-03",
      "L-04",
      "L-05",
      "L-06",
      "L-07",
      "L-08",
      "L-09",
    ]);
  });

  it("stores CC1's rating as each row's severity, rated by CC1, with its reason kept as data", async () => {
    const rows = await raid();
    expect(Object.keys(CC1_SEVERITY_RATINGS).sort()).toEqual(rows.map((r) => r.id));
    for (const row of rows) {
      const rating = CC1_SEVERITY_RATINGS[row.id as keyof typeof CC1_SEVERITY_RATINGS];
      expect({ id: row.id, severity: row.severity, by: row.severity_rated_by }).toEqual({
        id: row.id,
        severity: rating.severity,
        by: "CC1",
      });
      expect(rating.reason.length).toBeGreaterThan(20);
    }
  });

  it("cites a valid source on every row, and an enforcer on every adopted lesson", async () => {
    for (const row of await raid()) expect(row.source_url, row.id).toMatch(source);
    const all = await lessonRows();
    for (const lesson of all) expect(lesson.source_url, lesson.id).toMatch(source);
    const adopted = all.filter((l) => l.status === "adopted");
    expect(adopted.map((l) => l.id)).toEqual(["L-01", "L-04", "L-05", "L-06", "L-07", "L-08"]);
    for (const lesson of adopted) expect(lesson.enforced_by_url, lesson.id).toMatch(source);
    expect(all.find((l) => l.id === "L-09")).toMatchObject({
      status: "proposed",
      source_url: "hx15:/home/hxsa/HX-CentCom.wt/docs/wu1-monday-reference/SPEC.md:247",
    });
  });

  it("leaves no high or critical issue without a decision", async () => {
    const unlinked = (await raid()).filter(
      (r) =>
        r.type === "issue" &&
        ["high", "critical"].includes(r.severity ?? "") &&
        r.decision_id === null,
    );
    expect(unlinked).toEqual([]);
  });

  it("links the HX-CentCom rows to CC-01 and the Run 2 dependencies to IRP-04", async () => {
    const byId = new Map((await raid()).map((r) => [r.id, r]));
    for (const id of ["RAID-03", "RAID-04", "RAID-08"])
      expect(byId.get(id)?.task_ids).toEqual(["CC-01"]);
    expect(["RAID-05", "RAID-06", "RAID-07"].map((id) => byId.get(id))).toMatchObject([
      {
        blocked_task_id: "IRP-04",
        blocking_ref: "decision:D-01",
        decision_id: "D-01",
        task_ids: ["IRP-04"],
      },
      {
        blocked_task_id: "IRP-04",
        blocking_ref: "decision:D-03",
        decision_id: "D-03",
        task_ids: ["IRP-04"],
      },
      {
        blocked_task_id: "IRP-04",
        blocking_ref: "decision:D-17",
        decision_id: "D-17",
        task_ids: ["IRP-04"],
      },
    ]);
    expect(byId.get("RAID-01")).toMatchObject({
      decision_id: "D-06",
      escalated: true,
      task_ids: ["IRP-04"],
    });
  });

  it("records no creator and writes no activity rows", async () => {
    expect((await raid()).every((r) => r.created_by === null)).toBe(true);
    expect((await lessonRows()).every((l) => l.created_by === null)).toBe(true);
    expect(await h.count("activity_log", "entity in ('raid_item', 'lesson')")).toBe(0);
  });

  it("draws RAID-09 and L-10 next, and a second seed run changes nothing", async () => {
    await h.db.transaction((tx) => seedRaidLessons(tx));
    expect(await h.count("raid_items")).toBe(8);
    expect(await h.count("lessons")).toBe(9);
    const item = await h.svc.createRaidItem(h.as.CC1, {
      type: "risk",
      title: "t",
      summary: "s",
      description: "d",
      sourceUrl: WEB_SOURCE,
    });
    const lesson = await h.svc.createLesson(h.as.CC1, {
      title: "t",
      summary: "s",
      sourceUrl: WEB_SOURCE,
    });
    expect([item.value.item.id, lesson.value.lesson.id]).toEqual(["RAID-09", "L-10"]);
  });
});
