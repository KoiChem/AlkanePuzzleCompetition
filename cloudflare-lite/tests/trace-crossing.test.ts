import {test,expect} from 'vitest';
import {advanceTrace,traceBoard,type BoardGrid,type TraceState} from '../game/client/AlkaneBoard';
import {createAlkaneEngine} from '../game/engine.js';
const blank=():BoardGrid=>Array.from({length:5},()=>Array(7).fill(null));
const board=(cells:number[][]):BoardGrid=>{const result=blank();for(const [r,c,type,rotation] of cells)result[r][c]={type,rotation};return result;};
const ringWalk=[[2,1],[2,2],[2,3],[3,3],[3,2],[2,2]];
const methyl=[[2,1,1,0],[2,2,4,180],[2,3,3,180],[3,2,3,0],[3,3,3,270]];
const cases=[
 {name:'ring closes at a revisited branch carbon',path:ringWalk,want:methyl,compound:'メチルシクロブタン'},
 {name:'a branch continues from a closed starting carbon',path:[[2,2],[2,3],[3,3],[3,2],[2,2],[1,2]],want:[[1,2,1,90],[2,2,4,90],[2,3,3,180],[3,2,3,0],[3,3,3,270]],compound:'メチルシクロブタン'},
 {name:'a crossing retains four carbon bonds',path:[...ringWalk,[1,2]],want:[[1,2,1,90],[2,1,1,0],[2,2,5,0],[2,3,3,180],[3,2,3,0],[3,3,3,270]],compound:'1,1-ジメチルシクロブタン'},
 {name:'a repeated ring bond reaches an adjacent branch',path:[...ringWalk,[2,3],[1,3]],want:[[1,3,1,90],[2,1,1,0],[2,2,4,180],[2,3,4,270],[3,2,3,0],[3,3,3,270]],compound:'1,2-ジメチルシクロブタン'},
 {name:'two repeated ring bonds reach the opposite branch',path:[...ringWalk,[2,3],[3,3],[3,4]],want:[[2,1,1,0],[2,2,4,180],[2,3,3,180],[3,2,3,0],[3,3,4,0],[3,4,1,180]],compound:'1,3-ジメチルシクロブタン'},
 {name:'backtracking a branch retains the ring',path:[...ringWalk,[1,2],[2,2]],want:methyl,compound:'メチルシクロブタン'},
 {name:'backtracking a repeated edge retains its earlier traversal',path:[...ringWalk,[2,3],[2,2]],want:methyl,compound:'メチルシクロブタン'},
 {name:'backtracking the closing edge reopens the ring',path:[...ringWalk,[3,2]],want:[[2,1,1,0],[2,2,2,90],[2,3,3,180],[3,2,1,0],[3,3,3,270]],compound:'ペンタン'},
];
function walk(original:BoardGrid,path:number[][]){let trace:TraceState={path:[{row:path[0][0],col:path[0][1]}]};for(const [row,col] of path.slice(1))trace=advanceTrace(original,trace,{row,col});return trace;}
for(const scenario of cases)test(scenario.name,()=>{
 const original=blank(),trace=walk(original,scenario.path),result=traceBoard(original,trace);
 expect(result).toEqual(board(scenario.want));
 expect(createAlkaneEngine().generateName(result)).toEqual({ok:true,name:scenario.compound});
 expect(original).toEqual(blank());
});
test('one crossed stroke remains one Undo operation and a cancelled stroke adds no history',async()=>{
 const {createBoardHistory}=await import('../game/client/board-history');
 const original=blank(),history=createBoardHistory();let current=original;
 for(let i=2;i<=ringWalk.length;i++){const next=traceBoard(original,walk(original,ringWalk.slice(0,i)));history.change(current,next,'preview');current=next;}
 const final=traceBoard(original,walk(original,[...ringWalk,[1,2]]));history.change(current,final,'commit');
 expect(final[2][2]).toEqual({type:5,rotation:0});expect(history.undo()).toEqual(original);expect(history.canUndo()).toBe(false);
 history.change(original,final,'preview');history.change(final,original,'cancel');expect(history.canUndo()).toBe(false);
});
test('revisited carbons still reject diagonal jumps and cells outside the playable bounds',()=>{
 const original=blank(),trace=walk(original,ringWalk);
 expect(advanceTrace(original,trace,{row:1,col:1})).toBe(trace);
 expect(advanceTrace(original,trace,{row:1,col:2},{rows:1,cols:3})).toBe(trace);
});
