import {afterEach,beforeEach,expect,test} from 'vitest';
import {fixture,credentials,settings} from './helpers';
let f:Awaited<ReturnType<typeof fixture>>;
beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.runtime.dispose();});
async function room(gradingMode='deferred',kind='class'){
 const data=kind==='class'?(await f.create({...settings,gradingMode})).data:await(await f.fetch('/api/rooms',{method:'POST',headers:{origin:'https://lite.test'},body:JSON.stringify({kind:'mate',nickname:'ホスト',settings:{...settings,gradingMode}})})).json() as any;
 const h=await f.connect(data.code);await h.request({type:'hello',role:kind==='class'?'teacher':'mate-host',token:data.token});
 const c=credentials('解答者'),s=await f.connect(data.code);await s.request(c);const c2=credentials('待機者'),other=await f.connect(data.code);await other.request(c2);
 await h.request({type:'start'});const store=await f.storage(data.code);const start=Date.now()-1000;await store.exec('UPDATE room SET start_at=?,deadline_at=?',start,Date.now()+60000);
 const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions as string);return{data,h,c,s,c2,other,store,start,qs};
}
test('reopening keeps answers, unlocks correct fields, and latest submission sets elapsed time',async()=>{
 const {h,s,other,store,qs}=await room();
 await s.request({type:'draft',seq:1,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});
 const submitted=await s.request({type:'submit',seq:2});expect(submitted.state.own.finished).toBe(true);
 await store.exec('UPDATE participants SET finished_at=? WHERE nickname=?',Date.now()-500,'解答者');const originalElapsed=(await s.request({type:'sync'})).state.own.elapsedCs;
 const reopened=await s.request({type:'reopen',seq:3});expect(reopened.type).toBe('ack');expect(reopened.state.own.finished).toBe(false);expect(reopened.state.own.lastSeq).toBe(3);expect(reopened.state.drafts[`${qs[0].id}:name`]).toBe(qs[0].answer.canonical);expect(reopened.state.deferred.questions).toHaveLength(5);
 const host=await h.request({type:'sync'});expect(host.state.participants.find((p:any)=>p.nickname==='解答者').finished).toBe(false);
 const edited=await s.request({type:'draft',seq:4,answers:[{questionId:qs[0].id,fieldId:'name',value:'{"tokens":[]}'}]});expect(edited.state.own.answeredCount).toBe(0);
 await other.request({type:'submit',seq:1});await store.exec('UPDATE participants SET finished_at=? WHERE nickname=?',Date.now()-200,'待機者');const done=await s.request({type:'submit',seq:5});expect(done.state.room.state).toBe('FINISHED');expect(done.state.results.own.correctCount).toBe(0);expect(done.state.results.own.rank).toBe(2);expect(done.state.results.own.elapsedCs).toBeGreaterThan(originalElapsed);expect(done.state.results.questions[0].fields[0].state).toBe('unanswered');
});
test('submitted scores and field correctness stay private until results are final',async()=>{
 const {h,s,qs}=await room();await s.request({type:'draft',seq:1,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});
 const submitted=await s.request({type:'submit',seq:2});expect(submitted.state.own.correctCount).toBe(0);
 const host=await h.request({type:'sync'});expect(host.state.participants.every((p:any)=>p.correctCount===0)).toBe(true);
 const review=await s.request({type:'review'});expect(review.state.review).toBeUndefined();expect(review.state.question).toBeUndefined();expect(review.state.results).toBeUndefined();
});
test('reopen replay survives reload, does not erase subsequent edits and never reopens final results',async()=>{
 const {data,s,c,other,store,qs}=await room();await s.request({type:'submit',seq:1});const command={type:'reopen',seq:2};expect((await s.request(command)).type).toBe('ack');
 const resumed=await f.connect(data.code);const restored=await resumed.request(c);expect(restored.state.own.finished).toBe(false);expect(restored.state.lastOperation).toEqual({seq:2,body:JSON.stringify(command)});
 expect((await resumed.request(command)).state.own.lastSeq).toBe(2);await resumed.request({type:'draft',seq:3,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});expect((await resumed.request(command)).code).toBe('sequence_conflict');
 await resumed.request({type:'submit',seq:4});await other.request({type:'submit',seq:1});expect((await resumed.request({type:'reopen',seq:5})).code).toBe('not_running');expect((await store.exec('SELECT finished_at FROM participants WHERE nickname=?','解答者')).rows[0].finished_at).not.toBeNull();
});
test.each(['immediate','mate','not-submitted','teacher','deadline','interrupted'])('reopen is rejected for %s',async condition=>{
 const {h,s,store}=await room(condition==='immediate'?'immediate':'deferred',condition==='mate'?'mate':'class');
 if(condition!=='not-submitted')await s.request({type:'submit',seq:1});
 if(condition==='deadline')await store.exec('UPDATE room SET deadline_at=?',Date.now()-1);
 if(condition==='interrupted')await h.request({type:'finish'});
 const reply=await(condition==='teacher'?h:s).request({type:'reopen',seq:condition==='not-submitted'?1:2});expect(reply.type).toBe('error');
 if(condition==='deadline'||condition==='interrupted')expect(['COLLECTING','FINISHED']).toContain(reply.state.room.state);
});
test('saved reopened answers are graded at cutoff when not resubmitted',async()=>{
 const {h,s,store,qs}=await room();await s.request({type:'submit',seq:1});expect((await s.request({type:'reopen',seq:2})).type).toBe('ack');await s.request({type:'draft',seq:3,answers:[{questionId:qs[0].id,fieldId:'name',value:qs[0].answer.canonical}]});
 const cutoff=Date.now()-4000;await store.exec('UPDATE room SET start_at=?,deadline_at=?',cutoff-60000,cutoff);const final=await s.request({type:'sync'});expect(final.state.room.state).toBe('FINISHED');expect(final.state.results.own.correctCount).toBe(1);expect(final.state.results.own.elapsedCs).toBe(6000);expect(final.state.results.own.finishReason).toBe('timeout');
});
