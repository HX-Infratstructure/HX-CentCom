import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectServiceError, setup, WEB_SOURCE, type Fixture } from "./support";

let h: Fixture;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

const risk = {
  type: "risk" as const,
  title: "A risk",
  summary: "A short risk.",
  description: "The whole risk.",
  sourceUrl: WEB_SOURCE,
};
const lesson = { title: "A lesson", summary: "A short lesson.", sourceUrl: WEB_SOURCE };

async function version(table: string, id: string): Promise<number> {
  return (await h.one<{ version: number }>(`select version from ${table} where id = $1`, [id]))
    .version;
}

describe("SPEC §6.1 scope: an agent edits only what it owns or created; the owner edits all", () => {
  it("lets the creator, the owning agent and the owner edit a RAID item, and no one else", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CODEX, { ...risk, ownerAgent: "CC2" })).value;
    expect(item).toMatchObject({ created_by: "Codex", owner_agent: "CC2" });
    expect((await h.svc.updateRaidItem(h.as.CODEX, item.id, { title: "by Codex" })).status).toBe(
      200,
    );
    expect((await h.svc.updateRaidItem(h.as.CC2, item.id, { title: "by CC2" })).status).toBe(200);
    expect(
      (await h.svc.updateRaidItem(h.as.OWNER, item.id, { title: "by the owner" })).status,
    ).toBe(200);
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { title: "by CC1" }),
      "forbidden",
      403,
    );
    expect(await h.one("select title, version from raid_items where id = $1", [item.id])).toEqual({
      title: "by the owner",
      version: 4,
    });
  });

  it("lets only the owning agent and the owner edit a row nobody created (seed rows)", async () => {
    await h.q(
      `insert into raid_items (id, type, title, summary, description, source_url, owner_agent)
       values ('RAID-80', 'risk', 't', 's', 'd', $1, 'CC2')`,
      [WEB_SOURCE],
    );
    await h.q(
      `insert into lessons (id, title, summary, source_url) values ('L-80', 't', 's', $1)`,
      [WEB_SOURCE],
    );
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, "RAID-80", { title: "x" }),
      "forbidden",
      403,
    );
    expect((await h.svc.updateRaidItem(h.as.CC2, "RAID-80", { title: "x" })).status).toBe(200);
    await expectServiceError(
      h.svc.updateLesson(h.as.CC1, "L-80", { title: "x" }),
      "forbidden",
      403,
    );
    expect((await h.svc.updateLesson(h.as.OWNER, "L-80", { title: "x" })).status).toBe(200);
  });

  it("lets only the creator and the owner edit a lesson", async () => {
    const { lesson: created } = (await h.svc.createLesson(h.as.CC1, lesson)).value;
    await expectServiceError(
      h.svc.updateLesson(h.as.CC2, created.id, { title: "by CC2" }),
      "forbidden",
      403,
    );
    expect((await h.svc.updateLesson(h.as.CC1, created.id, { title: "by CC1" })).status).toBe(200);
    expect(
      (await h.svc.updateLesson(h.as.OWNER, created.id, { title: "by the owner" })).status,
    ).toBe(200);
    expect(await version("lessons", created.id)).toBe(3);
  });

  it("lets any authenticated actor create, and nobody without a key", async () => {
    expect((await h.svc.createRaidItem(h.as.CC1, risk)).status).toBe(201);
    expect((await h.svc.createLesson(h.as.CODEX, lesson)).status).toBe(201);
    await expectServiceError(h.svc.createRaidItem(null, risk), "unauthorized", 401);
    await expectServiceError(h.svc.createLesson(null, lesson), "unauthorized", 401);
  });

  it("checks 404 before 403 before 409", async () => {
    const { item } = (await h.svc.createRaidItem(h.as.CC2, risk)).value;
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, "RAID-99", { title: "x" }),
      "not_found",
      404,
    );
    await expectServiceError(
      h.svc.updateLesson(h.as.CC1, "L-99", { title: "x" }),
      "not_found",
      404,
    );
    await expectServiceError(
      h.svc.updateRaidItem(h.as.CC1, item.id, { title: "x" }, { expectedVersion: 7 }),
      "forbidden",
      403,
    );
    const conflict = await expectServiceError(
      h.svc.updateRaidItem(h.as.OWNER, item.id, { title: "x" }, { expectedVersion: 7 }),
      "version_conflict",
      409,
    );
    expect(conflict.body).toMatchObject({ currentVersion: 1 });
    expect(await version("raid_items", item.id)).toBe(1);
    expect(await h.count("activity_log", "entity = 'raid_item' and action = 'raid.update'")).toBe(
      0,
    );
  });
});
