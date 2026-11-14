import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

const ORG='HX-Infratstructure';
export const Route=createFileRoute('/api/public/jobs/github-sync')({server:{handlers:{POST:async({request})=>{
 const authFailure=await authenticateCronRequest(request); if(authFailure) return authFailure;
 const token=process.env['GITHUB_READONLY_TOKEN']; if(!token) return Response.json({error:'GITHUB_READONLY_TOKEN is not configured'},{status:500});
 const gh=async(path:string)=>{const res=await fetch(`https://api.github.com/${path}`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'User-Agent':'hx-agent-dashboard'}});if(!res.ok) throw new Error(`GitHub ${path} [${res.status}]: ${await res.text()}`);return res.json();};
 try{
  const repos=await gh(`orgs/${ORG}/repos?per_page=100`) as {name:string;default_branch:string;archived:boolean}[];
  const prRows:Record<string,unknown>[]=[];const repoRows:Record<string,unknown>[]=[];const now=new Date().toISOString();
  for(const r of repos.filter(r=>!r.archived)){
   const [pulls,commit]=await Promise.all([gh(`repos/${ORG}/${r.name}/pulls?state=open&per_page=100`) as Promise<{id:number;number:number;title:string;state:string;draft:boolean;head:{sha:string};merge_commit_sha:string|null;html_url:string}[]>,gh(`repos/${ORG}/${r.name}/commits/${encodeURIComponent(r.default_branch)}`).catch(()=>null) as Promise<{sha:string}|null>]);
   if(commit) repoRows.push({name:r.name,default_branch:r.default_branch,head_sha:commit.sha,fetched_at:now});
   for(const p of pulls) prRows.push({id:p.id,repo:r.name,number:p.number,title:p.title,state:p.state,draft:p.draft,head_sha:p.head.sha,merge_commit_sha:p.merge_commit_sha,url:p.html_url,fetched_at:now});
  }
  const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
  if(repoRows.length){const {error}=await supabaseAdmin.from('github_repos').upsert(repoRows as never);if(error) throw error;}
  if(prRows.length){const {error}=await supabaseAdmin.from('github_prs').upsert(prRows as never);if(error) throw error;}
  // PRs no longer returned as open were closed or merged since the last sync.
  const {error:closeErr}=await supabaseAdmin.from('github_prs').update({state:'closed'}).eq('state','open').lt('fetched_at',now);if(closeErr) throw closeErr;
  return Response.json({repos:repoRows.length,openPrs:prRows.length});
 }catch(e){console.error(e);return Response.json({error:String(e instanceof Error?e.message:e)},{status:502});}
}}}});
