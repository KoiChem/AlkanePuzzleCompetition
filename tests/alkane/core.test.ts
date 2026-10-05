import { describe, expect, it } from 'vitest';
import { DEFAULT_QUESTION_PROFILE, validateQuestionProfileShape } from '../../src/games/alkane-puzzle/shared/question-profile';
import { generateQuestionSet, validateGameSettings, validateQuestionProfile, toPublicQuestion } from '../../src/games/alkane-puzzle/server/question-generator';
import { evaluateField, validateAlkaneAnswer } from '../../src/games/alkane-puzzle/shared/answer-evaluator';
import { createAlkaneEngine } from '../../src/games/alkane-puzzle/shared/engine.js';
import type { AlkaneGameSettings } from '../../src/games/alkane-puzzle/shared/types';

const settings: AlkaneGameSettings = { mode: 'arrange', difficulty: 'easy', alcoholEnabled: false, questionCount: 5, timeLimitMinutes: 5, gradingMode: 'immediate' };
const seeded = (seed = 1) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);

describe('alkane core', () => {
  it('uses the four independent original default rules', () => {
    expect(DEFAULT_QUESTION_PROFILE.rules.arrange.easy.cycloSubstituentCount).toBe(0);
    expect(DEFAULT_QUESTION_PROFILE.rules.arrange.medium.typeMax).toBe(2);
    expect(DEFAULT_QUESTION_PROFILE.rules.name.easy.bendMax).toBe(1);
    expect(DEFAULT_QUESTION_PROFILE.rules.name.medium.bendMin).toBe(2);
  });

  it('generates a stable room set with arrangement prompts and hidden answers', () => {
    const first = generateQuestionSet(settings, seeded(91));
    const second = generateQuestionSet(settings, seeded(91));
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(first.map(q => q.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(first.every(q => q.prompt.kind === 'alkane' && q.prompt.mode === 'arrange' && q.prompt.grid === null && !!q.prompt.name)).toBe(true);
    expect(first.every(q => q.fields.length === 1 && q.fields[0].id === 'formula' && q.maxScore === 1)).toBe(true);
    expect(new Set(first.map(q => q.prompt.name)).size).toBe(first.length);
    expect(first.every(q => !JSON.stringify(q.prompt).includes('correctAnswer'))).toBe(true);
    expect(first.every(q => q.prompt.options?.length === 9 && q.prompt.bounds?.cols === 7 && q.prompt.bounds.rows === 5)).toBe(true);
    const publicQuestion = toPublicQuestion(first[0], { resolvedFieldIds: [] });
    expect(publicQuestion).not.toHaveProperty('answer');
    expect(publicQuestion.prompt).toHaveProperty('name');
  });

  it('generates name questions with an exact token answer and word bank', () => {
    const questions = generateQuestionSet({ ...settings, mode: 'name' }, seeded(117));
    expect(questions).toHaveLength(5);
    for (const q of questions) {
      expect(q.prompt.grid).not.toBeNull();
      expect(q.prompt.wordBank?.length).toBe(4);
      expect(q.fields[0].id).toBe('name');
      const answer = JSON.parse(q.answer.canonical);
      expect(evaluateField(q, 'name', JSON.stringify({ tokens: answer.tokens })).correct).toBe(true);
      expect(evaluateField(q, 'name', JSON.stringify({ tokens: [...answer.tokens].reverse() })).correct).toBe(answer.tokens.length <= 1);
    }
  });

  it('rejects invalid settings and malformed profiles', () => {
    expect(() => validateGameSettings({ ...settings, questionCount: 16 })).toThrow();
    expect(() => validateQuestionProfileShape({ ...DEFAULT_QUESTION_PROFILE, rules: { ...DEFAULT_QUESTION_PROFILE.rules, arrange: { ...DEFAULT_QUESTION_PROFILE.rules.arrange, easy: { ...DEFAULT_QUESTION_PROFILE.rules.arrange.easy, cycloSubstituentCount: 3 } } } })).toThrow();
  });

  it('judges translated and rotated structures by their generated names', () => {
    const empty = () => Array.from({ length: 5 }, () => Array(7).fill(null));
    const horizontal = empty();
    horizontal[2][2] = { type: 1, rotation: 0 };
    horizontal[2][3] = { type: 1, rotation: 180 };
    const vertical = empty();
    vertical[1][5] = { type: 1, rotation: 90 };
    vertical[2][5] = { type: 1, rotation: 270 };
    const question = { ...generateQuestionSet(settings, seeded(13))[0], answer: { type: 'formula' as const, canonical: JSON.stringify({ grid: horizontal }), accepted: [] } };
    expect(evaluateField(question, 'formula', { grid: vertical }).correct).toBe(true);
    expect(evaluateField(question, 'formula', { grid: empty() }).correct).toBe(false);
    expect(evaluateField(question, 'formula', { grid: [[{ type: 99, rotation: 0 }]] }).correct).toBe(false);
  });

  it('accepts only bounded board and word token syntax for saved drafts', () => {
    const board = Array.from({ length: 5 }, () => Array(7).fill(null));
    board[2][2] = { type: 1, rotation: 0, element: 'OH' };
    expect(validateAlkaneAnswer({ grid: board })).not.toBeNull();
    expect(validateAlkaneAnswer({ tokens: ['2', 'メチル', 'ブタン'] })).not.toBeNull();
    expect(validateAlkaneAnswer({ tokens: ['javascript:alert(1)'] })).toBeNull();
    expect(validateAlkaneAnswer({ tokens: Array(41).fill('メチル') })).toBeNull();
    expect(validateAlkaneAnswer({ grid: [[{ type: '1', rotation: 0 }]] })).toBeNull();
    const invalid = structuredClone(board);
    invalid[2][2] = { type: 2, rotation: 0, element: 'OH' };
    expect(validateAlkaneAnswer({ grid: invalid })).toBeNull();
    expect(validateAlkaneAnswer({ grid: board }, { bounds: { cols: 3, rows: 3 }, alcoholEnabled: false })).toBeNull();
    const outside = structuredClone(board);
    outside[2][2] = null;
    outside[0][0] = { type: 1, rotation: 0 };
    expect(validateAlkaneAnswer({ grid: outside }, { bounds: { cols: 3, rows: 3 }, alcoholEnabled: true })).toBeNull();
    expect(validateAlkaneAnswer({ grid: board, tokens: [] })).toBeNull();
  });

  it('enforces cyclo substituent count independently of hydroxyl count', () => {
    for (const target of [0, 1, 2] as const) {
      const profile = structuredClone(DEFAULT_QUESTION_PROFILE);
      profile.rules.arrange.easy.cycloSubstituentCount = target;
      const questions = generateQuestionSet({ ...settings, questionCount: 15, alcoholEnabled: true }, seeded(11 + target), profile);
      const engine = createAlkaneEngine();
      for (const question of questions.filter(q => q.category === 'cyclo')) {
        const grid = JSON.parse(question.answer.canonical).grid;
        const graph = engine.buildGraph(grid);
        const ring = new Set(engine.findRing(graph));
        let nonHydroxyl = 0;
        for (const id of ring) for (const neighbor of graph.adjacency.get(id) ?? []) {
          if (!ring.has(neighbor) && graph.elements.get(neighbor) !== 'OH') nonHydroxyl++;
        }
        expect(target === 2 ? nonHydroxyl >= 2 : nonHydroxyl === target).toBe(true);
      }
    }
  });

  it('generates alcohol when rate is 100 percent and fails within a bound for impossible constraints', () => {
    const profile = structuredClone(DEFAULT_QUESTION_PROFILE);
    profile.rules.name.easy.alcoholRate = 100;
    const questions = generateQuestionSet({ ...settings, mode: 'name', alcoholEnabled: true }, seeded(7), profile);
    expect(questions.every(q => JSON.parse(q.answer.canonical).tokens.includes('オール'))).toBe(true);
    const impossible = structuredClone(DEFAULT_QUESTION_PROFILE);
    impossible.rules.arrange.medium.gridCols = 3;
    impossible.rules.arrange.medium.gridRows = 3;
    impossible.rules.arrange.medium.lenMin = 10;
    impossible.rules.arrange.medium.lenMax = 10;
    impossible.rules.arrange.medium.ringSizes = [10];
    expect(() => validateQuestionProfile(impossible)).toThrow(/生成できません/);
    expect(() => generateQuestionSet({ ...settings, difficulty: 'medium' }, seeded(3), impossible)).toThrow(/生成できません/);
  });

  it('prepares playable sets for every mode, difficulty, and alcohol switch', () => {
    let seed = 201;
    for (const mode of ['arrange', 'name'] as const) for (const difficulty of ['easy', 'medium'] as const) for (const alcoholEnabled of [false, true]) {
      const questions = generateQuestionSet({ ...settings, mode, difficulty, alcoholEnabled }, seeded(seed++));
      expect(questions).toHaveLength(5);
      expect(questions.every(q => q.answer.canonical.length > 0)).toBe(true);
    }
  });

  it('uses original recent-name and backbone selection within one room', () => {
    const engine = createAlkaneEngine(seeded(73));
    const history: unknown[] = [];
    const rule = DEFAULT_QUESTION_PROFILE.rules.arrange.easy;
    const options = { ...rule, useBent: true, forceTurn: false, forceRingSubstituent: false, allowMethane: true, categoryWeights: { methane: 10, chain: 75, cyclo: 15 }, alcoholEnabled: false, maxWidth: 7, maxHeight: 5 };
    const first = engine.generateAvoidingRecentRepeat(options, history);
    expect(first).not.toBeNull();
    engine.rememberQuestion(history, first!);
    const next = engine.generateAvoidingRecentRepeat(options, history);
    expect(next?.name).not.toBe(first?.name);
  });
});
