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
const id = z.string().trim().min(1).max(100);
const commitSha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, "must be a 7-40 character hex commit SHA")
  .transform((s) => s.toLowerCase());
const noTypedProgress = z
  .never({ message: "progress is computed from requirements and cannot be set" })
  .optional();

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
});

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

export const requestDecisionInput = z
  .object({
    question: z.string().trim().min(1).max(500),
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
    recommendedBy: id.optional(),
  })
  .superRefine((v, ctx) => {
    const recommended = v.options.filter((o) => o.recommended).length;
    if (recommended > 0 && v.recommendedBy === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendedBy"],
        message: "a recommended option needs recommendedBy",
      });
    }
    if (recommended === 0 && v.recommendedBy !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendedBy"],
        message: "recommendedBy needs a recommended option",
      });
    }
  });

export const decideInput = z.object({
  status: z.enum(OWNER_DECISION_STATUSES),
  decisionText: z.string().trim().min(1).max(4000),
  sourceUrl: sourceRef,
});

export const issueKeyInput = z.object({ agentId: id, label: z.string().trim().min(1).max(100) });
export const revokeKeyInput = z.object({ keyId: z.string().uuid() });

const isoDateTime = z.string().datetime({ offset: true });
const limit = z.coerce.number().int().min(1).max(100).default(20);
const cursor = z.string().min(1).max(500);

export const updateQueryInput = z
  .object({
    agentId: id.optional(),
    taskId: id.optional(),
    source: z.enum(UPDATE_SOURCES).optional(),
    since: isoDateTime.optional(),
    until: isoDateTime.optional(),
    limit,
    cursor: cursor.optional(),
  })
  .default({});

export const activityQueryInput = z
  .object({
    actor: id.optional(),
    entity: z.enum(ACTIVITY_ENTITIES).optional(),
    entityId: id.optional(),
    since: isoDateTime.optional(),
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
export type UpdateQueryInput = z.input<typeof updateQueryInput>;
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
