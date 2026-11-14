/**
 * Sources, in precedence order:
 * - base rows: drizzle/migrations/0000_agent_task_progress.sql and 0001_owner_decisions_requirements_github.sql at
 *   3e39a5c (the migrations this baseline replaced);
 * - overrides: PROMPT-3-CORRECT-DECISIONS.md in the WU0 review docs;
 * - summary, description, gate_type and D-17: docs/wu1-monday-reference/DECISION-SEED.md. The decision rows were
 *   generated from that file by script, not retyped;
 * - CC-01: the orchestrator's WU1 seed decision (SPEC §6.1);
 * - agents: ids and roles from SPEC §2, display_name and color from the src/lib/task-data.ts roster at 3e39a5c.
 * A value no source gives is null. No recommended_by anywhere. No decision records options, because the 0001 options
 * had no source and neither PROMPT-3 nor DECISION-SEED.md gives any.
 */
import { sql } from "drizzle-orm";
import { groupForStatus, type StatusLabel } from "@/server/services";
import type { Db } from "./client";
import { agents, engineeringTasks, ownerDecisions, statusLabels, taskRequirements } from "./schema";
import { seedRaidLessons } from "./seed-raid";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export const SEED_AGENTS: readonly Insert<typeof agents>[] = [
  { id: "CC1", display_name: "Claude Code 01", role: "agent", color: "green", active: true },
  { id: "CC2", display_name: "Claude Code 02", role: "agent", color: "sky", active: true },
  { id: "Codex", display_name: "Codex", role: "agent", color: "violet", active: true },
  { id: "OpenCode", display_name: "OpenCode", role: "agent", color: "amber", active: true },
  { id: "Agent Zero", display_name: "Agent Zero", role: "owner", color: "stone", active: true },
];

/**
 * The four statuses of the 0000 CHECK list, plus "Ready for owner", which groupForStatus maps to the ready_for_owner
 * group and CC1's NEXT-BRIEFS.md asks for. Complete is the only done label. No source gives colors.
 */
export const SEED_STATUS_LABELS: readonly StatusLabel[] = [
  { id: "Waiting", label: "Waiting", is_done: false, color: null },
  { id: "In progress", label: "In progress", is_done: false, color: null },
  { id: "Complete", label: "Complete", is_done: true, color: null },
  { id: "Blocked", label: "Blocked", is_done: false, color: null },
  { id: "Ready for owner", label: "Ready for owner", is_done: false, color: null },
];

/** 'Unassigned' and '' from the base rows are null. */
export const SEED_TASKS: readonly Omit<Insert<typeof engineeringTasks>, "group" | "version">[] = [
  {
    id: "IRP-04",
    title: "Semantic controller · Stage 2 qualification",
    agent: "CC2",
    repository: "HX-Semantic-Router",
    host: "HX-18",
    commit_sha: "c34c7cb",
    status: "In progress",
    blocked_on: "owner_decision",
    start_date: "2026-11-10",
    due_date: "2026-11-18",
    note: "PR #19 in fix round; Run 2 needs PR #19 merge, deploy GO and Run 2 GO",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846416722",
  },
  {
    id: "IRP-05",
    title: "D3 adapter · O-5(c) closeout",
    agent: "CC1",
    repository: "HX-Semantic-Router",
    host: "HX-4 / HX-18",
    commit_sha: "fc08970",
    status: "Complete",
    blocked_on: "none",
    start_date: "2026-11-09",
    due_date: "2026-11-13",
    note: "PR #16 merged 5680553, PR #18 merged fc08970, API 1.2",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161",
  },
  {
    id: "HX12-01",
    title: "DeepAgents · source-led rebuild",
    agent: "OpenCode",
    repository: "HX-Langchain-DeepAgent",
    host: "HX-12",
    commit_sha: null,
    status: "Waiting",
    blocked_on: "dependency",
    start_date: "2026-11-13",
    due_date: "2026-11-21",
    note: "OpenCode / DeepSeek Harness. Source head is unpinned; verification needed.",
    source_url: "https://github.com/HX-Infratstructure/HX-Langchain-DeepAgent",
  },
  {
    id: "RO-01",
    title: "Qdrant · live acceptance",
    agent: null,
    repository: "HX-Qdrant",
    host: "HX-10",
    commit_sha: "68053f0",
    status: "Waiting",
    blocked_on: "assignment",
    start_date: "2026-11-14",
    due_date: "2026-11-20",
    note: "Live acceptance evidence is waiting. Owner assignment is needed.",
    source_url: "https://github.com/HX-Infratstructure/HX-Qdrant",
  },
  {
    // PROMPT-3 states nothing about IRP-UI, so the 0001 values stand.
    id: "IRP-UI",
    title: "Agent Lab · run contract & model picker",
    agent: "CC1",
    repository: "HX-Agent-Lab",
    host: "HX-15",
    commit_sha: "06475ac",
    status: "Complete",
    blocked_on: "none",
    start_date: "2026-11-14",
    due_date: "2026-11-22",
    note: "Agent Lab UI and model picker merged and deployed; MVP 3 WU1-WU3 merged (main 06475ac); next lane A assignment is an owner decision",
    source_url: "https://github.com/HX-Infratstructure/HX-Agent-Lab",
  },
  {
    id: "HX14-02",
    title: "n8n · Phase 2",
    agent: null,
    repository: "HX-n8n",
    host: "HX-14",
    commit_sha: null,
    status: "Waiting",
    blocked_on: "assignment",
    start_date: "2026-11-16",
    due_date: "2026-11-24",
    note: "Phase 2 is waiting. Source head is unpinned.",
    source_url: "https://github.com/HX-Infratstructure/HX-n8n",
  },
  {
    id: "CC-01",
    title: "HX-CentCom WU1 build",
    agent: "CC1",
    repository: "HX-CentCom",
    host: "HX-15 / HX-7",
    commit_sha: null,
    status: "In progress",
    start_date: null,
    due_date: null,
    note: null,
    source_url: "https://github.com/HX-Infratstructure/HX-CentCom/issues/1",
  },
];

const IRP05_SOURCE =
  "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846598662";

/** IRP-04: the three 0001 rows. IRP-05: PROMPT-3 item 3 replaces the two "merged" rows with these four. */
export const SEED_REQUIREMENTS: readonly Insert<typeof taskRequirements>[] = [
  {
    task_id: "IRP-04",
    requirement: "Stage 2 Run 1 sequential: 254 / 254 requests",
    state: "PASS",
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10",
    proof_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846416722",
  },
  {
    task_id: "IRP-04",
    requirement: "PR #19 merged after fix round",
    state: "BLOCKED",
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/19",
    proof_url: null,
  },
  {
    task_id: "IRP-04",
    requirement: "Stage 2 Run 2 concurrent acceptance",
    state: "NOT_RUN",
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10",
    proof_url: null,
  },
  {
    task_id: "IRP-05",
    requirement: "Admission slot held until the decision's last HTTP worker exits",
    state: "PASS",
    source_url: IRP05_SOURCE,
    proof_url: "https://drive.google.com/file/d/189sz7EIlunX8aih5E16kDM4rbaQ0DXhw/view",
  },
  {
    task_id: "IRP-05",
    requirement: "At most 2 open exchanges per adapter, timed-out workers included (offline)",
    state: "PASS",
    source_url: IRP05_SOURCE,
    proof_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/blob/fc08970/tests/mvp5/test_o5c_in_flight.py",
  },
  {
    task_id: "IRP-05",
    requirement: "Record shape unchanged; public API 1.2 (19 names)",
    state: "PASS",
    source_url: IRP05_SOURCE,
    proof_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/18",
  },
  {
    task_id: "IRP-05",
    requirement: "Live O-5(c) demonstration (OD-2), owned by CC2 Run 2",
    state: "NOT_RUN",
    source_url: IRP05_SOURCE,
    proof_url: null,
  },
];

/**
 * Generated from DECISION-SEED.md (summary, description, gate_type, status) merged with the 0001 rows and PROMPT-3
 * item 1. PROMPT-3's "source" is the request's `source_url` (item 2 defines that column); for D-12..D-16 the 0001
 * `decision_source_url` is kept.
 */
export const SEED_DECISIONS: readonly Insert<typeof ownerDecisions>[] = [
  {
    id: "D-01",
    gate_type: "merge",
    status: "Pending",
    question: "Merge PR #19 after CC2's fix round?",
    subject: "HX-Semantic-Router PR #19",
    summary:
      "Merge CC2's Stage 2 benchmark extension (HX-SR PR #19) once its fix round and reviews pass.",
    description:
      "PR #19 adds Stage 2 phases P4 to P7 to the HX-18 advice benchmark: concurrent waves and the E2 adapter-connection sampler. It changes five files.\n- **Head:** `c34c7cb` as of 2026-11-14 04:31Z.\n- **Fix round in progress:** the 5 CodeRabbit findings, the adversarial-review findings, the gaps from the definition-of-done check, and CC1's API check (A1 to A4). A1 adds a record-based O-5(c) check to P7.\n- **What a merge enables:** building the Run 2 release.",
    options: [],
    blocks: ["IRP-04"],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:07:45Z",
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/19",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-02",
    gate_type: "merge",
    status: "Decided",
    question: "Merge PR #20?",
    subject: "HX-Semantic-Router PR #20",
    summary:
      "Merged: the product CLAUDE.md adopts the standing bounded-outcome directive (HX-SR PR #20).",
    description:
      "PR #20 changed only HX-Semantic-Router's `CLAUDE.md`. It replaced the \"1-2 small tasks\" and STOP wording with the owner's standing directive. Merged 2026-11-14T04:48:28Z as `bd7aa5f`.",
    options: [],
    blocks: [],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:44:46Z",
    source_url: null,
    decision_text: "Merged (action) as bd7aa5f",
    decision_source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/20",
    decided_at: "2026-11-14T04:48:28Z",
  },
  {
    id: "D-03",
    gate_type: "deploy",
    status: "Pending",
    question: "Exact-release deploy GO?",
    subject: "HX-Semantic-Router exact release on HX-18",
    summary: "Authorize deploying the exact merged Stage 2 release to HX-18.",
    description:
      "After PR #19 merges, CC2 builds a release from `main` that contains the O-5(c) fix (`fc08970`) and the benchmark extension. Deploying it to HX-18 needs a GO for that exact SHA. Run 2 is a separate decision (D-17).",
    options: [],
    blocks: ["IRP-04"],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:29:28Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-04",
    gate_type: "host",
    status: "Pending",
    question: "Optional GO-5: HX-4 read-only snapshots?",
    subject: "HX-4 · read-only snapshots",
    summary: "Optional GO-5: allow read-only HX-4 snapshots around Run 2.",
    description:
      "GO-5 lets the benchmark take read-only HX-4 snapshots (`systemctl show`, `/health`, `/props`, `/slots`) around Run 2. Without it, the `--hx4-snapshots` flag stays off. HX-4 is not changed either way.",
    options: [],
    blocks: [],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:29:28Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-05",
    gate_type: "scope",
    status: "Pending",
    question: "GO-6: O-5(c) server-side scope?",
    subject: "O-5(c) server-side scope",
    summary:
      "GO-6: decide whether O-5(c) covers System One work that continues on HX-4 after a disconnect.",
    description:
      "The merged fix bounds client-side exchanges to 2 per adapter, and that is proven offline. Run 2's E2 sampler sees only the adapter's sockets.\n- **Not observed:** System One work on HX-4 after a disconnect.\n- **Why Run 2 can't show it:** llama-server answers only when it is complete, so Run 2 can't show a worker outliving its deadline live. This is CC1 and CC2's analysis of the code.\n- **What GO-6 decides:** the scope, and any evidence to collect.",
    options: [],
    blocks: ["IRP-04"],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:29:28Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-06",
    gate_type: "policy",
    status: "Pending",
    question: "F4: HX-2 unattended-upgrade restart policy?",
    subject: "HX-2 · unattended-upgrade restart policy",
    summary: "F4: decide the unattended-upgrade restart policy on HX-2, the classifier host.",
    description:
      "At 06:20Z on 2026-11-13, unattended-upgrades on HX-2 installed kernel 7.0.0-43 and libc6, then restarted Ollama.\n- **Recovery:** the classifier came back by itself in 14 s.\n- **Still outstanding:** a reboot is pending, and Automatic-Reboot is off.\n- **Until the owner decides:** no service or upgrade-policy change is authorized.",
    options: [],
    blocks: [],
    requested_by: "CC2",
    requested_at: "2026-11-13T06:44:18Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846205550",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-07",
    gate_type: "assignment",
    status: "Pending",
    question: "Who owns MVP 6?",
    subject: "MVP 6 owner",
    summary: "Assign an owner for MVP 6, the HX-6 LiteLLM shadow hook.",
    description:
      "Stage 3 recon found MVP 6 (program #16) unassigned, and HX-LiteLLM has no hook code yet. The work needs an owner, then decisions on:\n- the HX-6 token;\n- installing the hook;\n- the shadow window and the record fields;\n- the client timeout and in-flight cap.",
    options: [],
    blocks: [],
    requested_by: "CC2",
    requested_at: "2026-11-13T06:44:18Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846205550",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-08",
    gate_type: "policy",
    status: "Pending",
    question: "Ratify the 54 PR #12 acceptance rows and R5-G14?",
    subject: "HX-Semantic-Router PR #12 · 54 acceptance rows + R5-G14",
    summary: "Ratify the 54 owner-acceptance rows of the MVP 5 PR #12 ledger, and decide R5-G14.",
    description:
      "PR #12 (merged as `1cd806f`) left 54 ledger rows marked for owner acceptance. The Codex disposition on program #15 (6845918401) notes two things: the rows await one owner ratification, and R5-G14 is not a full G3 PASS without it.",
    options: [],
    blocks: [],
    requested_by: "CC1",
    requested_at: "2026-11-13T01:51:16Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/12#issuecomment-6841433208",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-09",
    gate_type: "merge",
    status: "Pending",
    question: "Merge PR #83?",
    subject: "HX-Repo-Optimization PR #83",
    summary: "Merge HXRO PR #83: work-unit gates G1-G5 and independent acceptance.",
    description:
      "Draft PR #83 in HX-Repo-Optimization (head `1c18c26`, opened 2026-11-12) documents work-unit gates G1-G5 and independent acceptance. Global reconciliation of the standing directive is tracked through it.",
    options: [],
    blocks: [],
    requested_by: null,
    requested_at: "2026-11-12T20:57:22Z",
    source_url: "https://github.com/HX-Infratstructure/HX-Repo-Optimization/pull/83",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-10",
    gate_type: "assignment",
    status: "Pending",
    question: "Next lane A assignment?",
    subject: "Lane A · Agent Lab / MVP 3",
    summary: "Choose lane A's next work unit after the agent dashboard (Agent Lab / MVP 3).",
    description:
      "CC1's MVP 5 outcome is complete (PR #16 merged as `5680553`, PR #18 as `fc08970`), and CC1 is now building the agent dashboard. Lane A's Agent Lab / MVP 3 work unit after that needs an owner assignment.",
    options: [],
    blocks: [],
    requested_by: "CC1",
    requested_at: "2026-11-14T03:40:02Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6871126872",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-11",
    gate_type: "policy",
    status: "Pending",
    question:
      "Delete remote branches wu5b/hx4-native-d3-pilot-tools and mvp5/o5c-slot-until-workers-exit?",
    subject: "Remote branches · wu5b/hx4-native-d3-pilot-tools, mvp5/o5c-slot-until-workers-exit",
    summary: "Delete two merged remote branches left from CC1's PRs #16 and #18.",
    description:
      "These branches are still on GitHub:\n- `wu5b/hx4-native-d3-pilot-tools`, from PR #16, merged as `5680553`;\n- `mvp5/o5c-slot-until-workers-exit`, from PR #18, merged as `fc08970`.\n\nDeleting them is housekeeping that the owner holds.",
    options: [],
    blocks: [],
    requested_by: "CC1",
    requested_at: "2026-11-14T03:07:51Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6870718475",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
  {
    id: "D-12",
    gate_type: "merge",
    status: "Decided",
    question: "Merge PR #16?",
    subject: "HX-Semantic-Router PR #16",
    summary: "Merged: WU5B offline tooling for the HX-4 native D3 pilot (HX-SR PR #16).",
    description:
      "Merged 2026-11-14T03:06:20Z as `5680553`. All five CodeRabbit findings were fixed and their threads resolved. The PR is tooling only: the HX-4 pilot ended on 2026-11-13, and no HX-4 run is authorized.",
    options: [],
    blocks: ["IRP-05"],
    requested_by: null,
    requested_at: null,
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/16",
    decision_text: "Merged (action) as 5680553",
    decision_source_url:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161",
    decided_at: "2026-11-14T03:06:20Z",
  },
  {
    id: "D-13",
    gate_type: "merge",
    status: "Decided",
    question: "Merge PR #18 and keep API 1.2?",
    subject: "HX-Semantic-Router PR #18",
    summary:
      "Merged: O-5(c) slot hold until the decision's last HTTP worker exits; API 1.2 kept (HX-SR PR #18).",
    description:
      "Merged 2026-11-14T03:18:52Z as `fc08970`.\n- **Offline proof:** at most 2 open exchanges per adapter. A stress test of 72 decisions peaked at 2, against 4 before the fix.\n- **Reviews:** CodeRabbit had 0 actionable comments.\n- **Not yet run:** the live demonstration, which is CC2's Run 2.",
    options: [],
    blocks: ["IRP-05"],
    requested_by: null,
    requested_at: null,
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/18",
    decision_text: "Merged (action) as fc08970; API 1.2 kept",
    decision_source_url:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161",
    decided_at: "2026-11-14T03:18:52Z",
  },
  {
    id: "D-14",
    gate_type: "merge",
    status: "Decided",
    question: "Merge PR #17?",
    subject: "HX-Semantic-Router PR #17",
    summary:
      "Merged: Stage 1 HX-18 deployment as built and the hx-advice-wire-1 contract (HX-SR PR #17).",
    description:
      "Merged 2026-11-14T03:30:04Z as `d1d5371`. It records the Stage 1 HX-18 deployment as built, and the versioned `hx-advice-wire-1` contract.",
    options: [],
    blocks: [],
    requested_by: null,
    requested_at: null,
    source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/17",
    decision_text: "Merged (action) as d1d5371",
    decision_source_url: "https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/17",
    decided_at: "2026-11-14T03:30:04Z",
  },
  {
    id: "D-15",
    gate_type: "merge",
    status: "Decided",
    question: "Merge IRR PR #32?",
    subject: "HX-Intelligent-Request-Routing PR #32",
    summary: "Merged: program governance adopts complete bounded-outcome execution (IRR PR #32).",
    description:
      "Merged 2026-11-14T03:49:19Z as `3f2633e`. It adopts cross-project complete bounded-outcome execution in the program's governance docs.",
    options: [],
    blocks: [],
    requested_by: null,
    requested_at: null,
    source_url: "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/32",
    decision_text: "Merged (action) as 3f2633e",
    decision_source_url:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/32",
    decided_at: "2026-11-14T03:49:19Z",
  },
  {
    id: "D-16",
    gate_type: "policy",
    status: "Decided",
    question: "Adopt the standing bounded-outcome operating directive?",
    subject: "HX-Semantic-Router #10",
    summary:
      "Adopted: agents own complete bounded outcomes and continue authorized work without micro-prompts.",
    description:
      "Recorded on HX-SR #10 (6870997761) at 03:30:11Z. It supersedes the 1-2 task limits and STOP-after-each-task. Merges, deployments, host changes and new scope stay with the owner.",
    options: [],
    blocks: [],
    requested_by: "Agent Zero",
    requested_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870997761",
    decision_text:
      "Owner assignment style is superseded: CC1 and CC2 receive complete, bounded working outcomes, not repeated 1-2-task prompts.",
    decision_source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870997761",
    decided_at: "2026-11-14T03:30:11Z",
  },
  {
    id: "D-17",
    gate_type: "live_run",
    status: "Pending",
    question: null,
    subject: null,
    summary: "Authorize Stage 2 Run 2 (GO-4) on HX-18 after the release is deployed.",
    description:
      "Run 2 (GO-4) runs on the deployed release.\n- **Bounds:** at most 72 System One calls and 82 `/tokenize` calls, at most 4 in flight, and at most 9 induced timeouts.\n- **Client STOPs:** the client stops at more than 2 timeouts in any P7 wave, which caps P7 at 6.\n- **Proof:** adapter-side O-5(c), from E2 and from the adapter's own records.",
    options: [],
    blocks: ["IRP-04"],
    requested_by: "CC2",
    requested_at: "2026-11-14T03:29:28Z",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
  },
];

const SYNC_DECISION_SEQUENCE = sql`
  select setval('owner_decision_id_seq', greatest(s.m, (select last_value from owner_decision_id_seq)))
  from (select max(substring(id from 3)::int) as m from owner_decisions where id ~ '^D-[0-9]+$') s
  where s.m is not null`;

function labelFor(status: string): StatusLabel {
  const label = SEED_STATUS_LABELS.find((l) => l.id === status);
  if (!label) throw new Error(`seed task status ${status} is not a seeded status label`);
  return label;
}

export async function seedDb(
  db: Db,
): Promise<Record<"agents" | "statusLabels" | "tasks" | "requirements" | "decisions", number>> {
  return db.transaction(async (tx) => {
    const insertedAgents = await tx
      .insert(agents)
      .values([...SEED_AGENTS])
      .onConflictDoNothing()
      .returning({ id: agents.id });
    const insertedLabels = await tx
      .insert(statusLabels)
      .values([...SEED_STATUS_LABELS])
      .onConflictDoNothing()
      .returning({ id: statusLabels.id });
    const insertedTasks = await tx
      .insert(engineeringTasks)
      .values(
        SEED_TASKS.map((t) => ({ ...t, group: groupForStatus(labelFor(t.status), "backlog") })),
      )
      .onConflictDoNothing()
      .returning({ id: engineeringTasks.id });
    const insertedRequirements = await tx
      .insert(taskRequirements)
      .values([...SEED_REQUIREMENTS])
      .onConflictDoNothing({ target: [taskRequirements.task_id, taskRequirements.requirement] })
      .returning({ id: taskRequirements.id });
    const insertedDecisions = await tx
      .insert(ownerDecisions)
      .values([...SEED_DECISIONS])
      .onConflictDoNothing()
      .returning({ id: ownerDecisions.id });
    await tx.execute(SYNC_DECISION_SEQUENCE);
    await seedRaidLessons(tx);
    return {
      agents: insertedAgents.length,
      statusLabels: insertedLabels.length,
      tasks: insertedTasks.length,
      requirements: insertedRequirements.length,
      decisions: insertedDecisions.length,
    };
  });
}
