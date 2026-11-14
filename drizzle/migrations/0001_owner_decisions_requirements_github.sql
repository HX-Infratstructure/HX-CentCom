ALTER TABLE public.engineering_tasks ADD COLUMN blocked_on text NOT NULL DEFAULT 'none' CHECK (blocked_on IN ('owner_decision','assignment','dependency','none'));
GRANT UPDATE (blocked_on) ON public.engineering_tasks TO authenticated;
ALTER TABLE public.task_editors ADD COLUMN agent text;
ALTER TABLE public.task_updates ADD COLUMN editor_id uuid;
DROP POLICY "Authorized editors update progress" ON public.engineering_tasks;
CREATE POLICY "Editors update their agent's tasks" ON public.engineering_tasks FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.task_editors e WHERE e.user_id=auth.uid() AND e.agent=engineering_tasks.agent))
 WITH CHECK (EXISTS (SELECT 1 FROM public.task_editors e WHERE e.user_id=auth.uid() AND e.agent=engineering_tasks.agent));
CREATE OR REPLACE FUNCTION public.record_task_progress() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 NEW.updated_at=now();
 INSERT INTO public.task_updates(task_id,agent,progress,status,note,editor_id) VALUES(NEW.id,NEW.agent,NEW.progress,NEW.status,NEW.note,auth.uid());
 RETURN NEW;
END; $$;

CREATE TABLE public.task_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id text NOT NULL REFERENCES public.engineering_tasks(id),
 requirement text NOT NULL,
 source_url text NOT NULL DEFAULT '',
 proof_url text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'NOT_RUN' CHECK (state IN ('PASS','FAIL','NOT_RUN','BLOCKED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.task_requirements TO anon, authenticated;
GRANT ALL ON public.task_requirements TO service_role;
ALTER TABLE public.task_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public requirement coverage" ON public.task_requirements FOR SELECT TO anon,authenticated USING (true);

CREATE TABLE public.owner_editors (user_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.owner_editors TO authenticated;
GRANT ALL ON public.owner_editors TO service_role;
ALTER TABLE public.owner_editors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner editors read own membership" ON public.owner_editors FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE TABLE public.owner_decisions (
 id text PRIMARY KEY,
 question text NOT NULL,
 subject text NOT NULL,
 gate_type text NOT NULL CHECK (gate_type IN ('merge','deploy','live_run','host','scope','assignment','policy')),
 options jsonb NOT NULL DEFAULT '[]'::jsonb,
 blocks text[] NOT NULL DEFAULT '{}',
 requested_by text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Decided','Deferred','Superseded')),
 decision_text text,
 decision_source_url text,
 decided_at timestamptz,
 superseded_by text REFERENCES public.owner_decisions(id),
 CHECK (status <> 'Decided' OR coalesce(decision_source_url,'') <> '')
);
GRANT SELECT ON public.owner_decisions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.owner_decisions TO authenticated;
GRANT ALL ON public.owner_decisions TO service_role;
ALTER TABLE public.owner_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public owner decisions" ON public.owner_decisions FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY "Owner editors insert decisions" ON public.owner_decisions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.owner_editors WHERE user_id=auth.uid()));
CREATE POLICY "Owner editors update decisions" ON public.owner_decisions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.owner_editors WHERE user_id=auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.owner_editors WHERE user_id=auth.uid()));

CREATE TABLE public.github_prs (
 id bigint PRIMARY KEY,
 repo text NOT NULL,
 number integer NOT NULL,
 title text NOT NULL,
 state text NOT NULL,
 draft boolean NOT NULL DEFAULT false,
 head_sha text NOT NULL,
 merge_commit_sha text,
 url text NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.github_prs TO anon, authenticated;
GRANT ALL ON public.github_prs TO service_role;
ALTER TABLE public.github_prs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public pull request snapshot" ON public.github_prs FOR SELECT TO anon,authenticated USING (true);
CREATE TABLE public.github_repos (
 name text PRIMARY KEY,
 default_branch text NOT NULL,
 head_sha text NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.github_repos TO anon, authenticated;
GRANT ALL ON public.github_repos TO service_role;
ALTER TABLE public.github_repos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public repository heads" ON public.github_repos FOR SELECT TO anon,authenticated USING (true);

UPDATE public.engineering_tasks SET commit_sha='fc08970', note='PR #16 merged 5680553, PR #18 merged fc08970, API 1.2', source_url='https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161', blocked_on='none' WHERE id='IRP-05';
UPDATE public.engineering_tasks SET commit_sha='d1d5371', note='PR #19 in fix round; Run 2 needs PR #19 merge, deploy GO and Run 2 GO', blocked_on='owner_decision' WHERE id='IRP-04';
UPDATE public.engineering_tasks SET status='Complete', progress=100, note='Agent Lab UI and model picker merged and deployed; MVP 3 WU1-WU3 merged (main 06475ac); next lane A assignment is an owner decision', blocked_on='none' WHERE id='IRP-UI';
UPDATE public.engineering_tasks SET blocked_on='assignment' WHERE id IN ('RO-01','HX14-02');
UPDATE public.engineering_tasks SET blocked_on='dependency' WHERE id='HX12-01';

INSERT INTO public.task_requirements(task_id,requirement,source_url,proof_url,state) VALUES
('IRP-04','Stage 2 Run 1 sequential: 254 / 254 requests','https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10','https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846416722','PASS'),
('IRP-04','PR #19 merged after fix round','https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/19','','BLOCKED'),
('IRP-04','Stage 2 Run 2 concurrent acceptance','https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10','','NOT_RUN'),
('IRP-05','PR #16 merged (5680553)','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161','PASS'),
('IRP-05','PR #18 merged (fc08970), API 1.2 kept','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161','PASS');

INSERT INTO public.owner_decisions(id,question,subject,gate_type,options,blocks,requested_by,requested_at,status,decision_text,decision_source_url,decided_at) VALUES
('D-01','Merge PR #19 after CC2''s fix round?','HX-Semantic-Router PR #19','merge','[{"label":"Merge after fix round","description":"Merge once CC2 fixes land and review passes","recommended":true,"recommended_by":"Codex"},{"label":"Hold","description":"Keep open","recommended":false}]','{IRP-04}','CC2','2026-11-13T15:00Z','Pending',NULL,NULL,NULL),
('D-02','Merge PR #20?','HX-Semantic-Router PR #20','merge','[{"label":"Merge","recommended":true,"recommended_by":"Codex"},{"label":"Hold","recommended":false}]','{IRP-04}','CC2','2026-11-13T16:00Z','Pending',NULL,NULL,NULL),
('D-03','Exact-release deploy GO, then Run 2 GO (GO-4)?','HX-Semantic-Router exact release on HX-18','deploy','[{"label":"Deploy GO then Run 2 GO","description":"Deploy the exact release SHA, then authorize Run 2","recommended":true,"recommended_by":"CC2"},{"label":"Defer","recommended":false}]','{IRP-04}','CC2','2026-11-13T17:00Z','Pending',NULL,NULL,NULL),
('D-04','Optional GO-5: HX-4 read-only snapshots?','HX-4 · read-only snapshots','host','[{"label":"Approve read-only snapshots","recommended":false},{"label":"Skip","recommended":false}]','{}','CC1','2026-11-13T14:00Z','Pending',NULL,NULL,NULL),
('D-05','GO-6: O-5(c) server-side scope?','O-5(c) server-side scope','scope','[{"label":"Approve server-side scope","recommended":false},{"label":"Keep client-side","recommended":false}]','{}','CC1','2026-11-13T13:00Z','Pending',NULL,NULL,NULL),
('D-06','F4: HX-2 unattended-upgrade restart policy?','HX-2 · unattended-upgrade restart policy','policy','[{"label":"Allow automatic restarts","recommended":false},{"label":"Require manual restart","recommended":false}]','{}','Codex','2026-11-12T18:00Z','Pending',NULL,NULL,NULL),
('D-07','Who owns MVP 6?','MVP 6 owner','assignment','[]','{}','Agent Zero','2026-11-12T16:00Z','Pending',NULL,NULL,NULL),
('D-08','Ratify the 54 PR #12 acceptance rows and R5-G14?','HX-Semantic-Router PR #12 · 54 acceptance rows + R5-G14','policy','[{"label":"Ratify","recommended":true,"recommended_by":"Codex"},{"label":"Request changes","recommended":false}]','{IRP-04}','Codex','2026-11-12T12:00Z','Pending',NULL,NULL,NULL),
('D-09','Merge PR #83?','HX-Repo-Optimization PR #83','merge','[{"label":"Merge","recommended":false},{"label":"Hold","recommended":false}]','{}','Codex','2026-11-13T12:00Z','Pending',NULL,NULL,NULL),
('D-10','Next lane A assignment?','Lane A · Agent Lab / MVP 3','assignment','[{"label":"Agent Lab / MVP 3","recommended":false}]','{}','CC1','2026-11-13T18:00Z','Pending',NULL,NULL,NULL),
('D-11','Delete remote branches wu5b/hx4-native-d3-pilot-tools and mvp5/o5c-slot-until-workers-exit?','Remote branches · wu5b/hx4-native-d3-pilot-tools, mvp5/o5c-slot-until-workers-exit','policy','[{"label":"Delete both","recommended":false},{"label":"Keep","recommended":false}]','{}','Codex','2026-11-13T11:00Z','Pending',NULL,NULL,NULL),
('D-12','Merge PR #16?','HX-Semantic-Router PR #16','merge','[]','{IRP-05}','CC1','2026-11-11T12:00Z','Decided','Merged as 5680553.','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161','2026-11-12T12:00Z'),
('D-13','Merge PR #18 and keep API 1.2?','HX-Semantic-Router PR #18','merge','[]','{IRP-05}','CC1','2026-11-12T12:00Z','Decided','Merged as fc08970; API 1.2 kept.','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/issues/15#issuecomment-6871127161','2026-11-13T10:00Z'),
('D-14','Merge PR #17?','HX-Semantic-Router PR #17','merge','[]','{}','CC2','2026-11-12T12:00Z','Decided','Merged as d1d5371.','https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/17','2026-11-13T11:00Z'),
('D-15','Merge IRR PR #32?','HX-Intelligent-Request-Routing PR #32','merge','[]','{}','CC1','2026-11-12T12:00Z','Decided','Merged as d9f487f.','https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/32','2026-11-13T12:00Z'),
('D-16','Standing directive','HX-Semantic-Router #10','policy','[]','{}','Agent Zero','2026-11-13T09:00Z','Decided','Standing directive recorded in HX-SR #10.','https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6870997761','2026-11-13T09:00Z');