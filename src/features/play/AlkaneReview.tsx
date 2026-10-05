import type { AnswerFieldId, QuestionPrompt } from "../../games/alkane-puzzle/shared/types";
import { AlkaneBoard, type BoardGrid } from "../../games/alkane-puzzle/client/AlkaneBoard";

export function parsedAnswer(raw:unknown): { grid?:BoardGrid; tokens?:string[] } | null {
  let value=raw;
  if (typeof value==="string") {try {value=JSON.parse(value);} catch {return null;}}
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const candidate=value as Record<string,unknown>;
  if (Array.isArray(candidate.grid) && candidate.grid.every(row => Array.isArray(row) && row.every(cell => cell===null || (typeof cell==="object" && !!cell)))) return {grid:candidate.grid as BoardGrid};
  if (Array.isArray(candidate.tokens) && candidate.tokens.every(token => typeof token==="string")) return {tokens:candidate.tokens as string[]};
  return null;
}
export function answerIsEmpty(raw:unknown):boolean {if (raw===null || raw===undefined || raw==="") return true;const answer=parsedAnswer(raw);return !!answer && (answer.grid ? !answer.grid.some(row => row.some(Boolean)) : !answer.tokens?.length);}
export function AlkanePromptSummary({prompt}:{prompt:QuestionPrompt}) {return prompt.mode==="arrange" ? <span className="alkane-review-name">並べる：{prompt.name}</span> : prompt.grid ? <div className="alkane-review-board"><span>名付ける：この構造</span><AlkaneBoard grid={prompt.grid} label="問題の構造"/></div> : <span>名付ける</span>;}
export function AlkaneAnswerView({raw,fieldId,label}:{raw:unknown;fieldId:AnswerFieldId;label:string}) {
  const answer=parsedAnswer(raw);
  if (answerIsEmpty(raw)) return <span>未解答</span>;
  if (!answer) return <span>解答を表示できません</span>;
  if (fieldId==="formula" && answer.grid) return <div className="alkane-review-board"><AlkaneBoard grid={answer.grid} label={label}/></div>;
  if (fieldId==="name" && answer.tokens) return <span className="alkane-review-tokens" aria-label={label}>{answer.tokens.map((token,index) => <span key={`${index}-${token}`}>{token}</span>)}</span>;
  return <span>解答を表示できません</span>;
}
