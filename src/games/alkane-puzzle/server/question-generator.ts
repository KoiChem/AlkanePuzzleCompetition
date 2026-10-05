import { createAlkaneEngine, type GeneratedStructure, type EngineOptions } from '../shared/engine.js';
import { DEFAULT_QUESTION_PROFILE, validateQuestionProfileShape, type QuestionProfile, type Rule } from '../shared/question-profile';
import type { AlkaneGameSettings, Grid, InternalQuestion, Panel, PublicQuestion, QuestionProgress } from '../shared/types';

const modes = ['arrange','name'] as const;
const difficulties = ['easy','medium'] as const;
function freeze<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    for(const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function shuffled<T>(items:readonly T[],random:()=>number):T[] {
  const result=[...items];
  for(let i=result.length-1;i>0;i--) {
    const j=Math.floor(random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
function optionsFor(settings:AlkaneGameSettings,rule:Rule):EngineOptions {
  const easy=settings.difficulty==='easy';
  return {
    typeMin:rule.typeMin,typeMax:rule.typeMax,lenMin:rule.lenMin,lenMax:rule.lenMax,
    subMin:rule.subMin,subMax:rule.subMax,ringSizes:rule.ringSizes,
    forceRingSubstituent:rule.cycloSubstituentCount!==0,
    alcoholEnabled:settings.alcoholEnabled,alcoholRate:rule.alcoholRate,
    hydroxylLimitOne:rule.hydroxylLimitOne,hydroxylCountsAsSubstituent:rule.hydroxylCountsAsSubstituent,
    useBent:true,forceTurn:false,allowMethane:easy,
    categoryWeights:easy?{methane:10,chain:75,cyclo:15}:{chain:80,cyclo:20},
    ...(settings.mode==='arrange'?{maxWidth:rule.gridCols,maxHeight:rule.gridRows,balanceLocants:true}:{bendRange:[rule.bendMin!,rule.bendMax!] as [number,number]})
  };
}
function cycloCount(result:GeneratedStructure,engine:ReturnType<typeof createAlkaneEngine>):number|null {
  if(!result.name.includes('シクロ')) return null;
  const graph=engine.buildGraph(result.grid);
  const ring=new Set(engine.findRing(graph));
  let count=0;
  for(const id of ring) {
    for(const neighbor of graph.adjacency.get(id)??[]) {
      if(!ring.has(neighbor)&&graph.elements.get(neighbor)!=='OH') count++;
    }
  }
  return count;
}
function acceptable(result:GeneratedStructure,rule:Rule,engine:ReturnType<typeof createAlkaneEngine>):boolean {
  const count=cycloCount(result,engine);
  if(count===null) return true;
  return rule.cycloSubstituentCount===2?count>=2:count===rule.cycloSubstituentCount;
}
function wordBank(rule:Rule,settings:AlkaneGameSettings,name:string,engine:ReturnType<typeof createAlkaneEngine>,random:()=>number):string[][] {
  const bases=new Set<string>();
  for(let n=rule.lenMin;n<=rule.lenMax;n++) bases.add(engine.CHAIN_NAMES[n]);
  for(const n of rule.ringSizes) bases.add(engine.CHAIN_NAMES[n]);
  const tokens=engine.expectedGame2AnswerTokens(name)??[];
  for(const token of tokens) if(engine.CHAIN_NAMES.includes(token)) bases.add(token);
  const maxNumber=Math.max(rule.lenMax,...rule.ringSizes);
  const rows=[
    Array.from({length:maxNumber},(_,i)=>String(i+1)),
    shuffled(engine.MULTIPLIER_TOKENS.slice(0,Math.max(rule.subMax,settings.alcoholEnabled?2:1)-1),random),
    shuffled([...engine.SUB_NAME_SET],random),
    ['シクロ',...(settings.alcoholEnabled?['オール']:[]),...shuffled([...bases],random)],
  ];
  return rule.shuffleWordBankGroups?shuffled(rows,random):rows;
}
function arrangementPalette(alcoholEnabled:boolean):Panel[] {
  const carbon:Panel[]=[1,2,3,4,5].map(type=>({type:type as Panel['type'],rotation:type===2?90:0}));
  const atoms:Panel[]=(alcoholEnabled?['F','Cl','Br','I','OH']:['F','Cl','Br','I']).map(element=>({type:1,rotation:0,element}));
  return [...carbon,...atoms];
}
export function validateGameSettings(settings:AlkaneGameSettings,profile:QuestionProfile|null=DEFAULT_QUESTION_PROFILE) {
  validateQuestionProfileShape(profile??DEFAULT_QUESTION_PROFILE);
  if(!modes.includes(settings.mode)||!difficulties.includes(settings.difficulty)) throw new TypeError('モード・難易度が不正です');
  if(![5,10,15].includes(settings.questionCount)||!Number.isInteger(settings.timeLimitMinutes)||settings.timeLimitMinutes<3||settings.timeLimitMinutes>10) throw new RangeError('問題数・制限時間が不正です');
  if(typeof settings.alcoholEnabled!=='boolean'||(settings.gradingMode!==undefined&&!['immediate','deferred'].includes(settings.gradingMode))) throw new TypeError('競技設定が不正です');
  return {availableCount:settings.questionCount,maxScore:settings.questionCount};
}
export function validateQuestionProfile(profile:QuestionProfile):void {
  validateQuestionProfileShape(profile);
  for(const mode of modes) for(const difficulty of difficulties) {
    const rule=profile.rules[mode][difficulty];
    let seed=9173;
    const random=()=>((seed=(seed*1664525+1013904223)>>>0)/0x100000000);
    const engine=createAlkaneEngine(random);
    for(const alcoholEnabled of [false,true]) {
      const settings:AlkaneGameSettings={mode,difficulty,alcoholEnabled,questionCount:5,timeLimitMinutes:5};
      const options=optionsFor(settings,rule);
      let feasible=false;
      for(let attempt=0;attempt<24;attempt++) {
        const result=engine.generateStructureWithOptions(options);
        if(result&&acceptable(result,rule,engine)) {feasible=true;break;}
      }
      if(!feasible) throw new RangeError(`${mode}・${difficulty}の設定に合う問題を生成できません`);
    }
  }
}
function identifier(random:()=>number):string {
  return Array.from({length:4},()=>Math.floor(random()*0x10000).toString(16).padStart(4,'0')).join('');
}
export function generateQuestionSet(settings:AlkaneGameSettings,random:()=>number=Math.random,profile:QuestionProfile|null=DEFAULT_QUESTION_PROFILE):readonly InternalQuestion[] {
  validateGameSettings(settings,profile);
  const engine=createAlkaneEngine(random);
  const rule=(profile??DEFAULT_QUESTION_PROFILE).rules[settings.mode][settings.difficulty];
  const options=optionsFor(settings,rule);
  const result:InternalQuestion[]=[];
  const history:unknown[]=[];
  const deadline=Date.now()+10000;
  for(let ordinal=0;ordinal<settings.questionCount;ordinal++) {
    const chosen=Date.now()<deadline
      ? engine.generateAvoidingRecentRepeat(options,history,generated=>acceptable(generated,rule,engine))
      : null;
    if(!chosen) throw new RangeError('設定に合う問題を生成できません。主鎖・置換基・枠数・折れ曲がりの設定を見直してください');
    engine.rememberQuestion(history,chosen);
    if(settings.mode==='arrange') engine.rememberGame1LocantProfile(chosen);
    const field=settings.mode==='arrange'?'formula':'name';
    const tokens=engine.expectedGame2AnswerTokens(chosen.name);
    if(!tokens) throw new RangeError('正答の語句を生成できません');
    const prompt=settings.mode==='arrange'
      ? {kind:'alkane' as const,mode:'arrange' as const,grid:null,name:chosen.name,options:arrangementPalette(settings.alcoholEnabled),bounds:{cols:rule.gridCols!,rows:rule.gridRows!},alcoholEnabled:settings.alcoholEnabled,values:[] as const}
      : {kind:'alkane' as const,mode:'name' as const,grid:chosen.grid,wordBank:wordBank(rule,settings,chosen.name,engine,random),alcoholEnabled:settings.alcoholEnabled,values:[] as const};
    result.push({
      id:identifier(random),ordinal,itemId:'alkane-'+ordinal,category:chosen.name.includes('シクロ')?'cyclo':'chain',variant:settings.mode,
      prompt,fields:[{id:field,type:field}],maxScore:1,
      answer:{type:field,canonical:JSON.stringify(settings.mode==='arrange'?{grid:chosen.grid}:{tokens}),accepted:[]},
    });
  }
  return freeze(result);
}
export function toPublicQuestion(question:InternalQuestion,progress:QuestionProgress):PublicQuestion {
  return freeze({id:question.id,ordinal:question.ordinal,prompt:question.prompt,fields:question.fields,progress});
}
