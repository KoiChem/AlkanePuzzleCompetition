import {createAlkaneEngine} from '../game/engine.js';
import {AlkaneBoard} from '../game/client/AlkaneBoard';
import {CompoundName} from '../game/client/CompoundName';
import {validateAlkaneAnswer} from '../game/evaluator';
import type {QuestionPrompt} from '../game/types';
const engine=createAlkaneEngine();
export function parsedAnswer(raw:unknown){return validateAlkaneAnswer(raw);}
export function AlkanePromptSummary({prompt}:{prompt:QuestionPrompt}){
 return prompt.mode==='arrange'?<span className="alkane-review-name"><CompoundName name={prompt.name??''}/></span>:prompt.grid?<div className="alkane-review-board"><AlkaneBoard grid={prompt.grid} label="問題の構造" compact/></div>:null;
}
export function AlkaneAnswerView({raw,fieldId,label}:{raw:unknown;fieldId:'formula'|'name';label:string}){
 const parsed=parsedAnswer(raw);
 if(!parsed)return <span aria-label={label}>未解答</span>;
 if(fieldId==='formula'&&'grid' in parsed)return <div className="alkane-review-board"><AlkaneBoard grid={parsed.grid} label={label} compact/></div>;
 if(fieldId==='name'&&'tokens' in parsed&&parsed.tokens.length)return <span className="alkane-review-tokens" aria-label={label}><CompoundName name={engine.reconstructNameFromTokens(parsed.tokens)??parsed.tokens.join('')}/></span>;
 return <span aria-label={label}>未解答</span>;
}
