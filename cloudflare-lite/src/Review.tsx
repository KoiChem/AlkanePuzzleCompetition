import {createAlkaneEngine} from '../game/engine.js';
import {AlkaneAnswerView as StructureAnswer,parsedAnswer} from '../../src/features/play/AlkaneReview';
export {AlkanePromptSummary,parsedAnswer} from '../../src/features/play/AlkaneReview';
const engine=createAlkaneEngine();
export function AlkaneAnswerView({raw,fieldId,label}:{raw:unknown;fieldId:'formula'|'name';label:string}){
 if(fieldId==='formula')return <StructureAnswer raw={raw} fieldId={fieldId} label={label}/>;
 const parsed=parsedAnswer(raw),tokens=parsed?.tokens;
 if(!Array.isArray(tokens)||tokens.some(t=>typeof t!=='string')||!tokens.length)return <span aria-label={label}>未解答</span>;
 return <span className="alkane-review-tokens" aria-label={label}>{engine.reconstructNameFromTokens(tokens)??tokens.join('')}</span>;
}
