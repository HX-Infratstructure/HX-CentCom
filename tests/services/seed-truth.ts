// Expected seed values, copied by hand from the two seed files named in SPEC §3. Do not edit a value here
// without changing the source file first; the tests are only as true as this copy.
//   P3 = docs/wu0-lovable-review/PROMPT-3-CORRECT-DECISIONS.md (item numbers in brackets)
//   DS = docs/wu1-monday-reference/DECISION-SEED.md (table rows and "Full descriptions")
// "not recorded" means the seed files give no value, so the seed must leave it empty (P3 preamble, SPEC §3).

export type GateType = "merge" | "deploy" | "live_run" | "host" | "scope" | "assignment" | "policy";

export interface DecisionTruth {
  id: string;
  gateType: GateType; // DS table
  status: "Pending" | "Decided"; // DS table
  summary: string; // DS table, verbatim
  description: string[]; // DS "Full descriptions", one entry per source line, markdown kept
  sourceUrl?: string; // P3 [1] request source; for decided rows P3 says only "source" (see sourceAnywhere)
  sourceAnywhere?: string; // P3 [1] "source" on a decided row: must be source_url or decision_source_url
  decisionSourceUrl?: string; // P3 [1] explicit decision_source_url
  requestedBy?: string | null; // undefined = P3 gives nothing, null = must be left empty
  requestedAt?: string | null; // undefined = P3 gives nothing, null = must be left empty
  blocks?: string[]; // only where P3 or DS states it
  question?: string; // only where P3 states it
  decisionText?: string; // P3 [1]
  decidedAt?: string; // P3 [1]
}

const SR = "https://github.com/HX-Infratstructure/HX-Semantic-Router";
const SR10_D03 = `${SR}/issues/10#issuecomment-6870987272`;
const SR10_D06 = `${SR}/issues/10#issuecomment-6846205550`;

export const DECISIONS: DecisionTruth[] = [
  {
    id: "D-01",
    gateType: "merge",
    status: "Pending",
    summary:
      "Merge CC2's Stage 2 benchmark extension (HX-SR PR #19) once its fix round and reviews pass.",
    description: [
      "PR #19 adds Stage 2 phases P4 to P7 to the HX-18 advice benchmark: concurrent waves and the E2 adapter-connection sampler. It changes five files.",
      "**Head:** `c34c7cb` as of 2026-11-14 04:31Z.",
      "**Fix round in progress:** the 5 CodeRabbit findings, the adversarial-review findings, the gaps from the definition-of-done check, and CC1's API check (A1 to A4). A1 adds a record-based O-5(c) check to P7.",
      "**What a merge enables:** building the Run 2 release.",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:07:45Z",
    sourceUrl: `${SR}/pull/19`,
    blocks: ["IRP-04"],
  },
  {
    id: "D-02",
    gateType: "merge",
    status: "Decided",
    summary:
      "Merged: the product CLAUDE.md adopts the standing bounded-outcome directive (HX-SR PR #20).",
    description: [
      "PR #20 changed only HX-Semantic-Router's `CLAUDE.md`. It replaced the \"1-2 small tasks\" and STOP wording with the owner's standing directive. Merged 2026-11-14T04:48:28Z as `bd7aa5f`.",
    ],
    decisionText: "Merged (action) as bd7aa5f",
    decidedAt: "2026-11-14T04:48:28Z",
    decisionSourceUrl: `${SR}/pull/20`,
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:44:46Z",
    blocks: [],
  },
  {
    id: "D-03",
    gateType: "deploy",
    status: "Pending",
    summary: "Authorize deploying the exact merged Stage 2 release to HX-18.",
    description: [
      "After PR #19 merges, CC2 builds a release from `main` that contains the O-5(c) fix (`fc08970`) and the benchmark extension. Deploying it to HX-18 needs a GO for that exact SHA. Run 2 is a separate decision (D-17).",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:29:28Z",
    sourceUrl: SR10_D03,
    blocks: ["IRP-04"],
  },
  {
    id: "D-17",
    gateType: "live_run",
    status: "Pending",
    summary: "Authorize Stage 2 Run 2 (GO-4) on HX-18 after the release is deployed.",
    description: [
      "Run 2 (GO-4) runs on the deployed release.",
      "**Bounds:** at most 72 System One calls and 82 `/tokenize` calls, at most 4 in flight, and at most 9 induced timeouts.",
      "**Client STOPs:** the client stops at more than 2 timeouts in any P7 wave, which caps P7 at 6.",
      "**Proof:** adapter-side O-5(c), from E2 and from the adapter's own records.",
    ],
    // DS "D-17 seed values (split from D-03)"
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:29:28Z",
    sourceUrl: SR10_D03,
    blocks: ["IRP-04"],
  },
  {
    id: "D-04",
    gateType: "host",
    status: "Pending",
    summary: "Optional GO-5: allow read-only HX-4 snapshots around Run 2.",
    description: [
      "GO-5 lets the benchmark take read-only HX-4 snapshots (`systemctl show`, `/health`, `/props`, `/slots`) around Run 2. Without it, the `--hx4-snapshots` flag stays off. HX-4 is not changed either way.",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:29:28Z",
    sourceUrl: SR10_D03, // P3: "same source as D-03"
  },
  {
    id: "D-05",
    gateType: "scope",
    status: "Pending",
    summary:
      "GO-6: decide whether O-5(c) covers System One work that continues on HX-4 after a disconnect.",
    description: [
      "The merged fix bounds client-side exchanges to 2 per adapter, and that is proven offline. Run 2's E2 sampler sees only the adapter's sockets.",
      "**Not observed:** System One work on HX-4 after a disconnect.",
      "**Why Run 2 can't show it:** llama-server answers only when it is complete, so Run 2 can't show a worker outliving its deadline live. This is CC1 and CC2's analysis of the code.",
      "**What GO-6 decides:** the scope, and any evidence to collect.",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-14T03:29:28Z",
    sourceUrl: SR10_D03,
    blocks: ["IRP-04"],
  },
  {
    id: "D-06",
    gateType: "policy",
    status: "Pending",
    summary: "F4: decide the unattended-upgrade restart policy on HX-2, the classifier host.",
    description: [
      "At 06:20Z on 2026-11-13, unattended-upgrades on HX-2 installed kernel 7.0.0-43 and libc6, then restarted Ollama.",
      "**Recovery:** the classifier came back by itself in 14 s.",
      "**Still outstanding:** a reboot is pending, and Automatic-Reboot is off.",
      "**Until the owner decides:** no service or upgrade-policy change is authorized.",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-13T06:44:18Z",
    sourceUrl: SR10_D06,
  },
  {
    id: "D-07",
    gateType: "assignment",
    status: "Pending",
    summary: "Assign an owner for MVP 6, the HX-6 LiteLLM shadow hook.",
    description: [
      "Stage 3 recon found MVP 6 (program #16) unassigned, and HX-LiteLLM has no hook code yet. The work needs an owner, then decisions on:",
      "the HX-6 token;",
      "installing the hook;",
      "the shadow window and the record fields;",
      "the client timeout and in-flight cap.",
    ],
    requestedBy: "CC2",
    requestedAt: "2026-11-13T06:44:18Z",
    sourceUrl: SR10_D06,
  },
  {
    id: "D-08",
    gateType: "policy",
    status: "Pending",
    summary: "Ratify the 54 owner-acceptance rows of the MVP 5 PR #12 ledger, and decide R5-G14.",
    description: [
      "PR #12 (merged as `1cd806f`) left 54 ledger rows marked for owner acceptance. The Codex disposition on program #15 (6845918401) notes two things: the rows await one owner ratification, and R5-G14 is not a full G3 PASS without it.",
    ],
    requestedBy: "CC1",
    requestedAt: "2026-11-13T01:51:16Z",
    sourceUrl: `${SR}/pull/12#issuecomment-6841433208`,
    blocks: [],
  },
  {
    id: "D-09",
    gateType: "merge",
    status: "Pending",
    summary: "Merge HXRO PR #83: work-unit gates G1-G5 and independent acceptance.",
    description: [
      "Draft PR #83 in HX-Repo-Optimization (head `1c18c26`, opened 2026-11-12) documents work-unit gates G1-G5 and independent acceptance. Global reconciliation of the standing directive is tracked through it.",
    ],
    requestedBy: "not recorded", // P3 [1] gives the literal string
    requestedAt: "2026-11-12T20:57:22Z",
    sourceUrl: "https://github.com/HX-Infratstructure/HX-Repo-Optimization/pull/83",
  },
  {
    id: "D-10",
    gateType: "assignment",
    status: "Pending",
    summary: "Choose lane A's next work unit after the agent dashboard (Agent Lab / MVP 3).",
    description: [
      "CC1's MVP 5 outcome is complete (PR #16 merged as `5680553`, PR #18 as `fc08970`), and CC1 is now building the agent dashboard. Lane A's Agent Lab / MVP 3 work unit after that needs an owner assignment.",
    ],
    requestedBy: "CC1",
    requestedAt: "2026-11-14T03:40:02Z",
    sourceUrl: `${SR}/issues/10#issuecomment-6871126872`,
  },
  {
    id: "D-11",
    gateType: "policy",
    status: "Pending",
    summary: "Delete two merged remote branches left from CC1's PRs #16 and #18.",
    description: [
      "These branches are still on GitHub:",
      "`wu5b/hx4-native-d3-pilot-tools`, from PR #16, merged as `5680553`;",
      "`mvp5/o5c-slot-until-workers-exit`, from PR #18, merged as `fc08970`.",
      "Deleting them is housekeeping that the owner holds.",
    ],
    requestedBy: "CC1",
    requestedAt: "2026-11-14T03:07:51Z",
    sourceUrl:
      "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6870718475",
  },
  {
    id: "D-12",
    gateType: "merge",
    status: "Decided",
    summary: "Merged: WU5B offline tooling for the HX-4 native D3 pilot (HX-SR PR #16).",
    description: [
      "Merged 2026-11-14T03:06:20Z as `5680553`. All five CodeRabbit findings were fixed and their threads resolved. The PR is tooling only: the HX-4 pilot ended on 2026-11-13, and no HX-4 run is authorized.",
    ],
    decidedAt: "2026-11-14T03:06:20Z",
    decisionText: "Merged (action) as 5680553",
    sourceAnywhere: `${SR}/pull/16`,
    requestedBy: null,
    requestedAt: null,
  },
  {
    id: "D-13",
    gateType: "merge",
    status: "Decided",
    summary:
      "Merged: O-5(c) slot hold until the decision's last HTTP worker exits; API 1.2 kept (HX-SR PR #18).",
    description: [
      "Merged 2026-11-14T03:18:52Z as `fc08970`.",
      "**Offline proof:** at most 2 open exchanges per adapter. A stress test of 72 decisions peaked at 2, against 4 before the fix.",
      "**Reviews:** CodeRabbit had 0 actionable comments.",
      "**Not yet run:** the live demonstration, which is CC2's Run 2.",
    ],
    decidedAt: "2026-11-14T03:18:52Z",
    decisionText: "Merged (action) as fc08970; API 1.2 kept",
    sourceAnywhere: `${SR}/pull/18`,
    requestedBy: null,
    requestedAt: null,
  },
  {
    id: "D-14",
    gateType: "merge",
    status: "Decided",
    summary:
      "Merged: Stage 1 HX-18 deployment as built and the hx-advice-wire-1 contract (HX-SR PR #17).",
    description: [
      "Merged 2026-11-14T03:30:04Z as `d1d5371`. It records the Stage 1 HX-18 deployment as built, and the versioned `hx-advice-wire-1` contract.",
    ],
    decidedAt: "2026-11-14T03:30:04Z",
    decisionText: "Merged (action) as d1d5371",
    sourceAnywhere: `${SR}/pull/17`,
    requestedBy: null,
    requestedAt: null,
  },
  {
    id: "D-15",
    gateType: "merge",
    status: "Decided",
    summary: "Merged: program governance adopts complete bounded-outcome execution (IRR PR #32).",
    description: [
      "Merged 2026-11-14T03:49:19Z as `3f2633e`. It adopts cross-project complete bounded-outcome execution in the program's governance docs.",
    ],
    decidedAt: "2026-11-14T03:49:19Z",
    decisionText: "Merged (action) as 3f2633e",
    sourceAnywhere: "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/32",
    requestedBy: null,
    requestedAt: null,
  },
  {
    id: "D-16",
    gateType: "policy",
    status: "Decided",
    summary:
      "Adopted: agents own complete bounded outcomes and continue authorized work without micro-prompts.",
    description: [
      "Recorded on HX-SR #10 (6870997761) at 03:30:11Z. It supersedes the 1-2 task limits and STOP-after-each-task. Merges, deployments, host changes and new scope stay with the owner.",
    ],
    question: "Adopt the standing bounded-outcome operating directive?",
    decidedAt: "2026-11-14T03:30:11Z",
    decisionText:
      "Owner assignment style is superseded: CC1 and CC2 receive complete, bounded working outcomes, not repeated 1-2-task prompts.",
    sourceAnywhere: `${SR}/issues/10#issuecomment-6870997761`,
    requestedBy: "Agent Zero",
    requestedAt: null, // P3 [1] gives decided_at only
  },
];

// P3 [3]: the IRP-05 requirements replace the two "merged" rows; one source URL for all four.
export const IRP05_REQUIREMENT_SOURCE = `${SR}/issues/10#issuecomment-6846598662`;
export const IRP05_REQUIREMENTS: {
  requirement: string;
  state: "PASS" | "NOT_RUN";
  proofUrl: string | null;
}[] = [
  {
    requirement: "Admission slot held until the decision's last HTTP worker exits",
    state: "PASS",
    proofUrl: "https://drive.google.com/file/d/189sz7EIlunX8aih5E16kDM4rbaQ0DXhw/view",
  },
  {
    requirement: "At most 2 open exchanges per adapter, timed-out workers included (offline)",
    state: "PASS",
    proofUrl: `${SR}/blob/fc08970/tests/mvp5/test_o5c_in_flight.py`,
  },
  {
    requirement: "Record shape unchanged; public API 1.2 (19 names)",
    state: "PASS",
    proofUrl: `${SR}/pull/18`,
  },
  {
    requirement: "Live O-5(c) demonstration (OD-2), owned by CC2 Run 2",
    state: "NOT_RUN",
    proofUrl: null,
  },
];

// SPEC §3 Seed: "the six tasks" are the six rows of drizzle/migrations/0000 at 3e39a5c, with their owning agents.
// SPEC §6.1 (CC1 decision, 2026-11-14 ~06:10Z) adds task CC-01 "HX-CentCom WU1 build", agent CC1.
export const TASK_OWNERS: Record<string, string> = {
  "IRP-04": "CC2",
  "IRP-05": "CC1",
  "HX12-01": "OpenCode",
  "RO-01": "Unassigned",
  "IRP-UI": "CC1",
  "HX14-02": "Unassigned",
  "CC-01": "CC1",
};

// P3 [4]
export const IRP04_COMMIT_SHA = "c34c7cb";

// SPEC §2 Identity and §3 Seed: agent ids and roles.
export const AGENT_ROLES: Record<string, "agent" | "owner"> = {
  CC1: "agent",
  CC2: "agent",
  Codex: "agent",
  OpenCode: "agent",
  "Agent Zero": "owner",
};
