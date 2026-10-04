import type { PersistenceDatabase } from '../persistence/db';
import { reservedEventCost } from '../web/realtime-policy';
export type RoomFingerprint = {control:string;progress:string};
async function readRoom(db:PersistenceDatabase,publicId:string){
  return db.prepare(`SELECT r.id,r.public_id,r.kind,r.state,r.revision,r.owner_teacher_id,r.mate_host_id,r.settings_json,r.start_at_ms,r.deadline_at_ms,r.expires_at_ms,
    m.state AS manifest_state,m.preparation_generation,m.cutoff_at_ms,m.collection_until_ms
    FROM rooms r LEFT JOIN v2_room_manifests m ON m.room_id=r.id WHERE r.public_id=?`).bind(publicId).first<Record<string,any>>();
}
async function readParticipants(db:PersistenceDatabase,id:string){
  return (await db.prepare(`SELECT p.id,p.nickname,p.status,p.joined_order,p.current_ordinal,p.correct_count,p.resolved_question_count,p.revision,p.elapsed_cs,p.timing_source,
    COALESCE(v.answered_count,0) AS answered_count,v.finished_elapsed_ms,v.ready_generation
    FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id=p.room_id AND v.participant_id=p.id
    WHERE p.room_id=? ORDER BY p.joined_order,p.id`).bind(id).all<Record<string,any>>()).results;
}
export async function roomFingerprint(db:PersistenceDatabase,publicId:string):Promise<RoomFingerprint|null>{
  const r=await readRoom(db,publicId);if(!r)return null;
  const participants=await readParticipants(db,r.id);
  return {control:JSON.stringify([r.state,r.manifest_state,r.settings_json,r.start_at_ms,r.deadline_at_ms,r.cutoff_at_ms,r.collection_until_ms,
    participants.map(p=>[p.id,p.nickname,p.status,p.ready_generation])]),
    progress:JSON.stringify(participants.map(p=>[p.id,p.correct_count,p.answered_count,p.revision,p.finished_elapsed_ms]))};
}
export async function queueRoomEvents(db:PersistenceDatabase,publicId:string,before:RoomFingerprint|null,now:number){
  const next=await roomFingerprint(db,publicId);const room=await readRoom(db,publicId);if(!room||!next)return;
  const kinds:('control'|'host')[]=[];
  if(!before||before.control!==next.control)kinds.push('control');
  if(!before||before.progress!==next.progress)kinds.push('host');
  if(!kinds.length)return;
  const topic=await db.prepare('UPDATE app_room_topics SET progress_revision=progress_revision+1,control_revision=control_revision+1 WHERE room_id=? RETURNING epoch,progress_revision,control_revision').bind(room.id).first<{epoch:number;progress_revision:number;control_revision:number}>();
  if(!topic)return;
  for(const kind of kinds){
    const event:any={eventId:crypto.randomUUID(),roomId:publicId,epoch:topic.epoch,revision:kind==='host'?topic.progress_revision:topic.control_revision,serverNow:now,roomRevision:room.revision};
    if(kind==='host'){
      const people=await readParticipants(db,room.id);
      event.participants=people.filter(p=>p.status!=='REMOVED').map(p=>({id:p.id,joinedOrder:p.joined_order,nickname:p.nickname,status:p.status,currentOrdinal:p.current_ordinal,
        correctCount:p.correct_count,resolvedQuestionCount:p.resolved_question_count,answeredCount:p.answered_count,revision:p.revision,elapsedCs:p.elapsed_cs,timingSource:p.timing_source,submitted:p.finished_elapsed_ms!=null}));
    }else{event.phase=room.manifest_state??room.state;event.startAtMs=room.start_at_ms;event.deadlineAtMs=room.deadline_at_ms;event.cutoffAtMs=room.cutoff_at_ms;event.collectionUntilMs=room.collection_until_ms;}
    await db.prepare(`INSERT INTO app_outbox(room_id,kind,revision,payload_json,event_id) VALUES(?,?,?,?,?)
      ON CONFLICT(room_id,kind) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,event_id=excluded.event_id`)
      .bind(room.id,kind,event.revision,JSON.stringify(event),event.eventId).run();
  }
}
export type BroadcastSender=(topic:string,event:string,payload:unknown)=>Promise<void>;
export async function flushRoomEvents(transact:<T>(scope:string,run:(db:PersistenceDatabase)=>Promise<T>)=>Promise<T>,publicId:string,send:BroadcastSender,now=Date.now()){
  const claimed=await transact(`broadcast:${publicId}`,async db=>{
    const room=await readRoom(db,publicId);if(!room||room.expires_at_ms<=now)return [];
    const topic=await db.prepare('SELECT epoch,sent_control_ms,sent_progress_ms FROM app_room_topics WHERE room_id=?').bind(room.id).first<any>();
    const pending=(await db.prepare(`SELECT * FROM app_outbox WHERE room_id=? AND lease_until_ms<? ORDER BY CASE kind WHEN 'control' THEN 0 ELSE 1 END`).bind(room.id,now).all<any>()).results;
    const recipients=await db.prepare(`SELECT count(*) AS count FROM participants WHERE room_id=? AND status<>'REMOVED'`).bind(room.id).first<{count:number}>();
    const hosts=1;const result=[];
    for(const event of pending){
      if(now-(event.kind==='host'?topic.sent_progress_ms:topic.sent_control_ms)<1000)continue;
      const cost=reservedEventCost(event.kind==='host'?hosts:Number(recipients?.count??0)+(room.kind==='mate'?0:1));
      // This singleton row serializes the project-wide weighted fanout budget.
      const budget=await db.prepare('SELECT window_ms,used FROM app_broadcast_budget WHERE id=1 FOR UPDATE').first<any>();
      const window=Math.floor(now/1000)*1000;const used=budget.window_ms===window?budget.used:0;
      if(used+cost>90)continue;
      await db.prepare('UPDATE app_broadcast_budget SET window_ms=?,used=? WHERE id=1').bind(window,used+cost).run();
      const lease=crypto.randomUUID();
      await db.prepare('UPDATE app_outbox SET lease_id=?,lease_until_ms=? WHERE room_id=? AND kind=?').bind(lease,now+5000,room.id,event.kind).run();
      result.push({...event,lease,topic:`room:${publicId}:${event.kind==='host'?'host':'control'}:${topic.epoch}`,epoch:topic.epoch});
    }
    return result;
  });
  for(const event of claimed){
    try{
      const payload=JSON.parse(event.payload_json);
      if(payload.epoch!==event.epoch)continue;
      // A revoke committed after claim must prevent sending to the old topic.
      await transact(`room:${publicId}`,async db=>{
        const current=await db.prepare('SELECT epoch FROM app_room_topics WHERE room_id=? FOR UPDATE').bind(event.room_id).first<{epoch:number}>();
        if(current?.epoch!==event.epoch)return;
        await send(event.topic,event.kind==='host'?'host.progress':'room.changed',payload);
        await db.prepare('DELETE FROM app_outbox WHERE room_id=? AND kind=? AND event_id=? AND lease_id=?').bind(event.room_id,event.kind,event.event_id,event.lease).run();
        await db.prepare(`UPDATE app_room_topics SET ${event.kind==='host'?'sent_progress_ms':'sent_control_ms'}=? WHERE room_id=?`).bind(now,event.room_id).run();
      });
    }catch{await transact(`broadcast:${publicId}`,async db=>{await db.prepare('UPDATE app_outbox SET lease_until_ms=0 WHERE room_id=? AND kind=? AND lease_id=?').bind(event.room_id,event.kind,event.lease).run();});}
  }
}
