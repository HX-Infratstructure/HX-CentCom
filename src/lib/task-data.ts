import { queryOptions } from '@tanstack/react-query';
import { getTaskWorkspace } from './tasks.functions';
import type { Database } from '@/integrations/supabase/types';
type T<N extends keyof Database['public']['Tables']>=Database['public']['Tables'][N]['Row'];
export type Task=T<'engineering_tasks'>;
export type Requirement=T<'task_requirements'>;
export type Decision=T<'owner_decisions'>;
export type PullRequest=T<'github_prs'>;
export type RepoHead=T<'github_repos'>;
export type DecisionOption={label:string;description?:string;recommended?:boolean;recommended_by?:string};
export const tasksQuery=queryOptions({queryKey:['task-workspace'],queryFn:()=>getTaskWorkspace(),refetchInterval:30000});
export const agents=[
 {id:'CC1',name:'Claude Code 01',role:'Implementation · Lane A',tone:'green'},
 {id:'CC2',name:'Claude Code 02',role:'Qualification · Lane B',tone:'sky'},
 {id:'OpenCode',name:'OpenCode',role:'DeepSeek harness · Rebuild',tone:'amber'},
 {id:'Codex',name:'Codex',role:'Independent architect & verifier',tone:'violet'},
 {id:'Agent Zero',name:'Agent Zero',role:'Owner · Governance',tone:'stone'},
];
export function agentFor(id:string){return agents.find(a=>a.id===id)??{id,name:id,role:'Assignment pending',tone:'stone'};}
export function needsAttention(t:Pick<Task,'status'|'blocked_on'>){return t.status==='Blocked' || t.status==='Waiting' || (t.blocked_on!=='none' && t.status!=='Complete');}
export function filterTasks(tasks:Task[],agent:string,search:string,tab:string){return tasks.filter(t=>(!agent || t.agent===agent) && `${t.title} ${t.agent} ${t.repository} ${t.id} ${t.host}`.toLowerCase().includes(search.toLowerCase()) && (tab==='All updates' || tab==='All tasks' || (tab==='Needs attention' && needsAttention(t)) || (tab==='Completed' && t.status==='Complete') || (tab==='In progress' && t.status==='In progress') || (tab==='Blocked' && t.status==='Blocked')));}
export function ganttPosition(start:string,end:string,rangeStart:string,days:number){const day=86400000;const offset=(Date.parse(start)-Date.parse(rangeStart))/day;const duration=(Date.parse(end)-Date.parse(start))/day+1;const left=Math.max(0,Math.min(days,offset));const endOffset=Math.min(days,offset+duration);return {left:left/days*100,width:Math.max(0,endOffset-left)/days*100};}
export function coverage(taskId:string,reqs:Requirement[]){const r=reqs.filter(x=>x.task_id===taskId);return {proven:r.filter(x=>x.state==='PASS').length,total:r.length};}
export function coverageLabel(t:Task,reqs:Requirement[]){const c=coverage(t.id,reqs);return c.total?`${c.proven} of ${c.total} proven`:`${t.progress}% reported`;}
export function pendingDecisions(ds:Decision[]){return ds.filter(d=>d.status==='Pending').sort((a,b)=>b.blocks.length-a.blocks.length || Date.parse(a.requested_at)-Date.parse(b.requested_at));}
export function recommended(d:Decision){return ((d.options as DecisionOption[]|null)??[]).find(o=>o.recommended);}
export function ageLabel(iso:string,now=Date.now()){const h=Math.max(0,Math.floor((now-Date.parse(iso))/3600000));return h<24?`${h}h`:`${Math.floor(h/24)}d`;}
const same=(a:string,b?:string|null)=>!!a && !!b && (b.startsWith(a)||a.startsWith(b));
/** A task is stale when GitHub data exists for its repo and its SHA matches neither the repo head nor any PR head/merge commit. */
export function isStale(t:Task,repos:RepoHead[],prs:PullRequest[]){if(!t.commit_sha)return false;const repo=repos.find(r=>r.name===t.repository);if(!repo)return false;if(same(t.commit_sha,repo.head_sha))return false;return !prs.some(p=>p.repo===t.repository && (same(t.commit_sha,p.head_sha)||same(t.commit_sha,p.merge_commit_sha)));}
export function openPrs(prs:PullRequest[]){return prs.filter(p=>p.state==='open');}
export function agentCard(id:string,tasks:Task[],prs:PullRequest[],decisions:Decision[]){
 if(id==='Agent Zero'){const p=pendingDecisions(decisions).length;const o=openPrs(prs).length;return {state:p?`${p} pending decisions`:'Clear',assignment:'Merge & deployment decisions',count:`${o} open pull requests`,waiting:p>0};}
 const mine=tasks.filter(t=>t.agent===id);const done=mine.filter(t=>t.status==='Complete').length;const active=mine.filter(t=>t.status==='In progress').length;const attn=mine.filter(needsAttention).length;
 const req=decisions.filter(d=>d.status==='Pending' && d.requested_by===id).length;
 const state=attn?`${attn} need attention`:active?`${active} in progress`:done?`${done} complete`:req?`${req} decisions requested`:'No assignments';
 const current=mine.find(t=>t.status!=='Complete')??mine[0];
 return {state,assignment:current?.title??(req?`${req} owner requests open`:'No saved assignment'),count:`${mine.length} assignment${mine.length===1?'':'s'}`,waiting:attn>0};
}
