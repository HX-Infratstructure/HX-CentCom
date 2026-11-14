CREATE TABLE public.engineering_tasks (
 id text PRIMARY KEY,
 title text NOT NULL,
 agent text NOT NULL,
 repository text NOT NULL,
 host text NOT NULL,
 commit_sha text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting','In progress','Complete','Blocked')),
 progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
 start_date date NOT NULL,
 due_date date NOT NULL,
 note text NOT NULL DEFAULT '',
 source_url text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (due_date >= start_date)
);
GRANT SELECT ON public.engineering_tasks TO anon, authenticated;
GRANT UPDATE (progress,status,note,updated_at) ON public.engineering_tasks TO authenticated;
GRANT ALL ON public.engineering_tasks TO service_role;
ALTER TABLE public.engineering_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public imported engineering records" ON public.engineering_tasks FOR SELECT TO anon,authenticated USING (true);
CREATE TABLE public.task_editors (user_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.task_editors TO authenticated;
GRANT ALL ON public.task_editors TO service_role;
ALTER TABLE public.task_editors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Editors read own membership" ON public.task_editors FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "Authorized editors update progress" ON public.engineering_tasks FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.task_editors WHERE user_id=auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.task_editors WHERE user_id=auth.uid()));
CREATE TABLE public.task_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id text NOT NULL REFERENCES public.engineering_tasks(id),
 agent text NOT NULL,
 progress integer NOT NULL,
 status text NOT NULL,
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.task_updates TO anon,authenticated;
GRANT ALL ON public.task_updates TO service_role;
ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public task update history" ON public.task_updates FOR SELECT TO anon,authenticated USING (true);
CREATE FUNCTION public.record_task_progress() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 NEW.updated_at=now();
 INSERT INTO public.task_updates(task_id,agent,progress,status,note) VALUES(NEW.id,NEW.agent,NEW.progress,NEW.status,NEW.note);
 RETURN NEW;
END; $$;
CREATE TRIGGER record_task_progress BEFORE UPDATE ON public.engineering_tasks FOR EACH ROW EXECUTE FUNCTION public.record_task_progress();
INSERT INTO public.engineering_tasks(id,title,agent,repository,host,commit_sha,status,progress,start_date,due_date,note,source_url) VALUES
('IRP-04','Semantic controller · Stage 2 qualification','CC2','HX-Semantic-Router','HX-18','fc08970','In progress',0,'2026-11-10','2026-11-18','Stage 2 Run 1: 254 / 254 requests passed. Concurrent Run 2 acceptance remains separate. Progress percentage has not been reported.','https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846416722'),
('IRP-05','D3 adapter · O-5(c) closeout','CC1','HX-Semantic-Router','HX-4 / HX-18','19c9085','Complete',100,'2026-11-09','2026-11-13','Repository outcome complete. Deployment authorization remains separate.','https://github.com/HX-Infratstructure/HX-Semantic-Router'),
('HX12-01','DeepAgents · source-led rebuild','OpenCode','HX-Langchain-DeepAgent','HX-12','','Waiting',0,'2026-11-13','2026-11-21','OpenCode / DeepSeek Harness. Source head is unpinned; verification needed.','https://github.com/HX-Infratstructure/HX-Langchain-DeepAgent'),
('RO-01','Qdrant · live acceptance','Unassigned','HX-Qdrant','HX-10','68053f0','Waiting',0,'2026-11-14','2026-11-20','Live acceptance evidence is waiting. Owner assignment is needed.','https://github.com/HX-Infratstructure/HX-Qdrant'),
('IRP-UI','Agent Lab · run contract & model picker','CC1','HX-Agent-Lab','HX-15','06475ac','Waiting',0,'2026-11-14','2026-11-22','UI work is not completed in the saved record.','https://github.com/HX-Infratstructure/HX-Agent-Lab'),
('HX14-02','n8n · Phase 2','Unassigned','HX-n8n','HX-14','','Waiting',0,'2026-11-16','2026-11-24','Phase 2 is waiting. Source head is unpinned.','https://github.com/HX-Infratstructure/HX-n8n');