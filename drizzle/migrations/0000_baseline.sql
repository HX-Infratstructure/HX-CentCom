CREATE SEQUENCE "public"."owner_decision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"run_id" text,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_action_check" CHECK ("activity_log"."action" in ('task.progress', 'requirement.set', 'decision.request', 'decision.decide', 'key.issue', 'key.revoke', 'key.bootstrap')),
	CONSTRAINT "activity_log_entity_check" CHECK ("activity_log"."entity" in ('task', 'requirement', 'decision', 'agent_key'))
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "agent_keys_hash_is_sha256_hex" CHECK ("agent_keys"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agents_role_check" CHECK ("agents"."role" in ('agent', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "engineering_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"agent" text,
	"repository" text NOT NULL,
	"host" text NOT NULL,
	"commit_sha" text,
	"status" text NOT NULL,
	"group" text NOT NULL,
	"blocked_on" text DEFAULT 'none' NOT NULL,
	"start_date" date,
	"due_date" date,
	"note" text,
	"source_url" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engineering_tasks_dates_check" CHECK ("engineering_tasks"."due_date" >= "engineering_tasks"."start_date"),
	CONSTRAINT "engineering_tasks_group_check" CHECK ("engineering_tasks"."group" in ('backlog', 'in_progress', 'ready_for_owner', 'done')),
	CONSTRAINT "engineering_tasks_blocked_on_check" CHECK ("engineering_tasks"."blocked_on" in ('owner_decision', 'assignment', 'dependency', 'none')),
	CONSTRAINT "engineering_tasks_version_check" CHECK ("engineering_tasks"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "github_prs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"head_sha" text NOT NULL,
	"merge_commit_sha" text,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repos" (
	"name" text PRIMARY KEY NOT NULL,
	"default_branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency" (
	"key" text NOT NULL,
	"actor" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_pk" PRIMARY KEY("key","actor"),
	CONSTRAINT "idempotency_status_check" CHECK ("idempotency"."status" = 0 or "idempotency"."status" between 200 and 299)
);
--> statement-breakpoint
CREATE TABLE "owner_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text,
	"subject" text,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"gate_type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocks" text[] DEFAULT '{}'::text[] NOT NULL,
	"recommended_by" text,
	"requested_by" text,
	"requested_at" timestamp with time zone,
	"source_url" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"decision_text" text,
	"decision_source_url" text,
	"decided_at" timestamp with time zone,
	"superseded_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "owner_decisions_gate_type_check" CHECK ("owner_decisions"."gate_type" in ('merge', 'deploy', 'live_run', 'host', 'scope', 'assignment', 'policy')),
	CONSTRAINT "owner_decisions_status_check" CHECK ("owner_decisions"."status" in ('Pending', 'Decided', 'Deferred', 'Superseded')),
	CONSTRAINT "owner_decisions_summary_length" CHECK (char_length("owner_decisions"."summary") between 1 and 140),
	CONSTRAINT "owner_decisions_description_present" CHECK (char_length("owner_decisions"."description") >= 1),
	CONSTRAINT "owner_decisions_decided_has_source" CHECK ("owner_decisions"."status" <> 'Decided' or coalesce("owner_decisions"."decision_source_url", '') <> ''),
	CONSTRAINT "owner_decisions_recommendation_attributed" CHECK (("owner_decisions"."recommended_by" is not null) = ("owner_decisions"."options" @? '$[*] ? (@.recommended == true)')),
	CONSTRAINT "owner_decisions_version_check" CHECK ("owner_decisions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "status_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_done" boolean NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "task_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"requirement" text NOT NULL,
	"source_url" text,
	"proof_url" text,
	"state" text DEFAULT 'NOT_RUN' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_requirements_state_check" CHECK ("task_requirements"."state" in ('PASS', 'FAIL', 'NOT_RUN', 'BLOCKED')),
	CONSTRAINT "task_requirements_pass_needs_proof" CHECK ("task_requirements"."state" <> 'PASS' or "task_requirements"."proof_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "task_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"note" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_sha" text,
	"pr_url" text,
	"source" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_updates_kind_check" CHECK ("task_updates"."kind" in ('progress', 'note', 'link', 'system')),
	CONSTRAINT "task_updates_source_check" CHECK ("task_updates"."source" is null or "task_updates"."source" in ('api', 'mcp', 'cli', 'hook', 'ui')),
	CONSTRAINT "task_updates_system_has_no_source" CHECK (("task_updates"."kind" = 'system') = ("task_updates"."source" is null))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_agents_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_tasks" ADD CONSTRAINT "engineering_tasks_agent_agents_id_fk" FOREIGN KEY ("agent") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_tasks" ADD CONSTRAINT "engineering_tasks_status_status_labels_id_fk" FOREIGN KEY ("status") REFERENCES "public"."status_labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency" ADD CONSTRAINT "idempotency_actor_agents_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_decisions" ADD CONSTRAINT "owner_decisions_recommended_by_agents_id_fk" FOREIGN KEY ("recommended_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_decisions" ADD CONSTRAINT "owner_decisions_requested_by_agents_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_decisions" ADD CONSTRAINT "owner_decisions_superseded_by_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."owner_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirements" ADD CONSTRAINT "task_requirements_task_id_engineering_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."engineering_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirements" ADD CONSTRAINT "task_requirements_updated_by_agents_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_task_id_engineering_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."engineering_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_status_status_labels_id_fk" FOREIGN KEY ("status") REFERENCES "public"."status_labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_feed_idx" ON "activity_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "activity_log_actor_feed_idx" ON "activity_log" USING btree ("actor","created_at","id");--> statement-breakpoint
CREATE INDEX "activity_log_entity_feed_idx" ON "activity_log" USING btree ("entity","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idempotency_created_idx" ON "idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_requirements_task_text_uq" ON "task_requirements" USING btree ("task_id","requirement");--> statement-breakpoint
CREATE INDEX "task_updates_feed_idx" ON "task_updates" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "task_updates_agent_feed_idx" ON "task_updates" USING btree ("agent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_updates_task_feed_idx" ON "task_updates" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_updates_source_feed_idx" ON "task_updates" USING btree ("source","created_at","id");