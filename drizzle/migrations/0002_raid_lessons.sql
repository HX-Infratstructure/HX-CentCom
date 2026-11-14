-- SPEC §6.1: the RAID register and the lessons log. Hand-written, because drizzle.config.ts reads only schema.ts;
-- tests/raid/schema.test.ts fails when this file and src/server/db/schema-raid.ts disagree.
CREATE SEQUENCE "public"."raid_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."lesson_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "raid_items" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"owner_agent" text,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text,
	"severity_rated_by" text,
	"review_at" timestamp with time zone,
	"source_url" text NOT NULL,
	"created_by" text,
	"task_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"decision_id" text,
	"probability" text,
	"impact" text,
	"mitigation" text,
	"validation_method" text,
	"validation_state" text,
	"resolution" text,
	"escalated" boolean DEFAULT false NOT NULL,
	"blocked_task_id" text,
	"blocking_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raid_items_id_format" CHECK ("raid_items"."id" ~ '^RAID-[0-9]{2,}$'),
	CONSTRAINT "raid_items_type_check" CHECK ("raid_items"."type" in ('risk', 'assumption', 'issue', 'dependency')),
	CONSTRAINT "raid_items_status_check" CHECK ("raid_items"."status" in ('open', 'monitoring', 'closed')),
	CONSTRAINT "raid_items_severity_check" CHECK ("raid_items"."severity" is null or "raid_items"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "raid_items_severity_rated" CHECK (("raid_items"."severity" is null) = ("raid_items"."severity_rated_by" is null)),
	CONSTRAINT "raid_items_validation_state_check" CHECK ("raid_items"."validation_state" is null or "raid_items"."validation_state" in ('unverified', 'validated', 'invalidated')),
	CONSTRAINT "raid_items_title_present" CHECK (char_length("raid_items"."title") >= 1),
	CONSTRAINT "raid_items_summary_length" CHECK (char_length("raid_items"."summary") between 1 and 140),
	CONSTRAINT "raid_items_description_present" CHECK (char_length("raid_items"."description") >= 1),
	CONSTRAINT "raid_items_source_ref" CHECK ("raid_items"."source_url" ~ '^(https?://\S+|hx15:/\S+)$'),
	CONSTRAINT "raid_items_blocking_ref_format" CHECK ("raid_items"."blocking_ref" is null or "raid_items"."blocking_ref" ~ '^(task:[^\s:]+|decision:D-[0-9]{2,}|https?://\S+)$'),
	CONSTRAINT "raid_items_blocked_task_listed" CHECK ("raid_items"."blocked_task_id" is null or "raid_items"."blocked_task_id" = any("raid_items"."task_ids")),
	CONSTRAINT "raid_items_probability_by_type" CHECK ("raid_items"."type" in ('risk') or "raid_items"."probability" is null),
	CONSTRAINT "raid_items_impact_by_type" CHECK ("raid_items"."type" in ('risk', 'issue') or "raid_items"."impact" is null),
	CONSTRAINT "raid_items_mitigation_by_type" CHECK ("raid_items"."type" in ('risk') or "raid_items"."mitigation" is null),
	CONSTRAINT "raid_items_validation_method_by_type" CHECK ("raid_items"."type" in ('assumption') or "raid_items"."validation_method" is null),
	CONSTRAINT "raid_items_validation_state_by_type" CHECK (("raid_items"."type" in ('assumption')) = ("raid_items"."validation_state" is not null)),
	CONSTRAINT "raid_items_resolution_by_type" CHECK ("raid_items"."type" in ('issue') or "raid_items"."resolution" is null),
	CONSTRAINT "raid_items_escalated_by_type" CHECK ("raid_items"."type" in ('issue') or "raid_items"."escalated" = false),
	CONSTRAINT "raid_items_blocked_task_id_by_type" CHECK (("raid_items"."type" in ('dependency')) = ("raid_items"."blocked_task_id" is not null)),
	CONSTRAINT "raid_items_blocking_ref_by_type" CHECK (("raid_items"."type" in ('dependency')) = ("raid_items"."blocking_ref" is not null)),
	CONSTRAINT "raid_items_version_check" CHECK ("raid_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"situation" text,
	"action" text,
	"outcome" text,
	"recommendation" text,
	"source_url" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"applies_to" text,
	"created_by" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"enforced_by_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_id_format" CHECK ("lessons"."id" ~ '^L-[0-9]{2,}$'),
	CONSTRAINT "lessons_status_check" CHECK ("lessons"."status" in ('proposed', 'adopted', 'retired')),
	CONSTRAINT "lessons_title_present" CHECK (char_length("lessons"."title") >= 1),
	CONSTRAINT "lessons_summary_length" CHECK (char_length("lessons"."summary") between 1 and 140),
	CONSTRAINT "lessons_source_ref" CHECK ("lessons"."source_url" ~ '^(https?://\S+|hx15:/\S+)$'),
	CONSTRAINT "lessons_enforced_by_ref" CHECK ("lessons"."enforced_by_url" is null or "lessons"."enforced_by_url" ~ '^(https?://\S+|hx15:/\S+)$'),
	CONSTRAINT "lessons_adopted_is_enforced" CHECK ("lessons"."status" <> 'adopted' or "lessons"."enforced_by_url" is not null),
	CONSTRAINT "lessons_version_check" CHECK ("lessons"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_owner_agent_agents_id_fk" FOREIGN KEY ("owner_agent") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_severity_rated_by_agents_id_fk" FOREIGN KEY ("severity_rated_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_decision_id_owner_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."owner_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_blocked_task_id_engineering_tasks_id_fk" FOREIGN KEY ("blocked_task_id") REFERENCES "public"."engineering_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raid_items_feed_idx" ON "raid_items" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "raid_items_task_ids_idx" ON "raid_items" USING gin ("task_ids");--> statement-breakpoint
CREATE INDEX "raid_items_open_dependency_idx" ON "raid_items" USING btree ("blocked_task_id") WHERE "raid_items"."type" = 'dependency' and "raid_items"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "lessons_feed_idx" ON "lessons" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "lessons_tags_idx" ON "lessons" USING gin ("tags");--> statement-breakpoint
-- The same constraint names, widened to A1's lists plus RAID_ACTIVITY_ACTIONS and RAID_ACTIVITY_ENTITIES. ADD
-- CONSTRAINT scans existing rows; the 0001 append-only trigger fires only on UPDATE, DELETE and TRUNCATE.
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action_check";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action_check" CHECK ("activity_log"."action" in ('task.progress', 'requirement.set', 'decision.request', 'decision.decide', 'key.issue', 'key.revoke', 'key.bootstrap', 'raid.create', 'raid.update', 'lesson.create', 'lesson.update'));--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_entity_check";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_entity_check" CHECK ("activity_log"."entity" in ('task', 'requirement', 'decision', 'agent_key', 'raid_item', 'lesson'));
