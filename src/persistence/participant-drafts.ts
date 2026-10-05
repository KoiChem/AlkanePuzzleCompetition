import {PersistenceConflictError, json, type PersistenceDatabase} from './db';
export type DraftItem={questionId:string;fieldId:'formula'|'name';version:number;value:unknown;editedElapsedMs:number};
export type SavedDraft={value:unknown;editedElapsedMs:number;version:number;writerEpoch:number};
export async function readParticipantDrafts(db:PersistenceDatabase,roomId:string,participantId:string):Promise<Record<string,SavedDraft>>{
 const {results}=await db.prepare('SELECT question_id,field_id,value_json,version,writer_epoch,edited_elapsed_ms FROM participant_drafts WHERE room_id=? AND participant_id=?').bind(roomId,participantId).all<{question_id:string;field_id:string;value_json:string;version:number;writer_epoch:number;edited_elapsed_ms:number}>();
 return Object.fromEntries(results.map(row=>[`${row.question_id}:${row.field_id}`,{value:JSON.parse(row.value_json),version:row.version,writerEpoch:row.writer_epoch,editedElapsedMs:row.edited_elapsed_ms}]));
}
export async function saveParticipantDrafts(db:PersistenceDatabase,input:{roomId:string;participantId:string;manifestId:string;writerEpoch:number;nowMs:number;items:readonly DraftItem[]}){
 const state=await db.prepare(`SELECT m.manifest_id,m.state,m.cutoff_at_ms,r.start_at_ms,r.deadline_at_ms,r.expires_at_ms,v.writer_epoch,v.finished_elapsed_ms FROM rooms r JOIN v2_room_manifests m ON m.room_id=r.id JOIN v2_participant_progress v ON v.room_id=r.id AND v.participant_id=? JOIN participants p ON p.room_id=v.room_id AND p.id=v.participant_id WHERE r.id=? AND p.status='ACTIVE'`).bind(input.participantId,input.roomId).first<{manifest_id:string;state:string;cutoff_at_ms:number|null;start_at_ms:number|null;deadline_at_ms:number|null;expires_at_ms:number;writer_epoch:number;finished_elapsed_ms:number|null}>();
 if(!state)throw new PersistenceConflictError('not_authorized','参加資格を確認できません',403);
 if(state.manifest_id!==input.manifestId)throw new PersistenceConflictError('stale_manifest','問題が更新されています');
 if(state.writer_epoch!==input.writerEpoch)throw new PersistenceConflictError('stale_writer','別のタブが解答しています');
 const cutoff=state.cutoff_at_ms??state.deadline_at_ms;
 if(state.state!=='COUNTDOWN'||state.start_at_ms==null||input.nowMs<state.start_at_ms||cutoff==null||input.nowMs>=cutoff||state.expires_at_ms<=input.nowMs||state.finished_elapsed_ms!==null)throw new PersistenceConflictError('deadline','途中解答の保存受付は終了しています');
 if(input.items.length>15)throw new TypeError('too many drafts');
 for(const item of input.items)if(!Number.isSafeInteger(item.version)||item.version<1||!Number.isSafeInteger(item.editedElapsedMs)||item.editedElapsedMs<0||item.editedElapsedMs>input.nowMs-state.start_at_ms+250||item.editedElapsedMs>=cutoff-state.start_at_ms)throw new TypeError('invalid draft time or version');
 await db.batch(input.items.map(item=>db.prepare(`INSERT INTO participant_drafts(room_id,participant_id,question_id,field_id,manifest_id,writer_epoch,version,value_json,edited_elapsed_ms,updated_at_ms)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms r JOIN v2_room_manifests m ON m.room_id=r.id JOIN v2_participant_progress v ON v.room_id=r.id AND v.participant_id=? WHERE r.id=? AND m.manifest_id=? AND m.state='COUNTDOWN' AND v.writer_epoch=? AND v.finished_elapsed_ms IS NULL AND CAST(unixepoch('subsec') * 1000 AS INTEGER)<r.deadline_at_ms)
 ON CONFLICT(room_id,participant_id,question_id,field_id) DO UPDATE SET manifest_id=excluded.manifest_id,writer_epoch=excluded.writer_epoch,version=excluded.version,value_json=excluded.value_json,edited_elapsed_ms=excluded.edited_elapsed_ms,updated_at_ms=excluded.updated_at_ms
 WHERE participant_drafts.manifest_id<>excluded.manifest_id OR participant_drafts.writer_epoch<excluded.writer_epoch OR (participant_drafts.writer_epoch=excluded.writer_epoch AND participant_drafts.version<excluded.version)`)
 .bind(input.roomId,input.participantId,item.questionId,item.fieldId,input.manifestId,input.writerEpoch,item.version,json(item.value),item.editedElapsedMs,input.nowMs,input.participantId,input.roomId,input.manifestId,input.writerEpoch)));
 const saved=await readParticipantDrafts(db,input.roomId,input.participantId);
 return {versions:Object.fromEntries(Object.entries(saved).map(([key,row])=>[key,row.version]))};
}
