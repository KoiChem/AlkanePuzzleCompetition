import {afterEach,beforeEach,expect,test} from 'vitest';
import {fixture,credentials,settings} from './helpers';
let f:Awaited<ReturnType<typeof fixture>>;
beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f?.runtime.dispose();});
async function room(value:any=settings){const {data}=await f.create(value);expect(data.code).toBeTruthy();const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});const c=credentials();const s=await f.connect(data.code);await s.request(c);return {data,h,s,c,store:await f.storage(data.code)};}
test('deferred drafts survive eviction, remain ungraded, are editable, and grade once at submission',async()=>{
 const {data,h,s,c,store}=await room({...settings,gradingMode:'deferred'});await h.request({type:'start'});await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);
 const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);
 const command={type:'draft',seq:1,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}],advancedQuestionCount:1};
 let r=await s.request(command);expect(r.verdict).toBeUndefined();expect(r.state.own.correctCount).toBe(0);expect(r.state.own.answeredCount).toBe(1);expect(r.state.own.advancedQuestionCount).toBe(1);expect(JSON.stringify(r.state.deferred.questions)).not.toContain('canonical');
 expect((await s.request(command)).state.own.lastSeq).toBe(1);
 s.socket.close();await f.runtime.unsafeEvictDurableObject('alkane-test','AlkaneRoom',{name:data.code});const resumed=await f.connect(data.code);r=await resumed.request(c);expect(r.state.deferred.drafts[`${qs[0].id}:name`]).toBe(qs[0].answer.canonical);
 await resumed.request({type:'draft',seq:2,answers:[{questionId:qs[0].id,fieldId:'name',value:'{"tokens":[]}'}]});await resumed.request({type:'draft',seq:3,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});
 r=await resumed.request({type:'submit',seq:4});expect(r.state.results.own.correctCount).toBe(1);expect(r.state.results.own.finishReason).toBe('submitted');expect((await resumed.request({type:'submit',seq:4})).state.results.own.correctCount).toBe(1);
});
test('waiting controls rename, reject duplicates, remove a participant, edit settings and cancel without results',async()=>{
 const {data,h,s}=await room();const other=await f.connect(data.code);await other.request(credentials('別名'));expect((await s.request({type:'nickname',nickname:'別名'})).code).toBe('conflict');const renamed=await s.request({type:'nickname',nickname:'変更後'});expect(renamed.state.own.nickname).toBe('変更後');
 expect((await s.request({type:'settings',settings:{...settings,questionCount:10}})).code).toBe('forbidden');let r=await h.request({type:'settings',settings:{...settings,questionCount:10,gradingMode:'deferred'}});expect(r.state.room.settings.gradingMode).toBe('deferred');expect(r.state.room.maxScore).toBe(10);
 await h.request({type:'remove',participantId:renamed.state.own.id});expect((await h.request({type:'sync'})).state.room.participantCount).toBe(1);r=await h.request({type:'cancel'});expect(r.state.room.state).toBe('CANCELLED');expect(r.state.results).toBeUndefined();expect((await (await f.fetch(`/api/rooms/${data.code}/info`)).json() as any).room.state).toBe('CANCELLED');
});
test('participant results include only top-three ties and own review, never classmates answers',async()=>{
 const {h,s,store}=await room();for(let i=0;i<4;i++){const p=await f.connect((await h.request({type:'sync'})).state.room.code);await p.request(credentials(`他${i}`));}await h.request({type:'start'});await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);await h.request({type:'finish'});const r=await s.request({type:'sync'});expect(r.state.results.ranking).toHaveLength(5);expect(r.state.results.ranking.every((p:any)=>p.rank<=3)).toBe(true);expect(r.state.results.ranking.every((p:any)=>!('id'in p)&&!('lastSeq'in p))).toBe(true);expect(r.state.results.questions).toHaveLength(5);
});
test('a deferred edit captured just before cutoff is collected once, but post-cutoff edits are rejected',async()=>{
 const {h,s,store}=await room({...settings,gradingMode:'deferred'});await h.request({type:'start'});const cutoff=Date.now()-100;await store.exec('UPDATE room SET start_at=?,deadline_at=?',cutoff-60000,cutoff);const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);
 let r=await s.request({type:'draft',seq:1,capturedAtMs:cutoff-1,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});expect(r.state.room.state).toBe('COLLECTING');expect(r.state.own.correctCount).toBe(0);
 expect((await s.request({type:'draft',seq:2,capturedAtMs:cutoff+1,answers:[{questionId:qs[0].id,fieldId:'name',value:'{"tokens":[]}'}]})).code).toBe('not_running');
 r=await s.request({type:'submit',seq:2,final:true});expect(r.state.room.state).toBe('FINISHED');expect(r.state.results.own.correctCount).toBe(1);expect(r.state.results.own.elapsedCs).toBe(6000);expect(r.state.results.own.finishReason).toBe('timeout');expect((await s.request({type:'submit',seq:2,final:true})).state.results.own.correctCount).toBe(1);
});
test('deferred collection survives eviction and finishes without a final client submission',async()=>{
 const {data,h,s,c,store}=await room({...settings,gradingMode:'deferred'});await h.request({type:'start'});await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-60000,Date.now()+60000);const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);
 await s.request({type:'draft',seq:1,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});expect((await h.request({type:'finish'})).state.room.state).toBe('COLLECTING');s.socket.close();h.socket.close();await store.exec('UPDATE room SET ended_at=?',Date.now()-4000);await f.runtime.unsafeEvictDurableObject('alkane-test','AlkaneRoom',{name:data.code,webSockets:'hibernate'});
 const resumed=await f.connect(data.code);const r=await resumed.request(c);expect(r.state.room.state).toBe('FINISHED');expect(r.state.results.own.correctCount).toBe(1);expect(r.state.results.own.finalSyncUnconfirmed).toBe(true);expect(r.state.results.own.finishReason).toBe('interrupted');
});
test('a submission captured before the cutoff ends at server cutoff when delivered during collection',async()=>{
 const {h,s,store}=await room({...settings,gradingMode:'deferred'});await h.request({type:'start'});const cutoff=Date.now()-100;await store.exec('UPDATE room SET start_at=?,deadline_at=?',cutoff-60000,cutoff);const r=await s.request({type:'submit',seq:1,capturedAtMs:cutoff-500});expect(r.state.room.state).toBe('FINISHED');expect(r.state.results.own.elapsedCs).toBe(6000);expect(r.state.results.own.finishReason).toBe('submitted');expect(r.state.results.own.finalSyncUnconfirmed).toBe(false);
});
test('a late answer cannot roll back the automatic deadline finish',async()=>{
  const {data}=await f.create();const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});
  const s=await f.connect(data.code);await s.request(credentials());await h.request({type:'start'});
  const store=await f.storage(data.code);await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-60000,Date.now()-1);
  const r=await s.request({type:'pass',seq:1,questionId:'late',fieldId:'name'});
  expect(r.state.room.state).toBe('FINISHED');expect(r.code).toBe('not_running');
  expect((await store.exec('SELECT state FROM room')).rows[0].state).toBe('FINISHED');
});
test('an unknown room returns an explicit terminal error instead of endless socket retries',async()=>{
  const s=await f.connect('ZZZZZZ');const r=await s.request(credentials());
  expect(r.code).toBe('not_found');
});
test('server alarm finishes with no teacher connection and survives hibernation',async()=>{
  const {data}=await f.create();const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});
  const c=credentials();const s=await f.connect(data.code);await s.request(c);await h.request({type:'start'});h.socket.close();
  const store=await f.storage(data.code);await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-60000,Date.now()+500);
  await s.request({type:'hello',role:'participant',token:c.token,participantId:c.participantId}); // Already authenticated; no mutation.
  await f.runtime.unsafeEvictDurableObject('alkane-test','AlkaneRoom',{name:data.code,webSockets:'hibernate'});
  // Reconnect schedules the stored deadline, not a new timer from the client.
  const resumed=await f.connect(data.code);await resumed.request(c);
  await new Promise(resolve=>setTimeout(resolve,650));
  expect(resumed.messages.some(m=>m.type==='state'&&m.state.room.state==='FINISHED')).toBe(true);
});
test('usual review screen lets a student retry a passed field without exposing answers or scoring twice',async()=>{
 const {data}=await f.create();const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});const s=await f.connect(data.code);await s.request(credentials());await h.request({type:'start'});
 const store=await f.storage(data.code);await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);
 for(let i=0;i<5;i++)await s.request({type:'pass',seq:i+1,questionId:qs[i].id,fieldId:'name'});
 const review=await s.request({type:'review'});expect(review.state.room.state).toBe('RUNNING');expect(review.state.review.questions).toHaveLength(5);expect(JSON.stringify(review.state.review)).not.toContain('canonical');
 const wrong=await s.request({type:'answer',seq:6,questionId:qs[0].id,fieldId:'name',value:'{"tokens":[]}'});expect(wrong.state.own.correctCount).toBe(0);
 const retryReview=await s.request({type:'review'});expect(retryReview.state.review.fields[`${qs[0].id}:name`]).toBe('passedRetry');
 const retry={type:'answer',seq:7,questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical};const r=await s.request(retry);expect(r.state.own.correctCount).toBe(1);expect(r.state.own.questionIndex).toBe(5);expect((await s.request(retry)).state.own.correctCount).toBe(1);
 const done=await s.request({type:'submit',seq:8});expect(done.state.room.state).toBe('FINISHED');expect(done.state.results.own.correctCount).toBe(1);
});
test('authenticated sockets survive the initial 10 second handshake alarm',async()=>{
 const {data}=await f.create();const s=await f.connect(data.code);await s.request(credentials());const pending=await f.connect(data.code);let closed=false,pendingClosed=false;s.socket.addEventListener('close',()=>{closed=true;});pending.socket.addEventListener('close',()=>{pendingClosed=true;});await new Promise(resolve=>setTimeout(resolve,10200));expect(closed).toBe(false);expect((await s.request({type:'sync'})).type).toBe('ack');
},16000);
test('expiry alarm deletes room data and leaves common teacher settings intact',async()=>{
 const {data}=await f.create();const s=await f.connect(data.code);await s.request(credentials());const store=await f.storage(data.code);await store.exec('UPDATE room SET expires_at=?',Date.now()+300);const extra=await f.connect(data.code);await extra.request({type:'hello',role:'teacher',token:data.token});const until=Date.now()+3000;while((await store.exec('SELECT * FROM room')).rows.length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));expect((await store.exec('SELECT * FROM room')).rows).toHaveLength(0);expect((await store.exec('SELECT * FROM participants')).rows).toHaveLength(0);expect((await store.exec('SELECT * FROM answers')).rows).toHaveLength(0);expect((await f.fetch('/api/question-profile')).status).toBe(200);expect((await f.fetch(`/api/rooms/${data.code}/info`)).status).toBe(404);
});
