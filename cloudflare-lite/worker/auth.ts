import {DEFAULT_PROFILE,validateProfile} from '../game/profile';
import {validateQuestionProfile} from '../game/generator';
import {DurableObject} from 'cloudflare:workers';
import {verifyGoogleIdToken} from './google';
import {readBoundedJson} from './response';
import {cookie, hash, readCookie, token} from './store';
import type {TeacherSession} from '../src/teacher-auth';

export type AlkaneTeacherEnv = {
  TEACHERS: DurableObjectNamespace<AlkaneTeachers>;
  APP_ORIGIN: string;
  MASTER_TEACHER_EMAIL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};
const SESSION = '__Host-alkane-lite-session', OAUTH = '__Host-alkane-lite-oauth';
const SESSION_MS = 8 * 60 * 60 * 1000, OAUTH_MS = 10 * 60 * 1000;
const validToken = /^[A-Za-z0-9_-]{43}$/;
const normalize = (email: string) => email.trim().toLowerCase();
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, {status, headers: {'cache-control': 'no-store', ...headers}});
type SessionRow = {sub: string; email: string; expires_at: number};
type OAuthRow = {nonce_hash: string; verifier: string};

// One small, separate object holds teacher permissions and short-lived login
// records. Student answers never access this object.
export class AlkaneTeachers extends DurableObject<AlkaneTeacherEnv> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: AlkaneTeacherEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS teachers (email TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS creation_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mate_setting (id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO mate_setting VALUES(1,1);`);
    if (!this.sql.exec<{name:string}>('PRAGMA table_info(teachers)').toArray().some(row => row.name === 'note')) this.sql.exec("ALTER TABLE teachers ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  private mateEnabled(){return this.sql.exec<{enabled:number}>('SELECT enabled FROM mate_setting WHERE id=1').toArray()[0].enabled===1;}
  private profile(){return this.sql.exec<{revision:number;value:string}>('SELECT revision,value FROM profile WHERE id=1').toArray()[0]??{revision:1,value:JSON.stringify(DEFAULT_PROFILE)};}
  private master() { return normalize(this.env.MASTER_TEACHER_EMAIL ?? ''); }
  private ready() {
    try {
      const origin = new URL(this.env.APP_ORIGIN);
      return validEmail(this.master()) && !!this.env.GOOGLE_CLIENT_ID && !!this.env.GOOGLE_CLIENT_SECRET
        && origin.origin === this.env.APP_ORIGIN && (origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)));
    } catch { return false; }
  }
  private allowed(email: string) {
    return email === this.master() || this.sql.exec('SELECT email FROM teachers WHERE email=?', email).toArray().length > 0;
  }
  private async session(request: Request): Promise<TeacherSession> {
    const empty: TeacherSession = {ready: this.ready(), identity: null, isMaster: false, csrfToken: null, expiresAtMs: null};
    const secret = readCookie(request, SESSION);
    if (!empty.ready || !secret || !validToken.test(secret)) return empty;
    const row = this.sql.exec<SessionRow>('SELECT sub,email,expires_at FROM sessions WHERE token_hash=? AND expires_at>?', await hash(secret), Date.now()).toArray()[0];
    if (!row || !this.allowed(row.email)) return empty;
    return {...empty, identity: {id: row.sub, email: row.email}, isMaster: row.email === this.master(), csrfToken: await hash(secret + ':csrf'), expiresAtMs: row.expires_at};
  }
  private clean() {
    this.sql.exec('DELETE FROM creation_limits WHERE expires_at<=?', Date.now());
    this.sql.exec('DELETE FROM oauth WHERE expires_at<=?', Date.now());
    this.sql.exec('DELETE FROM sessions WHERE expires_at<=?', Date.now());
  }
  private async schedule() {
    const next = this.sql.exec<{due: number | null}>('SELECT MIN(expires_at) AS due FROM (SELECT expires_at FROM oauth UNION ALL SELECT expires_at FROM sessions UNION ALL SELECT expires_at FROM creation_limits)').toArray()[0]?.due;
    if (next != null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() { this.clean(); await this.schedule(); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    if (url.origin !== this.env.APP_ORIGIN) return json({error: '許可されたアプリから操作してください'}, 403);
    if(path==='/api/public-config')return request.method==='GET'?json({mateEnabled:this.mateEnabled()}):json({error:'操作方法を確認してください'},405);
    if(['/internal/create-limit','/internal/probe-limit'].includes(path)&&request.method==='POST'){
      const {key,maximum,kind}=await request.json() as {key:string;maximum:number;kind?:string};if(!/^[a-f0-9]{64}$/.test(key)||!(path.endsWith('probe-limit')?maximum===180:[20,60].includes(maximum)))return json({error:'操作を確認してください'},400);
      if(path==='/internal/create-limit'&&kind==='mate'&&!this.mateEnabled())return json({error:'メイトマッチの新規作成は停止中です'},403);
      this.clean();
      const row=this.sql.exec<{count:number}>('SELECT count FROM creation_limits WHERE key=?',key).toArray()[0];if(row&&row.count>=maximum)return json({error:path.endsWith('probe-limit')?'アクセスが多すぎます。1分ほど待ってください':'ルームの作成が多すぎます。10分ほど待ってください'},429);
      this.sql.exec('INSERT INTO creation_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,Date.now()+(path.endsWith('probe-limit')?60000:600000));await this.schedule();return json({ok:true,mateEnabled:kind==='mate'&&this.mateEnabled()});
    }
    if(path==='/api/question-profile') {const current=this.profile();return request.method==='GET'?json({revision:current.revision,profile:JSON.parse(current.value)}):json({error:'操作方法を確認してください'},405);}
    if (path === '/api/auth/session') return request.method === 'GET' ? json(await this.session(request)) : json({error: '操作方法を確認してください'}, 405);
    if (!this.ready()) return json({error: '教員認証の設定を準備中です'}, 503);
    if (path === '/api/auth/google/start' || path === '/api/auth/google/callback') {
      if (request.method !== 'GET') return json({error: '操作方法を確認してください'}, 405);
      return path.endsWith('/start') ? this.start() : this.callback(request);
    }
    const session = await this.session(request);
    if (!session.identity) return json({error: '教員ログインが必要です'}, 401);
    if (request.method !== 'GET' && (request.headers.get('origin') !== this.env.APP_ORIGIN || request.headers.get('x-competition-csrf') !== session.csrfToken)) return json({error: '操作資格を再確認してください'}, 403);
    if(path==='/api/teacher/mate-setting'){
      if(!session.isMaster)return json({error:'マスター教員だけが変更できます'},403);
      if(request.method==='PUT'){
        let input:{enabled?:unknown}|null;
        try{const text=await request.text();if(text.length>128)throw new Error();input=JSON.parse(text);if(typeof input?.enabled!=='boolean')throw new Error();}catch{return json({error:'設定を確認してください'},400);}
        this.sql.exec('UPDATE mate_setting SET enabled=? WHERE id=1',input!.enabled?1:0);
      }else if(request.method!=='GET')return json({error:'操作方法を確認してください'},405);
      return json({mateEnabled:this.mateEnabled()});
    }
    if(path==='/api/teacher/question-profile') {
      if(!session.isMaster)return json({error:'マスター教員だけが難易度を調整できます'},403);
      if(request.method==='PUT'){
        let candidate:ReturnType<typeof validateProfile>,revision:number;
        try{const text=await request.text();if(text.length>16384)throw new Error();const body=JSON.parse(text);revision=body.revision;candidate=validateProfile(body.profile);validateQuestionProfile(candidate);}catch{return json({error:'設定範囲や組み合わせを確認してください'},400);}
        if(!Number.isSafeInteger(revision)||this.profile().revision!==revision)return json({error:'別の更新がありました。最新設定を読み直してください'},409);
        this.ctx.storage.transactionSync(()=>this.sql.exec('INSERT INTO profile(id,revision,value) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value',revision+1,JSON.stringify(candidate)));
      }else if(request.method!=='GET')return json({error:'操作方法を確認してください'},405);
      const current=this.profile();return json({revision:current.revision,profile:JSON.parse(current.value)});
    }
    if (path === '/api/auth/logout') {
      if (request.method !== 'POST') return json({error: '操作方法を確認してください'}, 405);
      this.sql.exec('DELETE FROM sessions WHERE token_hash=?', await hash(readCookie(request, SESSION)!));
      await this.schedule();
      return json({ok: true}, 200, {'set-cookie': cookie(SESSION, '', 0)});
    }
    if (path === '/api/teacher/allowlist') {
      if (!session.isMaster) return json({error: 'マスター教員だけが許可教員を管理できます'}, 403);
      if (request.method !== 'GET') {
        if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return json({error: '操作方法を確認してください'}, 405);
        const text = await request.text();
        if (text.length > 1024) return json({error: 'メールアドレスを確認してください'}, 400);
        let email: string, note = '';
        try { const body = JSON.parse(text); email = typeof body.email === 'string' ? normalize(body.email) : ''; if (request.method !== 'DELETE') { if (body.note !== undefined && typeof body.note !== 'string') throw new Error(); note = (body.note ?? '').trim(); if (note.length > 100 || /[\r\n]/.test(note)) return json({error:'メモは改行なしの100文字以内で入力してください'},400); } }
        catch { return json({error: 'メールアドレスを確認してください'}, 400); }
        if (!validEmail(email) || email === this.master()) return json({error: 'マスター教員以外のメールアドレスを入力してください'}, 400);
        if (request.method === 'POST') {
          if (!this.allowed(email) && this.sql.exec<{count: number}>('SELECT COUNT(*) AS count FROM teachers').toArray()[0].count >= 100) return json({error: '登録できる教員は100人までです'}, 409);
          this.sql.exec('INSERT OR IGNORE INTO teachers(email) VALUES(?)', email);
          this.sql.exec('UPDATE teachers SET note=? WHERE email=?',note,email);
        } else if(request.method === 'PUT') {
          if (!this.sql.exec('SELECT email FROM teachers WHERE email=?',email).toArray().length) return json({error:'教員が見つかりません'},404);
          this.sql.exec('UPDATE teachers SET note=? WHERE email=?',note,email);
        } else {
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM teachers WHERE email=?', email);
            this.sql.exec('DELETE FROM sessions WHERE email=?', email);
          });
          await this.schedule();
        }
      }
      return json({emails: this.sql.exec<{email: string}>('SELECT email FROM teachers ORDER BY email').toArray().map(row => row.email), notes: Object.fromEntries(this.sql.exec<{email:string;note:string}>('SELECT email,note FROM teachers').toArray().map(row => [row.email,row.note])), masterEmail: this.master()});
    }
    return json({error: '見つかりません'}, 404);
  }
  private async start() {
    this.clean();
    if (this.sql.exec<{count: number}>('SELECT COUNT(*) AS count FROM oauth').toArray()[0].count >= 256) return json({error: 'しばらく待ってからログインしてください'}, 503);
    const state = token(), browser = token(), nonce = token(), verifier = token();
    this.sql.exec('INSERT INTO oauth(state_hash,browser_hash,nonce_hash,verifier,expires_at) VALUES(?,?,?,?,?)', await hash(state), await hash(browser), await hash(nonce), verifier, Date.now() + OAUTH_MS);
    await this.schedule();
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    target.search = new URLSearchParams({client_id: this.env.GOOGLE_CLIENT_ID!, redirect_uri: this.env.APP_ORIGIN + '/api/auth/google/callback', response_type: 'code', scope: 'openid email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'}).toString();
    return new Response(null, {status: 302, headers: {location: target.href, 'cache-control': 'no-store', 'set-cookie': cookie(OAUTH, browser, OAUTH_MS / 1000)}});
  }
  private async callback(request: Request) {
    const url = new URL(request.url), headers = new Headers({'cache-control': 'no-store', 'set-cookie': cookie(OAUTH, '', 0)});
    let error = 'google';
    try {
      const state = url.searchParams.get('state') ?? '', browser = readCookie(request, OAUTH) ?? '';
      if (!validToken.test(state) || !validToken.test(browser)) throw new Error('invalid transaction');
      const tx = this.sql.exec<OAuthRow>('DELETE FROM oauth WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING nonce_hash,verifier', await hash(state), await hash(browser), Date.now()).toArray()[0];
      const code = url.searchParams.get('code');
      if (!tx || url.searchParams.has('error') || !code || code.length > 2048) throw new Error('invalid transaction');
      const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({code, client_id: this.env.GOOGLE_CLIENT_ID!, client_secret: this.env.GOOGLE_CLIENT_SECRET!, redirect_uri: this.env.APP_ORIGIN + '/api/auth/google/callback', grant_type: 'authorization_code', code_verifier: tx.verifier}), signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('token exchange failed');
      const body = await readBoundedJson(response);
      if (typeof body.id_token !== 'string' || body.id_token.length > 12000) throw new Error('invalid token');
      const identity = await verifyGoogleIdToken(body.id_token, this.env.GOOGLE_CLIENT_ID!, tx.nonce_hash);
      if (!this.allowed(identity.email)) { error = 'forbidden'; throw new Error('teacher forbidden'); }
      const secret = token();
      this.clean();
      this.sql.exec('INSERT INTO sessions(token_hash,sub,email,expires_at) VALUES(?,?,?,?)', await hash(secret), identity.id, identity.email, Date.now() + SESSION_MS);
      headers.append('set-cookie', cookie(SESSION, secret, SESSION_MS / 1000));
      headers.set('location', this.env.APP_ORIGIN + '/#/teacher');
    } catch { headers.set('location', this.env.APP_ORIGIN + '/#/teacher?authError=' + error); }
    await this.schedule();
    return new Response(null, {status: 302, headers});
  }
}

export async function teacherSession(request: Request, env: AlkaneTeacherEnv): Promise<TeacherSession> {
  const response = await env.TEACHERS.get(env.TEACHERS.idFromName('teachers')).fetch(new Request(env.APP_ORIGIN + '/api/auth/session', {headers: {cookie: request.headers.get('cookie') ?? ''}}));
  if (!response.ok) throw new Error('teacher auth unavailable');
  return response.json();
}
