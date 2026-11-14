/**
 * Seed rows for the RAID register and the lessons log (SPEC §6.1). Sources:
 * - docs/wu1-monday-reference/RAID-LESSONS-SEED.md: the 8 RAID rows and L-01 to L-08. Text cells were copied by
 *   script, not retyped. "n/a" and "null" are null. A parenthetical in an owner, status, task_ids, resolution or
 *   escalated cell is an evidence note, so only the bare value is stored;
 * - SPEC §6.1, CC1's decisions: task CC-01 on RAID-03, RAID-04 and RAID-08, and L-09, the D-005 citation lesson
 *   (SPEC.md:247), proposed;
 * - CC1's severity ratings with their reasons (`CC1_SEVERITY_RATINGS`), stored with severity_rated_by CC1.
 * created_by is null on every row: no agent created them. A value no source gives is null.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "./client";
import { lessons, raidItems, type Severity } from "./schema-raid";

const HX15_ROOTS = {
  memory: "/home/hxsa/.claude/projects/-home-hxsa/memory/",
  wu1: "/home/hxsa/HX-CentCom.wt/docs/wu1-monday-reference/",
} as const;

/** A source that exists only on HX-15: `hx15:<absolute path>[:lines]`. */
function hx15(root: keyof typeof HX15_ROOTS, rest: string): string {
  return `hx15:${HX15_ROOTS[root]}${rest}`;
}

type Unseeded =
  "severity" | "severity_rated_by" | "created_by" | "version" | "created_at" | "updated_at";
type RaidSeed = Omit<typeof raidItems.$inferInsert, Unseeded | "task_ids"> & {
  readonly task_ids: readonly string[];
};
type LessonSeed = Omit<typeof lessons.$inferInsert, Unseeded | "tags"> & {
  readonly tags: readonly string[];
};

export const SEED_RAID_ITEMS = [
  {
    id: "RAID-01",
    type: "issue",
    title: "HX-2 unattended upgrades restarted Ollama (F4)",
    summary:
      "On 2026-11-13 at 06:20Z, unattended upgrades on HX-2 restarted Ollama; the classifier recovered in 14 s. The restart policy is owner-held.",
    description:
      "At 06:20Z on 2026-11-13, unattended upgrades on HX-2, the classifier host, installed kernel 7.0.0-43 and `libc6`. needrestart then restarted Ollama; hx-verifier confirmed the cause (6846416722). `qwen-x` reloaded at context 65536. A reboot is pending, and automatic reboot is off. CC2 did not cause it. CC2 recorded the risk and recommended a policy: security upgrades stay automatic, needrestart is list-only on HX-2 and HX-18, automatic reboot stays off, restarts happen only in an owner-approved window and one host at a time, and nothing upgrades or restarts during a benchmark or Run 2 window. No host was contacted, and no configuration was changed (6870905499).",
    owner_agent: "CC2",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846205550",
    task_ids: ["IRP-04"],
    decision_id: "D-06",
    probability: null,
    impact:
      "Ollama restarted on the classifier host. The classifier came back by itself in 14 s, and `qwen-x` reloaded. A reboot is still pending (6846205550).",
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: true,
    blocked_task_id: null,
    blocking_ref: null,
  },
  {
    id: "RAID-02",
    type: "risk",
    title: "Server-side System One work after a disconnect is NOT_OBSERVED (GO-6)",
    summary:
      "O-5(c) is proven client-side only; System One work still running on HX-4 after an adapter disconnect stays NOT_OBSERVED until GO-6.",
    description:
      "The merged O-5(c) fix (PR #18, `fc08970`) bounds open exchanges to 2 per adapter. That is proven offline (6870866823). Run 2's E2 sampler counts only the adapter's own sockets, and the owner ruled that \"a socket limit does not establish the server-side bound\" (6870997761). CC1 notes that Run 2 cannot show a worker outliving its deadline live, because llama-server answers only when its work is complete (6872395358, providers.py:114/117/162). This was escalated to the owner as PR #19 finding AR-P2-3 (memory/project-hx-sr-mvp4.md:224). GO-6 decides the scope and any evidence to collect.",
    owner_agent: "CC2",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870997761",
    task_ids: ["IRP-04", "IRP-05"],
    decision_id: "D-05",
    probability: null,
    impact:
      'The owner\'s hard O-5(c) requirement covers "workers continuing after a timeout" (6846598662). Without GO-6 evidence, no server-side bound can be claimed.',
    mitigation:
      "PR #19's `bench_tool.py check` and runbook report the client-side E2 count and the server side (not observed) separately, and claim no server bound from socket counts (6870987272).",
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
  },
  {
    id: "RAID-03",
    type: "risk",
    title: "The HX-CentCom GitHub sync uses a classic token with scopes wider than read",
    summary:
      "The GitHub sync reads a classic token whose scopes are wider than read; only the GET-only code limits what it does.",
    description:
      'The owner said "use this token for now" (R8, SPEC.md:37). It is a classic GitHub token with the scopes repo, workflow and write:packages, not read-only (memory/project-hx-agent-dashboard.md:39; SPEC.md:79). The earlier plan was a read-only token that the owner would create (memory/project-hx-agent-dashboard.md:20-21). The sync is a systemd oneshot on HX-15 that only makes GET requests (SPEC.md:67, :76; renamed in SPEC.md:8).',
    owner_agent: "CC1",
    status: "open",
    review_at: null,
    source_url: hx15("wu1", "SPEC.md:79"),
    task_ids: ["CC-01"],
    decision_id: null,
    probability: null,
    impact:
      "The token's scopes allow writes (repo, workflow, write:packages), but the dashboard needs only reads (SPEC.md:67).",
    mitigation:
      "The code only makes GET requests (SPEC.md:67, :79). CC1 set the token file to mode 600 (memory/project-hx-agent-dashboard.md:39; SPEC.md:79).",
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
  },
  {
    id: "RAID-04",
    type: "assumption",
    title: "Agent keys on HX-15 attribute work but do not separate trust",
    summary:
      "CC1 and CC2 both run as hxsa on HX-15 and could read each other's key files, so a key attributes work but does not separate trust.",
    description:
      "Keys (`hxc_<agent>_…`, stored at `~/.config/hx-centcom/keys/<agent>.key` with mode 600: SPEC.md:13, :82-84) identify the caller without a login (R9, SPEC.md:38). CC1 and CC2 run as the same Unix user, so mode 600 does not stop one agent from reading another's key. CC1 judged this acceptable for DEV/TEST under the owner's no-hardening ruling (SPEC.md:84; memory/feedback-no-security-hardening.md:8-10). Issuing the keys is part of GO-2 (SPEC.md §2.1).",
    owner_agent: "CC1",
    status: "open",
    review_at: null,
    source_url: hx15("wu1", "SPEC.md:82-84"),
    task_ids: ["CC-01"],
    decision_id: null,
    probability: null,
    impact: null,
    mitigation: null,
    validation_method:
      "Check which user owns the Claude Code processes on HX-15 (`ps -eo pid,user,comm`).",
    validation_state: "validated",
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
  },
  {
    id: "RAID-05",
    type: "dependency",
    title: "Run 2 waits on the HX-SR PR #19 merge",
    summary: "Run 2 needs HX-SR PR #19 merged first; the owner holds the merge (D-01).",
    description:
      "PR #19 (the Stage 2 benchmark extension) is OPEN and no longer a draft, at head `8ee1ed8` (GitHub, checked 2026-11-14T06:08Z). CC1's API 1.2 interface sign-off at `8ee1ed8` passed (6872395358). After the merge, CC2 builds and verifies the exact release from `main` (6870987272).",
    owner_agent: "CC2",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
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
    blocking_ref: "decision:D-01",
  },
  {
    id: "RAID-06",
    type: "dependency",
    title: "Run 2 waits on the deployment GO for the exact merged release",
    summary:
      "After the merge, Run 2 needs an owner GO to deploy the exact release built from main to HX-18 (D-03).",
    description:
      "After PR #19 merges, CC2 builds a release from `main` that contains the O-5(c) fix (`fc08970`) and the benchmark extension, verifies it offline on HX-15, and requests a deployment GO for that exact SHA (6870987272, 6871060506).",
    owner_agent: "CC2",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    task_ids: ["IRP-04"],
    decision_id: "D-03",
    probability: null,
    impact: null,
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: "IRP-04",
    blocking_ref: "decision:D-03",
  },
  {
    id: "RAID-07",
    type: "dependency",
    title: "Run 2 waits on the Run 2 GO (GO-4)",
    summary: "Run 2 itself needs a separate owner GO (GO-4) after the release is deployed (D-17).",
    description:
      'Run 2 runs on the deployed release. Its bounds: at most 72 System One calls and 82 `/tokenize` calls, at most 4 in flight, and at most 9 induced timeouts (DECISION-SEED.md:34-37). "Do not activate a release, stop a service or execute Run 2 by inference" (6870997761).',
    owner_agent: "CC2",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870987272",
    task_ids: ["IRP-04"],
    decision_id: "D-17",
    probability: null,
    impact: null,
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: "IRP-04",
    blocking_ref: "decision:D-17",
  },
  {
    id: "RAID-08",
    type: "issue",
    title: "The Lovable app still has access to the HX-CentCom repo",
    summary:
      "Development moved off Lovable (R6), but the lovable-dev app is still installed on the org for all repos; main's head is a Lovable commit.",
    description:
      "The owner said \"no more lovable you now own all development going forward\" (R6, SPEC.md:35). The owner installed the `lovable-dev` GitHub app on the org at 2026-11-14T04:49:45Z (memory/project-hx-agent-dashboard.md:11). At about 06:05Z, GitHub still listed it with `repository_selection: all` and `suspended_at: null`. `main` is at `3e39a5c`, authored by `gpt-engineer-app[bot]`, and `AGENTS.md` at that commit still carries the Lovable connection block. The repo is now `HX-Infratstructure/HX-CentCom`, and the old name redirects (B4 checked this). CC1 reports that, per Lovable's docs, the Lovable connection follows the rename (UNVERIFIED: B4 did not read Lovable's docs). So the rename does not end the connection. CC1 noted that the owner may disconnect it (memory/project-hx-agent-dashboard.md:41).",
    owner_agent: "Agent Zero",
    status: "open",
    review_at: null,
    source_url:
      "https://github.com/HX-Infratstructure/HX-CentCom/blob/3e39a5c94018db85bf6f2111b2e60471053c8a20/AGENTS.md#L1-L30",
    task_ids: ["CC-01"],
    decision_id: null,
    probability: null,
    impact:
      "Commits pushed to the connected branch sync back to Lovable, and the block asks agents not to rewrite published history (AGENTS.md:3-9 at `3e39a5c`). The app can reach every repo in the org (`repository_selection: all`). UNVERIFIED: Lovable edits could still land on `main` while the HX-native branch is built.",
    mitigation: null,
    validation_method: null,
    validation_state: null,
    resolution: null,
    escalated: false,
    blocked_task_id: null,
    blocking_ref: null,
  },
] as const satisfies readonly RaidSeed[];

export type SeedRaidId = (typeof SEED_RAID_ITEMS)[number]["id"];

/** CC1's ratings (severity-ratings.md). Exhaustive over the seeded ids, so a row without a rating does not compile. */
export const CC1_SEVERITY_RATINGS: Readonly<
  Record<SeedRaidId, { readonly severity: Severity; readonly reason: string }>
> = {
  "RAID-01": {
    severity: "medium",
    reason:
      "The restart already happened and the classifier recovered by itself in 14 s (6846205550). The exposure is a repeat restart or the pending reboot landing in a benchmark or Run 2 window, which the recommended policy would bar (6870905499). It is already escalated to the owner as D-06.",
  },
  "RAID-02": {
    severity: "high",
    reason:
      "It touches the owner's hard O-5(c) requirement on workers that continue after a timeout (6846598662). No evidence can establish the server-side bound until GO-6 (6870997761). The only mitigation is reporting the client and server sides separately (6870987272).",
  },
  "RAID-03": {
    severity: "medium",
    reason:
      'The token can write to the repos it reaches (scopes repo, workflow and write:packages: memory/project-hx-agent-dashboard.md:39; SPEC.md:79). The only code that reads it makes GET requests, and the token file is mode 600 (SPEC.md:67, :79). The owner chose this token "for now" (R8, SPEC.md:37).',
  },
  "RAID-04": {
    severity: "low",
    reason:
      "The assumption is validated: every claude process on HX-15 runs as hxsa (checked 2026-11-14T06:05:40Z). The consequence is attribution without trust separation, which CC1 judged acceptable for DEV/TEST under the no-hardening ruling (SPEC.md:84).",
  },
  "RAID-05": {
    severity: "medium",
    reason:
      "It blocks IRP-04's Run 2 until the owner merges PR #19. The PR is no longer a draft and CC1's interface sign-off at 8ee1ed8 passed (6872395358), so the wait is an owner gate, not open work.",
  },
  "RAID-06": {
    severity: "medium",
    reason:
      "It blocks IRP-04's Run 2 until the owner gives the deployment GO for the exact merged release. The release can be built and verified offline on HX-15 first (6870987272).",
  },
  "RAID-07": {
    severity: "medium",
    reason:
      "It blocks IRP-04's Run 2 until the owner gives the Run 2 GO. Run 2's bounds are already fixed (DECISION-SEED.md:34-37), so only the GO remains.",
  },
  "RAID-08": {
    severity: "medium",
    reason:
      "The lovable-dev app still has access to every repo in the org (repository_selection: all, checked about 06:05Z), against R6. No Lovable commit after 3e39a5c is recorded, so an effect on main is UNVERIFIED, and the disconnect is an owner action already noted.",
  },
};

export const SEED_LESSONS = [
  {
    id: "L-01",
    title: "Done is a claim: check requirement coverage, not only test counts",
    summary:
      "A 77/77 self-check passed while 4 SPEC features were never built. Report requirement coverage apart from test counts.",
    situation:
      "The owner shared an example on 2026-11-14 (an Outskill video from 2026-11-11). The builder's self-check reported 77 of 77 passing, but 4 features in its own SPEC.md (/compact, helper agents, MCP, hooks) were never built. The self-check tested only what the AI had decided to build.",
    action:
      "CC1 and CC2 read it and took the same lessons. CC2 applied it as a spec-coverage audit of HX-SR PR #19 on 2026-11-14 (memory/feedback-done-is-a-claim.md:12-13, :22).",
    outcome:
      'It is a standing HX-CentCom requirement: "requirement coverage is reported apart from test counts" (SPEC.md:48).',
    recommendation:
      "\"A completion report states requirement coverage ('X of Y requirements, each mapped to a passing test or phase') separately from 'N tests pass'\" (memory/feedback-done-is-a-claim.md:20-21).",
    source_url: hx15("memory", "feedback-done-is-a-claim.md:15-22"),
    tags: ["verification", "reporting"],
    applies_to: "CC1, CC2; every completion report",
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-done-is-a-claim.md"),
  },
  {
    id: "L-02",
    title: "Lovable invented seed data",
    summary:
      "Lovable seeded decisions with invented dates, requesters and recommendations. Seed only verified values and leave the rest null.",
    situation:
      "Lovable's commits `e294f24..3e39a5c` seeded `owner_decisions` with invented `requested_at`, `requested_by`, `recommended_by` and `decided_at` values, and with wrong `blocks` (memory/project-hx-agent-dashboard.md:36). At `3e39a5c`: `recommended_by` is set on D-01, D-02, D-08 (Codex) and D-03 (CC2), though no recommendation is recorded (lines 100-102 and 107). D-02 has `requested_at` `2026-11-13T16:00Z` against the verified `2026-11-14T03:44:46Z` (PROMPT-3:11).",
    action:
      "CC1 checked every value on GitHub and wrote PROMPT-3: \"Never invent dates, requesters or recommendations: if a value is not given below, leave it empty or write 'not recorded'\" (PROMPT-3:7-8). DECISION-SEED.md then re-derived all 17 decisions.",
    outcome:
      "The HX-native rebuild seeds from PROMPT-3 and DECISION-SEED with no `recommended_by` (SPEC.md:114-117). Test T12 is specified to check this (SPEC.md:248).",
    recommendation:
      '"Never invent a value; leave it null" (SPEC.md:117). Test the seed against verified values (T12).',
    source_url:
      "https://github.com/HX-Infratstructure/HX-CentCom/blob/3e39a5c94018db85bf6f2111b2e60471053c8a20/drizzle/migrations/0001_owner_decisions_requirements_github.sql#L100-L115",
    tags: ["seed-data", "provenance"],
    applies_to: "HX-CentCom seed data; any agent writing seed or record data",
    status: "proposed",
    enforced_by_url: null,
  },
  {
    id: "L-03",
    title: "A PR's head commit was cited as its merge commit",
    summary:
      "IRR PR #32's head d9f487f was cited as its merge commit; the merge commit is 3f2633e. Record both.",
    situation:
      'CC1 gave `d9f487f` as the merge commit of HX-IRR PR #32, but `d9f487f` is the PR head (memory/project-hx-agent-dashboard.md:36, "CC1 error"). Lovable seeded D-15 as "Merged as d9f487f." (`3e39a5c` `0001_owner_decisions_requirements_github.sql:114`). GitHub shows head `d9f487f8`, merge commit `3f2633e0`, merged 2026-11-14T03:49:19Z (`gh pr view 32`, checked 2026-11-14T05:58Z).',
    action:
      'CC1 corrected it: "Merged (action) as 3f2633e (not d9f487f)" (PROMPT-3:22), and D-15 in DECISION-SEED.md:24 and :67.',
    outcome:
      "The corrected value is in the seed source. The same review found that the old stale rule wrongly flagged Complete tasks pinned to merge commits, because only open PRs were synced (PROMPT-3:34-36).",
    recommendation:
      'UNVERIFIED (no record states this as a rule): take both SHAs from `gh pr view --json headRefOid,mergeCommit` and write "merged at head X as Y". CC1\'s PR #18 closeout uses this form (HX-SR #10 6870866823).',
    source_url: "https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/32",
    tags: ["provenance", "git"],
    applies_to: "every agent that cites a merge SHA",
    status: "proposed",
    enforced_by_url: null,
  },
  {
    id: "L-04",
    title: "Direct CC1-CC2 messages instead of relays",
    summary:
      "Owner/GitHub relays slowed CC1-CC2 handoffs; direct cross-session messages are now the default, with GitHub as the record.",
    situation:
      "Relaying between CC1 and CC2 through the owner and GitHub threads slowed handoffs (memory/feedback-talk-to-cc1-directly.md:13; memory/feedback-talk-to-cc2-directly.md:13). The O-5(c) fix handoff (HX-SR #10 6846598662, 07:08:45Z on 2026-11-13) is the example these files cite.",
    action:
      "CC2 reached CC1's session directly once the owner gave it CC1's session ID. The owner then said \"going forward communicate dir with each other\" (2026-11-13, about 07:20Z).",
    outcome:
      "Direct messaging became the default. CC1 later delivered the PR #18 merged SHA and line references to CC2 by direct message (HX-SR #10 6870866823).",
    recommendation:
      "Use direct cross-session messages for handoffs, questions, interface details and merged-SHA notices. GitHub stays the durable record, and a peer message never grants authority (memory/feedback-talk-to-cc1-directly.md:16-19).",
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870866823",
    tags: ["coordination"],
    applies_to: "CC1, CC2",
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-talk-to-cc1-directly.md"),
  },
  {
    id: "L-05",
    title: "Get requirements right at the start",
    summary:
      "HX-SR PR #14 took four review rounds and about 90 findings. Quote every requirement and map it to a test before coding.",
    situation:
      "HX-SR PR #14 took four review rounds and about 90 findings (owner, 2026-11-12). Root causes: the plan was written without reading the program #15 rulings O-1, O-2 and O-6; it made `/ready` an exception to #10's bearer-token rule, and the docs reworded the requirement to fit; the work was deployed before PR #12 merged; and the reviewers were steered (memory/feedback-get-it-right-at-the-start.md:8-14).",
    action:
      'The owner: "if u want to steer something get code and tasks right in the begining then we dont have to spend hours fixing things that you created". This became the requirements-first rule.',
    outcome:
      "HX-CentCom's SPEC applies it: the owner's requirements are quoted (SPEC.md §1), and each acceptance test maps to a requirement (SPEC.md §7).",
    recommendation:
      "Before any plan, write every requirement into a checklist, quoted with its source comment ID. Map each to a test. Never reword a requirement to fit the code. Follow the plan's sequencing, then run one unsteered review (memory/feedback-get-it-right-at-the-start.md:19-23).",
    source_url: hx15("memory", "feedback-get-it-right-at-the-start.md:8-23"),
    tags: ["requirements", "review"],
    applies_to: "every work unit; first applied to CC2's HX-SR work (IRP-04 lineage)",
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-get-it-right-at-the-start.md"),
  },
  {
    id: "L-06",
    title: "Severity of findings against your own work comes from an independent rater",
    summary:
      "An agent rated findings against its own work. Severity and dispositions for own work come from an independent rater.",
    situation:
      'On 2026-11-13, the agent rated an unrated review of its own PR itself (P2 versus P3, "not ours", "not a defect", P3 for a bug in its own bench code) and acted on that rating. The owner: "the problem is your picking and u have not proverd to do it non bias way" (memory/feedback-separate-authority-gates.md:39-41).',
    action:
      "Rule: never assign severity or dispositions to findings against your own work. An independent rater gets a brief written to a file first (sha256 recorded), with the verbatim findings, the SHA, a stated scale and the owner-ruling comment IDs, and none of the author's triage (memory/feedback-separate-authority-gates.md:41-44).",
    outcome: null,
    recommendation:
      "The owner sees the rater's output verbatim next to the author's, and every difference goes to the owner (memory/feedback-separate-authority-gates.md:43-44).",
    source_url: hx15("memory", "feedback-separate-authority-gates.md:39-44"),
    tags: ["review", "independence"],
    applies_to:
      'every agent rating findings; the agent was CC2 (UNVERIFIED: inferred from "my own bench code", since CC2 owns `deploy/bench`)',
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-separate-authority-gates.md"),
  },
  {
    id: "L-07",
    title:
      "An offline proof is not live qualification, and a client socket count is not a server-side bound",
    summary:
      "An offline O-5(c) proof is not live qualification, and a client socket count does not prove a server-side bound.",
    situation:
      "PR #18 proved O-5(c) offline: a stress probe saw at most 2 open System One calls, against 4 before the fix (HX-SR #10 6870866823). Run 2's E2 sampler sees only the adapter's sockets (DECISION-SEED.md:39).",
    action:
      'The owner set proof boundaries: "offline O-5(c) stress proof is not live qualification". Report the client-side E2 count separately from server-side System One work after a disconnect, which is NOT_OBSERVED until GO-6 (HX-SR #10 6870997761). CC2\'s PR #19 reports the two sides separately (6870987272).',
    outcome:
      "The server side is recorded as NOT_OBSERVED, and GO-6 (D-05) is pending. CC1's interface sign-off restates the limit (6872395358).",
    recommendation:
      '"A socket limit does not establish the server-side bound" (6870997761). Keep offline correctness, connected acceptance and observed runtime separate (memory/feedback-standing-owner-directive.md:29).',
    source_url:
      "https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870997761",
    tags: ["verification", "O-5(c)"],
    applies_to: "CC1, CC2; IRP-04, IRP-05",
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-standing-owner-directive.md:29"),
  },
  {
    id: "L-08",
    title: "Reuse first: search upstream and sibling repos before building",
    summary:
      "WU5A built D3 fakes and replay tools that upstream vSR already had. Search upstream and sibling repos before building.",
    situation:
      "MVP 5 WU5A built its own D3 fakes, a recorded-exchange harness, replay and rule-comparison tooling. Upstream vLLM Semantic Router already had `tools/test` (including a System One provider mocker), `bench`, `e2e`, `perf` and `tools/calibration`. The AGENTS.md rule to search with XERJ first was skipped (memory/feedback-reuse-first.md:18-22).",
    action:
      'The owner, 2026-11-12: "i dont like the fact that these repos contain a bounty of gold and we just run off and do things from scratch". A reuse search and reuse table became part of every work unit\'s requirements gate.',
    outcome:
      "CC2's Stage 4 recon adopts `signal_labeled_set.py`, HX-Agent-Lab `abc_eval` and `advice_bench` instead of new tooling (memory/project-hx-sr-mvp4.md:210).",
    recommendation:
      "Before building a harness, fake, fixture, benchmark, replay or calibration tool, search upstream and sibling repos. Record each candidate as adopt, adapt, reference-only or not usable, and build from scratch only with a written reason (memory/feedback-reuse-first.md:11-16).",
    source_url: hx15("memory", "feedback-reuse-first.md:11-25"),
    tags: ["reuse"],
    applies_to: "every work unit; first seen in CC1's WU5A (IRP-05 lineage)",
    status: "adopted",
    enforced_by_url: hx15("memory", "feedback-reuse-first.md"),
  },
  {
    id: "L-09",
    title: "D-005 citation lesson",
    summary:
      'D-005 "HX-18 vSR placement" with source IRR #14 6812669163, which records HX-6; the HX-18 decision is 6813455936.',
    situation:
      'The ChatGPT control center\'s `/api/state` (snapshot 2026-11-14T03:04:26Z) has decision D-005 "HX-18 vSR placement" with source IRR #14 6812669163, which records HX-6; the HX-18 decision is 6813455936. CC1 read it on 2026-11-14.',
    action: null,
    outcome: null,
    recommendation: null,
    source_url: hx15("wu1", "SPEC.md:247"),
    tags: [],
    applies_to: null,
    status: "proposed",
    enforced_by_url: null,
  },
] as const satisfies readonly LessonSeed[];

const SYNC_RAID_SEQUENCE = sql`
  select setval('raid_item_id_seq', greatest(s.m, (select last_value from raid_item_id_seq)))
  from (select max(substring(id from 6)::int) as m from raid_items where id ~ '^RAID-[0-9]+$') s
  where s.m is not null`;

const SYNC_LESSON_SEQUENCE = sql`
  select setval('lesson_id_seq', greatest(s.m, (select last_value from lesson_id_seq)))
  from (select max(substring(id from 3)::int) as m from lessons where id ~ '^L-[0-9]+$') s
  where s.m is not null`;

/** Runs inside seedDb's transaction: ON CONFLICT DO NOTHING, no activity rows, then both id sequences follow the rows. */
export async function seedRaidLessons(tx: Tx): Promise<void> {
  await tx
    .insert(raidItems)
    .values(
      SEED_RAID_ITEMS.map((row) => ({
        ...row,
        task_ids: [...row.task_ids],
        severity: CC1_SEVERITY_RATINGS[row.id].severity,
        severity_rated_by: "CC1",
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(lessons)
    .values(SEED_LESSONS.map((row) => ({ ...row, tags: [...row.tags] })))
    .onConflictDoNothing();
  await tx.execute(SYNC_RAID_SEQUENCE);
  await tx.execute(SYNC_LESSON_SEQUENCE);
}
