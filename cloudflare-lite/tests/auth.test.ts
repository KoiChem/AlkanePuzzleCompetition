import {afterEach,beforeEach,expect,test} from 'vitest';
import {fixture,settings} from './helpers';import {DEFAULT_PROFILE} from '../game/profile';import {hashParticipantToken as hash} from '../../src/platform/participant-auth';
let f:Awaited<ReturnType<typeof fixture>>;beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.runtime.dispose();});
test('public profile starts with original values and only master can update atomically',async()=>{
 let r=await f.fetch('/api/question-profile');expect(r.status).toBe(200);let current=await r.json() as any;expect(current.profile).toEqual(DEFAULT_PROFILE);
 const profile=structuredClone(DEFAULT_PROFILE);profile.rules.arrange.easy.lenMax=5;
 r=await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:f.teacherHeaders,body:JSON.stringify({revision:current.revision,profile})});expect(r.status).toBe(200);const updated=await r.json() as any;expect(updated.revision).toBe(current.revision+1);
 expect((await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:f.teacherHeaders,body:JSON.stringify({revision:current.revision,profile:DEFAULT_PROFILE})})).status).toBe(409);
 const secret='B'.repeat(43);await f.authStorage.exec('INSERT INTO teachers(email) VALUES(?)','teacher@example.com');await f.authStorage.exec('INSERT INTO sessions VALUES(?,?,?,?)',await hash(secret),'teacher','teacher@example.com',Date.now()+60000);
 expect((await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:{cookie:'__Host-alkane-lite-session='+secret,origin:'https://lite.test','x-competition-csrf':await hash(secret+':csrf')},body:JSON.stringify({revision:updated.revision,profile})})).status).toBe(403);
});
test('room uses authoritative shared profile and existing snapshot never changes',async()=>{
 const initial=await (await f.fetch('/api/question-profile')).json() as any;const {data}=await f.create();
 const profile=structuredClone(DEFAULT_PROFILE);profile.rules.name.easy.lenMax=5;await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:f.teacherHeaders,body:JSON.stringify({revision:initial.revision,profile})});
 const old=await f.storage(data.code);expect(JSON.parse((await old.exec('SELECT profile FROM room')).rows[0].profile as string)).toEqual(initial.profile);
 const r=await f.fetch('/api/rooms',{method:'POST',headers:f.teacherHeaders,body:JSON.stringify({kind:'mate',nickname:'mate',settings,profile:initial.profile})});const mate=await r.json() as any;expect(r.status).toBe(201);expect(JSON.parse((await (await f.storage(mate.code)).exec('SELECT profile FROM room')).rows[0].profile as string)).toEqual(profile);
});
test('requires same origin and csrf and protects master from removal',async()=>{
 expect((await f.fetch('/api/rooms',{method:'POST',headers:{...f.teacherHeaders,origin:'https://evil.test'},body:JSON.stringify({kind:'mate',nickname:'a',settings})})).status).toBe(403);
 expect((await f.fetch('/api/teacher/question-profile',{method:'PUT',headers:{cookie:f.teacherHeaders.cookie,origin:'https://lite.test'},body:JSON.stringify({revision:1,profile:DEFAULT_PROFILE})})).status).toBe(403);
 expect((await f.fetch('/api/teacher/allowlist',{method:'DELETE',headers:f.teacherHeaders,body:'{"email":"master@example.com"}'})).status).toBe(400);
});
test('rate limits code probing without blocking a shared classroom network',async()=>{
 const {data}=await f.create();const headers={'cf-connecting-ip':'192.0.2.10'};for(let i=0;i<180;i++)expect((await f.fetch(`/api/rooms/${data.code}/info`,{headers})).status).toBe(200);expect((await f.fetch(`/api/rooms/${data.code}/info`,{headers})).status).toBe(429);expect((await f.fetch(`/api/rooms/${data.code}/info`,{headers:{'cf-connecting-ip':'192.0.2.11'}})).status).toBe(200);expect(JSON.stringify(await f.authStorage.exec('SELECT * FROM creation_limits'))).not.toContain('192.0.2.10');
});
