/**
 * Unknown keys are stripped, so an `agent` field (T2) never reaches the database. A typed `progress` is refused
 * instead (T8): progress is computed, and the agent should be told so.
 */
import { z } from "zod";
import {
  ACTIVITY_ENTITIES,
  DECISION_STATUSES,
  GATE_TYPES,
  OWNER_DECISION_STATUSES,
  REQUIREMENT_STATES,
  UPDATE_SOURCES,
  type UpdateKind,
  type UpdateSource,
} from "@/server/db/schema";
import { SOURCE_REF_PATTERN } from "@/server/db/schema-raid";
import { ServiceError, type Issue } from "./errors";

/** `system` is written only by decide, so a caller that sends it gets `invalid` (SPEC §5 wire contract). */
const POSTED_KINDS = ["progress", "note", "link"] as const satisfies readonly Exclude<
  UpdateKind,
  "system"
>[];

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");
/** A decision may cite a record that exists only on HX-15 (SPEC §6.1). */
export const sourceRef = z
  .string()
  .trim()
  .max(2000)
  .regex(new RegExp(SOURCE_REF_PATTERN), "must be an http(s) URL or hx15:<absolute path>");

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * PostgreSQL refuses year 0000 and offsets beyond ±15:59; isoTimestamp.fromDriver reads back only UTC years 0001-9999.
 * Years change on whole seconds, and PostgreSQL's rounding to microseconds reaches the next second only from
 * .9999995. `setUTCFullYear` because `Date.UTC` maps years 0-99 to 1900-1999.
 */
function storedAndReadBack(value: string): boolean {
  const m = INSTANT.exec(value);
  if (!m) return false;
  const [, year, month, day, hour, minute, second = "0", fraction = "", sign, oh = "0", om = "0"] =
    m;
  if (Number(year) < 1 || Number(oh) > 15 || Number(om) > 59) return false;
  const instant = new Date(0);
  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  instant.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const offsetMs = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60_000;
  const carryMs = /^9{6}[5-9]/.test(fraction) ? 1000 : 0;
  const utcYear = new Date(instant.getTime() - offsetMs + carryMs).getUTCFullYear();
  return utcYear >= 1 && utcYear <= 9999;
}

/** P3-6: an instant that PostgreSQL stores and that reads back, so a bad one is a 400 before any write. */
export const pgInstant = z
  .string()
  .datetime({ offset: true })
  .refine(
    storedAndReadBack,
    "must be a UTC instant in years 0001-9999 with an offset within ±15:59",
  );

/** pgInstant refuses a date such as 02-31 or year 0000, which the `::timestamptz` cast would turn into a 500. */
export const isoMicros = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .pipe(pgInstant);

const id = z.string().trim().min(1).max(100);
const commitSha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, "must be a 7-40 character hex commit SHA")
  .transform((s) => s.toLowerCase());
const noTypedProgress = z
  .never({ message: "progress is computed from requirements and cannot be set" })
  .optional();

const decisionQuestion = z.string().trim().min(1).max(500);

export const postProgressInput = z.object({
  kind: z.enum(POSTED_KINDS).default("progress"),
  note: z.string().trim().min(1).max(2000),
  status: id.optional(),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(200), url: httpUrl }))
    .max(20)
    .optional(),
  commitSha: commitSha.optional(),
  prUrl: httpUrl.optional(),
  source: z.enum(UPDATE_SOURCES),
  runId: z.string().trim().min(1).max(200).optional(),
  progress: noTypedProgress,
  /** F7a: overrides for the decision that a move into Ready for owner opens; any other update ignores it. */
  decision: z
    .object({ question: decisionQuestion.optional(), gateType: z.enum(GATE_TYPES).optional() })
    .optional(),
});

type BodySource = Exclude<UpdateSource, "mcp">;
const BODY_SOURCES = UPDATE_SOURCES.filter((s): s is BodySource => s !== "mcp") as [
  BodySource,
  ...BodySource[],
];

/**
 * What postProgressPlan parses: a body may record any source but mcp, which only the MCP adapter records, through the
 * `via` option that no REST body or header sets. The rule is in the schema, so one 400 lists it beside other fields.
 */
export const bodyProgressInput = postProgressInput.extend({
  source: z.enum(BODY_SOURCES, {
    errorMap: () => ({
      message: `must be ${BODY_SOURCES.join(", ")}; only the /mcp endpoint records mcp`,
    }),
  }),
});
export const mcpProgressInput = postProgressInput.extend({ source: z.literal("mcp") });

export const setRequirementInput = z
  .object({
    requirementId: z.string().uuid().optional(),
    requirement: z.string().trim().min(1).max(500).optional(),
    state: z.enum(REQUIREMENT_STATES),
    proofUrl: httpUrl.optional(),
    progress: noTypedProgress,
  })
  .superRefine((v, ctx) => {
    if ((v.requirementId === undefined) === (v.requirement === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["requirementId"],
        message: "give exactly one of requirementId or requirement",
      });
    }
    if (v.state === "PASS" && v.proofUrl === undefined) {
      ctx.addIssue({ code: "custom", path: ["proofUrl"], message: "PASS needs a proofUrl" });
    }
  })
  .transform((v) => ({
    target:
      v.requirementId !== undefined
        ? ({ kind: "id", id: v.requirementId } as const)
        : ({ kind: "text", text: v.requirement ?? "" } as const),
    state: v.state,
    proofUrl: v.proofUrl ?? null,
  }));

/** No recommendedBy: the server records the requester as the recommender of a recommended option (P3-8). */
export const requestDecisionInput = z.object({
  question: decisionQuestion,
  // UTF-16 length is never below char_length, so this check always fires before the database's.
  summary: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(20000),
  subject: z.string().trim().min(1).max(500),
  gateType: z.enum(GATE_TYPES),
  options: z
    .array(
      z
        .object({
          label: z.string().trim().min(1).max(200),
          description: z.string().trim().min(1).max(2000).optional(),
          recommended: z.boolean().default(false),
        })
        .transform(({ description, ...option }) =>
          description === undefined ? option : { ...option, description },
        ),
    )
    .max(10),
  blocks: z.array(id).max(20),
  sourceUrl: sourceRef,
});

export const decideInput = z.object({
  status: z.enum(OWNER_DECISION_STATUSES),
  decisionText: z.string().trim().min(1).max(4000),
  sourceUrl: sourceRef,
});

const TASK_DATE_MIN = "2020-01-01";
const TASK_DATE_MAX = "2099-12-31";
const TASK_SPAN_MAX_DAYS = 730;

/** A real calendar date, so 2026-02-31 is refused here instead of by the `::date` cast. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
  }, "must be a real calendar date");

/**
 * A planned task date, in a range that keeps the timeline, which draws one column per day, from freezing on a date
 * such as 9999-12-31.
 */
const taskDate = calendarDate.refine(
  (d) => d >= TASK_DATE_MIN && d <= TASK_DATE_MAX,
  `must be between ${TASK_DATE_MIN} and ${TASK_DATE_MAX}`,
);

/** The task's agent is not a field an agent sets: `agentId` is the owner's assignment (`taskAssignee`). */
export const createTaskInput = z
  .object({
    id: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[A-Z0-9]+-[A-Z0-9]+$/, "must be uppercase letters or digits, a dash, then more"),
    title: z.string().trim().min(1).max(200),
    repository: z.string().trim().min(1).max(100).optional(),
    host: z.string().trim().min(1).max(32).optional(),
    startDate: taskDate.optional(),
    dueDate: taskDate.optional(),
    status: id.default("Waiting"),
    note: z.string().trim().min(1).max(4000).optional(),
    sourceUrl: sourceRef,
    agentId: id.optional(),
    progress: noTypedProgress,
  })
  .superRefine((v, ctx) => {
    if (v.startDate === undefined || v.dueDate === undefined) return;
    if (v.dueDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "must not be before startDate" });
    } else if (Date.parse(v.dueDate) - Date.parse(v.startDate) > TASK_SPAN_MAX_DAYS * 86_400_000) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: `must be at most ${TASK_SPAN_MAX_DAYS} days after startDate`,
      });
    }
  });

export const issueKeyInput = z.object({ agentId: id, label: z.string().trim().min(1).max(100) });
export const revokeKeyInput = z.object({ keyId: z.string().uuid() });

/** The needs-attention reasons of `Task.attention`, which the update and task lists filter by. */
const ATTENTION_REASONS = ["blocked", "owner", "stale"] as const;

const limit = z.coerce.number().int().min(1).max(100).default(20);
const cursor = z.string().min(1).max(500);

export const updateQueryInput = z
  .object({
    agentId: id.optional(),
    taskId: id.optional(),
    /** Updates of any of these tasks. listUpdates refuses it beside `taskId`. */
    taskIds: z.array(id).min(1).max(100).optional(),
    /** Updates of the open tasks that need attention for this reason. listUpdates refuses it beside `taskId` or `taskIds`. */
    attention: z.enum(ATTENTION_REASONS).optional(),
    source: z.enum(UPDATE_SOURCES).optional(),
    since: pgInstant.optional(),
    until: pgInstant.optional(),
    limit,
    cursor: cursor.optional(),
  })
  .default({});

export const taskQueryInput = z
  .object({
    agentId: id.optional(),
    repo: id.optional(),
    /** The open tasks that need attention for this reason, under the rule of `Task.attention`. */
    attention: z.enum(ATTENTION_REASONS).optional(),
    /** A query string carries `true` or `false`; no other string is a boolean. */
    open: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
      .optional(),
    limit,
    cursor: cursor.optional(),
  })
  .default({});

export const activityQueryInput = z
  .object({
    actor: id.optional(),
    entity: z.enum(ACTIVITY_ENTITIES).optional(),
    entityId: id.optional(),
    since: pgInstant.optional(),
    limit,
    cursor: cursor.optional(),
  })
  .default({});

export const decisionQueryInput = z
  .object({
    gateType: z.enum(GATE_TYPES).optional(),
    /** `not_pending` is the history: Decided, Deferred and Superseded. */
    status: z.enum([...DECISION_STATUSES, "not_pending"]).optional(),
    limit,
    cursor: cursor.optional(),
  })
  .default({});

export type PostProgressInput = z.input<typeof postProgressInput>;
export type SetRequirementInput = z.input<typeof setRequirementInput>;
export type RequestDecisionInput = z.input<typeof requestDecisionInput>;
export type DecideInput = z.input<typeof decideInput>;
export type CreateTaskInput = z.input<typeof createTaskInput>;
export type UpdateQueryInput = z.input<typeof updateQueryInput>;
export type TaskQueryInput = z.input<typeof taskQueryInput>;
export type ActivityQueryInput = z.input<typeof activityQueryInput>;
export type DecisionQueryInput = z.input<typeof decisionQueryInput>;

export type Parsed<S extends z.ZodTypeAny> = z.output<S>;

export function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data as z.output<S>;
  const issues: Issue[] = result.error.issues.map((i) => ({
    path: i.path.join(".") || "(body)",
    message: i.message,
  }));
  throw ServiceError.invalid("The request body is invalid.", issues);
}
