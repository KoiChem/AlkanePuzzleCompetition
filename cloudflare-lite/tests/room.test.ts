import {afterEach,beforeEach,expect,test} from 'vitest';
import {fixture,credentials,settings} from './helpers';
let f:Awaited<ReturnType<typeof fixture>>;
beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.runtime.dispose();});
async function start(kind='class'){
 const r=kind==='class'?(await f.create()).data:await (await f.fetch('/api/rooms',{method:'POST',headers:{origin:'https://lite.test'},body:JSON.stringify({kind:'mate',nickname:'ホスト',settings})})).json() as any;
 const h=await f.connect(r.code);await h.request({type:'hello',role:kind==='class'?'teacher':'mate-host',token:r.token});
 const c=credentials();const s=await f.connect(r.code);await s.request(c);await h.request({type:'start'});const store=await f.storage(r.code);await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);return {r,h,c,s,store};
}
test('mate creates anonymous host as participant, needs two and rejects fifth participant',async()=>{
 const anonymous=await fixture(false);try{
  const response=await anonymous.fetch('/api/rooms',{method:'POST',headers:{origin:'https://lite.test'},body:JSON.stringify({kind:'mate',nickname:'ホスト',settings})});expect(response.status).toBe(201);const data=await response.json() as any;
  const h=await anonymous.connect(data.code);const first=await h.request({type:'hello',role:'mate-host',token:data.token});expect(first.state.own.nickname).toBe('ホスト');expect(first.state.room.kind).toBe('mate');expect((await h.request({type:'start'})).code).toBe('no_participants');
  for(let i=0;i<3;i++){const s=await anonymous.connect(data.code);expect((await s.request(credentials('p'+i))).state.room.participantCount).toBe(i+2);}
  const fifth=await anonymous.connect(data.code);expect((await fifth.request(credentials())).code).toBe('room_full');
 }finally{await anonymous.runtime.dispose();}
});
test('class requires Google teacher session and rejects participant 51',async()=>{
 const anon=await fixture(false);try{expect((await anon.create()).response.status).toBe(401);}finally{await anon.runtime.dispose();}
 const {data}=await f.create();for(let i=0;i<50;i++){const s=await f.connect(data.code);expect((await s.request(credentials('p'+i))).type).toBe('ack');}const extra=await f.connect(data.code);expect((await extra.request(credentials())).code).toBe('room_full');
});
test('same answer replay cannot score twice and same seq with different body is rejected',async()=>{
 const {s,store}=await start();const q=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string)[0];const command={type:'answer',seq:1,questionId:q.id,fieldId:'name',value:q.answer.canonical};expect((await s.request(command)).state.own.correctCount).toBe(1);expect((await s.request(command)).state.own.correctCount).toBe(1);expect((await s.request({...command,value:'{"tokens":[]}'})).code).toBe('sequence_conflict');
});
test('drafts work in immediate mode and restoring socket preserves board',async()=>{
 const {r,s,c,store}=await start();const q=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string)[0];await s.request({type:'draft',seq:1,answers:[{questionId:q.id,fieldId:'name',value:'{"tokens":["メタン"]}'}]});const next=await f.connect(r.code);const restored=await next.request(c);expect(restored.state.drafts[q.id+':name']).toBe('{"tokens":["メタン"]}');expect((await next.request({type:'sync'})).state.own.lastSeq).toBe(1);
});
test('mate host can answer but cannot read teacher answer review',async()=>{
 const {h,s,store}=await start('mate');const q=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string)[0];expect((await h.request({type:'answer',seq:1,questionId:q.id,fieldId:'name',value:q.answer.canonical})).state.own.correctCount).toBe(1);await h.request({type:'finish'});expect((await h.request({type:'sync'})).state.results.reviews).toBeUndefined();expect((await s.request({type:'sync'})).state.results.questions).toHaveLength(5);
});
test('deferred progress falls when cleared and does not expose answers',async()=>{
 const {data}=await f.create({...settings,gradingMode:'deferred'});const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});const s=await f.connect(data.code);await s.request(credentials());await h.request({type:'start'});const st=await f.storage(data.code);await st.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);const q=JSON.parse((await st.exec('SELECT questions FROM room')).rows[0].questions as string)[0];let reply=await s.request({type:'draft',seq:1,answers:[{questionId:q.id,fieldId:'name',value:'{"tokens":["メタン"]}'}]});expect(reply.state.own.answeredCount).toBe(1);reply=await s.request({type:'draft',seq:2,answers:[{questionId:q.id,fieldId:'name',value:'{"tokens":[]}'}]});expect(reply.state.own.answeredCount).toBe(0);expect((await s.request({type:'sync'})).state.results).toBeUndefined();
});
test('immediate draft cannot advance the frontier or accept future answers',async()=>{
 const {s,store}=await start();const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);
 expect((await s.request({type:'draft',seq:1,advancedQuestionCount:5,answers:[{questionId:qs[0].id,fieldId:'name',value:'{"tokens":[]}'}]})).code).toBe('invalid_question');
 expect((await s.request({type:'draft',seq:1,answers:[{questionId:qs[1].id,fieldId:'name',value:qs[1].answer.canonical}]})).code).toBe('stale_question');
 expect((await s.request({type:'sync'})).state.own.questionIndex).toBe(0);
});
test('mate host credential cannot be used as a second participant connection',async()=>{
 const {r}=await start('mate');const other=await f.connect(r.code);expect((await other.request({type:'hello',role:'participant',participantId:r.participantId,token:r.token,nickname:'別名'})).code).toBe('unauthorized');
});
test('deferred collection accepts pre-cutoff drafts and rejects impossible timestamps',async()=>{
 const {data}=await f.create({...settings,gradingMode:'deferred'});const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});const s=await f.connect(data.code);await s.request(credentials());await h.request({type:'start'});const st=await f.storage(data.code);const startAt=Date.now()-1000;await st.exec('UPDATE room SET start_at=?,deadline_at=?',startAt,Date.now()+60000);const q=JSON.parse((await st.exec('SELECT questions FROM room')).rows[0].questions as string)[0];await h.request({type:'finish'});
 const command={type:'draft',seq:1,answers:[{questionId:q.id,fieldId:'name',value:q.answer.canonical}]};expect((await s.request({...command,capturedAtMs:startAt-1})).code).toBe('not_running');expect((await s.request({...command,capturedAtMs:Date.now()+5000})).code).toBe('not_running');expect((await s.request({...command,capturedAtMs:startAt+100})).type).toBe('ack');expect((await s.request({type:'submit',seq:2,final:true})).state.results.own.correctCount).toBe(1);
});
