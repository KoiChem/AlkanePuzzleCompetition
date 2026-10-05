import type { FormulaEntry } from "../games/alkane-puzzle/shared/types";

export type DisplayAnswer = {
  lastAnswer: string | null;
  lastAnswerValue?: unknown;
  lastAnswerEntry: FormulaEntry | null;
  answerDisplayUnavailable?: true;
};

export function decodeDisplayAnswer(stored: string | null): DisplayAnswer {
  if (stored === null) return { lastAnswer: null, lastAnswerEntry: null };
  let raw: unknown;
  try { raw = JSON.parse(stored); }
  catch { return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true }; }
  if (raw === null) return { lastAnswer: null, lastAnswerEntry: null };
  if (typeof raw === "string") return { lastAnswer: raw, lastAnswerEntry: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  const candidate = raw as Record<string, unknown>;
  if (Array.isArray(candidate.grid) && candidate.grid.length <= 5 && candidate.grid.every(row => Array.isArray(row) && row.length <= 7)) {
    return { lastAnswer: null, lastAnswerEntry: null, lastAnswerValue: {grid: candidate.grid} };
  }
  if (!Array.isArray(candidate.tokens) || !candidate.tokens.every(token => typeof token === "string")) {
    return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  }
  if (Array.isArray(candidate.tokens) && candidate.charge === undefined) {
    return { lastAnswer: candidate.tokens.join(''), lastAnswerEntry: null, lastAnswerValue: {tokens: candidate.tokens} };
  }
  const charge = candidate.charge;
  if (charge !== null && charge !== undefined && (
    !charge || typeof charge !== "object" || Array.isArray(charge)
    || !["+", "-"].includes((charge as Record<string, unknown>).sign as string)
    || !Number.isSafeInteger((charge as Record<string, unknown>).magnitude)
    || Number((charge as Record<string, unknown>).magnitude) < 1
  )) return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  const entry = { ...candidate, tokens: candidate.tokens, charge: charge ?? null,
    cursor: Number.isSafeInteger(candidate.cursor) ? candidate.cursor : candidate.tokens.length } as FormulaEntry;
  const suffix = entry.charge ? `${entry.charge.magnitude === 1 ? "" : entry.charge.magnitude}${entry.charge.sign}` : "";
  return { lastAnswer: entry.tokens.join("") + suffix, lastAnswerEntry: entry };
}
