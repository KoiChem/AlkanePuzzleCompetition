import {expect,test} from 'vitest';
import {createAlkaneEngine} from '../game/engine.js';
import {generateQuestionSet} from '../game/generator';
import {DEFAULT_PROFILE} from '../game/profile';
import type {InternalQuestion} from '../game/types';
import {selectQuestionCandidates,type QuestionCandidate} from '../game/question-diversity';
const engine=createAlkaneEngine();
function rng(seed:number){let s=seed;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);}
function names(qs:readonly InternalQuestion[]){return qs.map(q=>q.prompt.name??engine.reconstructNameFromTokens(JSON.parse(q.answer.canonical).tokens)!);}
for(const mode of ['arrange','name','both'] as const)test(`${mode} prevents duplicate molecules and adjacent substituent sets for the whole competition`,()=>{
 for(const seed of [16,31,42,70]){
  const qs=generateQuestionSet({mode,difficulty:'easy',alcoholEnabled:true,questionCount:15,timeLimitMinutes:3},rng(seed*998244353>>>0));
  const ns=names(qs);expect(new Set(ns).size).toBe(15);
  const combinations=ns.map(n=>engine.groupTypeSignature(n));for(let i=1;i<15;i++)expect(combinations[i]).not.toBe(combinations[i-1]);
 }
});
test('an OH-only profile cannot silently repeat compounds or OH combinations',()=>{
 const profile=structuredClone(DEFAULT_PROFILE);for(const mode of ['arrange','name'] as const)profile.rules[mode].easy.alcoholRate=100;
 for(const mode of ['arrange','name','both'] as const)expect(()=>generateQuestionSet({mode,difficulty:'easy',alcoholEnabled:true,questionCount:5,timeLimitMinutes:3},rng(17),profile)).toThrow(/重複|連続/);
});
function candidate(name:string,mode:'arrange'|'name',parentCarbons:number,combination:string,totalCarbons=parentCarbons):QuestionCandidate{
 return {mode,structure:{name,grid:[],parentCarbonCount:parentCarbons,fellBack:false},combination,types:combination==='なし'?[]:combination.split('|'),parentCarbons,totalCarbons,backbone:`chain:${parentCarbons}`,locants:[],alcoholRate:0};
}
test('parent carbon counts are spread without adjacency when candidates allow it',()=>{
 const pool=[2,3,4].flatMap(n=>Array.from({length:5},(_,i)=>candidate(`compound-${n}-${i}`,'arrange',n,['フルオロ','クロロ','ブロモ','ヨード','なし'][i])));
 const qs=selectQuestionCandidates(pool,{arrange:9,name:0},rng(3),Date.now()+1000);
 expect([2,3,4].map(n=>qs.filter(q=>q.parentCarbons===n).length)).toEqual([3,3,3]);
 for(let i=1;i<qs.length;i++)expect(qs[i].parentCarbons).not.toBe(qs[i-1].parentCarbons);
});
test('total-carbon diversity wins over partial substituent overlap when parent-carbon diversity ties',()=>{
 let tie=0;
 const qs=selectQuestionCandidates([
  candidate('first','arrange',6,'クロロ',6),
  candidate('repeated-total','arrange',5,'フルオロ|メチル',6),
  candidate('fresh-total','arrange',5,'クロロ|エチル',7),
 ],{arrange:2,name:0},()=>tie++/10,Date.now()+1000);
 expect(qs.map(q=>q.structure.name)).toEqual(['first','fresh-total']);
});
test('backtracking preserves mode quotas when one mode has only one eligible shared substance',()=>{
 const qs=selectQuestionCandidates([candidate('shared','arrange',2,'OH'),candidate('shared','name',2,'OH'),candidate('b','arrange',3,'クロロ'),candidate('c','arrange',4,'ブロモ')],{arrange:2,name:1},()=>0,Date.now()+1000);
 expect(new Set(qs.map(q=>q.structure.name)).size).toBe(3);expect(qs.find(q=>q.mode==='name')?.structure.name).toBe('shared');
});
test('limited carbon variety is reused while molecule uniqueness and combinations remain strict',()=>{
 const qs=selectQuestionCandidates(Array.from({length:8},(_,i)=>candidate(`compound-${i}`,'name',3,i%2?'クロロ':'フルオロ')),{arrange:0,name:5},rng(4),Date.now()+1000);
 expect(qs).toHaveLength(5);expect(new Set(qs.map(q=>q.structure.name)).size).toBe(5);
 for(let i=1;i<qs.length;i++)expect(qs[i].combination).not.toBe(qs[i-1].combination);
});
test('preparation terminates rather than relaxing constraints when budget or unique candidates run out',()=>{
 const pool=[candidate('only','name',2,'なし'),candidate('only','arrange',2,'なし')];
 expect(()=>selectQuestionCandidates(pool,{arrange:1,name:1},rng(1),Date.now()+1000)).toThrow(/重複/);
 expect(()=>selectQuestionCandidates(pool,{arrange:1,name:0},rng(1),Date.now()-1)).toThrow(/重複/);
});
test('current restrictive medium profiles still prepare 15 valid diverse questions',()=>{
 const profile=structuredClone(DEFAULT_PROFILE);
 Object.assign(profile.rules.arrange.medium,{typeMin:2,typeMax:3,lenMin:6,lenMax:10,subMin:4,subMax:8,ringSizes:[6,8,10]});
 Object.assign(profile.rules.name.medium,{typeMin:1,typeMax:1,lenMin:6,lenMax:10,subMin:4,subMax:8,ringSizes:[6,8,10],bendMin:3,bendMax:5});
 for(const mode of ['arrange','name','both'] as const)for(const alcoholEnabled of [false,true]){
  const qs=generateQuestionSet({mode,difficulty:'medium',alcoholEnabled,questionCount:15,timeLimitMinutes:3},rng(9173),profile),ns=names(qs);
  expect(new Set(ns).size).toBe(15);for(let i=1;i<ns.length;i++)expect(engine.groupTypeSignature(ns[i])).not.toBe(engine.groupTypeSignature(ns[i-1]));
 }
});
