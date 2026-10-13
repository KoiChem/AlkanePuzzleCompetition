import {evaluateField} from './evaluator';
import { createAlkaneEngine, type GeneratedStructure, type EngineOptions } from './engine.js';
import { DEFAULT_PROFILE, validateProfile, type QuestionProfile, type Rule } from './profile';
import type { AlkaneGameSettings, Grid, InternalQuestion, Panel, PublicQuestion, QuestionProgress } from './types';
import {selectQuestionCandidates,QuestionPreparationError,PREPARATION_MESSAGE,type QuestionCandidate} from './question-diversity';

const modes = ['arrange','name'] as const;
const difficulties = ['easy','medium'] as const;
function boundedRandom(random:()=>number,maximum:number,deadline:number){let count=0;return ()=>{if(++count>maximum||Date.now()>deadline)throw new QuestionPreparationError(PREPARATION_MESSAGE);const value=random();if(!Number.isFinite(value)||value<0||value>=1)throw new TypeError('抽選値が不正です');return value;};}
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
    forceRingSubstituent:rule.forceRingSubstituent, cycloLimitOne:settings.mode==='name'?rule.cycloLimitOne:false,
    alcoholEnabled:settings.alcoholEnabled,alcoholRate:rule.alcoholRate,
    hydroxylLimitOne:rule.hydroxylLimitOne,hydroxylCountsAsSubstituent:rule.hydroxylCountsAsSubstituent,
    useBent:true,forceTurn:false,allowMethane:easy,
    categoryWeights:easy?{methane:10,chain:75,cyclo:15}:{chain:80,cyclo:20},
    ...(settings.mode==='arrange'?{maxWidth:rule.gridCols,maxHeight:rule.gridRows,balanceLocants:true}:{bendRange:[rule.bendMin!,rule.bendMax!] as [number,number]})
  };
}
function wordBank(rule:Rule,settings:AlkaneGameSettings,name:string,engine:ReturnType<typeof createAlkaneEngine>,random:()=>number,groupHistory:{order:string}):string[][] {
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
    ['シクロ',...shuffled([...bases],random),...(settings.alcoholEnabled?['オール']:[])],
  ];
  if(settings.difficulty!=='medium'&&!rule.shuffleWordBankGroups)return rows;
  const permutations:number[][]=[];
  function visit(order:number[]){if(order.length===4){const key=order.join(',');if(key!=='0,1,2,3'&&key!==groupHistory.order)permutations.push(order);return;}for(let i=0;i<4;i++)if(!order.includes(i))visit([...order,i]);}
  visit([]);const order=permutations[Math.floor(random()*permutations.length)];groupHistory.order=order.join(',');return order.map(i=>rows[i]);
}
function arrangementPalette(alcoholEnabled:boolean):Panel[] {
  const carbon:Panel[]=[1,2,3,4,5].map(type=>({type:type as Panel['type'],rotation:type===2?90:0}));
  const atoms:Panel[]=(alcoholEnabled?['F','Cl','Br','I','OH']:['F','Cl','Br','I']).map(element=>({type:1,rotation:0,element}));
  return [...carbon,...atoms];
}
export function validateGameSettings(settings:AlkaneGameSettings,profile:QuestionProfile|null=DEFAULT_PROFILE) {
  validateProfile(profile??DEFAULT_PROFILE);
  if(!['arrange','name','both'].includes(settings.mode)||!difficulties.includes(settings.difficulty)) throw new TypeError('モード・難易度が不正です');
  if(![5,10,15].includes(settings.questionCount)||!Number.isInteger(settings.timeLimitMinutes)||settings.timeLimitMinutes<3||settings.timeLimitMinutes>10) throw new RangeError('問題数・制限時間が不正です');
  if(typeof settings.alcoholEnabled!=='boolean'||(settings.gradingMode!==undefined&&!['immediate','deferred'].includes(settings.gradingMode))) throw new TypeError('競技設定が不正です');
  return {availableCount:settings.questionCount,maxScore:settings.questionCount};
}
export function validateQuestionProfile(profile:QuestionProfile):void {
  validateProfile(profile);
  for(const mode of modes) for(const difficulty of difficulties) {
    const rule=profile.rules[mode][difficulty];
    let seed=9173;
    const random=()=>((seed=(seed*1664525+1013904223)>>>0)/0x100000000);
    const engine=createAlkaneEngine(boundedRandom(random,100000,Date.now()+1000));
    for(const alcoholEnabled of [false,true]) {
      const settings:AlkaneGameSettings={mode,difficulty,alcoholEnabled,questionCount:5,timeLimitMinutes:5};
      const options=optionsFor(settings,rule);
      let feasible=false;
      for(let attempt=0;attempt<24;attempt++) {
        const result=engine.generateStructureWithOptions(options);
        if(result) {feasible=true;break;}
      }
      if(!feasible) throw new RangeError(`${mode}・${difficulty}の設定に合う問題を生成できません`);
    }
  }
}
function identifier(random:()=>number):string {
  return Array.from({length:4},()=>Math.floor(random()*0x10000).toString(16).padStart(4,'0')).join('');
}
export function generateQuestionSet(settings:AlkaneGameSettings,random:()=>number=Math.random,profile:QuestionProfile|null=DEFAULT_PROFILE):readonly InternalQuestion[] {
  validateGameSettings(settings,profile);
  const deadline=Date.now()+2000;random=boundedRandom(random,150000,deadline);
  const engine=createAlkaneEngine(random);
  const arrangeCount=Math.floor(settings.questionCount/2)+(settings.questionCount%2&&random()<0.5?1:0);
  const required={arrange:settings.mode==='both'?arrangeCount:settings.mode==='arrange'?settings.questionCount:0,name:settings.mode==='both'?settings.questionCount-arrangeCount:settings.mode==='name'?settings.questionCount:0};
  const candidates:QuestionCandidate[]=[];
  const target=Math.max(24,settings.questionCount*3);
  for(const mode of modes){
    if(!required[mode])continue;
    const rule=(profile??DEFAULT_PROFILE).rules[mode][settings.difficulty];
    const options=optionsFor({...settings,mode},rule),seen=new Set<string>();
    for(let attempt=0;attempt<target*4&&seen.size<target;attempt++){
      const structure=engine.generateStructureWithOptions(options);if(!structure||seen.has(structure.name))continue;
      const summary=engine.namedGroupSummary(structure.name);if(!summary)continue;
      seen.add(structure.name);
      const cyclo=structure.name.includes('シクロ');
      candidates.push({mode,structure,combination:summary.signature,types:summary.types,parentCarbons:summary.parentCarbonCount,
        totalCarbons:structure.grid.flat().filter(p=>p&&(!p.element||p.element==='C')).length,
        backbone:`${cyclo?'ring':'chain'}:${summary.parentCarbonCount}`,
        locants:cyclo?[]:(engine.expectedGame2AnswerTokens(structure.name)??[]).filter(t=>/^\d+$/.test(t)).map(Number),
        alcoholRate:settings.alcoholEnabled?rule.alcoholRate:0});
    }
  }
  const chosenQuestions=selectQuestionCandidates(candidates,required,random,deadline);
  if(new Set(chosenQuestions.map(q=>q.structure.name)).size!==settings.questionCount||chosenQuestions.some((q,i)=>i>0&&q.combination===chosenQuestions[i-1].combination))throw new QuestionPreparationError(PREPARATION_MESSAGE);
  const result:InternalQuestion[]=[];
  const groupHistory={order:''};
  for(let ordinal=0;ordinal<settings.questionCount;ordinal++) {
    const {mode,structure:chosen}=chosenQuestions[ordinal];
    const questionSettings={...settings,mode};
    const rule=(profile??DEFAULT_PROFILE).rules[mode][settings.difficulty];
    const field=mode==='arrange'?'formula':'name';
    const tokens=engine.expectedGame2AnswerTokens(chosen.name);
    if(!tokens) throw new RangeError('正答の語句を生成できません');
    const prompt=mode==='arrange'
      ? {kind:'alkane' as const,mode:'arrange' as const,grid:null,name:chosen.name,options:arrangementPalette(settings.alcoholEnabled),bounds:{cols:rule.gridCols!,rows:rule.gridRows!},alcoholEnabled:settings.alcoholEnabled,values:[] as const}
      : {kind:'alkane' as const,mode:'name' as const,grid:chosen.grid,wordBank:wordBank(rule,questionSettings,chosen.name,engine,random,groupHistory),alcoholEnabled:settings.alcoholEnabled,values:[] as const};
    result.push({
      id:identifier(random),ordinal,itemId:'alkane-'+ordinal,category:chosen.name.includes('シクロ')?'cyclo':'chain',variant:mode,
      prompt,fields:[{id:field,type:field}],maxScore:1,
      answer:{type:field,canonical:JSON.stringify(mode==='arrange'?{grid:chosen.grid}:{tokens}),accepted:[]},
    });
  }
  for(const question of result)if(!evaluateField(question,question.fields[0].id,question.answer.canonical).correct)throw new RangeError('問題の正答を検証できません。設定を見直してください');
  return freeze(result);
}
export function toPublicQuestion(question:InternalQuestion,progress:QuestionProgress):PublicQuestion {
  return freeze({id:question.id,ordinal:question.ordinal,prompt:question.prompt,fields:question.fields,progress});
}
