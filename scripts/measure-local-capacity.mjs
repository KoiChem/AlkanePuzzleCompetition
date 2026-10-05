// Local PGlite sizing model only. Never connects to Supabase or reads secrets.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

const compiled = await build({entryPoints:['src/games/alkane-puzzle/server/question-generator.ts'],
  bundle:true,platform:'node',format:'esm',write:false});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`;
const { generateQuestionSet } = await import(moduleUrl);
const tracked = ['rooms','room_questions','participants','participant_drafts','v2_operations',
  'v2_final_fields','v2_participant_progress','v2_room_manifests','final_results','app_memberships','app_room_topics'];
const day=24*60*60*1000;

async function sizes(pg){
  const result={};
  for(const name of tracked){
    const row=(await pg.query(`SELECT pg_total_relation_size($1::regclass) AS bytes`,[`public.${name}`])).rows[0];
    result[name]=Number(row.bytes);
  }
  return result;
}
async function sample(mode){
  const pg=new PGlite();
  try{
    await pg.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE SCHEMA realtime;CREATE TABLE realtime.messages(extension text);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;`);
    await pg.exec(readFileSync('docs/SUPABASE_INITIAL_SETUP.sql','utf8'));
    const baseline=await sizes(pg);
    let seed=mode==='arrange'?91:117;
    const random=()=>((seed=(seed*1664525+1013904223)>>>0)/0x100000000);
    const settings={mode,difficulty:'medium',alcoholEnabled:true,questionCount:15,timeLimitMinutes:5,gradingMode:'immediate'};
    const questions=generateQuestionSet(settings,random);
    const roomId=`capacity-${mode}`;
    const now=Date.now();
    let jsonBytes=0;
    await pg.transaction(async tx=>{
      await tx.query(`INSERT INTO rooms(id,public_id,join_code,kind,owner_teacher_id,settings_json,game_id,game_version,dataset_version,
        state,max_score,created_at_ms,ended_at_ms,expires_at_ms)
        VALUES($1,$1,$2,'class','capacity-teacher',$3,'alkane-puzzle','2','v1','FINISHED',15,$4,$4,$5)`,
        [roomId,`join-${mode}`,JSON.stringify(settings),now,now+14*day]);
      await tx.query(`INSERT INTO app_room_topics(room_id) VALUES($1)`,[roomId]);
      await tx.query(`INSERT INTO v2_room_manifests(room_id,state,manifest_id,evaluator_version,grading_mode,settings_revision,settings_json,prepared_at_ms,finalized_at_ms)
        VALUES($1,'FINISHED','capacity-manifest','v1','immediate',1,$2,$3,$3)`,[roomId,JSON.stringify(settings),now]);
      for(const q of questions){
        const publicPayload=JSON.stringify({id:q.id,ordinal:q.ordinal,prompt:q.prompt,fields:q.fields});
        const answerSnapshot=JSON.stringify(q);
        const fields=JSON.stringify(q.fields);
        jsonBytes+=Buffer.byteLength(publicPayload)+Buffer.byteLength(answerSnapshot)+Buffer.byteLength(fields);
        await tx.query(`INSERT INTO room_questions(room_id,question_id,ordinal,public_payload_json,answer_snapshot_json,field_spec_json,max_score)
          VALUES($1,$2,$3,$4,$5,$6,1)`,[roomId,q.id,q.ordinal,publicPayload,answerSnapshot,fields]);
      }
      for(let person=1;person<=42;person++){
        const participantId=`participant-${person}`;
        const uid=`auth-${mode}-${person}`;
        await tx.query(`INSERT INTO participants(room_id,id,token_hash,nickname,nickname_key,joined_at_ms,joined_order,status,current_ordinal,correct_count,resolved_question_count)
          VALUES($1,$2,$3,$4,$5,$6,$7,'FINISHED',15,15,15)`, [roomId,participantId,person.toString(16).padStart(64,'0'),`生徒${person}`,`student${person}`,now,person]);
        await tx.query(`INSERT INTO app_memberships(room_id,participant_id,uid) VALUES($1,$2,$3)`,[roomId,participantId,uid]);
        await tx.query(`INSERT INTO v2_participant_progress(room_id,participant_id,ack_seq,accepted_seq,answered_count,last_elapsed_ms,finished_elapsed_ms)
          VALUES($1,$2,16,16,15,300000,300000)`,[roomId,participantId]);
        await tx.query(`INSERT INTO final_results(room_id,participant_id,correct_count,elapsed_cs,rank,finish_reason)
          VALUES($1,$2,15,30000,$3,'completed')`,[roomId,participantId,person]);
        for(const q of questions){
          const answer=q.answer.canonical;
          const payload=JSON.stringify({seq:q.ordinal+1,operationId:`op-${person}-${q.ordinal}`,type:'answer',questionId:q.id,fieldId:q.fields[0].id,value:JSON.parse(answer),elapsedMs:1000+q.ordinal});
          jsonBytes+=Buffer.byteLength(answer)*2+Buffer.byteLength(payload);
          await tx.query(`INSERT INTO participant_drafts(room_id,participant_id,question_id,field_id,manifest_id,writer_epoch,version,value_json,edited_elapsed_ms,updated_at_ms)
            VALUES($1,$2,$3,$4,'capacity-manifest',1,1,$5,1000,$6)`,[roomId,participantId,q.id,q.fields[0].id,answer,now]);
          await tx.query(`INSERT INTO v2_operations(room_id,participant_id,seq,operation_id,payload_json,elapsed_ms,accepted_for_score,received_at_ms)
            VALUES($1,$2,$3,$4,$5,$6,1,$7)`,[roomId,participantId,q.ordinal+1,`op-${person}-${q.ordinal}`,payload,1000+q.ordinal,now]);
          await tx.query(`INSERT INTO v2_final_fields(room_id,participant_id,question_id,field_id,state,answer_json)
            VALUES($1,$2,$3,$4,'correct',$5)`,[roomId,participantId,q.id,q.fields[0].id,answer]);
        }
      }
    });
    const after=await sizes(pg);
    const byTable=Object.fromEntries(tracked.map(name=>[name,after[name]-baseline[name]]));
    const relationBytes=Object.values(byTable).reduce((sum,value)=>sum+value,0);
    return {mode,difficulty:'medium',alcoholEnabled:true,participants:42,questions:15,
      relationBytes,jsonPayloadBytes:jsonBytes,byTable,
      estimated14DayRelationBytesAtOneRoomPerDay:relationBytes*14,
      estimated14DayRelationBytesAtTenRoomsPerDay:relationBytes*140};
  }finally{await pg.close();}
}

const output={kind:'local-pglite-storage-model',generatedAt:new Date().toISOString(),
  excludes:['Supabase Auth','Realtime','WAL','backups','Edge logs','concurrent room overhead','platform quotas'],
  samples:[await sample('arrange'),await sample('name')]};
process.stdout.write(JSON.stringify(output,null,2)+'\n');
