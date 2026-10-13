import type {GeneratedStructure} from './engine.js';
import type {GameMode} from './types';

export const PREPARATION_MESSAGE='重複・連続を避けた問題を準備できませんでした。問題数を減らすか、主鎖・置換基・OH・枠数などの出題範囲を広げてください';
export class QuestionPreparationError extends RangeError {}
export type QuestionCandidate={
 mode:GameMode;structure:GeneratedStructure;combination:string;types:readonly string[];
 parentCarbons:number;totalCarbons:number;backbone:string;locants:readonly number[];alcoholRate:number;
};
type Counts=Record<GameMode,number>;
const count=(items:readonly QuestionCandidate[],matches:(item:QuestionCandidate)=>boolean)=>items.filter(matches).length;
function locantPenalty(candidate:QuestionCandidate,selected:readonly QuestionCandidate[]){
 const relevant=selected.filter(q=>q.backbone===candidate.backbone&&q.locants.length);
 if(relevant.length<2||!candidate.locants.length)return 0;
 const positions=Array<number>(candidate.parentCarbons).fill(0);
 for(const q of [...relevant,candidate])for(const n of q.locants)if(n>=1&&n<=positions.length)positions[n-1]++;
 const mean=positions.reduce((a,b)=>a+b,0)/positions.length;
 return positions.reduce((sum,n)=>sum+(n-mean)**2,0);
}
// Select both substance and mode together: consuming a shared molecule must not
// leave the other mode with too few eligible questions. Search never relaxes hard rules.
export function selectQuestionCandidates(candidates:readonly QuestionCandidate[],required:Counts,random:()=>number,deadline:number):QuestionCandidate[]{
 const ranked=candidates.map(candidate=>({candidate,tie:random()}));
 const selected:QuestionCandidate[]=[],used=new Set<string>(),remaining={...required};
 let visits=0;
 const total=required.arrange+required.name;
 function visit():boolean{
  if(selected.length===total)return true;
  if(++visits>5000||Date.now()>deadline)return false;
  for(const mode of ['arrange','name'] as const){
   const available=new Set(candidates.filter(q=>q.mode===mode&&!used.has(q.structure.name)).map(q=>q.structure.name));
   if(available.size<remaining[mode])return false;
  }
  const previous=selected.at(-1);
  const options=ranked.filter(({candidate:q})=>remaining[q.mode]>0&&!used.has(q.structure.name)&&q.combination!==previous?.combination).map(item=>{
   const q=item.candidate,modeItems=selected.filter(p=>p.mode===q.mode),hasOH=q.types.includes('OH');
   const alcoholDebt=Math.abs(count(modeItems,p=>p.types.includes('OH'))+Number(hasOH)-(modeItems.length+1)*q.alcoholRate/100);
   return {...item,score:[
    count(selected,p=>p.parentCarbons===q.parentCarbons),Number(previous?.parentCarbons===q.parentCarbons),
    alcoholDebt,count(selected,p=>p.totalCarbons===q.totalCarbons),q.types.filter(t=>previous?.types.includes(t)).length,
    count(selected,p=>p.combination===q.combination),
    count(selected,p=>p.backbone===q.backbone),locantPenalty(q,selected),item.tie,
   ]};
  });
  options.sort((a,b)=>{for(let i=0;i<a.score.length;i++)if(a.score[i]!==b.score[i])return a.score[i]-b.score[i];return 0;});
  for(const {candidate:q} of options){
   selected.push(q);used.add(q.structure.name);remaining[q.mode]--;
   if(visit())return true;
   selected.pop();used.delete(q.structure.name);remaining[q.mode]++;
   if(visits>5000||Date.now()>deadline)break;
  }
  return false;
 }
 if(!visit())throw new QuestionPreparationError(PREPARATION_MESSAGE);
 return selected;
}
