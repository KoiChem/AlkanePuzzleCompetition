"use client";
import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {readEditorPosition,saveEditorPosition} from '../../src/editor-position';

export type TokenEdit={type:'insert';token:string;index:number}|{type:'move';from:number;to:number}|{type:'remove';index:number}|{type:'clear'};
export function applyTokenEdit(tokens:readonly string[],edit:TokenEdit):string[]{
 const next=[...tokens];
 if(edit.type==='insert')next.splice(Math.max(0,Math.min(edit.index,next.length)),0,edit.token);
 if(edit.type==='move'&&edit.from>=0&&edit.from<next.length){const target=Math.max(0,Math.min(edit.to,next.length));const [token]=next.splice(edit.from,1);next.splice(target>edit.from?target-1:target,0,token);}
 if(edit.type==='remove')next.splice(edit.index,1);
 return edit.type==='clear'?[]:next;
}
const multiplier=new Set(['ジ','トリ','テトラ','ペンタ','ヘキサ','ヘプタ','オクタ','ノナ','デカ']);
const subnames=new Set(['メチル','エチル','フルオロ','クロロ','ブロモ','ヨード']);
function category(token:string){return /^\d+$/u.test(token)?'number':multiplier.has(token)?'multiplier':subnames.has(token)?'subname':'basename';}
function tokenClass(token:string){return `cat-${category(token)}${token==='シクロ'||token==='オール'?' special-affix':''}`;}
type Drag={token:string;from:number|null;id:number;startX:number;startY:number;source:DOMRect;dragging:boolean;target:number;trash:boolean;cleanup():void};
export function NameWordBank({groups,tokens,onChange,disabled,storageKey,expiresAtMs,actions,tools}:{groups:readonly (readonly string[])[];tokens:readonly string[];onChange(tokens:string[]):void;disabled?:boolean;storageKey?:string;expiresAtMs?:number;actions?:ReactNode;tools?:ReactNode}){
 const [cursor,setCursorValue]=useState<number|null>(()=>storageKey?readEditorPosition(storageKey):null);
 const [ghost,setGhost]=useState<{token:string;x:number;y:number}|null>(null),[marker,setMarker]=useState<number|null>(null),[trash,setTrash]=useState(false),[dragFrom,setDragFrom]=useState<number|null>(null),[guarded,setGuarded]=useState(false);
 const preview=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null),guardTimer=useRef<ReturnType<typeof setTimeout>|null>(null),height=useRef<number|null>(null);
 const latest=useRef({tokens,onChange,disabled,cursor});latest.current={tokens,onChange,disabled,cursor};
 function setCursor(value:number|null){setCursorValue(value);if(storageKey&&expiresAtMs)saveEditorPosition(storageKey,value??-1,expiresAtMs);}
 function edit(operation:TokenEdit){if(latest.current.disabled||operation.type==='insert'&&latest.current.tokens.length>=40)return;latest.current.onChange(applyTokenEdit(latest.current.tokens,operation));setCursor(null);}
 function resetDrag(){drag.current?.cleanup();drag.current=null;setGhost(null);setMarker(null);setTrash(false);setDragFrom(null);}
 useEffect(()=>{const cancel=()=>resetDrag();window.addEventListener('blur',cancel);return()=>{window.removeEventListener('blur',cancel);drag.current?.cleanup();if(guardTimer.current)clearTimeout(guardTimer.current);};},[]);
 useEffect(()=>{if(disabled)resetDrag();},[disabled]);
 useLayoutEffect(()=>{const next=preview.current?.getBoundingClientRect().height;if(next!==undefined&&height.current!==null&&Math.abs(height.current-next)>.5){setGuarded(true);if(guardTimer.current)clearTimeout(guardTimer.current);guardTimer.current=setTimeout(()=>setGuarded(false),250);}height.current=next??null;},[tokens]);
 function insertionAt(x:number,y:number){const chips=preview.current?.querySelectorAll<HTMLElement>('[data-token-index]')??[];for(const chip of chips){const rect=chip.getBoundingClientRect();if(y<rect.top||(y<=rect.bottom&&x<rect.left+rect.width/2))return Number(chip.dataset.tokenIndex);}return latest.current.tokens.length;}
 function begin(event:ReactPointerEvent<HTMLButtonElement>,token:string,from:number|null){
  if(disabled||drag.current||!event.isPrimary||event.button!==0)return;
  event.preventDefault();const element=preview.current!;event.currentTarget.focus({preventScroll:true});
  const state:Drag={token,from,id:event.pointerId,startX:event.clientX,startY:event.clientY,source:event.currentTarget.getBoundingClientRect(),dragging:false,target:tokens.length,trash:false,cleanup:()=>{}};drag.current=state;
  try{element.setPointerCapture(state.id);}catch{}
  function move(e:PointerEvent){
   if(e.pointerId!==state.id||drag.current!==state)return;
   if(!state.dragging&&Math.hypot(e.clientX-state.startX,e.clientY-state.startY)<8)return;
   e.preventDefault();state.dragging=true;setDragFrom(state.from);setGhost({token:state.token,x:e.clientX,y:e.clientY});
   const rect=element.getBoundingClientRect();state.trash=state.from!==null&&(e.clientY<rect.top-18||e.clientY>rect.bottom+18);setTrash(state.trash);
   if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom){state.target=insertionAt(e.clientX,e.clientY);setMarker(state.target);}else setMarker(null);
   if(from===null&&scroll.current&&scroll.current.scrollHeight>scroll.current.clientHeight){const box=scroll.current.getBoundingClientRect();if(e.clientY<box.top+34)scroll.current.scrollTop-=Math.ceil((box.top+34-e.clientY)/5);else if(e.clientY>box.bottom-34)scroll.current.scrollTop+=Math.ceil((e.clientY-box.bottom+34)/5);}
  }
  function up(e:PointerEvent){
   if(e.pointerId!==state.id||drag.current!==state)return;e.preventDefault();const rect=element.getBoundingClientRect();resetDrag();
   if(!state.dragging){if(state.from===null)edit({type:'insert',token:state.token,index:latest.current.cursor??latest.current.tokens.length});else setCursor(state.startX<state.source.left+state.source.width/2?state.from:state.from+1);return;}
   if(state.trash&&state.from!==null)edit({type:'remove',index:state.from});
   else if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom)edit(state.from===null?{type:'insert',token:state.token,index:state.target}:{type:'move',from:state.from,to:state.target});
  }
  function cancel(e:PointerEvent){if(e.pointerId===state.id)resetDrag();}
  state.cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);try{if(element.hasPointerCapture(state.id))element.releasePointerCapture(state.id);}catch{}};
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
 }
 const insert=ghost?marker:cursor===null||cursor<0?null:Math.min(cursor,tokens.length);
 const markerElement=<span className="alkane-insert-marker" aria-hidden="true"/>;
 return <><div className="alkane-wordbank" onContextMenu={e=>e.preventDefault()} onDragStart={e=>e.preventDefault()}>
  <div className="alkane-token-controls" role="toolbar" aria-label="解答クリアとマーキングツール"><button type="button" disabled={disabled||!tokens.length} onClick={()=>edit({type:'clear'})}>クリア</button>{tools}</div>
  <div ref={preview} className={`alkane-answer-tokens${trash?' delete-armed':''}`} aria-label="名前の解答" onPointerDown={e=>{if(e.target===e.currentTarget&&!disabled)setCursor(null);}}>
   {tokens.map((token,index)=><span className="alkane-chip-slot" key={`${index}-${token}`}>{insert===index&&markerElement}<button type="button" className={`alkane-token ${tokenClass(token)}${dragFrom===index&&ghost?' drag-origin':''}`} data-token-index={index} disabled={disabled} onPointerDown={e=>begin(e,token,index)} onClick={e=>{if(e.detail===0)setCursor(index);}} onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();edit({type:'remove',index});}else if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();edit({type:'move',from:index,to:Math.max(0,index-1)});}else if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();edit({type:'move',from:index,to:Math.min(tokens.length,index+2)});}}} aria-label={`${token}（解答の${index+1}番目）`}>{token}</button></span>)}
   {insert===tokens.length&&markerElement}{trash&&<span className="alkane-answer-trash">削除</span>}
  </div>
  <div ref={scroll} className="alkane-token-scroll">{groups.map((group,index)=><div className={`alkane-word-row cat-${category(group[0]??'')}`} key={index}>{group.map((token,i)=><button type="button" key={`${token}-${i}`} className={tokenClass(token)} disabled={disabled||tokens.length>=40} onPointerDown={e=>begin(e,token,null)} onClick={e=>{if(e.detail===0)edit({type:'insert',token,index:latest.current.cursor??latest.current.tokens.length});}}>{token}</button>)}</div>)}</div>
  {ghost&&createPortal(<span className={`alkane-token alkane-token-ghost ${tokenClass(ghost.token)}`} style={{left:ghost.x,top:ghost.y}}>{ghost.token}</span>,document.body)}
 </div>{actions&&<div className="immediate-actions name-immediate-actions" inert={guarded||undefined}>{actions}</div>}</>;
}
