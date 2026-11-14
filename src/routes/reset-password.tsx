import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Workspace } from '@/components/workspace';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
export const Route=createFileRoute('/reset-password')({head:()=>({meta:[{title:'HX · Reset password'},{name:'description',content:'Choose a new HX workspace password.'},{property:'og:title',content:'HX · Reset password'},{property:'og:description',content:'Reset your engineering workspace password securely.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary'}]}),component:Reset});
function Reset(){const [password,setPassword]=useState('');const [message,setMessage]=useState('');const navigate=useNavigate();async function save(e:FormEvent){e.preventDefault();const {error}=await supabase.auth.updateUser({password});if(error)setMessage(error.message);else await navigate({to:'/tasks'});}return <Workspace><main className="auth-page"><h1>New password</h1><form className="progress-form" onSubmit={save}><label>Password<input type="password" minLength={8} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><Button type="submit">Save password</Button><p role="status">{message}</p></form></main></Workspace>;}
