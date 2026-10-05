import { describe, expect, it } from 'vitest';
import { createSharedTeacherAuthority, signSharedTeacherRequest } from '../../../IonicFormulaCompetitionGitHub/src/platform/shared-teacher-authority';
import { createSharedTeacherClient } from '../../src/platform/shared-teacher-client';

const secret = 'test-secret-with-at-least-32-characters';
const now = 1_728_000_000_000;
const token = 'remote-access-token';
const registry = { appId: 'alkane-puzzle-competition', authUrl: 'https://remote.example', publishableKey: 'public-key', secretName: 'SHARED_TEACHER_ALKANE_HMAC_SECRET' };
function fixture() {
  const claimed = new Set<string>();
  const emails = new Set(['teacher@example.com']);
  let revision = 0;
  let lastOperation: {requestId:string;bodyHash:string}|null = null;
  let user: any = {id:'remote-uid',email:'teacher@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'google'}]};
  let unavailable = false;
  const authority = createSharedTeacherAuthority({
    now:()=>now, masterEmail:'master@example.com',
    lookupRegistry:async appId=>appId===registry.appId?registry:null,
    readSecret:name=>name===registry.secretName?secret:undefined,
    claimRequest:async(appId,id)=>{const key=`${appId}:${id}`;if(claimed.has(key))return false;claimed.add(key);return true;},
    verifyRemoteUser:async(url,key,bearer)=>{if(unavailable)throw new Error('remote offline');expect(url).toBe(registry.authUrl);expect(key).toBe(registry.publishableKey);return bearer===token?user:null;},
    readAllowlist:async()=>({emails:[...emails],revision,lastOperation}),
    mutateAllowlist:async(value)=>{
      if(value.expectedRevision!==revision)return false;
      value.enabled?emails.add(value.email):emails.delete(value.email);
      revision++;lastOperation={requestId:value.requestId,bodyHash:value.bodyHash};return true;
    },
  });
  async function send(action:'authorize'|'allowlist.get'|'allowlist.mutate', options:Record<string,unknown>={}) {
    const body=JSON.stringify({appId:registry.appId,requestId:crypto.randomUUID(),issuedAtMs:now,action,bearerToken:token,...options});
    const signature=await signSharedTeacherRequest(secret,body);
    return authority(new Request('https://central.example/shared-teacher',{method:'POST',headers:{'x-shared-teacher-signature':signature},body}));
  }
  return {authority,send,setUser:(value:any)=>{user=value;},setUnavailable:(value:boolean)=>{unavailable=value;}};
}

describe('shared teacher authority',()=>{
  it('rejects an unsigned or tampered assertion before querying remote Auth',async()=>{
    const f=fixture();
    const body=JSON.stringify({appId:registry.appId,requestId:crypto.randomUUID(),issuedAtMs:now,action:'authorize',bearerToken:token});
    expect((await f.authority(new Request('https://central.example/shared-teacher',{method:'POST',body}))).status).toBe(401);
    const signature=await signSharedTeacherRequest(secret,body);
    expect((await f.authority(new Request('https://central.example/shared-teacher',{method:'POST',headers:{'x-shared-teacher-signature':signature},body:body.replace(token,'forged')}))).status).toBe(401);
  });
  it('rejects expired and replayed signed requests',async()=>{
    const f=fixture();const body=JSON.stringify({appId:registry.appId,requestId:crypto.randomUUID(),issuedAtMs:now-31_000,action:'authorize',bearerToken:token});
    const signature=await signSharedTeacherRequest(secret,body);
    expect((await f.authority(new Request('https://central.example/shared-teacher',{method:'POST',headers:{'x-shared-teacher-signature':signature},body}))).status).toBe(401);
    const fresh=JSON.stringify({appId:registry.appId,requestId:crypto.randomUUID(),issuedAtMs:now,action:'authorize',bearerToken:token});
    const freshSignature=await signSharedTeacherRequest(secret,fresh);
    const request=()=>new Request('https://central.example/shared-teacher',{method:'POST',headers:{'x-shared-teacher-signature':freshSignature},body:fresh});
    expect((await f.authority(request())).status).toBe(200);
    expect((await f.authority(request())).status).toBe(409);
  });
  it('uses confirmed Google email from the registered remote project and fails closed when it is unavailable',async()=>{
    const f=fixture();
    await expect((await f.send('authorize',{email:'master@example.com'})).json()).resolves.toMatchObject({allowed:true,master:false,email:'teacher@example.com'});
    f.setUser({id:'remote-uid',email:'teacher@example.com',email_confirmed_at:null,identities:[{provider:'google'}]});
    expect((await f.send('authorize')).status).toBe(403);
    f.setUser({id:'remote-uid',email:'teacher@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'email'}]});
    expect((await f.send('authorize')).status).toBe(403);
    f.setUser({id:'remote-uid',email:'teacher@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'google'}]});
    expect((await f.send('authorize',{bearerToken:'token-from-another-project'})).status).toBe(403);
    f.setUnavailable(true);
    expect((await f.send('authorize')).status).toBe(503);
  });
  it('denies ordinary teacher allowlist access and reflects revocation immediately',async()=>{
    const f=fixture();
    expect((await f.send('allowlist.get')).status).toBe(403);
    expect((await f.send('allowlist.mutate',{mutation:{email:'teacher@example.com',enabled:false,expectedRevision:0,requestId:crypto.randomUUID()}})).status).toBe(403);
    f.setUser({id:'remote-master',email:'master@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'google'}]});
    expect((await f.send('allowlist.mutate',{mutation:{email:'teacher@example.com',enabled:false,expectedRevision:0,requestId:crypto.randomUUID()}})).status).toBe(200);
    f.setUser({id:'remote-uid',email:'teacher@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'google'}]});
    expect((await f.send('authorize')).status).toBe(403);
  });
  it('keeps central allowlist changes idempotent under revision CAS',async()=>{
    const f=fixture();
    f.setUser({id:'remote-master',email:'master@example.com',email_confirmed_at:'2026-10-04T00:00:00Z',identities:[{provider:'google'}]});
    const operation=crypto.randomUUID();
    const mutation={email:'new@example.com',enabled:true,expectedRevision:0,requestId:operation};
    expect((await f.send('allowlist.mutate',{mutation})).status).toBe(200);
    expect((await f.send('allowlist.mutate',{mutation})).status).toBe(200);
    expect((await f.send('allowlist.mutate',{mutation:{...mutation,email:'other@example.com'}})).status).toBe(409);
    expect((await f.send('allowlist.mutate',{mutation:{...mutation,requestId:crypto.randomUUID()}})).status).toBe(409);
    await expect((await f.send('allowlist.get')).json()).resolves.toMatchObject({revision:1,emails:['teacher@example.com','new@example.com']});
  });
});

it('the app client sends a signed request and treats authority failure as unavailable',async()=>{
  const f=fixture();
  const client=createSharedTeacherClient({url:'https://central.example/shared-teacher',appId:registry.appId,secret,
    now:()=>now,randomUUID:()=>crypto.randomUUID(),fetch:async(_url,init)=>f.authority(new Request('https://central.example/shared-teacher',init))});
  expect(await client.authorize(token)).toMatchObject({allowed:true,email:'teacher@example.com',master:false});
  f.setUnavailable(true);
  await expect(client.authorize(token)).rejects.toThrow('authority_unavailable');
});
