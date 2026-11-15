-- Widens the action CHECK by task.create, an agent registering its own work as a task (F-TASKS). Additive: every
-- earlier action stays, so the previous release still writes its rows.
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action_check";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action_check" CHECK ("activity_log"."action" in ('task.create', 'task.progress', 'requirement.set', 'decision.request', 'decision.decide', 'key.issue', 'key.revoke', 'key.bootstrap', 'raid.create', 'raid.update', 'lesson.create', 'lesson.update', 'activity.revert'));
