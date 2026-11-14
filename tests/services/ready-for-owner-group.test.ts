import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

const task = async (id: string) =>
  (await t.services.listWorkspace()).tasks.find((x) => x.id === id);

async function addStatusLabel(id: string): Promise<void> {
  await t.db.execute(
    sql`insert into status_labels (id, label, is_done) values (${id}, ${id}, false)`,
  );
}

describe("ready_for_owner group", () => {
  it("moves a task posted as Ready for owner into the ready_for_owner group", async () => {
    expect(await task("CC-01")).toMatchObject({
      agent: "CC1",
      status: "In progress",
      group: "in_progress",
    });

    await t.services.postProgress(await t.actorFor("CC1"), "CC-01", {
      status: "Ready for owner",
      note: "Build done; waiting on the owner.",
      source: "api",
    });

    expect(await task("CC-01")).toMatchObject({
      status: "Ready for owner",
      group: "ready_for_owner",
    });
  });

  it("keeps the current group for a label with no group, even one named like an Object key", async () => {
    await addStatusLabel("constructor");

    await t.services.postProgress(await t.actorFor("CC1"), "CC-01", {
      status: "constructor",
      note: "A label with no group mapping.",
      source: "api",
    });

    expect(await task("CC-01")).toMatchObject({ status: "constructor", group: "in_progress" });
  });
});
