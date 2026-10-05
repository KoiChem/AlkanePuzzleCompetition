import { describe, expect, it } from 'vitest';
import { answerHasContent } from '../../src/features/play/answer-content';
import { decodeDisplayAnswer } from '../../src/platform/result-answer';
import { PUBLIC_CONFIG } from '../../src/config/public';
describe('alkane transport and retention', () => {
 it('counts a placed panel as answered even when structurally invalid, clearing empties it', () => {
  expect(answerHasContent({grid:[[null,{type:1,rot:0},null]]})).toBe(true);
  expect(answerHasContent({grid:[[null,null,null]]})).toBe(false);
  expect(answerHasContent({tokens:['1','メチル']})).toBe(true);
  expect(answerHasContent({tokens:[]})).toBe(false);
 });
 it('retains the actual board for review rather than attempting formula conversion', () => {
  const board={grid:[[null,{type:1,rot:0},null]]};
  expect(decodeDisplayAnswer(JSON.stringify(board)).lastAnswerValue).toEqual(board);
  expect(decodeDisplayAnswer(JSON.stringify({tokens:['エタン']})).lastAnswerValue).toEqual({tokens:['エタン']});
  expect(decodeDisplayAnswer('{')).toMatchObject({answerDisplayUnavailable:true});
 });
 it('keeps both kinds for 14 days, independent from waiting and cancelled expiry', () => {
  expect(PUBLIC_CONFIG.retentionMs.classCompetition).toBe(14*86400000);
  expect(PUBLIC_CONFIG.retentionMs.mateMatch).toBe(14*86400000);
  expect(PUBLIC_CONFIG.waitingRoomLifetimeMs).toBe(7200000);
  expect(PUBLIC_CONFIG.retentionMs.cancelledRoom).toBe(86400000);
 });
});
