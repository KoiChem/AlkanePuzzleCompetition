import './server-only';

export type SharedTeacherDecision={allowed:boolean;master:boolean;email:string;revision:number};
export type SharedTeacherClientOptions={
  url:string;appId:string;secret:string;now?:()=>number;randomUUID?:()=>string;
  fetch?:typeof globalThis.fetch;
};
type Mutation={email:string;enabled:boolean;expectedRevision:number;requestId:string};
type Action='authorize'|'allowlist.get'|'allowlist.mutate';
const encoder=new TextEncoder();
async function signature(secret:string,body:string){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function createSharedTeacherClient(options:SharedTeacherClientOptions){
  if(!/^https:\/\//.test(options.url)||!options.appId||options.secret.length<32)throw new Error('Shared teacher client configuration is incomplete');
  const send=async(action:Action,bearerToken:string,mutation?:Mutation):Promise<Response>=>{
    const body=JSON.stringify({appId:options.appId,requestId:(options.randomUUID??crypto.randomUUID)(),issuedAtMs:(options.now??Date.now)(),action,bearerToken,...(mutation?{mutation}:{})});
    try{return await (options.fetch??fetch)(options.url,{method:'POST',headers:{'content-type':'application/json',
      'x-shared-teacher-signature':await signature(options.secret,body)},body,signal:AbortSignal.timeout(7000)});}
    catch{throw new Error('authority_unavailable');}
  };
  return {
    async authorize(bearerToken:string):Promise<SharedTeacherDecision>{
      const response=await send('authorize',bearerToken);
      if(response.status===403)return {allowed:false,master:false,email:'',revision:-1};
      if(!response.ok)throw new Error('authority_unavailable');
      let value:unknown;
      try{value=await response.json();}catch{throw new Error('authority_unavailable');}
      if(!value||typeof value!=='object')throw new Error('authority_unavailable');
      const result=value as Partial<SharedTeacherDecision>;
      if(result.allowed!==true||typeof result.master!=='boolean'||typeof result.email!=='string'||!Number.isSafeInteger(result.revision))throw new Error('authority_unavailable');
      return result as SharedTeacherDecision;
    },
    async allowlist(bearerToken:string,request:Request):Promise<Response>{
      let mutation:Mutation|undefined;
      if(request.method==='POST'){
        try{
          const body=await request.text();
          if(encoder.encode(body).length>4_096)return new Response(JSON.stringify({error:{code:'body_too_large'}}),{status:413,headers:{'content-type':'application/json'}});
          mutation=JSON.parse(body) as Mutation;
        }catch{return new Response(JSON.stringify({error:{code:'invalid_request'}}),{status:400,headers:{'content-type':'application/json'}});}
      }
      const response=await send(request.method==='POST'?'allowlist.mutate':'allowlist.get',bearerToken,mutation);
      if(response.status>=500)throw new Error('authority_unavailable');
      return response;
    },
  };
}
export type SharedTeacherClient=ReturnType<typeof createSharedTeacherClient>;
