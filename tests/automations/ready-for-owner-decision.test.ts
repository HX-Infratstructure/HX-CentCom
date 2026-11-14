// F7a (CC1's design H1): an update that moves a task into the ready_for_owner group from another group opens one
// Pending decision in the same transaction. It blocks the task, the requester is the posting agent, and its source is
// the prUrl, else the first link, else the task's source_url. It fires once per move, and a Pending decision that
// already blocks the task opens nothing and is named in a system update.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Route as updatesRoute } from "@/routes/api/v1/tasks/$id/updates";
import { expectInvalidAt, mcpClient, rest, setup, toolValue, type Fixture } from "../raid/support";

let h: Fixture;
let client: Client | undefined;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  await h.close();
});

const PR = "https://github.com/HX-Infratstructure/HX-CentCom/pull/7";
const REPORT = "https://github.com/HX-Infratstructure/HX-CentCom/issues/1#issuecomment-1";
const CC01_TITLE = "HX-CentCom WU1 build";
const READY = "Ready for owner";

type DecisionRow = {
  id: string;
  question: string;
  subject: string;
  summary: string;
  description: string;
  gate_type: string;
  options: unknown[];
  blocks: string[];
  requested_by: string;
  recommended_by: string | null;
  source_url: string;
  status: string;
};
const pendingBlocking = (taskId: string) =>
  h.q<DecisionRow>(
    "select * from owner_decisions where status = 'Pending' and $1 = any(blocks) order by id",
    [taskId],
  );
const lastProgressAfter = async (taskId: string) =>
  (
    await h.one<{ after: Record<string, unknown> }>(
      "select after from activity_log where action = 'task.progress' and entity_id = $1 order by created_at desc, id desc limit 1",
      [taskId],
    )
  ).after;
const taskRow = (id: string) =>
  h.one<{ status: string; group: string; blocked_on: string; version: number }>(
    'select status, "group", blocked_on, version from engineering_tasks where id = $1',
    [id],
  );

async function insertTask(id: string, title: string, sourceUrl: string): Promise<void> {
  await h.q(
    `insert into engineering_tasks (id, title, agent, repository, host, status, "group", source_url)
     values ($1, $2, 'CC1', 'HX-CentCom', 'HX-15', 'In progress', 'in_progress', $3)`,
    [id, title, sourceUrl],
  );
}

describe("F7a: moving a task into Ready for owner opens one Pending decision", () => {
  it("opens it with CC1's defaults when CC-01 moves in with a prUrl, and records it on the progress row", async () => {
    const before = await taskRow("CC-01");
    const posted = await h.svc.postProgress(h.as.CC1, "CC-01", {
      status: READY,
      note: "Build done.",
      prUrl: PR,
      links: [{ label: "Report", url: REPORT }],
      source: "cli",
    });
    const pending = await pendingBlocking("CC-01");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      question: `Accept CC-01: ${CC01_TITLE}?`,
      subject: `CC-01: ${CC01_TITLE}`,
      summary: `Ready for owner: ${CC01_TITLE}`,
      description: `Build done.\n\nLinks:\n- Report: ${REPORT}`,
      gate_type: "merge",
      options: [],
      blocks: ["CC-01"],
      requested_by: "CC1",
      recommended_by: null,
      source_url: PR,
    });
    expect(posted.value.decision).toMatchObject({ id: pending[0]?.id, status: "Pending" });
    expect(await lastProgressAfter("CC-01")).toMatchObject({
      group: "ready_for_owner",
      effects: { decisionId: pending[0]?.id },
    });
    expect(await taskRow("CC-01")).toMatchObject({
      group: "ready_for_owner",
      blocked_on: before.blocked_on,
    });
  });

  it("takes the first link as the source (gate scope), else the task's source_url", async () => {
    await h.svc.postProgress(h.as.CC1, "CC-01", {
      status: READY,
      note: "Ready.",
      links: [
        { label: "Report", url: REPORT },
        { label: "Other", url: PR },
      ],
      source: "api",
    });
    expect(await pendingBlocking("CC-01")).toMatchObject([
      { source_url: REPORT, gate_type: "scope" },
    ]);

    // IRP-05 is CC1's and done; D-12 and D-13 block it but are decided, so a decision opens.
    const irp05 = await h.one<{ source_url: string }>(
      "select source_url from engineering_tasks where id = 'IRP-05'",
    );
    const posted = await h.svc.postProgress(h.as.CC1, "IRP-05", {
      status: READY,
      note: "Reopened for the owner.",
      source: "api",
    });
    expect(posted.value.decision).toMatchObject({
      source_url: irp05.source_url,
      gate_type: "scope",
      blocks: ["IRP-05"],
    });
  });

  it("lets decision override the question and gate over REST and MCP, and ignores it on an update that does not move", async () => {
    const authorization = await h.auth("CC1");
    const note = await rest(h.svc, updatesRoute, "POST", "/api/v1/tasks/CC-01/updates", {
      params: { id: "CC-01" },
      authorization,
      body: { note: "Still building.", source: "cli", decision: { question: "Too early?" } },
    });
    expect(note.status).toBe(201);
    expect(await pendingBlocking("CC-01"), "a note does not move the task").toEqual([]);

    const moved = await rest(h.svc, updatesRoute, "POST", "/api/v1/tasks/CC-01/updates", {
      params: { id: "CC-01" },
      authorization,
      body: {
        status: READY,
        note: "Build done.",
        prUrl: PR,
        source: "cli",
        decision: { question: "Deploy PR #7 to HX-7?", gateType: "deploy" },
      },
    });
    expect(moved.status).toBe(201);
    expect(await pendingBlocking("CC-01")).toMatchObject([
      { question: "Deploy PR #7 to HX-7?", gate_type: "deploy", source_url: PR },
    ]);

    await insertTask("MCP-01", "MCP posted task", PR);
    client = await mcpClient(h.svc, authorization);
    toolValue(
      await client.callTool({
        name: "post_progress",
        arguments: {
          taskId: "MCP-01",
          status: READY,
          note: "Done.",
          decision: { gateType: "host" },
        },
      }),
    );
    expect(await pendingBlocking("MCP-01")).toMatchObject([
      { question: "Accept MCP-01: MCP posted task?", gate_type: "host", source_url: PR },
    ]);
  });

  it("cuts generated text to the input limits without splitting a surrogate pair", async () => {
    // "Ready for owner: " is 17 UTF-16 units, so the emoji spans units 139-140 of the summary.
    const title = `${"a".repeat(122)}😀${"b".repeat(600)}`;
    await insertTask("LONG-01", title, PR);
    const links = Array.from({ length: 20 }, (_, i) => ({
      label: `Link ${i}`,
      url: `https://example.test/${String(i).padStart(2, "0")}/${"x".repeat(1970)}`,
    }));
    const posted = await h.svc.postProgress(h.as.CC1, "LONG-01", {
      status: READY,
      note: "Long.",
      links,
      source: "api",
    });
    const decision = posted.value.decision;
    expect(decision?.summary).toBe(`Ready for owner: ${"a".repeat(122)}`);
    expect(decision?.subject).toBe(`LONG-01: ${"a".repeat(122)}😀${"b".repeat(367)}`);
    expect(decision?.question).toBe(`Accept LONG-01: ${"a".repeat(122)}😀${"b".repeat(360)}`);
    expect(decision?.description.length).toBeLessThanOrEqual(20000);
    expect(decision?.description.startsWith(`Long.\n\nLinks:\n- Link 0: ${links[0]?.url}`)).toBe(
      true,
    );
  });

  it("opens nothing on a replay or a repeat post, and names a Pending blocker in one system update instead", async () => {
    const body = { status: READY, note: "Build done.", prUrl: PR, source: "cli" as const };
    const first = await h.svc.postProgress(h.as.CC1, "CC-01", body, { idempotencyKey: "f7a" });
    const replay = await h.svc.postProgress(h.as.CC1, "CC-01", body, { idempotencyKey: "f7a" });
    expect(replay).toEqual({ ...first, replayed: true });
    const repeat = await h.svc.postProgress(h.as.CC1, "CC-01", body);
    expect(repeat.value, "the task was already Ready for owner").not.toHaveProperty("decision");
    expect(await pendingBlocking("CC-01")).toHaveLength(1);

    // D-01, D-03 and D-05 are Pending and block CC2's IRP-04.
    const pendingBefore = await h.count("owner_decisions", "status = 'Pending'");
    const blocked = await h.svc.postProgress(h.as.CC2, "IRP-04", {
      status: READY,
      note: "Stage 2 done.",
      source: "api",
    });
    expect(blocked.value).not.toHaveProperty("decision");
    expect(await h.count("owner_decisions", "status = 'Pending'")).toBe(pendingBefore);
    const notes = await h.q<{ note: string; agent_id: string }>(
      "select note, agent_id from task_updates where task_id = 'IRP-04' and kind = 'system'",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.note).toMatch(/\bD-01\b.*already pending/);
    expect(await lastProgressAfter("IRP-04")).not.toHaveProperty("effects");
  });

  it("refuses with 400 at prUrl when no prUrl, link or usable source_url gives a source, and keeps the status", async () => {
    await insertTask("NOSRC-01", "No usable source", "see the chat");
    const before = await taskRow("NOSRC-01");
    const updates = await h.count("task_updates", "task_id = 'NOSRC-01'");
    await expectInvalidAt(
      h.svc.postProgress(h.as.CC1, "NOSRC-01", { status: READY, note: "Done.", source: "api" }),
      "prUrl",
    );
    expect(await taskRow("NOSRC-01")).toEqual(before);
    expect(await h.count("task_updates", "task_id = 'NOSRC-01'")).toBe(updates);
    expect(await pendingBlocking("NOSRC-01")).toEqual([]);
  });
});
