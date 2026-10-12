"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicQuestion } from "../types";
import { AlkaneBoard, PaletteIcon, applyBoardEdit, type BoardGrid, type Panel } from "./AlkaneBoard";
import {createPortal} from "react-dom";
import {CompoundName} from './CompoundName';
import { NameQuestion } from "./NameQuestion";

function parseAnswer<T>(value: string | undefined, key: string, fallback: T): T {
  if (!value) return fallback;
  try { const parsed = JSON.parse(value) as Record<string, unknown>; return parsed[key] as T ?? fallback; } catch { return fallback; }
}
const defaultPalette:Panel[] = [1,2,3,4,5].map(type => ({type,rotation:type===2 ? 90 : 0}));
const carbonLabels=['','1級炭素','2級炭素（直線）','2級炭素（折れ曲がり）','3級炭素','4級炭素'];
export function QuestionView({question,fieldId,value,onChange,disabled,storageKey,expiresAtMs,actions,arrangeActions,arrangeNavigation}:{question:PublicQuestion;fieldId?:"formula"|"name";value?:string;onChange?:(value:string)=>void;disabled?:boolean;storageKey?:string;expiresAtMs?:number;actions?:ReactNode;arrangeActions?:{pass:ReactNode;review:ReactNode};arrangeNavigation?:{previous:ReactNode;next:ReactNode;review:ReactNode}}){
 const [selected,setSelected]=useState<Panel|null>(null),[ghost,setGhost]=useState<{panel:Panel;x:number;y:number}|null>(null);
 const drag=useRef<{id:number;x:number;y:number;panel:Panel;moved:boolean}|null>(null);
 useEffect(()=>{setSelected(null);setGhost(null);drag.current=null;},[question.id,disabled]);
 useEffect(()=>{const cancel=()=>{drag.current=null;setGhost(null);};window.addEventListener('blur',cancel);return()=>window.removeEventListener('blur',cancel);},[]);
 const prompt=question.prompt;
 if(prompt.kind!=="alkane")return <section className="question-card" aria-label="問題"/>;
 if(prompt.mode==="arrange"){
  const blank=Array.from({length:5},()=>Array<Panel|null>(7).fill(null));
  const saved=parseAnswer<BoardGrid>(value,"grid",blank);
  const grid=Array.isArray(saved)&&saved.length===5&&saved.every(row=>Array.isArray(row)&&row.length===7)?saved:blank;
  const options=prompt.options?.length?prompt.options:defaultPalette;
  function toggle(panel:Panel){setSelected(selected?.type===panel.type&&selected.element===panel.element?null:panel);}
  const clear=<button type="button" className="alkane-reset" disabled={disabled||!onChange||grid.every(row=>row.every(panel=>!panel))} onClick={()=>onChange?.(JSON.stringify({grid:blank}))}>クリア</button>;
  return <section className="question-card alkane-question" data-mode="arrange" aria-label="問題">
   <div className="alkane-arrange-objective"><span className="alkane-objective-text"><CompoundName name={prompt.name??''}/></span>
    {!arrangeActions&&!arrangeNavigation&&<div className="alkane-objective-actions">{actions}{clear}</div>}
   </div>
   <AlkaneBoard grid={grid} interactionKey={question.id} bounds={prompt.bounds} label="解答の構造" selected={selected} disabled={disabled||!onChange||fieldId==="name"} onChange={onChange?next=>onChange(JSON.stringify({grid:next})):undefined}/>
   <div className="alkane-palette" aria-label="原子パレット" onContextMenu={e=>e.preventDefault()} onDragStart={e=>e.preventDefault()}>{[options.filter(p=>!p.element||p.element==='C'),options.filter(p=>p.element&&p.element!=='C')].map((panels,row)=><div className="alkane-palette-row" key={row}>{panels.map((panel,index)=><button type="button" key={index} className="alkane-palette-card" aria-label={panel.element??carbonLabels[panel.type]} title={panel.element??carbonLabels[panel.type]} aria-pressed={selected?.type===panel.type&&selected.element===panel.element} disabled={disabled||!onChange} onClick={e=>{if(e.detail===0)toggle(panel);}}
    onPointerDown={e=>{if(!onChange||disabled||!e.isPrimary||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,panel,moved:false};}}
    onPointerMove={e=>{const item=drag.current;if(!item||item.id!==e.pointerId)return;if(Math.hypot(e.clientX-item.x,e.clientY-item.y)>8){item.moved=true;setSelected(null);setGhost({panel,x:e.clientX,y:e.clientY});}}}
    onPointerUp={e=>{const item=drag.current;if(!item||item.id!==e.pointerId)return;drag.current=null;setGhost(null);if(!item.moved){toggle(panel);return;}const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-alkane-cell]');if(target?.dataset.active==='true')onChange?.(JSON.stringify({grid:applyBoardEdit(grid,{type:'place',row:Number(target.dataset.row),col:Number(target.dataset.col),panel})}));}}
    onPointerCancel={()=>{drag.current=null;setGhost(null);}}><span className="alkane-palette-icon"><PaletteIcon panel={panel}/></span></button>)}</div>)}</div>
   {arrangeActions&&<div className="immediate-actions arrange-immediate-actions">{arrangeActions.pass}{clear}{actions}{arrangeActions.review}</div>}
   {arrangeNavigation&&<div className="immediate-actions arrange-navigation">{arrangeNavigation.previous}{arrangeNavigation.next}{clear}{arrangeNavigation.review}</div>}
   {ghost&&createPortal(<div className="alkane-panel-ghost" style={{left:ghost.x,top:ghost.y}}><PaletteIcon panel={ghost.panel}/></div>,document.body)}
  </section>;
 }
 const tokens=parseAnswer<string[]>(value,'tokens',[]);
 return <NameQuestion question={question} tokens={Array.isArray(tokens)?tokens:[]} onChange={next=>onChange?.(JSON.stringify({tokens:next}))} disabled={disabled||!onChange||fieldId==='formula'} storageKey={storageKey} expiresAtMs={expiresAtMs} actions={actions}/>;
}
