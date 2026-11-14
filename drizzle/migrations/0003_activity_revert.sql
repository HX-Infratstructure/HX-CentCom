-- Widens the action CHECK by activity.revert, the owner's revert of a logged write (F5). drizzle-kit also emitted a
-- drop and re-add of activity_log_entity_check, because 0001_snapshot.json still held the four-entity list; 0002
-- already applied the six-entity list, so that pair is removed here, and 0003_snapshot.json records both CHECKs as the
-- database holds them.
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action_check";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action_check" CHECK ("activity_log"."action" in ('task.progress', 'requirement.set', 'decision.request', 'decision.decide', 'key.issue', 'key.revoke', 'key.bootstrap', 'raid.create', 'raid.update', 'lesson.create', 'lesson.update', 'activity.revert'));
