import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { PostgresDatabase } from '../../src/platform/postgres-database';
import { createSupabaseGateway } from '../../src/platform/supabase-gateway';
let pg:PGlite;
const origin='https://koichem.github.io';
const master={id:'11111111-1111-4111-8111-111111111111',email:'teacher@example.com',email_confirmed_at:'2026-10-01',is_anonymous:false,identities:[{provider:'google'}]};
let currentUser:any=master;
const transact=async<T>(_scope:string,run:(db:PostgresDatabase)=>Promise<T>)=>pg.transaction(tx=>run(new PostgresDatabase(async(q,v)=>{try{return await tx.query(q,v)}catch(e){console.error(q,e);throw e;}})));
const gateway=createSupabaseGateway({transact,verifyUser:async()=>currentUser,masterEmail:'teacher@example.com',allowedOrigins:[origin],flush:async()=>{}});
function req(path:string,body?:unknown,token?:string,method=body?'POST':'GET'){
  return new Request('https://project.supabase.co/functions/v1/competition'+path,{method,headers:{origin,authorization:'Bearer auth','content-type':'application/json','x-competition-csrf':'1',...(token?{'x-participant-authorization':`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
}
beforeAll(async()=>{
 pg=new PGlite();await pg.exec(readFileSync('supabase/migrations/202610010001_core.sql','utf8'));
 await pg.exec(`CREATE ROLE authenticated;CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA realtime; CREATE TABLE realtime.messages(extension text); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.topic',true) $$;`);
 await pg.exec(readFileSync('supabase/migrations/202610010002_auth_realtime.sql','utf8'));
 await pg.exec(readFileSync('supabase/migrations/202610010003_permissions_maintenance.sql','utf8')); await pg.exec(readFileSync('supabase/migrations/202610020001_question_profiles.sql','utf8'));
});
afterAll(async()=>pg.close());
it('rejects untrusted origins and anonymous teacher impersonation',async()=>{
 expect((await gateway(new Request('https://project.supabase.co/functions/v1/competition/api/teacher/session',{headers:{origin:'https://evil.example'}}))).status).toBe(403);
 currentUser={...master,is_anonymous:true};
 expect((await gateway(req('/api/teacher/session'))).status).toBe(401);
 currentUser=master;
 expect((await gateway(req('/api/teacher/session'))).status).toBe(200);
});
it('binds participants by token and rotates topics when their identity is recovered',async()=>{
 currentUser=master;
 const settings={questionCount:5,timeLimitMinutes:3,mode:'ion',difficulty:'normal',ionAnswer:'formula',compoundPrompts:{formula:true,name:false},compoundAnswer:'formula',gradingMode:'immediate'};
 const create=await gateway(req('/api/class-rooms',{requestId:crypto.randomUUID(),settings}));
 expect(create.status,await create.clone().text()).toBe(201);
 const {room}=await create.json();
 const token='A'.repeat(43);currentUser={id:'22222222-2222-4222-8222-222222222222',is_anonymous:true};
 const join=await gateway(req(`/api/rooms/${room.id}/join`,{requestId:crypto.randomUUID(),nickname:'生徒'},token));
 expect(join.status,await join.clone().text()).toBe(201);
 const snapshot=await gateway(req(`/api/rooms/${room.id}/state`,undefined,token));
 const snapshotBody=await snapshot.json();
 expect(snapshotBody.serverTiming.receivedAtMs).toBeLessThanOrEqual(snapshotBody.serverTiming.sentAtMs);
 expect(Number.isSafeInteger(snapshotBody.serverTiming.receivedAtMs)).toBe(true);
 const topics=await gateway(req(`/api/rooms/${room.id}/realtime`,undefined,token));
 expect(topics.status,await topics.clone().text()).toBe(200);
 const first=await topics.json();expect(first.host).toBeNull();
 const unauthorized=await gateway(req(`/api/rooms/${room.id}/realtime`));expect(unauthorized.status).toBe(401);
 currentUser={id:'33333333-3333-4333-8333-333333333333',is_anonymous:true};
 const rebound=await gateway(req(`/api/rooms/${room.id}/realtime`,undefined,token));
 expect(rebound.status,await rebound.clone().text()).toBe(200);
 expect((await rebound.json()).epoch).toBe(first.epoch+1);
});
it('enforces private topic membership and denies direct table reads',async()=>{
 const rooms=await pg.query<{public_id:string;id:string}>('SELECT public_id,id FROM rooms LIMIT 1');const room=rooms.rows[0];
 const epoch=(await pg.query<{epoch:number}>('SELECT epoch FROM app_room_topics WHERE room_id=$1',[room.id])).rows[0].epoch;
 const control=`room:${room.public_id}:control:${epoch}`;
 const host=`room:${room.public_id}:host:${epoch}`;
 async function can(uid:string,topic:string){return pg.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE authenticated');
  await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);
  return (await tx.query<{allowed:boolean}>('SELECT public.app_can_subscribe($1) AS allowed',[topic])).rows[0].allowed;
 });}
 expect(await can('33333333-3333-4333-8333-333333333333',control)).toBe(true);
 expect(await can('22222222-2222-4222-8222-222222222222',control)).toBe(false);
 expect(await can('33333333-3333-4333-8333-333333333333',host)).toBe(false);
 expect(await can(master.id,host)).toBe(true);
 await expect(pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE authenticated');await tx.query('SELECT token_hash FROM participants');})).rejects.toThrow(/permission denied/);
});
