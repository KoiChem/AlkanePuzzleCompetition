import {expect,test} from 'vitest';
import {DEFAULT_PROFILE,validateProfile} from '../game/profile';
import {generateQuestionSet} from '../game/generator';
import {evaluateField,isAnswerEmpty,validateAlkaneAnswer} from '../game/evaluator';
import {createAlkaneEngine} from '../game/engine.js';
function random(){let s=9173;return ()=>((s=(s*1664525+1013904223)>>>0)/0x100000000);}
test('uses current original ring settings rather than exact substituent counts',()=>{
 expect(DEFAULT_PROFILE.rules.name.easy.cycloLimitOne).toBe(true);
 expect(DEFAULT_PROFILE.rules.name.medium.cycloLimitOne).toBe(false);
 expect(DEFAULT_PROFILE.rules.arrange.easy.forceRingSubstituent).toBe(false);
 expect(DEFAULT_PROFILE.rules.arrange.medium.forceRingSubstituent).toBe(true);
 expect(validateProfile(DEFAULT_PROFILE)).toEqual(DEFAULT_PROFILE);
 expect(()=>validateProfile({...DEFAULT_PROFILE,rules:{...DEFAULT_PROFILE.rules,name:{...DEFAULT_PROFILE.rules.name,easy:{...DEFAULT_PROFILE.rules.name.easy,cycloSubstituentCount:0}}}})).toThrow();
});
for(const mode of ['arrange','name'] as const)for(const difficulty of ['easy','medium'] as const)for(const alcoholEnabled of [false,true])test(`${mode}/${difficulty}/OH=${alcoholEnabled} generates solvable matching questions`,()=>{
 const questions=generateQuestionSet({mode,difficulty,alcoholEnabled,questionCount:5,timeLimitMinutes:3},random(),DEFAULT_PROFILE);
 expect(questions).toHaveLength(5);
 for(const q of questions){expect(evaluateField(q,q.fields[0].id,q.answer.canonical).correct).toBe(true);if(!alcoholEnabled)expect(JSON.stringify(q)).not.toContain('"element":"OH"');}
});
test('limited ring counts OH and overrides the normal minimum',()=>{
 const engine=createAlkaneEngine(random());
 for(let i=0;i<20;i++){
  const q=engine.generateStructureWithOptions({typeMin:2,typeMax:3,lenMin:4,lenMax:8,subMin:3,subMax:6,ringSizes:[4,6],forceRingSubstituent:true,cycloLimitOne:true,useBent:true,forceTurn:false,allowMethane:false,categoryWeights:{chain:0,cyclo:100},alcoholEnabled:true,alcoholRate:100,hydroxylLimitOne:false,hydroxylCountsAsSubstituent:false});
  expect(q).not.toBeNull();expect(q!.name).toContain('シクロ');expect(engine.namedGroupSummary(q!.name)!.total).toBe(1);expect(engine.namedGroupSummary(q!.name)!.hydroxylCount).toBe(1);
 }
});
test('input progress reflects nonempty board or tokens and clear removes progress',()=>{
 const grid=Array.from({length:5},()=>Array(7).fill(null));expect(isAnswerEmpty(JSON.stringify({grid}))).toBe(true);grid[2][3]={type:1,rotation:0};expect(isAnswerEmpty(JSON.stringify({grid}))).toBe(false);expect(isAnswerEmpty('{"tokens":[]}')).toBe(true);expect(isAnswerEmpty('{"tokens":["1"]}')).toBe(false);
});
test('arrangement grading accepts rotated structures and rejects a changed atom',()=>{
 const qs=generateQuestionSet({mode:'arrange',difficulty:'medium',alcoholEnabled:true,questionCount:15,timeLimitMinutes:3},random());
 for(const q of qs){const grid=JSON.parse(q.answer.canonical).grid;const turned=grid.map((row:any[])=>row.map((p:any)=>p?{...p,rotation:(p.rotation+180)%360}:null).reverse()).reverse();expect(evaluateField(q,'formula',JSON.stringify({grid:turned})).correct).toBe(true);const modified=structuredClone(grid);outer:for(const row of modified)for(const p of row)if(p){p.element=p.element==='F'?'Cl':'F';p.type=1;break outer;}expect(evaluateField(q,'formula',JSON.stringify({grid:modified})).correct).toBe(false);}
});
test('rejects settings outside the original easy/medium adjustment range',()=>{
 const profile=structuredClone(DEFAULT_PROFILE);profile.rules.name.easy.bendMax=11;expect(()=>validateProfile(profile)).toThrow();
});
test('mode-specific payloads cannot fake progress and corrupt local payloads are empty',()=>{
 const name=generateQuestionSet({mode:'name',difficulty:'easy',alcoholEnabled:false,questionCount:5,timeLimitMinutes:3},random())[0],arrange=generateQuestionSet({mode:'arrange',difficulty:'easy',alcoholEnabled:false,questionCount:5,timeLimitMinutes:3},random())[0];
 expect(validateAlkaneAnswer(arrange.answer.canonical,name.prompt)).toBeNull();expect(validateAlkaneAnswer(name.answer.canonical,arrange.prompt)).toBeNull();expect(isAnswerEmpty('{"grid":[1]}')).toBe(true);
});
test('impossible profile never falls back to an out-of-profile rescue question',()=>{
 const profile=structuredClone(DEFAULT_PROFILE);Object.assign(profile.rules.arrange.easy,{lenMin:10,lenMax:10,subMin:10,subMax:10,typeMin:6,typeMax:6,ringSizes:[10],forceRingSubstituent:true,gridCols:3,gridRows:3});expect(()=>generateQuestionSet({mode:'arrange',difficulty:'easy',alcoholEnabled:false,questionCount:5,timeLimitMinutes:3},random(),profile)).toThrow();
});
for(const questionCount of [5,10,15])test(`mixed ${questionCount} questions are balanced, shuffled and use each mode profile`,()=>{
 const profile=structuredClone(DEFAULT_PROFILE);
 const sequences=new Set<string>(),majorities=new Set<string>();
 for(let seed=1;seed<=24;seed++){
  let state=(seed*998244353)>>>0;const rng=()=>((state=(state*1664525+1013904223)>>>0)/0x100000000);
  const qs=generateQuestionSet({mode:'both' as any,difficulty:'medium',alcoholEnabled:false,questionCount,timeLimitMinutes:3},rng,profile);
  const counts={arrange:0,name:0};
  for(const q of qs){counts[q.prompt.mode]++;expect(q.prompt.mode).not.toBe('both');expect(evaluateField(q,q.fields[0].id,q.answer.canonical).correct).toBe(true);if(q.prompt.mode==='arrange')expect(q.prompt.bounds).toEqual({cols:profile.rules.arrange.medium.gridCols,rows:profile.rules.arrange.medium.gridRows});else {expect(q.prompt.bounds).toBeUndefined();expect(q.prompt.wordBank).toBeDefined();}expect(q.fields[0].id).toBe(q.prompt.mode==='arrange'?'formula':'name');}
  expect(Math.abs(counts.arrange-counts.name)).toBeLessThanOrEqual(1);sequences.add(qs.map(q=>q.prompt.mode).join(','));if(counts.arrange!==counts.name)majorities.add(counts.arrange>counts.name?'arrange':'name');
 }
 expect(sequences.size).toBeGreaterThan(1);if(questionCount%2)expect(majorities.size).toBe(2);
});
