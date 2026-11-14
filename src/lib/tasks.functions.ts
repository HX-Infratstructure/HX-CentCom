import { createServerFn } from '@tanstack/react-start';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';

export const getTaskWorkspace = createServerFn({ method: 'GET' }).handler(async () => {
 const key=process.env['SUPABASE_PUBLISHABLE_KEY']; const url=process.env['SUPABASE_URL'];
 if(!key || !url) throw new Error('Task storage is unavailable.');
 const client=createClient<Database>(url,key,{auth:{persistSession:false},global:{fetch:(input,init)=>{const headers=new Headers(init?.headers); if(key.startsWith('sb_') && headers.get('Authorization')===`Bearer ${key}`) headers.delete('Authorization');headers.set('apikey',key);return fetch(input,{...init,headers});}}});
 const [{data:tasks,error},{data:updates,error:updateError}]=await Promise.all([client.from('engineering_tasks').select('*').order('start_date'),client.from('task_updates').select('*').order('created_at',{ascending:false}).limit(100)]);
 if(error || updateError) throw new Error('Could not load engineering records.');
 return {tasks:tasks??[],updates:updates??[]};
});
export const updateTaskProgress=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:{id:string;progress:number;status:string;note:string})=>{
 if(!input.id || !Number.isInteger(input.progress) || input.progress<0 || input.progress>100 || !['Waiting','In progress','Complete','Blocked'].includes(input.status) || input.note.trim().length<3 || input.note.length>2000) throw new Error('Enter a valid progress update and a short note.');
 return {...input,note:input.note.trim()};
}).handler(async({data,context})=>{
 const {data:task,error}=await context.supabase.from('engineering_tasks').update({progress:data.progress,status:data.status,note:data.note}).eq('id',data.id).select().maybeSingle();
 if(error || !task) throw new Error('This account is not authorized to update project tasks.');
 return task;
});
