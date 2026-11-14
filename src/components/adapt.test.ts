import { describe, expect, it } from "vitest";
import { adaptRaid } from "./adapt";
import type { RaidItem } from "./server-types";

function dependency(blockingRef: string): RaidItem {
  return {
    id: "RAID-05",
    type: "dependency",
    title: "Run 2 waits on the HX-SR PR #19 merge",
    summary: "Run 2 needs HX-SR PR #19 merged first.",
    description: "PR #19 is open.",
    owner_agent: "CC2",
    status: "open",
    severity: "medium",
    severity_rated_by: "CC1",
    review_at: null,
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10",
    created_by: null,
    task_ids: ["IRP-04"],
    decision_id: "D-01",
    probability: null,
    impact: null,
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: "IRP-04",
    blocking_ref: blockingRef,
    version: 1,
    created_at: "2026-11-14T06:08:00.123456+00:00",
    updated_at: "2026-11-14T06:08:00.123456+00:00",
  };
}

function blockingOf(raw: string) {
  const [view] = adaptRaid([dependency(raw)], new Map());
  return view?.type === "dependency" ? view.blocking : undefined;
}

describe("a dependency's blocking ref", () => {
  it("links a task ref to the task", () => {
    expect(blockingOf("task:IRP-04")).toEqual({ kind: "task", id: "IRP-04" });
  });

  it("links a decision ref to the decision", () => {
    expect(blockingOf("decision:D-17")).toEqual({ kind: "decision", id: "D-17" });
  });

  it("links an http(s) URL as an external page", () => {
    const url = "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/19";
    expect(blockingOf(url)).toEqual({ kind: "external", source: { kind: "web", url } });
  });

  it("keeps any other value as text, never a link", () => {
    for (const raw of ["hx15:/home/hxsa/notes.md", "javascript:alert(1)", "IRP-04", "D-17"]) {
      expect(blockingOf(raw)).toEqual({ kind: "external", source: { kind: "text", text: raw } });
    }
  });
});
