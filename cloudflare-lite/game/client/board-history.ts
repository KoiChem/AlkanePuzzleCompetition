import type {BoardGrid} from './AlkaneBoard';
export type BoardChangePhase='preview'|'commit'|'cancel';
const copy=(grid:BoardGrid):BoardGrid=>grid.map(row=>row.map(panel=>panel?{...panel}:null));
const same=(a:BoardGrid,b:BoardGrid)=>a.every((row,r)=>row.every((p,c)=>{
 const q=b[r]?.[c];return !p&&!q||!!p&&!!q&&p.type===q.type&&p.rotation===q.rotation&&(p.element??'C')===(q.element??'C');
}));
// Local to the currently mounted question; history never changes grading or server sequences.
export function createBoardHistory(){
 const entries:BoardGrid[]=[];let before:BoardGrid|null=null;
 return {
  change(current:BoardGrid,next:BoardGrid,phase:BoardChangePhase){
   if(phase==='cancel'){before=null;return;}
   if(phase==='preview'){before??=copy(current);return;}
   const previous=before??copy(current);before=null;
   if(!same(previous,next))entries.push(previous);
  },
  canUndo(){return before===null&&entries.length>0;},
  undo(){return before===null?entries.pop()??null:null;},
  reset(){entries.length=0;before=null;},
 };
}
