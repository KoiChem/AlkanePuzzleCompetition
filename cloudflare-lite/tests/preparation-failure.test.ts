import {test,expect} from 'vitest';
import {fixture,settings,credentials} from './helpers';
import {DEFAULT_PROFILE} from '../game/profile';
for(const kind of ['class','mate'] as const)test(`${kind} preparation failure leaves the room waiting and permits a settings retry`,async()=>{
 const f=await fixture();try{
  const profile=structuredClone(DEFAULT_PROFILE);for(const mode of ['arrange','name'] as const)profile.rules[mode].easy.alcoholRate=100;
  const current=await(await f.fetch('/api/question-profile')).json() as any;
  expect((await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:f.teacherHeaders,body:JSON.stringify({revision:current.revision,profile})})).status).toBe(200);
  const response=await f.fetch('/api/rooms',{method:'POST',headers:f.teacherHeaders,body:JSON.stringify({kind,nickname:'host',settings:{...settings,mode:'both',alcoholEnabled:true}})}),data=await response.json() as any;
  expect(response.status).toBe(201);
  const host=await f.connect(data.code);await host.request({type:'hello',role:kind==='mate'?'mate-host':'teacher',token:data.token,participantId:data.participantId});
  const student=await f.connect(data.code);await student.request(credentials());
  const failure=await host.request({type:'start'});
  expect(failure.code).toBe('question_preparation_failed');expect(failure.message).toMatch(/重複・連続/);
  const storage=await f.storage(data.code),row=(await storage.exec('SELECT state,questions,start_at FROM room')).rows[0];
  expect(row.state).toBe('WAITING');expect(row.questions).toBe('[]');expect(row.start_at).toBeNull();
  expect((await host.request({type:'settings',settings:{...settings,mode:'both',alcoholEnabled:false}})).type).toBe('ack');
  const start=await host.request({type:'start'});expect(start.type).toBe('ack');
  const original=(await storage.exec('SELECT questions FROM room')).rows[0].questions;
  expect((await host.request({type:'start'})).type).toBe('ack');expect((await storage.exec('SELECT questions FROM room')).rows[0].questions).toBe(original);
 }finally{await f.runtime.dispose();}
});
