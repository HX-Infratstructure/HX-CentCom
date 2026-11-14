import { queryOptions } from '@tanstack/react-query';
import { getTaskWorkspace } from './tasks.functions';
import type { Database } from '@/integrations/supabase/types';
export type Task=Database['public']['Tables']['engineering_tasks']['Row'];
export const tasksQuery=queryOptions({queryKey:['task-workspace'],queryFn:()=>getTaskWorkspace(),refetchInterval:30000});
export const agents=[
 {id:'CC1',name:'Claude Code 01',role:'Implementation · Lane A',tone:'green',state:'1 complete',assignment:'D3 adapter / Agent Lab',count:'2 assignments'},
 {id:'CC2',name:'Claude Code 02',role:'Qualification · Lane B',tone:'sky',state:'In progress',assignment:'Stage 2 qualification',count:'1 tracked outcome'},
 {id:'OpenCode',name:'OpenCode',role:'DeepSeek harness · Rebuild',tone:'amber',state:'Waiting',assignment:'DeepAgents source-led rebuild',count:'1 assignment'},
 {id:'Agent Zero',name:'Agent Zero',role:'Owner · Governance',tone:'stone',state:'Owner review',assignment:'Merge & deployment decisions',count:'6 open pull requests'},
];
export function agentFor(id:string){return agents.find(a=>a.id===id)??{id,name:id,role:'Assignment pending',tone:'stone',state:'Waiting',assignment:'Owner assignment needed',count:'Unassigned'};}
export function filterTasks(tasks:Task[],agent:string,search:string,tab:string){return tasks.filter(t=>(!agent || t.agent===agent) && `${t.title} ${t.agent} ${t.repository} ${t.id} ${t.host}`.toLowerCase().includes(search.toLowerCase()) && (tab==='All updates' || tab==='All tasks' || (tab==='Needs attention' && t.status==='Waiting') || (tab==='Completed' && t.status==='Complete') || (tab==='In progress' && t.status==='In progress') || (tab==='Blocked' && t.status==='Blocked')));}
export function ganttPosition(start:string,end:string,rangeStart:string,days:number){const day=86400000;const offset=(Date.parse(start)-Date.parse(rangeStart))/day;const duration=(Date.parse(end)-Date.parse(start))/day+1;const left=Math.max(0,Math.min(days,offset));const endOffset=Math.min(days,offset+duration);return {left:left/days*100,width:Math.max(0,endOffset-left)/days*100};}
