// Local Miniflare only: no credential or production URL accepted.
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
await mkdir('.wrangler',{recursive:true});
await build({entryPoints:['tests/helpers.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.wrangler/load-helpers.mjs'});
const {fixture,credentials,settings}=await import(pathToFileURL(resolve('.wrangler/load-helpers.mjs')));
const summary=values=>{const xs=[...values].sort((a,b)=>a-b);return {count:xs.length,medianMs:+xs[Math.floor(xs.length/2)].toFixed(2),p95Ms:+xs[Math.ceil(xs.length*.95)-1].toFixed(2),maxMs:+xs.at(-1).toFixed(2)};};
const reports=[];
for(const mode of ['arrange','name'])for(const gradingMode of ['immediate','deferred']){
 const f=await fixture();try{
  const {data}=await f.create({...settings,mode,gradingMode,difficulty:'medium',alcoholEnabled:true,questionCount:15});const h=await f.connect(data.code);await h.request({type:'hello',role:'teacher',token:data.token});
  const clients=await Promise.all(Array.from({length:51},async(_,i)=>{const s=await f.connect(data.code),c=credentials('計測'+i);const at=performance.now(),reply=await s.request(c);return {...s,c,reply,joinMs:performance.now()-at};}));
  const accepted=clients.filter(c=>c.reply.type==='ack');if(accepted.length!==50||clients.filter(c=>c.reply.code==='room_full').length!==1)throw new Error('capacity failed');
  const at=performance.now(),started=await h.request({type:'start'}),startMs=performance.now()-at;if(started.type!=='ack')throw new Error('start failed');
  const store=await f.storage(data.code);await store.exec('UPDATE room SET start_at=?,deadline_at=?',Date.now()-1000,Date.now()+60000);const qs=JSON.parse((await store.exec('SELECT questions FROM room')).rows[0].questions),field=mode==='arrange'?'formula':'name',times=[];
  if(gradingMode==='immediate'){
   for(let round=0;round<15;round++)await Promise.all(accepted.map(async s=>{const message={type:'answer',seq:round+1,questionId:qs[round].id,fieldId:field,value:qs[round].answer.canonical},sent=performance.now(),r=await s.request(message);times.push(performance.now()-sent);if(!r.verdict?.correct||r.state.own.correctCount!==round+1)throw new Error('grading failed');if(round===0){const duplicate=await s.request(message);if(duplicate.state.own.correctCount!==1)throw new Error('duplicate scored');}}));
  }else{
   await Promise.all(accepted.map(async s=>{const sent=performance.now(),r=await s.request({type:'draft',seq:1,answers:qs.map(q=>({questionId:q.id,fieldId:field,value:q.answer.canonical})),capturedAtMs:Date.now()});times.push(performance.now()-sent);if(r.state.own.correctCount!==0||r.state.own.answeredCount!==15)throw new Error('draft failed');}));
   await h.request({type:'finish'});await Promise.all(accepted.map(async s=>{const r=await s.request({type:'submit',seq:2,final:true});if(r.type!=='ack')throw new Error('final collection failed');}));
  }
  const result=(await h.request({type:'sync'})).state;if(result.room.state!=='FINISHED'||result.results.ranking.length!==50||result.results.ranking.some(p=>p.correctCount!==15))throw new Error('results failed');
  const report={mode,gradingMode,participants:50,questionCount:15,startGenerationAckMs:+startMs.toFixed(2),joinAck:summary(accepted.map(c=>c.joinMs)),answerOrBatchDraftAck:summary(times),allCorrect:true,rejected51:true};reports.push(report);console.log(JSON.stringify(report));
 }finally{await f.runtime.dispose();}
}
await writeFile(new URL('../docs/local-load.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),environment:'Local Miniflare on one Mac; simulated sockets. Countdown shortened using fixture SQL; not cloud CPU, physical devices or school network.',reports},null,2)+'\n');
