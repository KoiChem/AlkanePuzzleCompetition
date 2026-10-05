import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let pg:PGlite;
const day=24*60*60*1000;
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE SCHEMA realtime;CREATE TABLE realtime.messages(extension text);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;`);
  // This is the exact administrator SQL handoff, not a reconstructed test schema.
  await pg.exec(readFileSync('docs/SUPABASE_INITIAL_SETUP.sql','utf8'));
});
afterAll(async()=>pg.close());

async function seedRoom(id:string,endedAt:number,expiresAt:number){
  await pg.query(`INSERT INTO rooms(id,public_id,join_code,kind,owner_teacher_id,settings_json,game_id,game_version,dataset_version,
    state,max_score,created_at_ms,ended_at_ms,expires_at_ms) VALUES($1,$1,$2,'class','teacher-uid',$3,'alkane','2','v1','FINISHED',5,$4,$5,$6)`,
    [id,`code-${id}`,JSON.stringify({mode:'arrange',difficulty:'easy',alcoholEnabled:false,questionCount:5,timeLimitMinutes:5}),endedAt-day,endedAt,expiresAt]);
  await pg.query(`INSERT INTO participants(room_id,id,token_hash,nickname,nickname_key,joined_at_ms,joined_order)
    VALUES($1,'student-uid','hash','生徒','student',$2,1)`,[id,endedAt-day]);
  await pg.query(`INSERT INTO room_questions(room_id,question_id,ordinal,public_payload_json,answer_snapshot_json,field_spec_json,max_score)
    VALUES($1,'question-1',0,'{}','{}','{}',1)`,[id]);
  await pg.query(`INSERT INTO participant_drafts(room_id,participant_id,question_id,field_id,manifest_id,writer_epoch,version,value_json,edited_elapsed_ms,updated_at_ms)
    VALUES($1,'student-uid','question-1','formula','manifest-1',1,1,'{"grid":[]}',100,$2)`,[id,endedAt]);
}

it('loads all ordered migrations and prunes 14-day expired results with drafts by cascade',async()=>{
  const now=Date.now();
  await seedRoom('expired-room',now-14*day-1,now-1);
  await seedRoom('current-room',now-13*day,now+day);
  await pg.query(`INSERT INTO teacher_allowlist(id,emails_json) VALUES(1,'["teacher@example.com"]')`);
  const result=await pg.query<{removed:number}>('SELECT public.app_prune_expired_rooms(100) AS removed');
  expect(Number(result.rows[0].removed)).toBe(1);
  expect((await pg.query<{id:string}>('SELECT id FROM rooms ORDER BY id')).rows.map(x=>x.id)).toEqual(['current-room']);
  expect((await pg.query<{room_id:string}>('SELECT room_id FROM participant_drafts')).rows.map(x=>x.room_id)).toEqual(['current-room']);
  expect((await pg.query<{emails_json:string}>('SELECT emails_json FROM teacher_allowlist WHERE id=1')).rows[0].emails_json).toBe('["teacher@example.com"]');
});

it('rejects unsafe cleanup bounds and direct authenticated access',async()=>{
  await expect(pg.query('SELECT public.app_prune_expired_rooms(1001)')).rejects.toThrow(/invalid batch limit/);
  expect((await pg.query<{permitted:boolean}>(`SELECT has_table_privilege('authenticated','participant_drafts','SELECT') AS permitted`)).rows[0].permitted).toBe(false);
  await expect(pg.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE authenticated');
    return tx.query('SELECT public.app_prune_expired_rooms(100)');
  })).rejects.toThrow(/permission denied/);
});
