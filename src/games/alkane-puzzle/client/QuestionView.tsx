"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { PublicQuestion } from "../shared/types";
import { AlkaneBoard, PaletteIcon, applyBoardEdit, type BoardGrid, type Panel } from "./AlkaneBoard";
import { NameWordBank } from "./NameWordBank";

function parseAnswer<T>(value: string | undefined, key: string, fallback: T): T {
  if (!value) return fallback;
  try { const parsed = JSON.parse(value) as Record<string, unknown>; return parsed[key] as T ?? fallback; } catch { return fallback; }
}
const pens = { yellow:["rgba(255,235,0,.46)",22.5], pink:["rgba(255,105,180,.46)",22.5], red:["rgba(240,68,58,.94)",3.2], blue:["rgba(22,141,225,.94)",3.2], green:["rgba(21,163,93,.94)",3.2] } as const;
type Stroke = { pen:keyof typeof pens; points:{x:number;y:number}[] };
type MarkupStorage=Pick<Storage,'length'|'key'|'getItem'|'removeItem'>;
function validStroke(value:unknown):value is Stroke {
  if (!value || typeof value!=='object') return false;
  const stroke=value as Stroke;
  return Object.hasOwn(pens,stroke.pen) && Array.isArray(stroke.points) && stroke.points.length>0 && stroke.points.length<=2048 && stroke.points.every(point=>point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x>=0 && point.x<=1 && point.y>=0 && point.y<=1);
}
function validMarkup(value:unknown,nowMs:number):value is {expiresAtMs:number;strokes:Stroke[]} {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  const data=value as {expiresAtMs?:unknown;strokes?:unknown};
  return typeof data.expiresAtMs==='number' && Number.isFinite(data.expiresAtMs) && data.expiresAtMs>nowMs && Array.isArray(data.strokes) && data.strokes.length<=100 && data.strokes.every(validStroke);
}
export function restoreMarkupStrokes(storage:MarkupStorage,key:string,nowMs=Date.now()):Stroke[] {
  const raw=storage.getItem(key);if (raw===null) return [];
  try {const data=JSON.parse(raw) as unknown;if (validMarkup(data,nowMs)) return data.strokes;} catch { /* malformed old data */ }
  storage.removeItem(key);return [];
}
export function pruneExpiredMarkup(storage:MarkupStorage,nowMs=Date.now()) {
  const keys:string[]=[];
  for (let index=0;index<storage.length;index++) {const key=storage.key(index);if (key?.startsWith('alkane-markup:')) keys.push(key);}
  for (const key of keys) restoreMarkupStrokes(storage,key,nowMs);
}
export function updateMarkupExpiry(storage:MarkupStorage & Pick<Storage,"setItem">,prefix:string,expiresAtMs:number,nowMs=Date.now()) {
  const keys:string[]=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))keys.push(key);}
  for(const key of keys){const strokes=restoreMarkupStrokes(storage,key,nowMs);if(storage.getItem(key)!==null){if(expiresAtMs<=nowMs)storage.removeItem(key);else storage.setItem(key,JSON.stringify({expiresAtMs,strokes}));}}
}
function Markup({ children, label, storageKey, expiresAtMs }: { children:ReactNode; label:string; storageKey:string; expiresAtMs?:number }) {
  const [open,setOpen] = useState(false), [pen,setPen] = useState<keyof typeof pens>("yellow"), [strokes,setStrokes] = useState<Stroke[]>(() => typeof window!=="undefined" && expiresAtMs && expiresAtMs>Date.now() ? restoreMarkupStrokes(localStorage,storageKey):[]), [undone,setUndone] = useState<Stroke[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef<Stroke | null>(null), redraw = useRef<() => void>(() => {});
  useEffect(() => { if (!expiresAtMs || expiresAtMs<=Date.now()) return;try {localStorage.setItem(storageKey,JSON.stringify({expiresAtMs,strokes}));} catch { /* local markup remains available this session */ } },[storageKey,strokes,expiresAtMs]);
  useEffect(() => { if (!expiresAtMs) return;const remove=()=>{try {localStorage.removeItem(storageKey);} catch { /* private storage may be unavailable */ }};const remaining=expiresAtMs-Date.now();if (remaining<=0) {remove();return;}const timer=setTimeout(remove,remaining);return () => clearTimeout(timer); },[storageKey,expiresAtMs]);
  useEffect(() => { const element=canvas.current; if (!element) return; const draw=() => { const rect=element.getBoundingClientRect(), ratio=Math.min(window.devicePixelRatio || 1,3); if (!rect.width || !rect.height) return; const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);if (element.width!==width || element.height!==height) {element.width=width;element.height=height;}const ctx=element.getContext("2d");if (!ctx) return;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,rect.width,rect.height);for (const stroke of [...strokes,...(drawing.current ? [drawing.current] : [])]) {ctx.beginPath();ctx.strokeStyle=pens[stroke.pen][0];ctx.fillStyle=pens[stroke.pen][0];ctx.lineWidth=pens[stroke.pen][1];ctx.lineCap="round";ctx.lineJoin="round";stroke.points.forEach((p,i) => i ? ctx.lineTo(p.x*rect.width,p.y*rect.height) : ctx.moveTo(p.x*rect.width,p.y*rect.height));if (stroke.points.length===1) {const p=stroke.points[0];ctx.arc(p.x*rect.width,p.y*rect.height,pens[stroke.pen][1]/2,0,Math.PI*2);ctx.fill();} else ctx.stroke();}};redraw.current=draw;draw();const observer=new ResizeObserver(draw);observer.observe(element);return () => observer.disconnect(); },[strokes,open]);
  function point(event:ReactPointerEvent<HTMLCanvasElement>) { const rect=event.currentTarget.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)),y:Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))}; }
  return <div className="alkane-markup-wrap"><div className="alkane-markup-surface">{children}<canvas ref={canvas} className={`alkane-markup-canvas ${open ? "active" : ""}`} aria-label={label} onPointerDown={event => {if (!open) return;event.currentTarget.setPointerCapture(event.pointerId);drawing.current={pen,points:[point(event)]};redraw.current();}} onPointerMove={event => {if (!drawing.current || drawing.current.points.length>=2048) return;drawing.current.points.push(point(event));redraw.current();}} onPointerUp={() => {if (!drawing.current) return;setStrokes([...strokes,drawing.current].slice(-100));drawing.current=null;setUndone([]);}} onPointerCancel={() => {drawing.current=null;redraw.current();}}/></div><div className="alkane-markup-tools"><button type="button" aria-pressed={open} onClick={() => setOpen(!open)}>書き込み {open ? "終了" : "開始"}</button>{open && <>{(Object.keys(pens) as (keyof typeof pens)[]).map(key => <button type="button" key={key} className={`markup-pen ${key}`} aria-pressed={pen===key} aria-label={`${key}のペン`} onClick={() => setPen(key)}/>)}<button type="button" disabled={!strokes.length} onClick={() => {setUndone([...undone,strokes.at(-1)!]);setStrokes(strokes.slice(0,-1));}}>戻す</button><button type="button" disabled={!undone.length} onClick={() => {setStrokes([...strokes,undone.at(-1)!]);setUndone(undone.slice(0,-1));}}>やり直す</button><button type="button" disabled={!strokes.length} onClick={() => {setStrokes([]);setUndone([]);}}>消す</button></>}</div></div>;
}
const defaultPalette:Panel[] = [1,2,3,4,5].map(type => ({type,rotation:type===2 ? 90 : 0}));
export function QuestionView({ question, fieldId, value, onChange, disabled, storageKey, expiresAtMs }: { question:PublicQuestion; fieldId?:"formula"|"name"; value?:string; onChange?:(value:string)=>void; disabled?:boolean; storageKey?:string; expiresAtMs?:number }) {
  const [selected,setSelected] = useState<Panel | null>(null);
  useEffect(() => setSelected(null), [question.id]);
  const prompt=question.prompt;
  if (prompt.kind!=="alkane") return <section className="question-card" aria-label="問題"/>;
  if (prompt.mode==="arrange") {
    const shape=Array.from({length:5},() => Array<Panel|null>(7).fill(null));
    const blank=shape.map(row => row.map(() => null));
    const saved=parseAnswer<BoardGrid>(value,"grid",blank);
    const grid=Array.isArray(saved) && saved.length===blank.length && saved.every((row,i) => Array.isArray(row) && row.length===blank[i].length) ? saved : blank;
    const options=prompt.options?.length ? prompt.options : defaultPalette;
    return <section className="question-card alkane-question" aria-label="問題"><div className="alkane-objective">この名前の構造を並べよう</div><Markup key={`${storageKey ?? question.id}:objective`} storageKey={`alkane-markup:${storageKey ?? question.id}:objective`} expiresAtMs={expiresAtMs} label="化合物名へのマーキング領域"><span className="alkane-markup-text">{prompt.name}</span></Markup><AlkaneBoard grid={grid} interactionKey={question.id} bounds={prompt.bounds} label="解答の構造" selected={selected} disabled={disabled || !onChange || fieldId==="name"} onChange={onChange ? next => onChange(JSON.stringify({grid:next})) : undefined}/><div className="alkane-palette" aria-label="原子パレット">{options.map((panel,index) => <button type="button" key={index} className="alkane-palette-card" aria-pressed={selected?.type===panel.type && selected.element===panel.element} disabled={disabled || !onChange} onClick={() => setSelected(selected?.type===panel.type && selected.element===panel.element ? null : panel)} onPointerDown={event => {if (!onChange || disabled) return;event.currentTarget.dataset.startX=String(event.clientX);event.currentTarget.dataset.startY=String(event.clientY);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerUp={event => {if (!onChange || disabled) return;const x=Number(event.currentTarget.dataset.startX),y=Number(event.currentTarget.dataset.startY);if (Math.hypot(event.clientX-x,event.clientY-y)<10) return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>("[data-alkane-cell]");if (target?.dataset.active === "true") onChange(JSON.stringify({grid:applyBoardEdit(grid,{type:"place",row:Number(target.dataset.row),col:Number(target.dataset.col),panel})}));}}><span className="alkane-palette-icon"><PaletteIcon panel={panel}/></span><span>{panel.element ?? ["","末端","直線","かど","分岐","四級"][panel.type]}</span></button>)}</div><button type="button" className="alkane-reset" disabled={disabled || !onChange || grid.every(row => row.every(panel => !panel))} onClick={() => onChange?.(JSON.stringify({grid:blank}))}>全部消す</button><p className="alkane-gesture-help">空きマスや炭素をなぞって結合。パネルを選んで配置し、1回で回転、2回で逆回転、3回で削除、長押しで移動。</p></section>;
  }
  const tokens=parseAnswer<string[]>(value,"tokens",[]);
  return <section className="question-card alkane-question" aria-label="問題"><p className="alkane-objective">この構造に名前を付けよう</p>{prompt.grid && <Markup key={`${storageKey ?? question.id}:structure`} storageKey={`alkane-markup:${storageKey ?? question.id}:structure`} expiresAtMs={expiresAtMs} label="アルカン構造へのマーキング領域"><AlkaneBoard grid={prompt.grid} label="問題の構造"/></Markup>}<NameWordBank groups={prompt.wordBank ?? []} tokens={Array.isArray(tokens) ? tokens : []} onChange={next => onChange?.(JSON.stringify({tokens:next}))} disabled={disabled || !onChange || fieldId==="formula"}/></section>;
}
