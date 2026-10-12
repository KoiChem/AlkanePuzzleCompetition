import { AlkaneRoom, type AlkaneEnv, json } from './room';
import {hash} from './store';
import {AlkaneTeachers, teacherSession} from './auth';
export { AlkaneRoom, AlkaneTeachers };
export default {
  async fetch(request: Request, env: AlkaneEnv): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    try {
      if (url.pathname === '/api/health') response = json({ backend: 'lite', d1: false, game:'alkane', maxParticipants: 50, mateCapacity:4, release: env.RELEASE_SHA });
      else if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/teacher/') || ['/api/question-profile','/api/public-config'].includes(url.pathname)) {
        response = await env.TEACHERS.get(env.TEACHERS.idFromName('teachers')).fetch(new Request(request, {redirect: 'manual'}));
      } else if (url.pathname === '/api/rooms' && request.method === 'POST') {
        if (request.headers.get('origin') !== url.origin) return json({error:'別のサイトからの操作は受け付けません'},403);
        if (Number(request.headers.get('content-length')) > 16384) return json({error:'設定が大きすぎます'},413);
        const body = await request.text();if(body.length>16384)return json({error:'設定が大きすぎます'},413);
        let input:{kind?:string;settings?:unknown;nickname?:string};try{input=JSON.parse(body);}catch{return json({error:'設定を確認してください'},400);}
        if(!input||!['class','mate'].includes(input.kind??''))return json({error:'競技形式を確認してください'},400);
        let creatorKey=request.headers.get('cf-connecting-ip')??'local';
        if(input.kind==='class'){
          const session=await teacherSession(request,env);
          if(!session.ready)return json({error:'教員認証の設定を準備中です'},503);
          if(!session.identity)return json({error:'教員ログインが必要です'},401);
          creatorKey=session.identity.id;
          if(request.headers.get('x-competition-csrf')!==session.csrfToken)return json({error:'操作資格を再確認してください'},403);
        }
        const limit=await env.TEACHERS.get(env.TEACHERS.idFromName('teachers')).fetch(new Request(env.APP_ORIGIN+'/internal/create-limit',{method:'POST',body:JSON.stringify({key:await hash(input.kind+':'+creatorKey),maximum:input.kind==='class'?20:60,kind:input.kind})}));if(!limit.ok)return limit;
        const {mateEnabled}=await limit.json() as {mateEnabled:boolean};
        const common=await env.TEACHERS.get(env.TEACHERS.idFromName('teachers')).fetch(new Request(env.APP_ORIGIN+'/api/question-profile'));
        if(!common.ok)return json({error:'出題設定を取得できません'},503);
        const profile=await common.json() as {profile:unknown;revision:number};
        const roomBody=JSON.stringify({...input,profile:profile.profile,profileRevision:profile.revision});
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n&31]).join('');
        response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(url.origin+'/create', {method:'POST',body:roomBody,headers:{'x-room-code':code,'x-mate-create-enabled':String(mateEnabled)}}));
      } else {
        const match = /^\/api\/rooms\/([A-Z2-9]{6})\/(socket|info|state)$/.exec(url.pathname);
        if (match) {
          const ip=request.headers.get('cf-connecting-ip');if(ip){const limit=await env.TEACHERS.get(env.TEACHERS.idFromName('teachers')).fetch(new Request(env.APP_ORIGIN+'/internal/probe-limit',{method:'POST',body:JSON.stringify({key:await hash('probe:'+ip),maximum:180})}));if(!limit.ok)return limit;}
          if (match[2]==='socket' && request.headers.get('origin') !== url.origin) return json({error:'別のサイトからの接続は受け付けません'},403);
          return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
        }
        response = url.pathname.startsWith('/api') ? json({error:'見つかりません'},404) : await env.ASSETS.fetch(request);
      }
    } catch { response = json({error:'処理できませんでした。再接続してください'},500); }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff'); headers.set('Referrer-Policy','no-referrer');
    headers.set('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${url.origin.replace(/^http/,'ws')}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    return new Response(response.body,{status:response.status,headers});
  }
};
