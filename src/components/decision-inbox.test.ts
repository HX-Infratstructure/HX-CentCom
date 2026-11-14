import { describe, expect, it } from "vitest";
import { adaptWorkspace } from "./adapt";
import { splitInbox } from "./model";
import type { Agent, Decision, Workspace } from "./server-types";

const REPO = "HX-Infratstructure/HX-CentCom";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

function decision(fields: Pick<Decision, "id"> & Partial<Decision>): Decision {
  return {
    question: `Approve ${fields.id}?`,
    subject: null,
    summary: "The owner picks the gate before the next step runs.",
    description: "The requesting agent stops until the owner records a decision.",
    gate_type: "merge",
    options: [
      { label: "Approve", recommended: false },
      { label: "Hold", recommended: false },
    ],
    blocks: [],
    recommended_by: null,
    requested_by: "atlas",
    requested_at: "2026-11-10T09:00:00.123456+00:00",
    source_url: `https://github.com/${REPO}/issues/10`,
    status: "Pending",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
    superseded_by: null,
    version: 1,
    ...fields,
  };
}

function inbox(decisions: readonly Decision[]) {
  const raw: Workspace = {
    tasks: [],
    updates: [],
    updatesCursor: null,
    requirements: [],
    decisions,
    agents: AGENTS,
    statusLabels: [],
    repos: [],
    counts: {
      updates: { total: 0, byAgent: {}, byTask: {}, bySource: {} },
      decisions: { total: decisions.length, byGateType: {}, byStatus: {} },
    },
  };
  const { pending, history } = splitInbox(adaptWorkspace(raw).decisions);
  return { pending: pending.map((d) => d.id), history: history.map((d) => d.id) };
}

// Pending and decided rows interleaved, each group in an order that the inbox must change.
const STORED: readonly Decision[] = [
  decision({ id: "D-31", blocks: ["IRP-04"], requested_at: null }),
  decision({
    id: "D-32",
    status: "Decided",
    decision_text: "Merge after CI passes.",
    decision_source_url: `https://github.com/${REPO}/pull/19#issuecomment-6870997761`,
    decided_at: "2026-11-05T12:00:00.123456+00:00",
  }),
  decision({
    id: "D-33",
    blocks: ["IRP-04"],
    requested_at: "2026-11-10T09:00:00.123456+00:00",
  }),
  decision({
    id: "D-34",
    status: "Superseded",
    superseded_by: "D-38",
    decided_at: null,
  }),
  decision({
    id: "D-35",
    blocks: ["IRP-05", "IRP-UI"],
    requested_at: "2026-11-12T09:00:00.123456+00:00",
  }),
  decision({
    id: "D-36",
    status: "Deferred",
    decision_text: "Revisit after Run 2.",
    decided_at: "2026-11-12T16:45:00.123456+00:00",
  }),
  decision({
    id: "D-37",
    blocks: ["IRP-05"],
    requested_at: "2026-11-08T09:00:00.123456+00:00",
  }),
  decision({
    id: "D-38",
    status: "Decided",
    decision_text: "Deploy 6a69437 to HX-15.",
    decision_source_url: `https://github.com/${REPO}/issues/10#issuecomment-6875070691`,
    decided_at: "2026-11-14T08:10:00.123456+00:00",
  }),
  decision({
    id: "D-39",
    blocks: ["IRP-04", "IRP-05", "IRP-UI"],
    requested_at: "2026-11-13T09:00:00.123456+00:00",
  }),
];

describe("the decision inbox", () => {
  it("puts the pending decision that blocks the most tasks first, the oldest request first on a tie, and an unrecorded request last", () => {
    expect(inbox(STORED).pending).toEqual(["D-39", "D-35", "D-37", "D-33", "D-31"]);
  });

  it("lists every decided, deferred and superseded decision in history, newest decision first and an unrecorded time last", () => {
    expect(inbox(STORED).history).toEqual(["D-38", "D-36", "D-32", "D-34"]);
  });

  it("files every stored decision in exactly one of the two lists", () => {
    const { pending, history } = inbox(STORED);
    expect([...pending, ...history].sort()).toEqual(STORED.map((d) => d.id).sort());
  });
});
