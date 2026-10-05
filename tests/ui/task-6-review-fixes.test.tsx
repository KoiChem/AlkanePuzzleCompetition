import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QuestionView } from "../../src/games/alkane-puzzle/client/QuestionView";
import { generateQuestionSet, toPublicQuestion } from "../../src/games/alkane-puzzle/server/question-generator";
import { Lobby } from "../../src/features/lobby/Lobby";
import {
  DEFAULT_SETTINGS,
  CompetitionSettingsForm,
  settingsSummary,
} from "../../src/features/setup/CompetitionSettingsForm";
import {
  chooseFreshSnapshot,
  countdownSeconds,
  remainingSeconds,
} from "../../src/features/play/useRoomSync";

const room = {
  id: "stable-public-id", kind: "mate" as const, state: "WAITING" as const,
  revision: 4, settings: DEFAULT_SETTINGS, maxScore: 10,
  startAtMs: null, deadlineAtMs: null, expiresAtMs: 99_999,
};

describe("Task 6 review fixes", () => {
  it("supplies a full source palette without revealing the generated answer structure", () => {
    const question = generateQuestionSet({ ...DEFAULT_SETTINGS, questionCount: 5 }, () => .47)[0];
    expect(question.prompt.mode).toBe("arrange");
    expect(question.prompt.grid).toBeNull();
    expect(question.prompt.options?.map(item => item.element ?? item.type)).toEqual([1,2,3,4,5,"F","Cl","Br","I"]);
    expect(question.answer.canonical).toContain('"grid"');
  });

  it("renders the public puzzle without embedding its canonical answer", () => {
    const question = generateQuestionSet({ ...DEFAULT_SETTINGS, questionCount: 5 }, () => .37)[0];
    const html = renderToStaticMarkup(createElement(QuestionView, { question: toPublicQuestion(question,{resolvedFieldIds:[]}), fieldId:"formula", onChange:()=>{} }));
    expect(html).toContain("解答の構造");
    expect(html).toContain("原子パレット");
    expect(html).not.toContain(question.answer.canonical);
  });

  it("rejects participant snapshots that arrive out of order even when room revision is unchanged", () => {
    const current = { room: { revision: 4 }, participant: { revision: 8 } };
    expect(chooseFreshSnapshot(current, { room: { revision: 4 }, participant: { revision: 7 } }, 2, 1)).toBe(current);
    expect(chooseFreshSnapshot(current, { room: { revision: 4 }, participant: { revision: 9 } }, 2, 1)?.participant?.revision).toBe(9);
    expect(chooseFreshSnapshot(current, { room: { revision: 4 }, participant: { revision: 8 } }, 2, 3)).not.toBe(current);
  });

  it("derives a continuously changing countdown and remaining play time", () => {
    expect(countdownSeconds(10_000, 5_001)).toBe(5);
    expect(countdownSeconds(10_000, 9_001)).toBe(1);
    expect(remainingSeconds(310_000, 10_001)).toBe(300);
    expect(remainingSeconds(310_000, 309_999)).toBe(1);
  });

  it("exposes the two alkane modes, difficulties, and shared settings summary", () => {
    expect(DEFAULT_SETTINGS.mode).toBe("arrange");
    expect(DEFAULT_SETTINGS.difficulty).toBe("easy");
    expect(settingsSummary({ ...DEFAULT_SETTINGS, mode: "name", difficulty:"medium" })).toBe("10問・5分・問題毎判定・名付ける・まあまあ");
    const html = renderToStaticMarkup(createElement(CompetitionSettingsForm, {
      value: DEFAULT_SETTINGS, onChange: () => {},
    }));
    for (const label of ["並べる","名付ける","すいすい","まあまあ","アルコール"]) expect(html).toContain(label);
  });

  it("renders a real local QR image, lobby settings, and owner removal controls", () => {
    const html = renderToStaticMarkup(createElement(Lobby, {
      room, joinCode: "ABC234", canStart: true, onStart: () => {}, onRemove: () => {},
      ownerParticipantId: "host",
      participants: [
        { id: "host", nickname: "ホスト", status: "ACTIVE", currentOrdinal: 0, correctCount: 0, resolvedQuestionCount: 0, revision: 0, elapsedCs: null, timingSource: null },
        { id: "guest", nickname: "ゲスト", status: "ACTIVE", currentOrdinal: 0, correctCount: 0, resolvedQuestionCount: 0, revision: 2, elapsedCs: null, timingSource: null },
      ],
    }));
    expect(html).toContain("<svg");
    expect(html).toContain("aria-label=\"参加用QRコード");
    expect(html).not.toContain("qr-placeholder");
    expect(html).toContain("10問・5分・問題毎判定・並べる・すいすい");
    expect(html).toContain("ゲストさんを参加者から除外");
    expect(html).not.toContain("ホストさんを参加者から除外");
  });

  it("wires join info, settings PATCH, removal, and persistent pending actions in components", () => {
    const join = readFileSync(new URL("../../app/join/[publicId]/page.tsx", import.meta.url), "utf8");
    const roomScreen = readFileSync(new URL("../../src/features/lobby/RoomScreen.tsx", import.meta.url), "utf8");
    const player = readFileSync(new URL("../../src/features/play/CompetitionPlayerV2.tsx", import.meta.url), "utf8");
    expect(join).toContain("/api/join-info?publicId=");
    expect(join).toContain("participantCount");
    expect(join).toContain("capacity");
    expect(roomScreen).toContain("patchJson");
    expect(roomScreen).toContain("/settings");
    expect(roomScreen).toContain("/remove");
    expect(player).toContain("writeV2Local");
    expect(player).toContain("scheduleDrafts");
    expect(player).toContain("QuestionView");
  });
});
