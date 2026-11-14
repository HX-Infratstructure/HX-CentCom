// @vitest-environment node
// T2 (R5, R2) attribution, T3 (R2) scope, T8 (R1) computed progress. SPEC §3, §4.
// Task owners come from the seed: IRP-05 and IRP-UI belong to CC1, IRP-04 to CC2 (seed-truth.ts TASK_OWNERS).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PostProgressInput, SetRequirementInput } from "@/server/services";
import { IRP05_REQUIREMENTS, TASK_OWNERS } from "./seed-truth";
import {
  IDS,
  count,
  expectServiceError,
  loose,
  setup,
  taskProgress,
  type Harness,
} from "./support";

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

interface UpdateRow {
  agent_id: string;
  source: string | null;
  run_id: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  links: unknown;
  progress?: unknown;
}

const updatesFor = (taskId: string, note: string) =>
  h.q<UpdateRow>("select * from task_updates where task_id = $1 and note = $2", [taskId, note]);

describe("T2 (R5, R2): each update records the agent that made it", () => {
  it("records agent_id CC1 when CC1 posts to its own task, and ignores an agent named in the body", async () => {
    // Catches: author taken from the request body, so an agent could post as someone else.
    expect(TASK_OWNERS["IRP-05"]).toBe(IDS.CC1);
    await h.svc.postProgress(
      h.as.CC1,
      "IRP-05",
      loose<PostProgressInput>({
        note: "t2 spoof",
        source: "api",
        agent: "CC2",
        agentId: "CC2",
        agent_id: "CC2",
      }),
      {},
    );
    const rows = await updatesFor("IRP-05", "t2 spoof");
    expect(rows.map((r) => r.agent_id)).toEqual([IDS.CC1]);
  });

  it("keeps the links, commit SHA, PR URL, source and run id the agent sent", async () => {
    // Catches: an update that names its agent but drops what the tasks page shows next to the badge (SPEC §6).
    const pr = "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/19";
    const links = [{ label: "PR #19", url: pr }];
    await h.svc.postProgress(
      h.as.CC1,
      "IRP-UI",
      { note: "t2 fields", source: "cli", runId: "run-t2", links, commitSha: "c34c7cb", prUrl: pr },
      {},
    );
    const rows = await updatesFor("IRP-UI", "t2 fields");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent_id: IDS.CC1,
      source: "cli",
      run_id: "run-t2",
      commit_sha: "c34c7cb",
      pr_url: pr,
      links,
    });
  });

  it("records the owner as the actor when the owner posts", async () => {
    // Catches: owner posts filed under the task's agent instead of under Agent Zero.
    await h.svc.postProgress(h.as.OWNER, "IRP-04", { note: "t2 owner", source: "ui" }, {});
    const rows = await updatesFor("IRP-04", "t2 owner");
    expect(rows.map((r) => r.agent_id)).toEqual([IDS.OWNER]);
  });
});

describe("T3 (R2): an agent writes only its own tasks and only requests decisions", () => {
  it("rejects CC1 posting progress to CC2's task with 403 and writes nothing", async () => {
    // Catches: missing scope check, so any agent could post to any task.
    expect(TASK_OWNERS["IRP-04"]).toBe(IDS.CC2);
    const updates = await count(h, "task_updates");
    const audit = await count(h, "activity_log");
    await expectServiceError(
      h.svc.postProgress(h.as.CC1, "IRP-04", { note: "t3 cross", source: "api" }, {}),
      "forbidden",
      403,
    );
    expect(await count(h, "task_updates")).toBe(updates);
    expect(await count(h, "activity_log")).toBe(audit);
  });

  it("lets CC2 post to its own task, the control for the case above", async () => {
    // Catches: a scope check that rejects everyone, which would make the 403 above meaningless.
    await h.svc.postProgress(h.as.CC2, "IRP-04", { note: "t3 own", source: "api" }, {});
    expect(await updatesFor("IRP-04", "t3 own")).toHaveLength(1);
  });

  it("rejects CC1 adding or changing a requirement on CC2's task with 403", async () => {
    // Catches: scope enforced on postProgress but not on setRequirement, the other task write.
    await h.svc.setRequirement(
      h.as.CC2,
      "IRP-04",
      { requirement: "t3 CC2 requirement", state: "NOT_RUN" },
      {},
    );
    const req = await h.one<{ id: string }>(
      "select id from task_requirements where task_id = 'IRP-04' and requirement = 't3 CC2 requirement'",
    );
    const before = await count(h, "task_requirements", "task_id = 'IRP-04'");

    await expectServiceError(
      h.svc.setRequirement(h.as.CC1, "IRP-04", { requirementId: req.id, state: "FAIL" }, {}),
      "forbidden",
      403,
    );
    await expectServiceError(
      h.svc.setRequirement(
        h.as.CC1,
        "IRP-04",
        { requirement: "t3 CC1 intrudes", state: "NOT_RUN" },
        {},
      ),
      "forbidden",
      403,
    );
    const after = await h.one<{ state: string }>(
      "select state from task_requirements where id = $1",
      [req.id],
    );
    expect(after.state).toBe("NOT_RUN");
    expect(await count(h, "task_requirements", "task_id = 'IRP-04'")).toBe(before);
  });

  it("rejects an agent deciding a decision with 403, and the decision stays Pending", async () => {
    // Catches: an agent closing an owner gate.
    for (const agent of [h.as.CC1, h.as.CC2]) {
      await expectServiceError(
        h.svc.decide(
          agent,
          "D-01",
          {
            status: "Decided",
            decisionText: "agent tries to decide",
            sourceUrl: "https://example.invalid/agent-decides",
          },
          {},
        ),
        "forbidden",
        403,
      );
    }
    const row = await h.one<{ status: string }>(
      "select status from owner_decisions where id = 'D-01'",
    );
    expect(row.status).toBe("Pending");
  });

  it("lets the owner post to any agent's task and decide", async () => {
    // Catches: owner role treated like an agent role.
    await h.svc.postProgress(h.as.OWNER, "IRP-04", { note: "t3 owner post", source: "ui" }, {});
    expect(await updatesFor("IRP-04", "t3 owner post")).toHaveLength(1);

    await h.svc.decide(
      h.as.OWNER,
      "D-01",
      {
        status: "Decided",
        decisionText: "t3 owner decides",
        sourceUrl: "https://example.invalid/owner-decides",
      },
      {},
    );
    const row = await h.one<{ status: string; decision_text: string }>(
      "select status, decision_text from owner_decisions where id = 'D-01'",
    );
    expect(row).toEqual({ status: "Decided", decision_text: "t3 owner decides" });
  });
});

describe("T8 (R1): progress is PASS requirements divided by all requirements", () => {
  const irp05NotRun = () =>
    h.one<{ id: string }>(
      "select id from task_requirements where task_id = 'IRP-05' and state = 'NOT_RUN'",
    );

  it("computes the seeded IRP-05 progress as 3 PASS of 4", async () => {
    // Catches: progress read from a stored or typed column instead of computed from requirements.
    const pass = IRP05_REQUIREMENTS.filter((r) => r.state === "PASS").length;
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(pass / IRP05_REQUIREMENTS.length, 6);
  });

  it("moves progress when a requirement becomes PASS, and back when it becomes FAIL", async () => {
    // Catches: progress that counts non-PASS states, or that is cached and never recomputed.
    const nr = await irp05NotRun();
    await h.svc.setRequirement(
      h.as.CC1,
      "IRP-05",
      { requirementId: nr.id, state: "PASS", proofUrl: "https://example.invalid/t8-proof" },
      {},
    );
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(4 / 4, 6);

    const pass = await h.one<{ id: string }>(
      "select id from task_requirements where task_id = 'IRP-05' and state = 'PASS' order by id limit 1",
    );
    await h.svc.setRequirement(h.as.CC1, "IRP-05", { requirementId: pass.id, state: "FAIL" }, {});
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(3 / 4, 6);

    await h.svc.setRequirement(
      h.as.CC1,
      "IRP-05",
      { requirementId: pass.id, state: "BLOCKED" },
      {},
    );
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(3 / 4, 6);
  });

  it("counts a newly added non-PASS requirement in the total", async () => {
    // Catches: a denominator that ignores requirements added after the seed.
    await h.svc.setRequirement(
      h.as.CC1,
      "IRP-05",
      { requirement: "t8 added requirement", state: "NOT_RUN" },
      {},
    );
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(3 / 5, 6);
  });

  it("rejects PASS without a proof URL (400) and leaves progress unchanged", async () => {
    // Catches: a PASS with no evidence inflating progress (SPEC §3: PASS needs a proof_url).
    const nr = await irp05NotRun();
    await expectServiceError(
      h.svc.setRequirement(h.as.CC1, "IRP-05", { requirementId: nr.id, state: "PASS" }, {}),
      "invalid",
      400,
    );
    await expectServiceError(
      h.svc.setRequirement(
        h.as.CC1,
        "IRP-05",
        { requirementId: nr.id, state: "PASS", proofUrl: "" },
        {},
      ),
      "invalid",
      400,
    );
    const row = await h.one<{ state: string }>(
      "select state from task_requirements where id = $1",
      [nr.id],
    );
    expect(row.state).toBe("NOT_RUN");
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(3 / 4, 6);
  });

  it("does not accept a typed percentage through postProgress or setRequirement", async () => {
    // Catches: the old typed-progress path surviving, so an agent could claim a percentage without proof.
    // 37 is used because it is neither the computed 75% nor the stale 100 in the Lovable seed.
    const before = await h.one<Record<string, unknown>>(
      "select * from engineering_tasks where id = 'IRP-05'",
    );
    let rejected = false;
    try {
      await h.svc.postProgress(
        h.as.CC1,
        "IRP-05",
        loose<PostProgressInput>({
          note: "t8 typed percent",
          source: "api",
          progress: 37,
          percent: 37,
        }),
        {},
      );
    } catch (err) {
      expect((err as { code?: unknown }).code).toBe("invalid");
      rejected = true;
    }
    let reqRejected = false;
    try {
      await h.svc.setRequirement(
        h.as.CC1,
        "IRP-05",
        loose<SetRequirementInput>({
          requirement: "t8 typed percent req",
          state: "NOT_RUN",
          progress: 37,
        }),
        {},
      );
    } catch (err) {
      expect((err as { code?: unknown }).code).toBe("invalid");
      reqRejected = true;
    }
    const totalAfter = reqRejected ? 4 : 5;
    expect(await taskProgress(h, "IRP-05")).toBeCloseTo(3 / totalAfter, 6);
    // Whether rejected or ignored, the typed 37 may not be stored on the task or on an update.
    const after = await h.one<Record<string, unknown>>(
      "select * from engineering_tasks where id = 'IRP-05'",
    );
    expect(after["progress"] ?? null).toBe(before["progress"] ?? null);
    const rows = await updatesFor("IRP-05", "t8 typed percent");
    expect(rows).toHaveLength(rejected ? 0 : 1);
    for (const r of rows) expect(r.progress ?? null).not.toBe(37);
  });
});
