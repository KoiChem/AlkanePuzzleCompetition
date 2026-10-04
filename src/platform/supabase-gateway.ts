import { createApiHandlers, jsonResponse } from './http';
import { hashParticipantToken } from './participant-auth';
import { googleIdentity, type VerifiedUser } from './supabase-identity';
import type { PersistenceDatabase } from '../persistence/db';
import { queueRoomEvents, roomFingerprint } from './realtime-outbox';

export type TransactionRunner = <T>(scope: string, run: (db: PersistenceDatabase) => Promise<T>) => Promise<T>;
export type GatewayOptions = {
  transact: TransactionRunner;
  verifyUser(request: Request): Promise<VerifiedUser | null>;
  masterEmail: string;
  allowedOrigins: readonly string[];
  flush(roomId: string): Promise<void>;
  now?: () => number;
};
type HandlerName = keyof ReturnType<typeof createApiHandlers>;
const topRoutes: Record<string, { method: string[]; name: HandlerName }> = {
  '/api/public-config': {method:['GET'],name:'publicConfig'},
  '/api/join-info': {method:['GET'],name:'joinInfo'},
  '/api/class-rooms': {method:['POST'],name:'createClassRoom'},
  '/api/mate-rooms': {method:['POST'],name:'createMateRoom'},
  '/api/teacher/session': {method:['GET'],name:'teacherSession'},
  '/api/teacher/allowlist': {method:['GET','POST'],name:'teacherAllowlist'},
  '/api/teacher/question-profile': {method:['GET','PATCH'],name:'teacherQuestionProfile'},
  '/api/teacher/site-settings': {method:['GET','PATCH'],name:'teacherSiteSettings'},
};
const roomRoutes: Record<string, { method: string[]; name: HandlerName }> = {
  state:{method:['GET'],name:'state'},join:{method:['POST'],name:'joinRoom'},
  nickname:{method:['PATCH'],name:'nickname'},settings:{method:['PATCH'],name:'updateRoomSettings'},
  start:{method:['POST'],name:'startRoom'},manifest:{method:['GET'],name:'manifest'},ready:{method:['POST'],name:'ready'},
  'cancel-preparation':{method:['POST'],name:'cancelPreparation'},operations:{method:['POST'],name:'operations'},
  writer:{method:['POST'],name:'writer'},cancel:{method:['POST'],name:'cancelRoom'},interrupt:{method:['POST'],name:'interruptRoom'},
  remove:{method:['POST'],name:'removeParticipant'},actions:{method:['POST'],name:'actions'},
  results:{method:['GET'],name:'results'},'result-summary':{method:['GET'],name:'resultSummary'},
};
function failure(status:number,code:string,message:string) { return jsonResponse({error:{code,message}},status); }
function withCors(response: Response, origin: string) {
  const headers=new Headers(response.headers);
  headers.set('access-control-allow-origin',origin);headers.set('vary','Origin');
  headers.set('access-control-allow-methods','GET,POST,PATCH,OPTIONS');
  headers.set('access-control-allow-headers','authorization,apikey,content-type,x-region,x-participant-authorization,x-competition-csrf,x-creation-key');
  headers.set('access-control-expose-headers','retry-after,x-request-id');
  return new Response(response.body,{status:response.status,headers});
}

async function teacherProvider(db: PersistenceDatabase,user:VerifiedUser,masterEmail:string) {
  const identity=googleIdentity(user);
  if (!identity) return {getVerifiedIdentity:async()=>null};
  const master=masterEmail.trim().toLowerCase();
  if (!master) return {getVerifiedIdentity:async()=>null};
  await db.prepare('INSERT OR IGNORE INTO app_auth_config(id,master_email) VALUES(1,?)').bind(master).run();
  const settings=await db.prepare('SELECT master_email FROM app_auth_config WHERE id=1').first<{master_email:string}>();
  if(settings?.master_email!==master) throw new Error('Master identity configuration differs');
  const list=await db.prepare('SELECT emails_json FROM teacher_allowlist WHERE id=1').first<{emails_json:string}>();
  const permitted=identity.email===master||(JSON.parse(list?.emails_json??'[]') as string[]).includes(identity.email);
  const byUid=await db.prepare('SELECT email,active FROM app_teacher_bindings WHERE uid=?').bind(user.id).first<{email:string;active:boolean}>();
  const byEmail=await db.prepare('SELECT uid FROM app_teacher_bindings WHERE email=?').bind(identity.email).first<{uid:string}>();
  if(!permitted || (byUid && byUid.email!==identity.email) || (byEmail && byEmail.uid!==user.id)) return {getVerifiedIdentity:async()=>null};
  if(!byUid) await db.prepare('INSERT INTO app_teacher_bindings(uid,email) VALUES(?,?)').bind(user.id,identity.email).run();
  else if(!byUid.active) await db.prepare('UPDATE app_teacher_bindings SET active=true WHERE uid=?').bind(user.id).run();
  return {getVerifiedIdentity:async()=>identity};
}
async function associateParticipant(db:PersistenceDatabase,user:VerifiedUser,request:Request,publicId:string) {
  const authorization=request.headers.get('authorization');
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization??'');
  if(!match)return;
  const hash=await hashParticipantToken(match[1]);
  const participant=await db.prepare(`SELECT p.room_id,p.id FROM participants p JOIN rooms r ON r.id=p.room_id
    WHERE r.public_id=? AND p.token_hash=? AND p.status<>'REMOVED'`).bind(publicId,hash).first<{room_id:string;id:string}>();
  if(!participant)return;
  const old=await db.prepare('SELECT uid FROM app_memberships WHERE room_id=? AND participant_id=?').bind(participant.room_id,participant.id).first<{uid:string}>();
  await db.prepare(`INSERT INTO app_memberships(room_id,participant_id,uid) VALUES(?,?,?)
    ON CONFLICT(room_id,participant_id) DO UPDATE SET uid=excluded.uid WHERE app_memberships.uid<>excluded.uid`)
    .bind(participant.room_id,participant.id,user.id).run();
  if(old&&old.uid!==user.id) await db.prepare('INSERT INTO app_audit(actor_uid,event,room_id) VALUES(?,?,?)').bind(user.id,'participant_rebound',participant.room_id).run();
}
async function topicsFor(db:PersistenceDatabase,user:VerifiedUser,publicId:string,now:number) {
  const room=await db.prepare('SELECT id,owner_teacher_id,mate_host_id,expires_at_ms,state FROM rooms WHERE public_id=?').bind(publicId)
    .first<{id:string;owner_teacher_id:string|null;mate_host_id:string|null;expires_at_ms:number;state:string}>();
  if(!room||room.expires_at_ms<=now)return null;
  const member=await db.prepare(`SELECT m.participant_id FROM app_memberships m JOIN participants p ON p.room_id=m.room_id AND p.id=m.participant_id
    WHERE m.room_id=? AND m.uid=? AND p.status<>'REMOVED'`).bind(room.id,user.id).first<{participant_id:string}>();
  const teacher=await db.prepare('SELECT uid FROM app_teacher_bindings WHERE uid=? AND active=true').bind(user.id).first<{uid:string}>();
  const owner=teacher?.uid===room.owner_teacher_id;
  if(!member&&!owner)return null;
  const row=await db.prepare('SELECT epoch FROM app_room_topics WHERE room_id=?').bind(room.id).first<{epoch:number}>();
  const epoch=row?.epoch??1;
  return {control:`room:${publicId}:control:${epoch}`,host:owner||member?.participant_id===room.mate_host_id?`room:${publicId}:host:${epoch}`:null,epoch,role:owner?'teacher':member?.participant_id===room.mate_host_id?'host':'participant'};
}

export function createSupabaseGateway(options:GatewayOptions) {
  return async (incoming:Request):Promise<Response> => {
    const receivedAtMs=(options.now??Date.now)();
    const origin=incoming.headers.get('origin');
    if(!origin||!options.allowedOrigins.includes(origin))return failure(403,'origin_forbidden','許可されたアプリから利用してください');
    if(incoming.method==='OPTIONS')return withCors(new Response(null,{status:204}),origin);
    const url=new URL(incoming.url);const marker=url.pathname.indexOf('/api/');
    if(marker<0)return withCors(failure(404,'not_found','APIが見つかりません'),origin);
    const path=url.pathname.slice(marker);const match=/^\/api\/rooms\/([A-Za-z0-9_-]{1,128})\/([a-z-]+)$/.exec(path);
    const route=topRoutes[path]??(match?roomRoutes[match[2]]:undefined);
    const realtime=match?.[2]==='realtime';
    if(!route&&!realtime)return withCors(failure(404,'not_found','APIが見つかりません'),origin);
    if(!(realtime?['GET']:route!.method).includes(incoming.method))return withCors(failure(405,'method_not_allowed','操作方法を確認してください'),origin);
    try {
      const user=await options.verifyUser(incoming);
      if(!user)return withCors(failure(401,'authentication_required','参加資格を確認できません'),origin);
      const headers=new Headers(incoming.headers);
      const participant=headers.get('x-participant-authorization');headers.delete('authorization');
      if(participant)headers.set('authorization',participant);
      // Same-origin guard is still applied by the core after trusted CORS validation.
      headers.set('origin','https://competition.internal');headers.delete('sec-fetch-site');
      const request=new Request(`https://competition.internal${path}${url.search}`,{method:incoming.method,headers,body:['GET','HEAD'].includes(incoming.method)?undefined:incoming.body,duplex:'half'} as RequestInit);
      let publicId=match?.[1]??'';
      const scope=path.startsWith('/api/teacher/')?'teacher-configuration':(publicId?`room:${publicId}`:`creation:${user.id}`);
      const response=await options.transact(scope,async db=>{
        const now=(options.now??Date.now)();
        if(crypto.getRandomValues(new Uint32Array(1))[0]%200===0)await db.prepare('SELECT app_prune_auxiliary()').run();
        // Rate limits are per verified UID, never classroom NAT IP.
        const bucket=`${user.id}:${Math.floor(now/60000)}`;
        const limit=await db.prepare(`INSERT INTO app_request_limits(bucket,window_ms,count) VALUES(?,?,1)
          ON CONFLICT(bucket) DO UPDATE SET count=app_request_limits.count+1 RETURNING count`).bind(bucket,now).first<{count:number}>();
        if((limit?.count??0)>180) { const limited=failure(429,'rate_limited','通信が集中しています。少し待って再試行してください'); limited.headers.set('retry-after',String(Math.ceil((60000-now%60000)/1000))); return limited; }
        const provider=await teacherProvider(db,user,options.masterEmail);
        const handlers=createApiHandlers({database:db,teacherIdentity:provider,serverConfig:{teacherAllowedEmails:[],masterTeacherEmail:options.masterEmail.trim().toLowerCase()},now:options.now??Date.now,random:()=>crypto.getRandomValues(new Uint32Array(1))[0]/0x100000000,randomUUID:()=>crypto.randomUUID()});
        const before=publicId?await roomFingerprint(db,publicId):null;
        const result=await (handlers[realtime?'state':route!.name] as (r:Request,p:{id:string})=>Promise<Response>)(request.clone(),{id:publicId});
        if(!result.ok)return result;
        const body=await result.clone().json() as {room?:{id:string}};
        publicId=publicId||body.room?.id||'';
        if(publicId){
          const room=await db.prepare('SELECT id FROM rooms WHERE public_id=?').bind(publicId).first<{id:string}>();
          if(room){
            await db.prepare('INSERT OR IGNORE INTO app_room_topics(room_id) VALUES(?)').bind(room.id).run();
            await associateParticipant(db,user,request,publicId);
            await queueRoomEvents(db,publicId,before,now);
          }
          const topics=await topicsFor(db,user,publicId,now);
          if(realtime)return topics?jsonResponse(topics):failure(403,'not_authorized','通知を購読する権限がありません');
          if(route?.name==='state'&&topics)return jsonResponse({...body,realtime:topics});
        }
        return result;
      });
      if(publicId)void options.flush(publicId).catch(()=>{});
      const timedResponse=route?.name==='state'&&response.ok
        ? jsonResponse({...await response.clone().json(),serverTiming:{receivedAtMs,sentAtMs:(options.now??Date.now)()}})
        : response;
      return withCors(timedResponse,origin);
    } catch(error) {
      console.error(JSON.stringify({event:'gateway_failed',category:error instanceof Error?error.name:'Unknown',code:typeof (error as {code?:unknown})?.code==='string'&&/^[A-Z0-9]{5}$/.test((error as {code:string}).code)?(error as {code:string}).code:undefined}));
      return withCors(failure(503,'service_unavailable','サービスを利用できません。再試行してください'),origin);
    }
  };
}
