import {expect,test} from 'vitest';
import {fixture,settings,credentials} from './helpers';
for(const gradingMode of ['immediate','deferred'])test(`mixed room grades both payload types in ${gradingMode} mode`,async()=>{
 const f=await fixture();try{
  const {data}=await f.create({...settings,mode:'both',gradingMode,questionCount:10});const host=await f.connect(data.code);await host.request({type:'hello',role:'teacher',token:data.token});
  const participant=await f.connect(data.code),hello=credentials();await participant.request(hello);expect((await host.request({type:'start'})).type).toBe('ack');const storage=await f.storage(data.code);await storage.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+180000);
  const questions=JSON.parse((await storage.exec('SELECT questions FROM room')).rows[0].questions as string);expect(questions.filter((q:any)=>q.prompt.mode==='arrange')).toHaveLength(5);let seq=0;
  if(gradingMode==='immediate')for(const q of questions){const result=await participant.request({type:'answer',seq:++seq,questionId:q.id,fieldId:q.fields[0].id,value:q.answer.canonical});expect(result.verdict.correct).toBe(true);}
  else {const result=await participant.request({type:'draft',seq:++seq,answers:questions.map((q:any)=>({questionId:q.id,fieldId:q.fields[0].id,value:q.answer.canonical})),capturedAtMs:Date.now()});expect(result.type).toBe('ack');expect((await participant.request({type:'submit',seq:++seq})).type).toBe('ack');}
  const result=await participant.request({type:'sync'});expect(result.state.own.correctCount).toBe(10);expect(result.state.room.state).toBe('FINISHED');expect(result.state.results.questions).toHaveLength(10);
 }finally{await f.runtime.dispose();}
},20000);
