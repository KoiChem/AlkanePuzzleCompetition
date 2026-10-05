import {afterEach, describe, expect, it} from 'vitest';
import {SqliteD1} from '../persistence/helpers';
import {saveParticipantDrafts, readParticipantDrafts} from '../../src/persistence/participant-drafts';
const dbs:SqliteD1[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
function fixture(){const db=new SqliteD1();dbs.push(db);db.setNow(1000);
 db.sqlite.exec(`INSERT INTO rooms(id,public_id,join_code,kind,owner_teacher_id,settings_json,game_id,game_version,dataset_version,state,revision,max_score,created_at_ms,start_at_ms,deadline_at_ms,expires_at_ms) VALUES('r','r','code','class','teacher','{}','alkane-puzzle','2','1','COUNTDOWN',1,5,0,100,10000,99999);`);
 db.sqlite.exec(`INSERT INTO participants(id,room_id,token_hash,nickname,nickname_key,joined_order,status,revision,joined_at_ms) VALUES('p','r','hash','p','p',1,'ACTIVE',0,0);`);
 db.sqlite.exec(`INSERT INTO v2_room_manifests(room_id,manifest_id,evaluator_version,grading_mode,preparation_generation,state,settings_revision,settings_json,prepared_at_ms) VALUES('r','m','v','immediate',1,'COUNTDOWN',1,'{}',0); INSERT INTO v2_participant_progress(room_id,participant_id,writer_epoch) VALUES('r','p',1);`);
 db.sqlite.exec(`INSERT INTO room_questions(room_id,question_id,ordinal,public_payload_json,answer_snapshot_json,field_spec_json,max_score) VALUES('r','q',0,'{}','{}','[]',1);`); return db;}
const input={roomId:'r',participantId:'p',manifestId:'m',writerEpoch:1,nowMs:1000,items:[{questionId:'q',fieldId:'formula' as const,version:2,value:{grid:[[null,{type:1,rot:0}]]},editedElapsedMs:800}]};
describe('latest participant drafts',()=>{
 it('restores latest JSON and does not overwrite it with an older retry',async()=>{const db=fixture(); await saveParticipantDrafts(db,input); await saveParticipantDrafts(db,{...input,items:[{...input.items[0],version:1,value:{grid:[]}}]}); const rows=await readParticipantDrafts(db,'r','p');expect(rows['q:formula'].value).toEqual(input.items[0].value);expect(rows['q:formula'].version).toBe(2);});
 it('rejects wrong manifest/writer and edits at or after deadline',async()=>{const db=fixture(); await expect(saveParticipantDrafts(db,{...input,writerEpoch:2})).rejects.toMatchObject({code:'stale_writer'});await expect(saveParticipantDrafts(db,{...input,manifestId:'old'})).rejects.toMatchObject({code:'stale_manifest'});await expect(saveParticipantDrafts(db,{...input,nowMs:10000})).rejects.toMatchObject({code:'deadline'});});
});
