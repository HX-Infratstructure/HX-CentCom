-- SPEC §3: activity_log is append-only. The database refuses changes from every client, not only the services.
CREATE FUNCTION activity_log_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_reject_change();
