/**
 * The lessons log (SPEC §6.1), and automation 3: the lessons ask when a task becomes done. Writes run through the
 * shared writer (pipeline.ts).
 */
import { and, countDistinct, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { statusLabels } from "@/server/db/schema";
import {
  formatLessonId,
  LESSON_ID_PATTERN,
  LESSON_STATUSES,
  lessons,
  type LessonStatus,
} from "@/server/db/schema-raid";
import type { Actor } from "./actor";
import { ServiceError } from "./errors";
import { parse, sourceRef } from "./inputs";
import type { CreatePlan, UpdatePlan } from "./pipeline";
import { count, keyset, listCursor, listLimit, page, SNAPSHOT, tally, text } from "./raid";
import type { CreateOptions, Page, UpdateOptions, WriteResult } from "./types";
import type { postProgressPlan } from "./writes";

export type Lesson = typeof lessons.$inferSelect;

const ADOPTION_RULE =
  "an adopted lesson needs enforcedByUrl: the rule, test or memory entry that enforces it";

const lessonFields = {
  title: text(200).describe("One-line title."),
  summary: text(140).describe("The row view, at most 140 characters."),
  situation: text(4000).nullable(),
  action: text(4000).nullable(),
  outcome: text(4000).nullable(),
  recommendation: text(4000).nullable(),
  sourceUrl: sourceRef.describe(
    "Required: where the lesson is recorded. An http(s) URL, or hx15:<absolute path> for a record that exists only on HX-15.",
  ),
  tags: z.array(text(50)).max(20),
  appliesTo: text(500).nullable().describe("Who or what the lesson applies to."),
  status: z
    .enum(LESSON_STATUSES)
    .describe("proposed, adopted or retired. adopted needs enforcedByUrl."),
  enforcedByUrl: sourceRef
    .nullable()
    .describe(
      "The rule, test or memory entry that enforces the lesson: an http(s) URL or hx15:<absolute path>.",
    ),
};
type LessonField = keyof typeof lessonFields;

const LESSON_COLUMNS = {
  title: "title",
  summary: "summary",
  situation: "situation",
  action: "action",
  outcome: "outcome",
  recommendation: "recommendation",
  sourceUrl: "source_url",
  tags: "tags",
  appliesTo: "applies_to",
  status: "status",
  enforcedByUrl: "enforced_by_url",
} as const satisfies Record<LessonField, keyof Lesson>;

type LessonColumns = Partial<Pick<Lesson, (typeof LESSON_COLUMNS)[LessonField]>>;

function lessonColumns(input: Partial<Record<LessonField, unknown>>): LessonColumns {
  return Object.fromEntries(
    Object.entries(LESSON_COLUMNS).flatMap(([field, column]) => {
      const value = input[field as LessonField];
      return value === undefined ? [] : [[column, value]];
    }),
  ) as LessonColumns;
}

const lessonObject = z.object(lessonFields);

export const createLessonInput = lessonObject
  .partial({
    situation: true,
    action: true,
    outcome: true,
    recommendation: true,
    appliesTo: true,
    enforcedByUrl: true,
  })
  .extend({
    status: lessonFields.status.default("proposed"),
    tags: lessonFields.tags.default([]),
  })
  .superRefine((v, ctx) => {
    if (v.status === "adopted" && v.enforcedByUrl == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enforcedByUrl"],
        message: ADOPTION_RULE,
      });
    }
  });

/** A partial update: an absent field stays, null clears it. */
export const updateLessonInput = lessonObject.partial().superRefine((v, ctx) => {
  if (Object.values(lessonColumns(v)).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "give at least one field to change",
    });
  }
});

export const lessonQueryInput = z
  .object({
    status: z.enum(LESSON_STATUSES).optional(),
    tag: text(50).optional(),
    limit: listLimit,
    cursor: listCursor.optional(),
  })
  .default({});

export type CreateLessonInput = z.input<typeof createLessonInput>;
export type UpdateLessonInput = z.input<typeof updateLessonInput>;
export type LessonQueryInput = z.input<typeof lessonQueryInput>;

export type LessonWrite = { readonly lesson: Lesson };
type LessonRoot = { readonly kind: "lesson"; readonly id: string };

async function nextLessonId(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ n: sql<number>`nextval('lesson_id_seq')::int`.mapWith(Number) })
    .from(sql`(select 1) as one`);
  if (!row) throw new Error("nextval returned no row");
  return formatLessonId(row.n);
}

export const createLessonPlan: CreatePlan<typeof createLessonInput, LessonWrite> = {
  action: "lesson.create",
  input: createLessonInput,
  async apply(tx, { actor, input, at }) {
    const id = await nextLessonId(tx);
    const [lesson] = await tx
      .insert(lessons)
      .values({
        ...lessonColumns(input),
        id,
        title: input.title,
        summary: input.summary,
        source_url: input.sourceUrl,
        created_by: actor.agentId,
        created_at: at,
        updated_at: at,
      })
      .returning();
    if (!lesson) throw new Error("lesson insert returned no row");
    return {
      status: 201,
      value: { lesson },
      activity: { entity: "lesson", entityId: id, before: null, after: lesson },
    };
  },
};

export function updateLessonPlan(
  id: string,
): UpdatePlan<typeof updateLessonInput, LessonRoot, LessonWrite> {
  return {
    action: "lesson.update",
    input: updateLessonInput,
    root: { kind: "lesson", id },
    async apply(tx, { input, before }) {
      const columns = lessonColumns(input);
      const merged = { ...before, ...columns };
      if (merged.status === "adopted" && merged.enforced_by_url === null) {
        throw ServiceError.invalid("The request body is invalid.", [
          { path: "enforcedByUrl", message: ADOPTION_RULE },
        ]);
      }
      const [lesson] = await tx
        .update(lessons)
        .set(columns)
        .where(eq(lessons.id, before.id))
        .returning();
      if (!lesson) throw new Error("lesson update returned no row");
      return {
        status: 200,
        value: { lesson },
        activity: { entity: "lesson", entityId: before.id, before, after: lesson },
      };
    },
  };
}

type ProgressPlan = ReturnType<typeof postProgressPlan>;
type ProgressCtx = Parameters<ProgressPlan["apply"]>[1];

const LESSONS_ASK =
  "add any lessons from this task with their source (POST /api/v1/lessons or the add_lesson MCP tool).";

/** One system update when the progress write moved the task from a not-done status to a done one. */
async function askForLessons(tx: Tx, ctx: ProgressCtx, status: string): Promise<void> {
  if (status === ctx.before.status) return;
  const labels = await tx
    .select({ id: statusLabels.id, is_done: statusLabels.is_done })
    .from(statusLabels)
    .where(inArray(statusLabels.id, [ctx.before.status, status]));
  const done = new Map(labels.map((l) => [l.id, l.is_done]));
  if (done.get(ctx.before.status) || !done.get(status)) return;
  const ask = ctx.before.agent
    ? `${ctx.before.agent}: ${LESSONS_ASK}`
    : `${LESSONS_ASK.charAt(0).toUpperCase()}${LESSONS_ASK.slice(1)}`;
  await ctx.insertUpdates([
    {
      task_id: ctx.before.id,
      kind: "system",
      status: null,
      note: `${ctx.before.id} is ${status}. ${ask}`,
      links: [],
      source: null,
    },
  ]);
}

/**
 * Automation 3 (SPEC §6.1). Wraps postProgressPlan (writes.ts) at its wiring line, so the ask shares the progress
 * write's transaction, actor and clock, and a replay (which never runs apply) asks nothing. The progress write's value
 * and activity row are returned unchanged.
 */
export function withLessonsAsk(plan: ProgressPlan): ProgressPlan {
  return {
    ...plan,
    async apply(tx, ctx) {
      const applied = await plan.apply(tx, ctx);
      await askForLessons(tx, ctx, applied.value.task.status);
      return applied;
    },
  };
}

export type LessonCounts = {
  readonly total: number;
  readonly byStatus: Readonly<Partial<Record<LessonStatus, number>>>;
  readonly byTag: Readonly<Record<string, number>>;
};
export type LessonsPage = Page<Lesson> & { readonly counts: LessonCounts };

const lessonKeyset = keyset(LESSON_ID_PATTERN);

type LessonFacet = "status" | "tag";

function lessonFilters(query: z.output<typeof lessonQueryInput>, except?: LessonFacet): SQL[] {
  const filters: (SQL | undefined)[] = [
    except !== "status" && query.status !== undefined
      ? eq(lessons.status, query.status)
      : undefined,
    except !== "tag" && query.tag !== undefined
      ? sql`${query.tag}::text = any(${lessons.tags})`
      : undefined,
  ];
  return filters.filter((f): f is SQL => f !== undefined);
}

/** One REPEATABLE READ, READ ONLY snapshot; each facet applies every filter but its own; counts ignore the cursor. */
export async function listLessons(db: Db, raw: unknown): Promise<LessonsPage> {
  const query = parse(lessonQueryInput, raw);
  return db.transaction(async (tx) => {
    const items = await page(
      tx
        .select()
        .from(lessons)
        .where(
          and(
            ...lessonFilters(query),
            lessonKeyset.olderThan(lessons.created_at, lessons.id, query.cursor),
          ),
        )
        .orderBy(desc(lessons.created_at), desc(lessons.id)),
      query.limit,
      lessonKeyset.encode,
    );
    const [total] = await tx
      .select({ n: count })
      .from(lessons)
      .where(and(...lessonFilters(query)));
    const byStatus = await tx
      .select({ key: lessons.status, n: count })
      .from(lessons)
      .where(and(...lessonFilters(query, "status")))
      .groupBy(lessons.status);
    const tags = tx
      .select({ id: lessons.id, tag: sql<string>`unnest(${lessons.tags})`.as("tag") })
      .from(lessons)
      .where(and(...lessonFilters(query, "tag")))
      .as("tags");
    const byTag = await tx
      .select({ key: tags.tag, n: countDistinct(tags.id) })
      .from(tags)
      .groupBy(tags.tag);
    return {
      ...items,
      counts: { total: total?.n ?? 0, byStatus: tally(byStatus), byTag: tally(byTag) },
    };
  }, SNAPSHOT);
}

export async function getLesson(db: Db, id: string): Promise<Lesson> {
  return db.transaction(async (tx) => {
    const [lesson] = await tx.select().from(lessons).where(eq(lessons.id, id));
    if (!lesson) throw ServiceError.notFound("Lesson", id);
    return lesson;
  }, SNAPSHOT);
}

export interface LessonServices {
  listLessons(query?: LessonQueryInput): Promise<LessonsPage>;
  getLesson(id: string): Promise<Lesson>;
  createLesson(
    actor: Actor | null,
    input: CreateLessonInput,
    opts?: CreateOptions,
  ): Promise<WriteResult<LessonWrite>>;
  updateLesson(
    actor: Actor | null,
    id: string,
    input: UpdateLessonInput,
    opts?: UpdateOptions,
  ): Promise<WriteResult<LessonWrite>>;
}
