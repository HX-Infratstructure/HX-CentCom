// @vitest-environment node
// T12 (R3): the seed matches PROMPT-3 and DECISION-SEED, with no recommended_by. SPEC §3 Seed.
// Expected values live in seed-truth.ts, copied from the two seed files; nothing here is invented.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_ROLES,
  DECISIONS,
  IRP04_COMMIT_SHA,
  IRP05_REQUIREMENTS,
  IRP05_REQUIREMENT_SOURCE,
  TASK_OWNERS,
} from "./seed-truth";
import { setup, type Harness } from "./support";

interface DecisionRow {
  id: string;
  question: string;
  gate_type: string;
  status: string;
  summary: string | null;
  description: string | null;
  source_url: string | null;
  decision_source_url: string | null;
  decision_text: string | null;
  requested_by: string | null;
  requested_epoch: number | null;
  decided_epoch: number | null;
  blocks: string[];
  options: unknown;
  recommended_by: string | null;
}

let h: Harness;
let decisions: Map<string, DecisionRow>;

beforeAll(async () => {
  h = await setup();
  const rows = await h.q<DecisionRow>(
    `select id, question, gate_type, status, summary, description, source_url, decision_source_url, decision_text,
            requested_by, extract(epoch from requested_at)::float8 as requested_epoch,
            extract(epoch from decided_at)::float8 as decided_epoch, blocks, options, recommended_by
       from owner_decisions`,
  );
  decisions = new Map(rows.map((r) => [r.id, r]));
});
afterAll(async () => {
  await h.close();
});

const epoch = (iso: string) => Date.parse(iso) / 1000;
// Markdown emphasis and code marks are formatting, not content; list markers and line breaks likewise.
const plain = (s: string) =>
  s
    .replace(/[*`]/g, "")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
const notRecorded = (v: string | null) =>
  v === null || v.trim() === "" || v.trim().toLowerCase() === "not recorded";

describe("T12 (R3): seeded owner decisions", () => {
  it("has exactly the seventeen decisions D-01 to D-17", () => {
    // Catches: D-03 not split into D-03 and D-17, or extra invented decisions.
    expect([...decisions.keys()].sort()).toEqual(DECISIONS.map((d) => d.id).sort());
    expect(decisions.size).toBe(17);
  });

  it("sets no recommendation anywhere: no recommended_by and no recommended option", () => {
    // Catches: the invented Codex/CC2 recommendations from the Lovable seed surviving (PROMPT-3 item 1).
    for (const d of decisions.values()) {
      expect(d.recommended_by, d.id).toBeNull();
      const options = (Array.isArray(d.options) ? d.options : []) as Record<string, unknown>[];
      for (const o of options) {
        const label = String(o["label"]);
        expect(
          o["recommended_by"] ?? o["recommendedBy"] ?? null,
          `${d.id} option ${label}`,
        ).toBeNull();
        expect(o["recommended"] === true, `${d.id} option ${label} is marked recommended`).toBe(
          false,
        );
      }
    }
  });

  for (const t of DECISIONS) {
    it(`${t.id}: type, status, summary and full description match DECISION-SEED`, () => {
      // Catches: a summary or type paraphrased or mis-assigned, or a description cut short or swapped.
      const d = decisions.get(t.id);
      expect(d, t.id).toBeDefined();
      expect({ gate_type: d!.gate_type, status: d!.status, summary: d!.summary }).toEqual({
        gate_type: t.gateType,
        status: t.status,
        summary: t.summary,
      });
      expect(d!.summary!.length).toBeLessThanOrEqual(140);
      const description = plain(d!.description ?? "");
      for (const line of t.description) expect(description).toContain(plain(line));
    });

    it(`${t.id}: requester, times, sources, decision and blocks match PROMPT-3`, () => {
      // Catches: invented or stale request times, requesters and sources (PROMPT-3 replaces the Lovable values).
      const d = decisions.get(t.id)!;
      // P3's preamble equates "not recorded" with empty. Requesters are agent ids (SPEC §2 names agents by id).
      if (t.requestedBy === null || t.requestedBy === "not recorded")
        expect(notRecorded(d.requested_by), `${t.id} requested_by=${d.requested_by}`).toBe(true);
      else if (t.requestedBy !== undefined) expect(d.requested_by).toBe(t.requestedBy);
      if (t.requestedAt === null)
        expect(d.requested_epoch, `${t.id} requested_at must be left empty`).toBeNull();
      else if (t.requestedAt !== undefined) expect(d.requested_epoch).toBe(epoch(t.requestedAt));
      if (t.sourceUrl) expect(d.source_url).toBe(t.sourceUrl);
      if (t.decisionSourceUrl) expect(d.decision_source_url).toBe(t.decisionSourceUrl);
      if (t.sourceAnywhere)
        expect([d.source_url, d.decision_source_url]).toContain(t.sourceAnywhere);
      if (t.decisionText) expect(d.decision_text).toBe(t.decisionText);
      if (t.decidedAt) expect(d.decided_epoch).toBe(epoch(t.decidedAt));
      if (t.question) expect(d.question).toBe(t.question);
      if (t.blocks) expect([...d.blocks].sort()).toEqual([...t.blocks].sort());
      if (t.status === "Pending") {
        expect(d.decided_epoch, `${t.id} is Pending but has decided_at`).toBeNull();
        expect(d.decision_text ?? null, `${t.id} is Pending but has decision_text`).toBeNull();
      }
    });
  }
});

describe("T12 (R3): seeded tasks, requirements and agents", () => {
  it("has the six tasks plus CC-01, with their owning agents", async () => {
    // Catches: tasks dropped, added or reassigned by the migration.
    // The Lovable seed wrote "Unassigned"; a null agent means the same and is what "never invent" asks for.
    const rows = await h.q<{ id: string; agent: string | null }>(
      "select id, agent from engineering_tasks",
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.agent ?? "Unassigned"]))).toEqual(
      TASK_OWNERS,
    );
  });

  it("pins IRP-04 to commit c34c7cb", async () => {
    // Catches: the stale d1d5371/fc08970 commit from the Lovable seed (PROMPT-3 item 4).
    const row = await h.one<{ commit_sha: string }>(
      "select commit_sha from engineering_tasks where id = 'IRP-04'",
    );
    expect(row.commit_sha).toBe(IRP04_COMMIT_SHA);
  });

  it("replaces IRP-05's two 'merged' rows with exactly the four PROMPT-3 requirements", async () => {
    // Catches: the old PR-merged rows kept, a requirement mis-stated, or a NOT_RUN row given a proof.
    const rows = await h.q<{
      requirement: string;
      state: string;
      proof_url: string | null;
      source_url: string | null;
    }>(
      "select requirement, state, proof_url, source_url from task_requirements where task_id = 'IRP-05'",
    );
    const got = rows
      .map((r) => ({
        requirement: r.requirement,
        state: r.state,
        proofUrl: r.proof_url ? r.proof_url : null,
      }))
      .sort((a, b) => a.requirement.localeCompare(b.requirement));
    const want = [...IRP05_REQUIREMENTS].sort((a, b) => a.requirement.localeCompare(b.requirement));
    expect(got).toEqual(want);
    for (const r of rows) expect(r.source_url).toBe(IRP05_REQUIREMENT_SOURCE);
  });

  it("seeds agents CC1, CC2, Codex and OpenCode with role agent, and Agent Zero as owner", async () => {
    // Catches: a missing agent (its posts could not be attributed) or a wrong role (owner rights to an agent).
    const rows = await h.q<{ id: string; role: string; active: boolean }>(
      "select id, role, active from agents",
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.role]))).toEqual(AGENT_ROLES);
    for (const r of rows) expect(r.active, r.id).toBe(true);
  });
});
