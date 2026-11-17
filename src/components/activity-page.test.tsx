import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { workspaceWith } from "@/test/ui-fixtures";
import type { ActivityCounts, ActivityEntry, ActivityPage, Agent } from "./server-types";

const server = vi.hoisted(() => ({ listWorkspace: vi.fn(), listActivity: vi.fn() }));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspace: server.listWorkspace,
  listActivity: server.listActivity,
}));

const OWNER_KEY = "owner-key-for-this-test";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
  { id: "beacon", display_name: "Beacon", role: "agent", color: "sky", active: true },
];

const WORKSPACE = workspaceWith({ agents: AGENTS });

let serial = 0;
/** A row as listActivity returns it. `revertible` is the server's verdict, so a row the server marks revertible says so. */
function entry(
  fields: Pick<ActivityEntry, "action" | "entity" | "entity_id"> & Partial<ActivityEntry>,
): ActivityEntry {
  serial += 1;
  return {
    id: `7f3c2a10-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    actor: "atlas",
    before: null,
    after: null,
    run_id: null,
    commit_sha: null,
    created_at: "2026-11-14T08:10:00.123456+00:00",
    revertible: false,
    ...fields,
  };
}

const PROGRESS = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "IRP-04",
  before: { status: "In progress", group: "in_progress", version: 3 },
  after: { status: "Ready for owner", group: "ready_for_owner", version: 4 },
  revertible: true,
});

/** One row for every logged action, newest first. */
const EVERY_ACTION: readonly ActivityEntry[] = [
  PROGRESS,
  entry({
    action: "requirement.set",
    entity: "requirement",
    entity_id: "0b8e0a52-5b1f-4c35-9a53-1d2e3f405162",
    before: { task_id: "IRP-04", state: "NOT_RUN" },
    after: { task_id: "IRP-04", state: "PASS" },
    revertible: true,
  }),
  entry({ action: "decision.request", entity: "decision", entity_id: "D-14" }),
  entry({ action: "decision.decide", entity: "decision", entity_id: "D-13", actor: "beacon" }),
  entry({ action: "key.issue", entity: "agent_key", entity_id: "key-atlas-2" }),
  entry({ action: "key.revoke", entity: "agent_key", entity_id: "key-atlas-1" }),
  entry({ action: "key.bootstrap", entity: "agent_key", entity_id: "key-owner-1" }),
  entry({ action: "raid.create", entity: "raid_item", entity_id: "R-07" }),
  entry({
    action: "raid.update",
    entity: "raid_item",
    entity_id: "R-06",
    before: { status: "open" },
    revertible: true,
  }),
  entry({ action: "lesson.create", entity: "lesson", entity_id: "L-03" }),
  entry({
    action: "lesson.update",
    entity: "lesson",
    entity_id: "L-02",
    before: { status: "proposed" },
    revertible: true,
  }),
  /* A revert logs the reverted fields as before and after, as revert.ts does, so it can be reverted in turn. */
  entry({
    action: "activity.revert",
    entity: "task",
    entity_id: "IRP-02",
    actor: "Agent Zero",
    before: { status: "Blocked", group: "in_progress", version: 6 },
    after: {
      status: "In progress",
      group: "in_progress",
      version: 7,
      update_id: "5d2a8c31-6e4f-4b07-a9d3-1c8e7f2b6a40",
      reverts: "7f3c2a10-0000-4000-8000-000000000099",
    },
    revertible: true,
  }),
];

/* What a write's automations did, which restoring the row cannot undo (writes.ts, raid.ts). */
const OPENED_DECISION = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "IRP-05",
  before: { status: "In progress", group: "in_progress", version: 2 },
  after: {
    status: "Ready for owner",
    group: "ready_for_owner",
    version: 3,
    update_id: "e1b7c4a2-3f90-4d6e-8a15-2c9f0b7d3e61",
    effects: { decisionId: "D-15" },
  },
});

const DEPENDENCY = { id: "RAID-10", type: "dependency", severity: "low", task_ids: ["CC-01"] };

const CLOSED_DEPENDENCY = entry({
  action: "raid.update",
  entity: "raid_item",
  entity_id: DEPENDENCY.id,
  before: { ...DEPENDENCY, status: "open", version: 1 },
  after: {
    ...DEPENDENCY,
    status: "closed",
    version: 2,
    effects: {
      systemUpdateIds: ["9a4e2f60-7b1c-4d38-b5e9-0f6a3c8d2b17"],
      unblockedTask: { id: "CC-01", version: 3 },
    },
  },
});

/* Shapes as the server logs them (H3 screenshot run, evidence/d5/api/a1-activity.json). */
const STATUS_BLOCKED = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "CC-01",
  before: { group: "in_progress", status: "In progress", version: 1 },
  after: {
    group: "in_progress",
    status: "Blocked",
    version: 2,
    update_id: "75ff7fbb-0da1-456d-92b4-a2a323d8b9e2",
  },
  revertible: true,
});

const NOTE_ONLY = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "IRP-04",
  before: { group: "in_progress", status: "In progress", version: 1 },
  after: {
    group: "in_progress",
    status: "In progress",
    version: 2,
    update_id: "0522eed4-db35-48ad-90e6-429e5d70bf13",
  },
  revertible: true,
});

/* A progress post with commitSha repins the task, and the row's snapshots then carry commit_sha (writes.ts). */
const SHA_BEFORE = "4d1e9b27c0a85f3e6b1d2c9a7e40f8b35d6c1a92";
const SHA_AFTER = "a07c3f5e2b9d1840c6e7f3a2b5d9c1e08f4a6b37";

const REPINNED = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "IRP-07",
  before: { status: "In progress", group: "in_progress", version: 3, commit_sha: SHA_BEFORE },
  after: {
    status: "In progress",
    group: "in_progress",
    version: 4,
    update_id: "3b0c6f1e-8a2d-4f47-9c15-6e2d8b7a4f90",
    commit_sha: SHA_AFTER,
  },
  commit_sha: SHA_AFTER,
  revertible: true,
});

const FIRST_PIN = entry({
  action: "task.progress",
  entity: "task",
  entity_id: "IRP-08",
  before: { status: "In progress", group: "in_progress", version: 1, commit_sha: null },
  after: {
    status: "In progress",
    group: "in_progress",
    version: 2,
    update_id: "c4e19a7b-2f63-4d08-b5a1-9e7f0d3c6b28",
    commit_sha: SHA_AFTER,
  },
  commit_sha: SHA_AFTER,
  revertible: true,
});

const REQUIREMENT_ROW = {
  id: "a8975406-7a84-4788-a7de-0a26b5a31197",
  task_id: "CC-01",
  requirement: "The router answers on the HX-7 route",
  proof_url: null,
  source_url: null,
  updated_by: "atlas",
  created_at: "2026-11-14T16:24:57.151Z",
};

const STATE_BLOCKED = entry({
  action: "requirement.set",
  entity: "requirement",
  entity_id: REQUIREMENT_ROW.id,
  before: { ...REQUIREMENT_ROW, state: "NOT_RUN", version: 1 },
  after: { ...REQUIREMENT_ROW, state: "BLOCKED", version: 2 },
  revertible: true,
});

/* requirement.set inserts a requirement its task did not have yet, and logs the new row with no before (writes.ts). */
const NEW_REQUIREMENT = {
  ...REQUIREMENT_ROW,
  id: "3c0d9e61-2b7a-4f18-8e45-6a1f0b9c7d23",
  task_id: "IRP-04",
  requirement: "The shadow hook logs every routed request",
  state: "NOT_RUN",
  version: 1,
};

const REQUIREMENT_CREATED = entry({
  action: "requirement.set",
  entity: "requirement",
  entity_id: NEW_REQUIREMENT.id,
  after: NEW_REQUIREMENT,
});

const OLD_SUMMARY = "Created by the screenshot run for a raid.update row";
const NEW_SUMMARY = "Summary edited by the screenshot run to create a raid.update row";
const RAID_ROW = {
  id: "RAID-09",
  type: "risk",
  status: "open",
  severity: "low",
  task_ids: ["CC-01"],
};

const SUMMARY_EDITED = entry({
  action: "raid.update",
  entity: "raid_item",
  entity_id: "RAID-09",
  before: { ...RAID_ROW, summary: OLD_SUMMARY, version: 1, updated_at: "2026-11-14T16:24:57.194Z" },
  after: {
    ...RAID_ROW,
    summary: NEW_SUMMARY,
    version: 2,
    updated_at: "2026-11-14T16:24:57.214Z",
    effects: {},
  },
  revertible: true,
});

/* review_at is a RAID input (raid.ts), so a new review date is a change the row shows, unlike updated_at. */
const REVIEW_MOVED = entry({
  action: "raid.update",
  entity: "raid_item",
  entity_id: "RAID-09",
  before: {
    ...RAID_ROW,
    review_at: "2026-11-20T00:00:00.000Z",
    version: 2,
    updated_at: "2026-11-14T16:24:57.214Z",
  },
  after: {
    ...RAID_ROW,
    review_at: "2026-11-27T00:00:00.000Z",
    version: 3,
    updated_at: "2026-11-14T17:02:11.508Z",
    effects: {},
  },
  revertible: true,
});

const PENDING_DECISION = {
  id: "D-13",
  question: "Merge the shadow hook PR?",
  gate_type: "merge",
  requested_by: "atlas",
  requested_at: "2026-11-13T09:00:00.123456+00:00",
  superseded_by: null,
  status: "Pending",
  decision_text: null,
  decided_at: null,
  version: 1,
};

const DECIDED = entry({
  action: "decision.decide",
  entity: "decision",
  entity_id: "D-13",
  before: PENDING_DECISION,
  after: {
    ...PENDING_DECISION,
    status: "Decided",
    decision_text: "Merge it.",
    decided_at: "2026-11-14T08:10:00.123456+00:00",
    version: 2,
  },
});

const KEY_REVOKED = entry({
  action: "key.revoke",
  entity: "agent_key",
  entity_id: "key-atlas-1",
  before: { revoked_at: null },
  after: { revoked_at: "2026-11-14T08:10:00.123456+00:00" },
});

const RAID_CREATED = entry({
  action: "raid.create",
  entity: "raid_item",
  entity_id: "RAID-09",
  after: { ...RAID_ROW, summary: OLD_SUMMARY, version: 1, effects: {} },
});

/** Tests that do not read the chips get counts with no facet values. */
function page(
  items: readonly ActivityEntry[],
  nextCursor: string | null = null,
  counts: ActivityCounts = { total: items.length, byActor: {}, byEntity: {} },
): ActivityPage {
  return { items, nextCursor, counts };
}

async function renderActivity(url: string, owner: boolean) {
  if (owner) window.sessionStorage.setItem("hx-centcom.owner-key", OWNER_KEY);
  await renderApp(url, { heading: "Activity", onDocument: true });
}

/** The row of the change to `record`, named as the row names it ("Task CC-01"). */
function rowOf(record: string): HTMLElement {
  const row = screen.getAllByRole("article").find((r) => within(r).queryByText(record) !== null);
  if (row === undefined) throw new Error(`No row for ${record}`);
  return row;
}

function changesOf(record: string): readonly (string | null)[] {
  return within(rowOf(record))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

function rows() {
  return screen.getAllByRole("article").map((row) => ({
    title: within(row).getByRole("heading", { level: 3 }).textContent,
    revert: within(row).queryByRole("button", { name: "Revert" }) !== null,
    status: within(row).queryByRole("status")?.textContent ?? null,
  }));
}

/** Answers the revert POST with `status` and `body`; every other request is unexpected in these tests. */
function stubRevertAnswer(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestKeys(fetchMock: ReturnType<typeof vi.fn>): readonly (string | null)[] {
  return fetchMock.mock.calls.map((call) =>
    new Headers((call[1] as RequestInit).headers).get("Idempotency-Key"),
  );
}

async function confirmRevert(title: string) {
  const row = screen
    .getAllByRole("article")
    .find((r) => within(r).queryByRole("heading", { level: 3, name: title }));
  if (row === undefined) throw new Error(`No row titled ${title}`);
  fireEvent.click(within(row).getByRole("button", { name: "Revert" }));
  const dialog = await screen.findByRole("alertdialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert" }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  server.listWorkspace.mockReset();
  server.listActivity.mockReset();
});

describe("the activity page's filters", () => {
  const chips = (facet: string) =>
    within(screen.getByRole("group", { name: facet }))
      .getAllByRole("link")
      .map((chip) => chip.textContent);

  it("counts each actor and record type from the log's counts, and the whole log under the rows", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(
      page(EVERY_ACTION, "page-2", {
        total: 40,
        byActor: { atlas: 31, beacon: 9 },
        byEntity: { task: 20, requirement: 6, decision: 8, agent_key: 5, raid_item: 1 },
      }),
    );
    await renderActivity("/activity", false);

    expect(chips("Actor")).toEqual(["Atlas31", "Beacon9"]);
    expect(chips("Record")).toEqual([
      "Task20",
      "Requirement6",
      "Decision8",
      "Agent key5",
      "RAID item1",
    ]);
    expect(screen.getByText("Showing 12 of 40 activity entries.")).toBeInTheDocument();
  });

  it("keeps the actor and record filters in the URL and sends them to the log", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(
      page([PROGRESS], null, {
        total: 1,
        byActor: { atlas: 1, beacon: 2 },
        byEntity: { task: 1, decision: 3 },
      }),
    );
    await renderActivity("/activity?actor=atlas&entity=task", false);

    expect(server.listActivity).toHaveBeenCalledWith({ data: { actor: "atlas", entity: "task" } });
    expect(
      within(screen.getByRole("group", { name: "Actor" })).getByRole("link", { name: "Atlas 1" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(screen.getByRole("group", { name: "Record" })).getByRole("link", { name: "Task 1" }),
    ).toHaveAttribute("aria-current", "true");
  });
});

describe("what each activity row changed", () => {
  const LOG = [SUMMARY_EDITED, RAID_CREATED, STATE_BLOCKED, NOTE_ONLY, STATUS_BLOCKED];

  it("shows a progress post's status change and none of its bookkeeping", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page(LOG));
    await renderActivity("/activity", false);

    expect(changesOf("Task CC-01")).toEqual(["status In progress → Blocked"]);
  });

  it("shows nothing extra for a progress post that changed only bookkeeping", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page(LOG));
    await renderActivity("/activity", false);

    expect(changesOf("Task IRP-04")).toEqual([]);
  });

  it("shows no change for a write whose snapshots are arrays, not rows", async () => {
    const arrays = entry({
      action: "task.progress",
      entity: "task",
      entity_id: "CC-01",
      before: ["In progress", 3],
      after: ["Blocked", 4],
    });
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([arrays]));
    await renderActivity("/activity", false);

    expect(changesOf("Task CC-01")).toEqual([]);
  });

  it("shows a requirement's state change in the page's words", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page(LOG));
    await renderActivity("/activity", false);

    expect(changesOf("Requirement on CC-01")).toEqual(["state Not run → Blocked"]);
  });

  it("says a long summary was edited without printing either text", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([SUMMARY_EDITED]));
    await renderActivity("/activity", false);

    expect(changesOf("RAID item RAID-09")).toEqual(["summary edited"]);
    expect(rowOf("RAID item RAID-09")).not.toHaveTextContent(OLD_SUMMARY);
    expect(rowOf("RAID item RAID-09")).not.toHaveTextContent(NEW_SUMMARY);
  });

  it("shows nothing extra for a create, which has no before", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([RAID_CREATED]));
    await renderActivity("/activity", false);

    expect(changesOf("RAID item RAID-09")).toEqual([]);
  });

  it("shows a RAID item's new review date, which is an input and not a write time", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([REVIEW_MOVED]));
    await renderActivity("/activity", false);

    expect(changesOf("RAID item RAID-09")).toEqual([
      "review at 2026-11-20T00:00:00.000Z → 2026-11-27T00:00:00.000Z",
    ]);
    expect(rowOf("RAID item RAID-09")).not.toHaveTextContent("updated at");
  });

  it("shows a decision's status change and not when it was decided, which the row's time already says", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([DECIDED]));
    await renderActivity("/activity", false);

    expect(changesOf("Decision D-13")).toEqual([
      "status Pending → Decided",
      "decision text none → Merge it.",
    ]);
  });

  it("shows nothing extra for a key revoke, whose only change is when it was revoked", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([KEY_REVOKED]));
    await renderActivity("/activity", false);

    expect(changesOf("Agent key key-atlas-1")).toEqual([]);
  });

  it("shows a repinned commit as its short SHA, as the rest of the app does, and a first pin as from none", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([REPINNED, FIRST_PIN]));
    await renderActivity("/activity", false);

    expect(changesOf("Task IRP-07")).toEqual(["commit sha 4d1e9b2 → a07c3f5"]);
    expect(changesOf("Task IRP-08")).toEqual(["commit sha none → a07c3f5"]);
  });
});

describe("Revert on the activity page", () => {
  it.each([
    [STATUS_BLOCKED, "Task CC-01", "status goes back from Blocked to In progress."],
    [SUMMARY_EDITED, "RAID item RAID-09", "summary goes back to its earlier value."],
    [REPINNED, "Task IRP-07", "commit sha goes back from a07c3f5 to 4d1e9b2."],
  ])("says in the confirm dialog what the revert restores (%#)", async (row, record, restores) => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([row]));
    await renderActivity("/activity", true);

    fireEvent.click(within(rowOf(record)).getByRole("button", { name: "Revert" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(restores)).toBeInTheDocument();
  });

  it("is offered nowhere without an owner key", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page(EVERY_ACTION));
    await renderActivity("/activity", false);

    expect(rows()).toHaveLength(EVERY_ACTION.length);
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });

  it("is offered in owner mode only on progress, requirement, RAID and lesson updates, and on reverts", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page(EVERY_ACTION));
    await renderActivity("/activity", true);

    expect(
      rows()
        .filter((r) => r.revert)
        .map((r) => r.title),
    ).toEqual([
      "Progress posted",
      "Requirement set",
      "RAID item updated",
      "Lesson updated",
      "Change reverted",
    ]);
  });

  it("is not offered on an update whose after records effects, which restoring the row cannot undo", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(
      page([OPENED_DECISION, CLOSED_DEPENDENCY, SUMMARY_EDITED]),
    );
    await renderActivity("/activity", true);

    const offered = (record: string) =>
      within(rowOf(record)).queryByRole("button", { name: "Revert" }) !== null;
    expect({
      openedDecision: offered("Task IRP-05"),
      closedDependency: offered("RAID item RAID-10"),
      noEffects: offered("RAID item RAID-09"),
    }).toEqual({ openedDecision: false, closedDependency: false, noEffects: true });
  });

  it("is not offered on a requirement.set that created the requirement, which has no before", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([REQUIREMENT_CREATED, STATE_BLOCKED]));
    await renderActivity("/activity", true);

    const offered = (record: string) =>
      within(rowOf(record)).queryByRole("button", { name: "Revert" }) !== null;
    expect({
      created: offered("Requirement on IRP-04"),
      updated: offered("Requirement on CC-01"),
    }).toEqual({ created: false, updated: true });
  });

  it("sends the confirmed revert with the owner key and a request key, and no body", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([PROGRESS]));
    const fetchMock = stubRevertAnswer(200, { reverted: PROGRESS.id });
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(`/api/v1/activity/${PROGRESS.id}/revert`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${OWNER_KEY}`);
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f]{32}$/);
    expect(headers.get("If-Match")).toBeNull();
  });

  it("says the change cannot be reverted, with the server's reason, on 409 not_revertible", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([PROGRESS]));
    const reason = `Activity ${PROGRESS.id} cannot be reverted: restoring the row cannot undo its effects (decision).`;
    stubRevertAnswer(409, { error: { code: "not_revertible", status: 409, message: reason } });
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `This change cannot be reverted.${reason}`,
    );
  });

  it("says this change is no longer the record's latest, and only the latest can be reverted, on 409 version_conflict", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([PROGRESS]));
    stubRevertAnswer(409, {
      error: {
        code: "version_conflict",
        status: 409,
        message: "The resource is at version 6.",
        currentVersion: 6,
      },
    });
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This change is no longer the record's latest.The resource is at version 6.Only a record's latest change can be reverted.",
    );
    expect(alert).not.toHaveTextContent("This record changed after you opened it.");
  });

  it("confirms the revert and refetches the log, which then shows the revert on top", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    const revertRow = entry({
      action: "activity.revert",
      entity: "task",
      entity_id: "IRP-04",
      actor: "Agent Zero",
      after: { status: "In progress", reverts: PROGRESS.id },
    });
    server.listActivity
      .mockResolvedValueOnce(page([PROGRESS]))
      .mockResolvedValue(page([revertRow, PROGRESS]));
    stubRevertAnswer(200, {
      reverted: PROGRESS.id,
      entity: "task",
      entityId: "IRP-04",
      version: 5,
    });
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");

    await screen.findByRole("heading", { level: 3, name: "Change reverted" });
    expect(server.listActivity).toHaveBeenCalledTimes(2);
    expect(rows().map((r) => [r.title, r.status])).toEqual([
      ["Change reverted", null],
      ["Progress posted", "Reverted."],
    ]);
  });

  it("resends with the same request key after a network failure, so the server replays instead of reverting twice", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([PROGRESS]));
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(
        async () => new Response(JSON.stringify({ reverted: PROGRESS.id }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request did not complete.Failed to fetch",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByText("Reverted.")).toBeInTheDocument();
    const keys = requestKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("sends a new request key once the server has answered, so a later revert never replays an old answer", async () => {
    server.listWorkspace.mockResolvedValue(WORKSPACE);
    server.listActivity.mockResolvedValue(page([PROGRESS]));
    const conflict = {
      error: {
        code: "version_conflict",
        status: 409,
        message: "The resource is at version 6.",
        currentVersion: 6,
      },
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(conflict), { status: 409 }))
      .mockImplementation(
        async () => new Response(JSON.stringify({ reverted: PROGRESS.id }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderActivity("/activity", true);

    await confirmRevert("Progress posted");
    await screen.findByRole("alert");
    await confirmRevert("Progress posted");

    expect(await screen.findByText("Reverted.")).toBeInTheDocument();
    const keys = requestKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
