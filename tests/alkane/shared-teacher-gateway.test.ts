import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { PostgresDatabase } from '../../src/platform/postgres-database';
import { createSupabaseGateway } from '../../src/platform/supabase-gateway';

let pg:PGlite;
let now=Date.now();
let allowed=true;
let unavailable=false;
let user:any={id:'11111111-1111-4111-8111-111111111111',email:'teacher@example.com',email_confirmed_at:'2026-10-04',is_anonymous:false,identities:[{provider:'google'}]};
const origin='https://koichem.github.io';
const gateway=createSupabaseGateway({
  transact:async<T>(_scope:string,run:(db:PostgresDatabase)=>Promise<T>)=>pg.transaction(tx=>run(new PostgresDatabase((q,v)=>tx.query(q,v)))),
  verifyUser:async()=>user,masterEmail:'master@example.com',allowedOrigins:[origin],flush:async()=>{},now:()=>now,
  sharedTeacher:{authorize:async()=>{if(unavailable)throw new Error('authority_unavailable');return {allowed,master:false,email:'teacher@example.com',revision:0};},
    allowlist:async()=>new Response(null,{status:403})},
});
function request(path:string){return new Request('https://project.supabase.co/functions/v1/competition'+path,{headers:{origin,authorization:'Bearer local-token'}});}
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(readFileSync('supabase/migrations/202610010001_core.sql','utf8'));
  await pg.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE SCHEMA realtime;CREATE TABLE realtime.messages(extension text);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;`);
  for(const file of ['202610010002_auth_realtime.sql','202610010003_permissions_maintenance.sql','202610040001_teacher_leases.sql'])
    await pg.exec(readFileSync('supabase/migrations/'+file,'utf8'));
});
afterAll(async()=>pg.close());

it('refreshes a local teacher lease only after the central decision and revokes on denial',async()=>{
  expect((await gateway(request('/api/teacher/session'))).status).toBe(200);
  let row=(await pg.query<{active:boolean;lease_until_ms:number}>('SELECT active,lease_until_ms FROM app_teacher_bindings WHERE uid=$1',[user.id])).rows[0];
  expect(row.active).toBe(true);expect(Number(row.lease_until_ms)).toBe(now+60_000);
  allowed=false;
  expect((await gateway(request('/api/teacher/session'))).status).toBe(403);
  row=(await pg.query<{active:boolean;lease_until_ms:number}>('SELECT active,lease_until_ms FROM app_teacher_bindings WHERE uid=$1',[user.id])).rows[0];
  expect(row.active).toBe(false);expect(Number(row.lease_until_ms)).toBe(0);
});
it('fails closed on central outage while anonymous student requests continue',async()=>{
  unavailable=true;
  expect((await gateway(request('/api/teacher/session'))).status).toBe(503);
  user={id:'22222222-2222-4222-8222-222222222222',is_anonymous:true,identities:[]};
  expect((await gateway(request('/api/public-config'))).status).toBe(200);
  unavailable=false;
});
