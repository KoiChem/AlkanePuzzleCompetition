"use client";
import { useRef,useState } from "react";

import {readEditorPosition,saveEditorPosition} from '../../src/editor-position';

export type TokenEdit = { type:"insert"; token:string; index:number } | { type:"move"; from:number; to:number } | { type:"remove"; index:number } | { type:"clear" };
export function applyTokenEdit(tokens: readonly string[], edit: TokenEdit): string[] {
  const next = [...tokens];
  if (edit.type === "insert") next.splice(Math.max(0, Math.min(edit.index, next.length)), 0, edit.token);
  if (edit.type === "move" && edit.from >= 0 && edit.from < next.length) { const [token] = next.splice(edit.from,1); next.splice(Math.max(0,Math.min(edit.to, next.length)),0,token); }
  if (edit.type === "remove") next.splice(edit.index,1);
  if (edit.type === "clear") return [];
  return next;
}
const numberToken = /^\d+(?:,\d+)*$/u;
const multiplier = new Set(["ジ","トリ","テトラ","ペンタ","ヘキサ","ヘプタ","オクタ","ノナ","デカ"]);
const base = /(?:タン|オール)$/u;
function category(token: string) { return numberToken.test(token) ? "number" : multiplier.has(token) ? "multiplier" : base.test(token) || token === "シクロ" ? "basename" : "subname"; }
export function NameWordBank({ groups, tokens, onChange, disabled, storageKey, expiresAtMs }: { groups: readonly (readonly string[])[]; tokens: readonly string[]; onChange(tokens:string[]):void; disabled?:boolean;storageKey?:string;expiresAtMs?:number }) {
  const [cursor,setCursor]=useState<number|null>(()=>storageKey?readEditorPosition(storageKey):null);
  const dragged = useRef<number | null>(null);
  const pointer = useRef<{index:number;x:number;y:number}|null>(null);
  const skipClick = useRef(false);
  const send = (edit:TokenEdit) => { if (disabled || edit.type==='insert'&&tokens.length>=40)return;onChange(applyTokenEdit(tokens,edit));if(edit.type==='insert'&&cursor!==null){const next=Math.min(cursor,tokens.length)+1;setCursor(next);if(storageKey&&expiresAtMs)saveEditorPosition(storageKey,next,expiresAtMs);} };
  return <div className="alkane-wordbank"><div className="alkane-answer-tokens" aria-label="名前の解答" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged.current !== null) send({type:"move",from:dragged.current,to:tokens.length}); dragged.current=null; }}>
    {tokens.length === 0 && <span className="alkane-answer-placeholder">語句を選んで名前を作る</span>}
    {tokens.map((token,index) => <button key={`${index}-${token}`} type="button" className={`alkane-token cat-${category(token)}`} data-token-index={index} draggable={!disabled} disabled={disabled} onDragStart={() => { dragged.current=index; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragged.current !== null) send({type:"move",from:dragged.current,to:index}); dragged.current=null; }} onPointerDown={event => {pointer.current={index,x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerUp={event => {const start=pointer.current;pointer.current=null;if (!start || Math.hypot(event.clientX-start.x,event.clientY-start.y)<10) return;skipClick.current=true;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>("[data-token-index]");if (target) send({type:"move",from:start.index,to:Number(target.dataset.tokenIndex)});else if (document.elementFromPoint(event.clientX,event.clientY)?.closest(".alkane-answer-tokens")) send({type:"move",from:start.index,to:tokens.length});}} onClick={() => {if (skipClick.current) {skipClick.current=false;return;}send({type:"remove",index});}} aria-label={`${token}を外す`}>{token}</button>)}
  </div><div className="alkane-token-controls"><label>挿入位置<select aria-label="語句の挿入位置" value={cursor===null?tokens.length:Math.min(cursor,tokens.length)} disabled={disabled} onChange={e=>{const next=Number(e.target.value);setCursor(next===tokens.length?null:next);if(storageKey&&expiresAtMs)saveEditorPosition(storageKey,next,expiresAtMs);}}>{Array.from({length:tokens.length+1},(_,i)=><option key={i} value={i}>{i===tokens.length?'末尾':`${i+1}番目の前`}</option>)}</select></label><button type="button" disabled={disabled || tokens.length===0} onClick={() => send({type:"remove",index:tokens.length-1})}>ひとつ戻す</button><button type="button" disabled={disabled || tokens.length===0} onClick={() => send({type:"clear"})}>ぜんぶ消す</button></div>
  <div className="alkane-token-scroll">{groups.map((group,index) => <div className={`alkane-word-row cat-${category(group[0] ?? "")}`} key={index}>{group.map((token,i) => <button type="button" key={`${token}-${i}`} className={`cat-${category(token)}`} disabled={disabled || tokens.length>=40} onClick={() => send({type:"insert",token,index:cursor===null?tokens.length:Math.min(cursor,tokens.length)})}>{token}</button>)}</div>)}</div></div>;
}
