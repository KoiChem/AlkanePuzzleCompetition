import { createAlkaneEngine } from './engine.js';
import type { FieldEvaluation, Grid, InternalQuestion, QuestionPrompt } from './types';

export const EVALUATOR_VERSION = 'alkane-puzzle-evaluator-1';
const engine = createAlkaneEngine(() => 0.5);
const invalid = (empty:boolean):FieldEvaluation => ({correct:false,empty,matchedAnswerKind:null,note:null});
function parseInput(value:unknown):unknown {
  if(typeof value!=='string') return value;
  if(value.length>10000) return null;
  try { return JSON.parse(value); } catch { return null; }
}
function validGrid(raw:unknown):raw is Grid {
  if(!Array.isArray(raw)||raw.length!==5) return false;
  return raw.every(row=>Array.isArray(row)&&row.length===7&&row.every(panel=>{
    if(panel===null) return true;
    if(!panel||typeof panel!=='object'||Array.isArray(panel)) return false;
    const p=panel as Record<string,unknown>;
    return [1,2,3,4,5].includes(p.type as number)&&[0,90,180,270].includes(p.rotation as number)
      && (p.element===undefined||['C','F','Cl','Br','I','OH'].includes(p.element as string))
      && (p.element===undefined||p.element==='C'||p.type===1)
      && Object.keys(p).every(k=>['type','rotation','element'].includes(k));
  }));
}
const validTokens = new Set([
  ...engine.CHAIN_NAMES.slice(1,11),...engine.MULTIPLIER_TOKENS,
  ...engine.SUB_NAME_SET,'シクロ','オール',
  ...Array.from({length:10},(_,i)=>String(i+1)),
]);
export function validateAlkaneAnswer(value:unknown,prompt?:Pick<QuestionPrompt,'bounds'|'alcoholEnabled'|'wordBank'>):{grid:Grid}|{tokens:string[]}|null {
  const parsed=parseInput(value);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) return null;
  const record=parsed as Record<string,unknown>;
  if(Object.keys(record).length!==1) return null;
  if(Object.hasOwn(record,'grid')) {
    if(!validGrid(record.grid)) return null;
    const grid=record.grid;
    const bounds=prompt?.bounds;
    const startCol=bounds?Math.floor((7-bounds.cols)/2):0;
    const startRow=bounds?Math.floor((5-bounds.rows)/2):0;
    for(let row=0;row<5;row++) for(let col=0;col<7;col++) {
      const panel=grid[row][col];
      if(!panel) continue;
      if(bounds&&(row<startRow||row>=startRow+bounds.rows||col<startCol||col>=startCol+bounds.cols)) return null;
      if(prompt?.alcoholEnabled===false&&panel.element==='OH') return null;
    }
    return {grid};
  }
  if(Object.hasOwn(record,'tokens')&&Array.isArray(record.tokens)&&record.tokens.length<=40
    && record.tokens.every(token=>typeof token==='string'&&validTokens.has(token))
    && (prompt?.alcoholEnabled!==false||!record.tokens.includes('オール'))
    && (!prompt?.wordBank||record.tokens.every(token=>prompt.wordBank!.some(row=>row.includes(token))))) return {tokens:[...record.tokens]};
  return null;
}
export function evaluateField(question:InternalQuestion,fieldId:string,value:unknown):FieldEvaluation {
  if(!question.fields.some(field=>field.id===fieldId)) throw new TypeError('この問題に存在しない解答欄です');
  const parsed=validateAlkaneAnswer(value,question.prompt);
  const empty=value===null||value===undefined||value==='';
  if(empty) return invalid(true);
  let correct=false;
  if(fieldId==='formula'&&question.prompt.mode==='arrange') {
    const grid=parsed&&'grid' in parsed?parsed.grid:null;
    if(validGrid(grid)) {
      const result=engine.generateName(grid);
      const expectedAnswer=validateAlkaneAnswer(question.answer.canonical);
      const expected=expectedAnswer&&'grid' in expectedAnswer?engine.generateName(expectedAnswer.grid):null;
      correct=result.ok&&expected?.ok===true&&result.name===expected.name;
    }
  } else if(fieldId==='name'&&question.prompt.mode==='name') {
    const tokens=parsed&&'tokens' in parsed?parsed.tokens:null;
    if(tokens) {
      const expectedAnswer=validateAlkaneAnswer(question.answer.canonical);
      const expectedTokens=expectedAnswer&&'tokens' in expectedAnswer?expectedAnswer.tokens:[];
      const expected=engine.reconstructNameFromTokens(expectedTokens);
      correct=expected!==null&&engine.reconstructNameFromTokens(tokens)===expected;
    }
  }
  return {correct,empty:false,matchedAnswerKind:correct?'canonical':null,note:null};
}
