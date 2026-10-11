import type { CompetitionSettings } from '../../src/config/public';

export type GameMode = 'arrange' | 'name';
export type Difficulty = 'easy' | 'medium';
export type GradingMode = 'immediate' | 'deferred';
export type Panel = { readonly type: 1 | 2 | 3 | 4 | 5; readonly rotation: number; readonly element?: string };
export type Grid = readonly (readonly (Panel | null)[])[];
export type AlkaneGameSettings = CompetitionSettings & {
  readonly mode: GameMode | 'both';
  readonly difficulty: Difficulty;
  readonly alcoholEnabled: boolean;
  readonly chemistryContentVersion?: string;
  readonly gradingMode?: GradingMode;
  readonly ionAnswer?: string;
  readonly compoundAnswer?: string;
  readonly compoundPrompts?: { readonly formula: boolean; readonly name: boolean };
  readonly complexEnabled?: boolean;
};
export type AnswerFieldId = 'formula' | 'name';
export type AnswerField = { readonly id: AnswerFieldId; readonly type: AnswerFieldId };
export type AnswerSpecification = { readonly type: AnswerFieldId; readonly canonical: string; readonly accepted: readonly string[] };
export type QuestionAnswer = AnswerSpecification;
export type FormulaCharge = { readonly magnitude: number; readonly sign: '+' | '-'; readonly source: 'chargeButton' | 'typed' };
export type FormulaEntry = { readonly tokens: readonly string[]; readonly cursor: number; readonly charge: FormulaCharge | null };
export type QuestionPrompt = {
  readonly kind: 'alkane';
  readonly mode: GameMode;
  readonly grid: Grid | null;
  readonly name?: string;
  readonly options?: readonly Panel[];
  readonly wordBank?: readonly (readonly string[])[];
  readonly bounds?: { readonly cols: number; readonly rows: number };
  readonly alcoholEnabled: boolean;
  readonly values: readonly [];
};
export type InternalQuestion = {
  readonly id: string;
  readonly ordinal: number;
  readonly itemId: string;
  readonly category: string;
  readonly variant: string;
  readonly prompt: QuestionPrompt;
  readonly fields: readonly AnswerField[];
  readonly maxScore: number;
  readonly answer: QuestionAnswer;
};
export type QuestionProgress = { readonly resolvedFieldIds: readonly AnswerFieldId[]; readonly fieldStates?: Readonly<Partial<Record<AnswerFieldId, 'pending' | 'correct' | 'passed' | 'unanswered'>>> };
export type PublicQuestion = Pick<InternalQuestion, 'id' | 'ordinal' | 'prompt' | 'fields'> & { readonly progress: QuestionProgress };
export type FieldEvaluation = { readonly correct: boolean; readonly empty: boolean; readonly matchedAnswerKind: 'canonical' | 'acceptedAlternative' | null; readonly note: string | null };
