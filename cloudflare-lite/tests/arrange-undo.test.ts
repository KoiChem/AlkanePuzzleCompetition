import {test,expect} from 'vitest';
import {advanceTrace,traceBoard,type BoardGrid,type TraceState} from '../game/client/AlkaneBoard';
const blank=():BoardGrid=>Array.from({length:5},()=>Array(7).fill(null));
test('tracing carbon replaces dangling arms with hydrogen while keeping mutual bonds',()=>{
 const original=blank();original[2][3]={type:5,rotation:0};original[2][2]={type:1,rotation:0};original[2][4]={type:1,rotation:0};
 const result=traceBoard(original,{path:[{row:1,col:3},{row:2,col:3}],closed:false});
 // Up is traced; left is a real bond; right points toward a carbon facing away; down is empty.
 expect(result[2][3]).toEqual({type:3,rotation:270});
 expect(result[2][2]).toEqual(original[2][2]);expect(result[2][4]).toEqual(original[2][4]);expect(original[2][3]).toEqual({type:5,rotation:0});
});
for(const element of ['F','Cl','Br','I','OH'])test(`tracing carbon retains its bond to ${element}`,()=>{
 const original=blank();original[2][3]={type:5,rotation:0};original[2][2]={type:1,rotation:0,element};
 expect(traceBoard(original,{path:[{row:1,col:3},{row:2,col:3}],closed:false})[2][3]).toEqual({type:3,rotation:270});
});
test('tracing removes dangling arms throughout a loop and backtracking restores the snapshot',()=>{
 const original=blank();original[2][3]={type:5,rotation:0};
 const path=[{row:2,col:3},{row:2,col:4},{row:3,col:4},{row:3,col:3}];
 expect(traceBoard(original,{path,closed:true})[2][3]).toEqual({type:3,rotation:90});
 expect(traceBoard(original,{path:[path[0]],closed:false})).toEqual(original);
});
for(const element of ['F','Cl','Br','I','OH']){
 test(`${element} is replaced at start, crossing and endpoint without mutating the snapshot`,()=>{
  for(const path of [[{row:2,col:3},{row:1,col:3}],[{row:1,col:3},{row:2,col:3}],[{row:1,col:3},{row:2,col:3},{row:3,col:3}]]){
   const original=blank();original[2][3]={type:1,rotation:0,element};const serialized=JSON.stringify(original);
   let trace:TraceState={path:[path[0]],closed:false};for(const point of path.slice(1))trace=advanceTrace(original,trace,point);
   const result=traceBoard(original,trace);expect(result[2][3]?.element??'C').toBe('C');expect(trace.path).toHaveLength(path.length);expect(JSON.stringify(original)).toBe(serialized);
  }
 });
 test(`${element} original real bond is retained and backtracking restores original atom`,()=>{
  const original=blank();original[2][2]={type:1,rotation:0};original[2][3]={type:1,rotation:90,element};
  let trace:TraceState={path:[{row:1,col:3}],closed:false};trace=advanceTrace(original,trace,{row:2,col:3});trace=advanceTrace(original,trace,{row:3,col:3});
  expect(traceBoard(original,trace)[2][3]).toEqual({type:4,rotation:270});
  trace=advanceTrace(original,trace,{row:2,col:3});trace=advanceTrace(original,trace,{row:1,col:3});expect(traceBoard(original,trace)).toEqual(original);
 });
}
test('one stroke is one independent Undo entry, cancellation and no-op have no entry',async()=>{
 const {createBoardHistory}=await import('../game/client/board-history');const history=createBoardHistory(),original=blank();original[2][3]={type:1,rotation:0,element:'OH'};
 const next=traceBoard(original,{path:[{row:2,col:3},{row:1,col:3}],closed:false});history.change(original,next,'preview');expect(history.canUndo()).toBe(false);
 const final=traceBoard(original,{path:[{row:2,col:3},{row:1,col:3},{row:1,col:2}],closed:false});history.change(next,final,'commit');expect(history.canUndo()).toBe(true);
 original[2][3]!.rotation=180;expect(history.undo()![2][3]).toEqual({type:1,rotation:0,element:'OH'});expect(history.canUndo()).toBe(false);
 history.change(final,final,'commit');expect(history.canUndo()).toBe(false);
 history.change(final,next,'preview');history.change(next,final,'cancel');expect(history.canUndo()).toBe(false);
});
test('multiple Undo steps restore overwritten destinations and clear; reset drops local history',async()=>{
 const {createBoardHistory}=await import('../game/client/board-history');const history=createBoardHistory(),original=blank();original[2][3]={type:1,rotation:0,element:'Cl'};original[2][4]={type:1,rotation:0,element:'OH'};
 const next=blank();next[2][4]={...original[2][3]!};history.change(original,next,'commit');history.change(next,blank(),'commit');expect(history.undo()).toEqual(next);expect(history.undo()).toEqual(original);
 history.change(original,next,'commit');history.reset();expect(history.canUndo()).toBe(false);
});
