import {useEffect,useRef,useState} from 'react';
import {QuestionView} from '../game/client/QuestionView';
import {ImmediateVerdict} from '../../src/features/play/ImmediateVerdict';
import {ParticipantSyncStatus} from '../../src/features/play/ParticipantSyncStatus';
import {readDrafts,writeDraft,mergeDrafts} from './drafts';
import {AlkaneAnswerView,AlkanePromptSummary} from './Review';
import {readEditorPosition,saveEditorPosition} from './editor-position';
import {isAnswerEmpty} from '../game/evaluator';
import type {ClientMessage,Snapshot,Verdict} from './protocol';
export function Player({state,enabled,now,verdict,status,error,send}:{state:Snapshot;enabled:boolean;now:number;verdict:Verdict|null;status:string;error:string;send(message:ClientMessage):Promise<Snapshot>}){
 const deferred=state.room.settings.gradingMode==='deferred',own=state.own!,room=state.room;
 const [review,setReview]=useState(state.review),[ordinal,setOrdinalValue]=useState(()=>Math.min(room.settings.questionCount-1,readEditorPosition(`${room.code}:${own.id}:question`)??0)),[target,setTarget]=useState<number|null>(null),[reviewing,setReviewing]=useState(false),[confirm,setConfirm]=useState(false),[values,setValues]=useState<Record<string,string>>(state.drafts??{}),[loaded,setLoaded]=useState(false),[storageError,setStorageError]=useState(''),[message,setMessage]=useState(''),[submitting,setSubmitting]=useState(false);
 const [localSaving,setLocalSaving]=useState(false);
 function setOrdinal(index:number){setOrdinalValue(index);saveEditorPosition(`${room.code}:${own.id}:question`,index,room.expiresAtMs);}
 const latest=useRef(values),server=useRef(state.drafts??{}),seq=useRef(own.lastSeq),saving=useRef<Promise<void>|null>(null),persisting=useRef(Promise.resolve()),capturedAt=useRef(now),alive=useRef(true),finalizing=useRef(false),latestNow=useRef(now);latestNow.current=now;
 useEffect(()=>()=>{alive.current=false;},[]);
 useEffect(()=>{seq.current=Math.max(seq.current,own.lastSeq);server.current=state.drafts??{};if(state.review)setReview(state.review);},[state]);
 useEffect(()=>{void readDrafts(room.code,own.id).then(records=>{if(!alive.current)return;const known=new Set((state.deferred?.questions??state.review?.questions??(state.question?[state.question]:[])).map(q=>q.id));const valid=records.filter(r=>known.has(r.question.split(':')[0])||!deferred);const merged=mergeDrafts(state.drafts??{},valid,Date.now(),room.code);latest.current=merged;setValues(merged);if(valid.length)capturedAt.current=Math.max(...valid.map(r=>r.updatedAtMs));setLoaded(true);}).catch(()=>{setStorageError('この端末への保存を確認できません。保存設定を確認してください');});},[room.code,own.id]);
 const questions=deferred?state.deferred?.questions??[]:review?.questions??[];
 const q=deferred?questions[ordinal]:target!==null?questions[target]:state.question;
 const waiting=Math.max(0,Math.ceil((room.startAtMs!-now)/1000)),remaining=Math.max(0,Math.ceil(((room.cutoffAtMs??room.deadlineAtMs!)-now)/1000));
 const canEdit=loaded&&!storageError&&!submitting&&!status.startsWith('別のタブ')&&room.state!=='COLLECTING'&&remaining>0&&waiting===0;
 const field=q?.fields[0].id,key=q&&field?`${q.id}:${field}`:null;
 async function flush(){
  if(saving.current){await saving.current;return flush();}
  await persisting.current;if(storageError)throw new Error(storageError);
  const all=deferred?questions:questions.length?questions:state.question?[state.question]:[];
  const answers=all.flatMap(item=>item.fields.filter(f=>latest.current[`${item.id}:${f.id}`]!==undefined&&latest.current[`${item.id}:${f.id}`]!==server.current[`${item.id}:${f.id}`]).map(f=>({questionId:item.id,fieldId:f.id,value:latest.current[`${item.id}:${f.id}`]})));
  if(!answers.length)return;
  const operation=send({type:'draft',seq:seq.current+1,answers,capturedAtMs:capturedAt.current}).then(next=>{seq.current=next.own!.lastSeq;server.current=next.drafts??{};if(alive.current)setMessage('');});saving.current=operation.finally(()=>{saving.current=null;});await saving.current;
 }
 function update(value:string){if(!key||!canEdit)return;capturedAt.current=latestNow.current;const next={...latest.current,[key]:value};latest.current=next;setValues(next);setLocalSaving(true);const record={key:`${room.code}:${own.id}:${key}`,room:room.code,participant:own.id,question:key,value,updatedAtMs:capturedAt.current,expiresAtMs:room.expiresAtMs};persisting.current=persisting.current.then(()=>writeDraft(record)).then(()=>{if(alive.current)setLocalSaving(false);}).catch(()=>{if(alive.current)setStorageError('端末に解答を保存できません。画面を閉じず、保存を再試行してください');throw new Error('端末保存未確認');});void persisting.current.catch(()=>{});}
 // Fixed interval puts an upper bound on buffering even during continuous edits.
 const flushRef=useRef(flush);flushRef.current=flush;
 useEffect(()=>{if(!loaded||!enabled||waiting||remaining===0)return;const timer=setInterval(()=>{void flushRef.current().catch(e=>{if(alive.current)setMessage(e.message);});},1500);return()=>clearInterval(timer);},[loaded,enabled,waiting,remaining===0]);
 async function openReview(){try{await flush();if(!deferred){const next=await send({type:'review'});setReview(next.review);}setTarget(null);setReviewing(true);setConfirm(false);}catch(e){setMessage((e as Error).message);}}
 useEffect(()=>{if(!deferred&&!state.question&&target===null&&enabled&&!reviewing&&room.state!=='COLLECTING')void openReview();},[state.question,enabled,room.state]);
 async function action(type:'answer'|'pass'){if(!q||!field||!enabled||!canEdit)return;try{await flush();const next=await send({type,seq:seq.current+1,questionId:q.id,fieldId:field,...(type==='answer'?{value:latest.current[`${q.id}:${field}`]}:{})});seq.current=next.own!.lastSeq;if(target!==null&&type==='answer'&&next.own!.correctCount>own.correctCount){setTarget(null);setReviewing(true);const refreshed=await send({type:'review'});setReview(refreshed.review);}}catch(e){setMessage((e as Error).message);}}
 async function submit(final=false){if(!enabled||finalizing.current)return;finalizing.current=true;setSubmitting(true);setMessage('');try{await flush();await send({type:'submit',seq:seq.current+1,...(final?{final:true}:{capturedAtMs:latestNow.current})});}catch(e){finalizing.current=false;if(alive.current){setSubmitting(false);setMessage((e as Error).message);}}}
 useEffect(()=>{if(room.state==='COLLECTING'&&enabled&&loaded&&!storageError)void submit(true);},[room.state,enabled,loaded,storageError]);
 const feedback=<ImmediateVerdict verdict={!deferred&&verdict&&!verdict.passed?{attemptId:String(own.lastSeq),correct:verdict.correct,questionNumber:verdict.questionNumber??1,fieldLabel:verdict.fieldId==='formula'?'構造':'名称',fullScore:own.correctCount===room.maxScore}:null}/>;
 const filled=Object.values(values).filter(v=>!isAnswerEmpty(v)).length;
 const scorebar=<header className="scorebar"><span>{reviewing?'全解答確認':`第${(q?.ordinal??0)+1}問 / 全${room.settings.questionCount}問`}</span><span>{deferred?`入力済み ${filled}`:`正解 ${own.correctCount}`} / {room.maxScore}</span><span>残り {String(Math.floor(remaining/60)).padStart(2,'0')}:{String(remaining%60).padStart(2,'0')}</span></header>;
 const dirty=Object.entries(values).some(([k,v])=>v!==(state.drafts??{})[k]);
 const sync=<ParticipantSyncStatus text={storageError||message||error||(!loaded?'端末の記録を読み込み中…':localSaving?'端末に保存中…':status==='接続済み'?(dirty?'端末に保存済み・サーバーへ同期中…':'端末・サーバーに保存済み'):status==='送信中'?'端末に保存済み・同期中…':`${status}・端末に保存済み`)} action={storageError?'保存を再試行':undefined} onAction={()=>{persisting.current=Promise.resolve();setStorageError('');for(const [question,value]of Object.entries(latest.current))persisting.current=persisting.current.then(()=>writeDraft({key:`${room.code}:${own.id}:${question}`,room:room.code,participant:own.id,question,value,updatedAtMs:capturedAt.current,expiresAtMs:room.expiresAtMs}));void persisting.current.then(()=>setLoaded(true)).catch(()=>setStorageError('端末保存未確認'));}}/>;
 if(waiting>0)return <main className="countdown"><p>まもなく開始</p><strong>{waiting}</strong></main>;
 if(room.state==='COLLECTING'||submitting)return <main className="page-shell"><section className="panel"><h1>記録を確認しています</h1>{sync}</section></main>;
 if(reviewing||!q)return <main className="play-shell play-active">{scorebar}{sync}{feedback}<section className="panel wide"><h1>全解答確認</h1><ol className="review-list">{questions.map((item,index)=>{const f=item.fields[0].id,answerState=review?.fields[`${item.id}:${f}`];return <li className="review-card" key={item.id}><AlkanePromptSummary prompt={item.prompt}/><AlkaneAnswerView raw={values[`${item.id}:${f}`]??null} fieldId={f} label="現在の解答"/><span>第{index+1}問　{deferred?(isAnswerEmpty(values[`${item.id}:${f}`])?'未入力':'入力済み'):answerState==='correct'?'正解':answerState==='passed'?'パス':'未正解'}</span><button type="button" disabled={!canEdit||(!deferred&&(answerState==='correct'||item.ordinal>own.questionIndex))} onClick={()=>{setReviewing(false);setConfirm(false);if(deferred)setOrdinal(index);else setTarget(index);}}>この問題へ</button></li>;})}</ol>{!deferred&&state.question&&<button disabled={!canEdit} onClick={()=>{setTarget(null);setReviewing(false);}}>続きの問題へ</button>}{confirm?<div role="alertdialog" aria-label="提出の最終確認"><p>提出後は解答に戻れません。</p><div className="submission-confirm-actions"><button onClick={()=>setConfirm(false)}>取り消す</button><button className="primary-action" disabled={!enabled||!canEdit} onClick={()=>void submit()}>提出を確定する</button></div></div>:<button className="primary-action" disabled={!enabled||!canEdit} onClick={()=>setConfirm(true)}>このまま提出</button>}</section></main>;
 const nameMode=q.prompt.mode==='name';
 const check=<button className="check-action" disabled={!enabled||!canEdit||!key||isAnswerEmpty(values[key])} onClick={()=>void action('answer')}>{nameMode?'解答':'チェック'}</button>;
 const pass=<button className="pass-action" disabled={!enabled||!canEdit} onClick={()=>void action('pass')}>パス</button>;
 const reviewButton=<button className="review-action" disabled={!enabled||!canEdit} onClick={()=>void openReview()}>全解答確認</button>;
 const actions=deferred?null:nameMode?<>{check}{pass}</>:check;
 return <main className="play-shell play-active play-answering">{scorebar}{sync}{feedback}<QuestionView key={q.id} question={q} fieldId={field} value={key?values[key]:undefined} onChange={update} disabled={!canEdit} storageKey={`${room.code}:${own.id}:${q.id}`} expiresAtMs={room.expiresAtMs} actions={actions} arrangeActions={!deferred&&!nameMode?{pass,review:reviewButton}:undefined}/>{(deferred||nameMode)&&<section className="answer-area"><div className={`immediate-actions${deferred?' question-navigation':''}`}>{deferred?<><button disabled={!canEdit||ordinal===0} onClick={()=>{setOrdinal(ordinal-1);void flush().catch(e=>setMessage(e.message));}}>前の問題</button><button disabled={!canEdit||ordinal===questions.length-1} onClick={()=>{setOrdinal(ordinal+1);void flush().catch(e=>setMessage(e.message));}}>次の問題</button></>:!nameMode?pass:null}{reviewButton}</div></section>}</main>;
}
