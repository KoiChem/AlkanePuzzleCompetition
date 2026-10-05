import { postgresTransactions } from './postgres-runtime';
import { createSupabaseGateway } from './supabase-gateway';
import { verifySupabaseUser } from './supabase-identity';
import { flushRoomEvents } from './realtime-outbox';
import { createSharedTeacherClient } from './shared-teacher-client';
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void};
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Missing backend configuration: ${name}`);return value;};
const url=required('SUPABASE_URL');
const key=required('SUPABASE_ANON_KEY');
const serviceKey=required('SUPABASE_SERVICE_ROLE_KEY');
const databaseUrl=required('COMPETITION_DATABASE_URL');
const transact=postgresTransactions(databaseUrl);
const authorityUrl=Deno.env.get('SHARED_TEACHER_AUTHORITY_URL');
const authoritySecret=Deno.env.get('SHARED_TEACHER_HMAC_SECRET');
const sharedTeacher=authorityUrl&&authoritySecret?createSharedTeacherClient({
  url:authorityUrl,appId:'alkane-puzzle-competition',secret:authoritySecret,
}):undefined;
async function flush(publicId:string){
  await flushRoomEvents(transact,publicId,async(topic,event,payload)=>{
    const result=await fetch(`${url}/realtime/v1/api/broadcast`,{method:'POST',headers:{authorization:`Bearer ${serviceKey}`,apikey:serviceKey,'content-type':'application/json'},
      body:JSON.stringify({messages:[{topic,event,payload,private:true}]}),signal:AbortSignal.timeout(3000)});
    if(!result.ok)throw new Error('Broadcast delivery failed');
  });
}
const gateway=createSupabaseGateway({transact,verifyUser:request=>verifySupabaseUser(request,url,key),masterEmail:required('MASTER_TEACHER_EMAIL'),
  allowedOrigins:required('ALLOWED_ORIGINS').split(',').map(x=>x.trim()).filter(Boolean),sharedTeacher,flush:async id=>{EdgeRuntime.waitUntil(flush(id));}});
Deno.serve(gateway);
