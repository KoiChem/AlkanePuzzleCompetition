import type { AnswerFieldId, QuestionPrompt } from "../../games/alkane-puzzle/shared/types";
import { AlkaneAnswerView, AlkanePromptSummary, answerIsEmpty } from "./AlkaneReview";

type ReviewField={id:AnswerFieldId;value:unknown};
export function DeferredReviewQuestion({number,prompt,fields,disabled,onSelect}:{number:number;prompt:QuestionPrompt;fields:readonly ReviewField[];disabled:boolean;onSelect():void}) {
  return <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} onClick={disabled ? undefined : onSelect} onKeyDown={disabled ? undefined : event => {if (event.key==="Enter" || event.key===" ") {event.preventDefault();onSelect();}}} className="alkane-deferred-review"><div className="review-question-line"><strong>第{number}問：</strong><AlkanePromptSummary prompt={prompt}/></div><div className={`review-answer-block ${fields.every(field => answerIsEmpty(field.value)) ? "is-empty" : ""}`}>{fields.map(field => <div key={field.id} className="review-answer-line"><strong>{field.id==="formula" ? "構造" : "名前"}：</strong><AlkaneAnswerView raw={field.value} fieldId={field.id} label={`第${number}問の解答`}/></div>)}</div></div>;
}
