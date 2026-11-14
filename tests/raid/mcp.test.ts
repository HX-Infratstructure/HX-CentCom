import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mcpClient,
  setup,
  toolError,
  toolMeta,
  toolValue,
  WEB_SOURCE,
  type Fixture,
} from "./support";

const B4_READS = ["list_lessons", "list_raid"];
const B4_WRITES = ["add_lesson", "add_raid_item", "update_raid_item"];

let h: Fixture;
const clients: Client[] = [];
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await h.close();
});

async function client(agentId?: string): Promise<Client> {
  const c = await mcpClient(h.svc, agentId === undefined ? undefined : await h.auth(agentId));
  clients.push(c);
  return c;
}

const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);

describe("MCP tools for the RAID register and the lessons log (SPEC §6.1)", () => {
  it("lists B4's read tools to anonymous callers and no B4 write tool", async () => {
    const listed = await names(await client());
    for (const name of B4_READS) expect(listed).toContain(name);
    for (const name of B4_WRITES) expect(listed).not.toContain(name);
  });

  it("lists all five to a keyed agent, with honest annotations", async () => {
    const { tools } = await (await client("CC2")).listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    for (const name of [...B4_READS, ...B4_WRITES]) expect(byName.has(name), name).toBe(true);
    for (const name of B4_READS)
      expect(byName.get(name)).toEqual({ readOnlyHint: true, openWorldHint: false });
    const write = { readOnlyHint: false, idempotentHint: false, openWorldHint: false };
    expect(byName.get("add_raid_item")).toEqual({ ...write, destructiveHint: false });
    expect(byName.get("add_lesson")).toEqual({ ...write, destructiveHint: false });
    expect(byName.get("update_raid_item")).toEqual({ ...write, destructiveHint: true });
  });

  it("list_raid and list_lessons return the service page", async () => {
    const c = await client();
    const raid = toolValue<{ items: { id: string }[]; counts: { total: number } }>(
      await c.callTool({ name: "list_raid", arguments: { type: "dependency", limit: 2 } }),
    );
    expect(raid).toEqual(
      JSON.parse(JSON.stringify(await h.svc.listRaid({ type: "dependency", limit: 2 }))),
    );
    expect(raid.items.map((i) => i.id)).toEqual(["RAID-07", "RAID-06"]);
    const lessons = toolValue(
      await c.callTool({ name: "list_lessons", arguments: { tag: "review" } }),
    );
    expect(lessons).toEqual(JSON.parse(JSON.stringify(await h.svc.listLessons({ tag: "review" }))));
  });

  it("add_raid_item, update_raid_item and add_lesson each make one service write as the key's agent", async () => {
    const c = await client("CC2");
    const added = toolValue<{
      item: { id: string; created_by: string };
      decision: unknown;
      systemUpdates: unknown[];
    }>(
      await c.callTool({
        name: "add_raid_item",
        arguments: {
          type: "risk",
          title: "t",
          summary: "s",
          description: "d",
          sourceUrl: WEB_SOURCE,
          idempotencyKey: "m1",
        },
      }),
    );
    expect(added).toMatchObject({ item: { created_by: "CC2" }, decision: null, systemUpdates: [] });
    const replay = await c.callTool({
      name: "add_raid_item",
      arguments: {
        type: "risk",
        title: "t",
        summary: "s",
        description: "d",
        sourceUrl: WEB_SOURCE,
        idempotencyKey: "m1",
      },
    });
    expect(toolMeta(replay)).toEqual({ replayed: true });
    const updated = toolValue<{
      item: { status: string; version: number };
      systemUpdates: unknown[];
    }>(
      await c.callTool({
        name: "update_raid_item",
        arguments: { id: "RAID-05", status: "closed", expectedVersion: 1 },
      }),
    );
    expect(updated.item).toMatchObject({ status: "closed", version: 2 });
    expect(updated.systemUpdates).toHaveLength(1);
    const lesson = toolValue<{ lesson: { created_by: string; status: string } }>(
      await c.callTool({
        name: "add_lesson",
        arguments: { title: "t", summary: "s", sourceUrl: WEB_SOURCE },
      }),
    );
    expect(lesson.lesson).toMatchObject({ created_by: "CC2", status: "proposed" });
    expect(
      await h.count(
        "activity_log",
        "actor = 'CC2' and action in ('raid.create', 'raid.update', 'lesson.create')",
      ),
    ).toBe(3);
  });

  it("returns a service error as isError with the error body", async () => {
    const c = await client("CC1");
    const refused = await c.callTool({
      name: "update_raid_item",
      arguments: { id: "RAID-01", title: "not mine" },
    });
    expect(toolError(refused)).toMatchObject({ code: "forbidden", status: 403 });
    const adoption = await c.callTool({
      name: "add_lesson",
      arguments: { title: "t", summary: "s", sourceUrl: WEB_SOURCE, status: "adopted" },
    });
    expect(toolError(adoption)).toMatchObject({ code: "invalid", status: 400 });
  });
});
