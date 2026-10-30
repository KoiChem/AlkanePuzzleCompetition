import {afterEach,beforeEach,expect,test} from 'vitest';
import {fixture,credentials,settings} from './helpers';
import {hashParticipantToken as hash} from '../../src/platform/participant-auth';

let f:Awaited<ReturnType<typeof fixture>>;
beforeEach(async()=>{f=await fixture();});
afterEach(async()=>{await f.runtime.dispose();});
const input={kind:'mate',nickname:'ホスト',settings};
const create=()=>f.fetch('/api/rooms',{method:'POST',headers:{origin:'https://lite.test'},body:JSON.stringify(input)});
const update=(enabled:boolean)=>f.fetch('/api/teacher/mate-setting',{method:'PUT',headers:f.teacherHeaders,body:JSON.stringify({enabled})});

test('mate availability defaults to enabled and saved state controls new rooms',async()=>{
 expect((await f.fetch('/api/public-config')).status).toBe(200);
 expect(await (await f.fetch('/api/public-config')).json()).toEqual({mateEnabled:true});
 expect((await update(false)).status).toBe(200);
 await f.runtime.unsafeEvictDurableObject('alkane-test','AlkaneTeachers',{name:'teachers'});
 const config=await f.fetch('/api/public-config');expect(config.headers.get('cache-control')).toBe('no-store');expect(await config.json()).toEqual({mateEnabled:false});
 expect((await create()).status).toBe(403);
 expect((await f.create()).response.status).toBe(201);
 expect((await update(true)).status).toBe(200);
 expect((await create()).status).toBe(201);
});

test('only master with same-origin CSRF can change mate availability',async()=>{
 expect((await f.fetch('/api/teacher/mate-setting',{method:'PUT',body:'{"enabled":false}'})).status).toBe(401);
 expect((await f.fetch('/api/teacher/mate-setting',{method:'PUT',headers:{cookie:f.teacherHeaders.cookie,origin:'https://lite.test'},body:'{"enabled":false}'})).status).toBe(403);
 expect((await f.fetch('/api/teacher/mate-setting',{method:'PUT',headers:{...f.teacherHeaders,origin:'https://evil.test'},body:'{"enabled":false}'})).status).toBe(403);
 const secret='B'.repeat(43);await f.authStorage.exec('INSERT INTO teachers(email) VALUES(?)','teacher@example.com');await f.authStorage.exec('INSERT INTO sessions VALUES(?,?,?,?)',await hash(secret),'teacher','teacher@example.com',Date.now()+60000);
 expect((await f.fetch('/api/teacher/mate-setting',{method:'PUT',headers:{cookie:'__Host-alkane-lite-session='+secret,origin:'https://lite.test','x-competition-csrf':await hash(secret+':csrf')},body:'{"enabled":false}'})).status).toBe(403);
 expect(await (await f.fetch('/api/public-config')).json()).toEqual({mateEnabled:true});
});

test('invalid mate setting writes do not change saved state',async()=>{
 expect((await update(false)).status).toBe(200);
 for(const body of ['{}','{"enabled":"true"}','null','{',' '.repeat(129)])expect((await f.fetch('/api/teacher/mate-setting',{method:'PUT',headers:f.teacherHeaders,body})).status).toBe(400);
 expect((await f.fetch('/api/teacher/mate-setting',{method:'DELETE',headers:f.teacherHeaders})).status).toBe(405);
 expect(await (await f.fetch('/api/public-config')).json()).toEqual({mateEnabled:false});
});

test('disabled creation leaves existing mate join, start, answer and results usable',async()=>{
 const response=await create();expect(response.status).toBe(201);const room=await response.json() as any;
 const host=await f.connect(room.code);await host.request({type:'hello',role:'mate-host',token:room.token});
 expect((await update(false)).status).toBe(200);
 expect((await f.fetch(`/api/rooms/${room.code}/info`)).status).toBe(200);
 const guest=await f.connect(room.code);expect((await guest.request(credentials())).type).toBe('ack');
 expect((await host.request({type:'start'})).state.room.state).toBe('COUNTDOWN');
 const storage=await f.storage(room.code);await storage.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);
 const q=JSON.parse((await storage.exec('SELECT questions FROM room')).rows[0].questions as string)[0];
 expect((await host.request({type:'answer',seq:1,questionId:q.id,fieldId:'name',value:q.answer.canonical})).state.own.correctCount).toBe(1);
 expect((await host.request({type:'finish'})).state.room.state).toBe('FINISHED');
 expect((await guest.request({type:'sync'})).state.results.questions).toHaveLength(5);
 expect((await f.fetch(`/api/rooms/${room.code}/state`,{headers:{authorization:`Bearer ${room.token}`}})).status).toBe(200);
});
