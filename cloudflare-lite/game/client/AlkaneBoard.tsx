"use client";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {primePanelAudio,playPanelSound} from './panel-audio';
import {createPortal} from "react-dom";

export type Panel = { type: number; rotation: number; element?: string };
export type BoardGrid = (Panel | null)[][];
export type BoardEdit = { type: "place"; row: number; col: number; panel: Panel } | { type: "rotate" | "remove"; row: number; col: number; reverse?: boolean } | { type: "move"; row: number; col: number; toRow: number; toCol: number };
export function applyBoardEdit(grid: readonly (readonly (Panel | null)[])[], edit: BoardEdit): BoardGrid {
  const next = grid.map(row => row.map(panel => panel ? { ...panel } : null));
  if (!next[edit.row]?.hasOwnProperty(edit.col)) return next;
  if (edit.type === "place") next[edit.row][edit.col] = { ...edit.panel };
  if (edit.type === "rotate" && next[edit.row][edit.col]) next[edit.row][edit.col]!.rotation = (next[edit.row][edit.col]!.rotation + (edit.reverse ? 270 : 90)) % 360;
  if (edit.type === "remove") next[edit.row][edit.col] = null;
  if (edit.type === "move" && (edit.toRow !== edit.row || edit.toCol !== edit.col) && next[edit.toRow]?.hasOwnProperty(edit.toCol)) { next[edit.toRow][edit.toCol] = next[edit.row][edit.col]; next[edit.row][edit.col] = null; }
  return next;
}
export function occupiedRegion(grid:readonly (readonly (Panel|null)[])[]) {
  let top=grid.length,left=Infinity,bottom=-1,right=-1;
  grid.forEach((line,row)=>line.forEach((panel,col)=>{if(panel){top=Math.min(top,row);left=Math.min(left,col);bottom=Math.max(bottom,row);right=Math.max(right,col);}}));
  return bottom<0?null:{top,left,bottom,right};
}
const vectors = [[0,-1],[1,0],[0,1],[-1,0]] as const;
const arms: Record<number, number[]> = { 1:[1], 2:[0,2], 3:[0,1], 4:[0,3,1], 5:[0,1,2,3] };
export type TracePoint = { row:number; col:number };
export type TraceState = { path:TracePoint[]; closed:boolean };
type Bounds = { rows:number; cols:number };
function cloneGrid(grid:readonly (readonly (Panel|null)[])[]):BoardGrid { return grid.map(row=>row.map(panel=>panel ? {...panel}:null)); }
function isCarbon(panel:Panel|null|undefined) { return !panel?.element || panel.element==='C'; }
export function cellWithinBounds(grid:readonly (readonly (Panel|null)[])[],row:number,col:number,bounds?:Bounds) {
  if (!grid[row] || col<0 || col>=grid[row].length) return false;
  if (!bounds) return true;
  const startRow=Math.floor((grid.length-bounds.rows)/2), startCol=Math.floor(((grid[0]?.length ?? 0)-bounds.cols)/2);
  return row>=startRow && row<startRow+bounds.rows && col>=startCol && col<startCol+bounds.cols;
}
function direction(from:TracePoint,to:TracePoint) { return vectors.findIndex(([x,y])=>from.col+x===to.col && from.row+y===to.row); }
function panelForDirections(directions:Iterable<number>):Panel {
  const desired=new Set(directions);
  for (const type of [1,2,3,4,5]) for (const turns of [0,1,2,3]) {
    const rotated=(arms[type] ?? []).map(arm=>(arm+turns)%4);
    if (rotated.length===desired.size && rotated.every(arm=>desired.has(arm))) return {type,rotation:turns*90};
  }
  throw new Error('Unsupported carbon bond directions');
}
export function advanceTrace(snapshot:readonly (readonly (Panel|null)[])[],trace:TraceState,next:TracePoint,bounds?:Bounds):TraceState {
  if (trace.closed || !cellWithinBounds(snapshot,next.row,next.col,bounds)) return trace;
  const path=trace.path, last=path.at(-1);
  if (!last || direction(last,next)<0) return trace;
  if (path.length>=2 && next.row===path.at(-2)!.row && next.col===path.at(-2)!.col) return {path:path.slice(0,-1),closed:false};
  if (!isCarbon(snapshot[next.row][next.col])) return trace;
  const first=path[0];
  if (next.row===first.row && next.col===first.col) return path.length>=3 ? {path:[...path],closed:true}:trace;
  if (path.some(point=>point.row===next.row && point.col===next.col)) return trace;
  return {path:[...path,next],closed:false};
}
export function traceBoard(snapshot:readonly (readonly (Panel|null)[])[],trace:TraceState):BoardGrid {
  const result=cloneGrid(snapshot), {path,closed}=trace;
  for (let index=0;index<path.length;index++) {
    const point=path[index], directions:number[]=[];
    const previous=index>0 ? path[index-1]:closed ? path.at(-1):undefined;
    const following=index<path.length-1 ? path[index+1]:closed ? path[0]:undefined;
    if (previous) directions.push(direction(point,previous));
    if (following) directions.push(direction(point,following));
    if (!directions.length) continue;
    const existing=result[point.row][point.col];
    const existingDirections=existing ? (arms[existing.type] ?? []).map(arm=>(arm+Math.round(existing.rotation/90))%4):[];
    result[point.row][point.col]=panelForDirections([...existingDirections,...directions]);
  }
  return result;
}
export function createBoardTapController(getGrid:()=>BoardGrid,commit:(next:BoardGrid)=>void) {
  const pending=new Map<string,{count:number;timer:ReturnType<typeof setTimeout>|null;panel:Panel}>();
  const cancelAll=()=>{for (const item of pending.values()) if (item.timer) clearTimeout(item.timer);pending.clear();};
  const hold=(row:number,col:number)=>{const item=pending.get(`${row},${col}`);if (item?.timer) {clearTimeout(item.timer);item.timer=null;}};
  const tap=(row:number,col:number)=>{
    const panel=getGrid()[row]?.[col];if (!panel) return;
    const key=`${row},${col}`, old=pending.get(key);
    if (old?.timer) clearTimeout(old.timer);
    const current={count:(old?.count ?? 0)+1,timer:null as ReturnType<typeof setTimeout>|null,panel:old?.panel ?? {...panel}};
    pending.set(key,current);
    const settle=()=>{
      if (pending.get(key)!==current) return;
      pending.delete(key);
      const live=getGrid(), at=live[row]?.[col];
      if (!at || at.type!==current.panel.type || at.rotation!==current.panel.rotation || at.element!==current.panel.element) return;
      if (current.count>=3) commit(applyBoardEdit(live,{type:'remove',row,col}));
      else if (isCarbon(at)) commit(applyBoardEdit(live,{type:'rotate',row,col,reverse:current.count===2}));
    };
    if (current.count>=3) settle(); else current.timer=setTimeout(settle,220);
  };
  return {tap,hold,cancelAll,dispose:cancelAll};
}
const halogens: Record<string, { fill: string; stroke: string }> = { F:{fill:"#F7F2A0",stroke:"#B08D1A"}, Cl:{fill:"#E8F5D0",stroke:"#7CB518"}, Br:{fill:"#F3E0D6",stroke:"#A0522D"}, I:{fill:"#EBDFF5",stroke:"#7B4397"} };
function PanelIcon({ panel, grid, row, col }: { panel: Panel; grid?: readonly (readonly (Panel | null)[])[]; row?: number; col?: number }) {
  const element = panel.element;
  const isAtom = element && element !== "C";
  const active = new Set((arms[panel.type] ?? []).map(direction => (direction + Math.round(panel.rotation / 90)) % 4));
  if (isAtom && grid && row !== undefined && col !== undefined) {
    active.clear();
    vectors.forEach(([x,y], direction) => { const neighbor = grid[row + y]?.[col + x]; if (neighbor && isCarbon(neighbor) && (arms[neighbor.type] ?? []).some(arm => (arm + Math.round(neighbor.rotation / 90)) % 4 === (direction + 2) % 4)) active.add(direction); });
  }
  if (isAtom && !grid) active.clear();
  const bondDirection=active.values().next().value;
  const hydrogen=element==='OH'&&bondDirection!==undefined ? (()=>{const [x,y]=vectors[(bondDirection+2)%4];return <><line x1={50+x*13} y1={50+y*13} x2={50+x*25} y2={50+y*25} stroke="var(--muted)" strokeWidth="2" strokeLinecap="round"/><circle cx={50+x*32} cy={50+y*32} r="6" fill="var(--paper)" stroke="var(--muted)" strokeWidth="2"/></>;})() : <circle cx="64.1" cy="35.9" r="6" fill="var(--paper)" stroke="var(--muted)" strokeWidth="2"/>;
  return <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    {vectors.map(([x,y], direction) => active.has(direction) ? <line key={direction} x1={50+x*13} y1={50+y*13} x2={50+x*44} y2={50+y*44} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round"/> : !isAtom ? <g key={direction}><line x1={50+x*13} y1={50+y*13} x2={50+x*25} y2={50+y*25} stroke="var(--muted)" strokeWidth="2" strokeLinecap="round"/><circle cx={50+x*32} cy={50+y*32} r="6" fill="var(--paper)" stroke="var(--muted)" strokeWidth="2"/></g> : null)}
    {isAtom ? element === "OH" ? <>{hydrogen}<circle cx="50" cy="50" r="14" fill="#E8564F"/></> : <><circle cx="50" cy="50" r="27" fill={halogens[element]?.fill ?? "#fff"} stroke={halogens[element]?.stroke ?? "#333"} strokeWidth="2"/><text x="50" y="51" textAnchor="middle" dominantBaseline="central" fontSize={element.length === 1 ? "32" : "24"} fontWeight="700" fill={halogens[element]?.stroke ?? "#333"}>{element}</text></> : <circle cx="50" cy="50" r="14" fill="var(--ink)"/>}
  </svg>;
}
export function AlkaneBoard({ grid, label, onChange, selected, disabled, bounds, interactionKey, compact, promptCompact }: { grid: readonly (readonly (Panel | null)[])[]; label?: string; onChange?: (grid: BoardGrid) => void; selected?: Panel | null; disabled?: boolean; bounds?: Bounds; interactionKey?: string; compact?:boolean; promptCompact?:boolean }) {
  const board=useRef<HTMLDivElement>(null),[boardWidth,setBoardWidth]=useState(0);
  useLayoutEffect(()=>{const element=board.current;if(!element)return;const measure=()=>{const width=element.getBoundingClientRect().width;setBoardWidth(previous=>Math.abs(previous-width)<.1?previous:width);};measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[compact,promptCompact,grid]);
  const [viewport,setViewport]=useState(()=>({width:typeof window==="undefined"?320:window.innerWidth,height:typeof window==="undefined"?568:window.innerHeight}));
  useEffect(()=>{if(!promptCompact)return;const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);},[promptCompact]);
  const [ghost,setGhost]=useState<{panel:Panel;x:number;y:number;row:number;col:number}|null>(null);
  const pointer = useRef<{ id:number; row: number; col: number; x: number; y: number; lastX:number;lastY:number; timer: ReturnType<typeof setTimeout> | null; moved: boolean; long: boolean; snapshot:BoardGrid|null; trace:TraceState|null } | null>(null);
  const previousGrid=useRef(grid);
  const latest=useRef({grid:cloneGrid(grid),onChange});
  latest.current.onChange=onChange;
  // A local emission must be visible to the next gesture even before React rerenders.
  if (grid!==previousGrid.current) {latest.current.grid=cloneGrid(grid);previousGrid.current=grid;}
  function commit(next:BoardGrid) {latest.current.grid=next;latest.current.onChange?.(next);}
  const taps=useRef<ReturnType<typeof createBoardTapController>|null>(null);
  if (!taps.current) taps.current=createBoardTapController(()=>latest.current.grid,commit);
  useEffect(() => () => { if (pointer.current?.timer) clearTimeout(pointer.current.timer);pointer.current=null;taps.current?.dispose(); }, []);
  useEffect(() => { if (pointer.current?.timer) clearTimeout(pointer.current.timer);pointer.current=null;taps.current?.cancelAll();setGhost(null); }, [disabled,interactionKey]);
  useEffect(()=>{const cancel=()=>{if(pointer.current?.timer)clearTimeout(pointer.current.timer);pointer.current=null;taps.current?.cancelAll();setGhost(null);};window.addEventListener("blur",cancel);return()=>window.removeEventListener("blur",cancel);},[]);
  const editable = !!onChange && !disabled;
  const active=(row:number,col:number) => cellWithinBounds(grid,row,col,bounds);
  function emit(edit: BoardEdit) { if (editable) {taps.current?.cancelAll();commit(applyBoardEdit(latest.current.grid,edit));} }
  function targetPoint(event:ReactPointerEvent):TracePoint|null {
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-alkane-cell]');
    if (target?.dataset.active!=='true'||!board.current?.contains(target)) return null;
    return {row:Number(target.dataset.row),col:Number(target.dataset.col)};
  }
  function advancePointerTrace(item:NonNullable<typeof pointer.current>,event:ReactPointerEvent) {
    if (!item.snapshot || !item.trace) return;
    const target=targetPoint(event);if (!target) return;
    const next=advanceTrace(item.snapshot,item.trace,target,bounds);
    if (next===item.trace) return;
    item.trace=next;commit(traceBoard(item.snapshot,next));
  }
  function down(event: ReactPointerEvent, row: number, col: number) {
    if (!editable || !active(row,col) || !event.isPrimary || event.button!==0) return;
    event.preventDefault();primePanelAudio();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel=latest.current.grid[row][col];
    if (panel) taps.current?.hold(row,col);
    const item = { id:event.pointerId,row, col, x:event.clientX, y:event.clientY,lastX:event.clientX,lastY:event.clientY, timer:null as ReturnType<typeof setTimeout> | null, moved:false, long:false,snapshot:null as BoardGrid|null,trace:null as TraceState|null };
    if (panel && (selected || isCarbon(panel))) item.timer = setTimeout(() => {if(pointer.current!==item)return;item.long=true;taps.current?.cancelAll();setGhost({panel,row,col,x:item.lastX,y:item.lastY});playPanelSound("pickup");},400);
    if (!selected && !panel) {item.snapshot=cloneGrid(latest.current.grid);item.trace={path:[{row,col}],closed:false};taps.current?.cancelAll();}
    pointer.current = item;
  }
  function move(event: ReactPointerEvent) {
    const item=pointer.current;if (!item || item.id!==event.pointerId) return;
    item.lastX=event.clientX;item.lastY=event.clientY;
    if(item.long){const panel=latest.current.grid[item.row][item.col];if(panel)setGhost({panel,row:item.row,col:item.col,x:event.clientX,y:event.clientY});return;}
    if (Math.hypot(event.clientX-item.x,event.clientY-item.y)>8) {
      if (!item.moved) {
        item.moved=true;taps.current?.cancelAll();
        if (item.timer) {clearTimeout(item.timer);item.timer=null;}
        const panel=latest.current.grid[item.row][item.col];
        if (!selected && panel && isCarbon(panel)) {item.snapshot=cloneGrid(latest.current.grid);item.trace={path:[{row:item.row,col:item.col}],closed:false};}
        else if (panel?.element && !selected) {item.long=true;setGhost({panel,row:item.row,col:item.col,x:event.clientX,y:event.clientY});}
      }
      advancePointerTrace(item,event);
    }
  }
  function up(event: ReactPointerEvent, row: number, col: number) {
    const item = pointer.current; if (!item || item.id!==event.pointerId) return;primePanelAudio();pointer.current=null;
    if (item.timer) clearTimeout(item.timer);
    setGhost(null);
    const target=targetPoint(event);
    if (item.long) { if (target) { if (target.row!==item.row || target.col!==item.col) {emit({ type:"move", row:item.row, col:item.col, toRow:target.row, toCol:target.col });playPanelSound("move");} } else {emit({ type:"remove", row:item.row, col:item.col });playPanelSound("delete");} return; }
    if (item.trace) {advancePointerTrace(item,event);return;}
    if (item.moved) { if (selected && target) emit({ type:"place", row:target.row, col:target.col, panel:selected }); return; }
    if (selected) { emit({ type:"place", row, col, panel:selected }); return; }
    taps.current?.tap(row,col);
  }
  let region=(compact||promptCompact)&&!onChange?occupiedRegion(grid):null;
  if(region&&promptCompact&&viewport.height>620)region={top:Math.max(0,region.top-1),bottom:Math.min(grid.length-1,region.bottom+1),left:Math.max(0,region.left-1),right:Math.min((grid[0]?.length??7)-1,region.right+1)};
  if(compact&&!onChange&&!region)return <span aria-label={label}>未解答</span>;
  const columns=region?region.right-region.left+1:grid[0]?.length??7;
  const rowCount=region?region.bottom-region.top+1:grid.length;
  const cellSize=boardWidth>0?Math.max(0,(boardWidth-3*(columns-1))/columns):undefined;
  const promptWidth=region&&promptCompact?Math.min(viewport.width*.74,310,(viewport.height<=620?180:250)*columns/(region.bottom-region.top+1)):undefined;
  const displayGrid=ghost?grid.map((line,row)=>line.map((panel,col)=>row===ghost.row&&col===ghost.col?null:panel)):grid;
  return <><div ref={board} className={`alkane-board ${compact ? "alkane-board-cropped" : ""} ${promptCompact ? "alkane-board-prompt" : ""} `} role="group" aria-label={label ?? "アルカンの構造"} style={{ gridAutoRows:cellSize,height:cellSize===undefined?undefined:cellSize*rowCount+3*(rowCount-1),width:promptWidth, "--alkane-cols": columns, "--alkane-crop-width": `${columns*48+(columns-1)*3}px` } as CSSProperties}>{displayGrid.flatMap((line,row) => line.flatMap((panel,col) => region&&(row<region.top||row>region.bottom||col<region.left||col>region.right)?[]:<div className={`alkane-cell ${panel ? "filled" : ""} ${active(row,col) ? "" : "inactive"}`} key={`${row}-${col}`} data-alkane-cell data-row={row} data-col={col} data-active={active(row,col)} onContextMenu={event=>event.preventDefault()} onDragStart={event=>event.preventDefault()} onPointerDown={editable && active(row,col) ? event => down(event,row,col) : undefined} onPointerMove={editable && active(row,col) ? move : undefined} onPointerUp={editable && active(row,col) ? event => up(event,row,col) : undefined} onPointerCancel={editable ? () => { if (pointer.current?.timer) clearTimeout(pointer.current.timer); pointer.current=null; taps.current?.cancelAll(); setGhost(null); } : undefined} aria-label={`${row+1}行${col+1}列${panel ? ` ${panel.element ?? "炭素"}` : " 空欄"}`} role={editable && active(row,col) ? "button" : undefined} tabIndex={editable && active(row,col) ? 0 : undefined} onKeyDown={editable && active(row,col) ? event => { if (event.key === "Delete" || event.key === "Backspace") emit({type:"remove",row,col}); if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (selected) emit({type:"place",row,col,panel:selected}); else if (panel) emit({type:"rotate",row,col,reverse:event.shiftKey}); } } : undefined}>{panel && <PanelIcon panel={panel} grid={displayGrid} row={row} col={col}/>}</div>))}</div>{ghost&&createPortal(<div className="alkane-panel-ghost" style={{left:ghost.x,top:ghost.y,transform:`translate(-50%,-50%) rotate(${ghost.panel.rotation}deg)`}}><PaletteIcon panel={{...ghost.panel,rotation:0}}/></div>,document.body)}</>;
}
export function PaletteIcon({ panel }: { panel: Panel }) { return <PanelIcon panel={panel}/>; }
