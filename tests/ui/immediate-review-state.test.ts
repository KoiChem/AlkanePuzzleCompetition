import { describe, expect, it } from "vitest";
import { immediateReviewState } from "../../src/features/play/immediate-review-state";
import type { InternalQuestion } from "../../src/games/alkane-puzzle/shared/types";
import type { V2Operation } from "../../src/competition-core/v2-operations";

const questions: InternalQuestion[] = [0, 1, 2].map(ordinal => ({ id: `q${ordinal}`, ordinal, itemId: `i${ordinal}`, category: "chain", variant: "name", maxScore: 1,
  prompt: { kind: "alkane", mode: "name", grid: [[{type:1,rotation:0}]], wordBank: [["メタン", "エタン"]], alcoholEnabled: false, values: [] }, fields: [{ id: "name", type: "name" }],
  answer: { type: "name", canonical: JSON.stringify({tokens:["メタン"]}), accepted: [] },
}));
const op = (seq: number, type: V2Operation["type"], questionId: string, value?: string): V2Operation => ({ seq, operationId: `op${seq}`, type, questionId, fieldId: "name", value, elapsedMs: seq * 100 });

describe("immediate review state", () => {
  it("tracks the furthest question despite revisiting a passed field", () => {
    const state = immediateReviewState(questions, [op(1, "pass", "q0"), op(2, "answer", "q1", JSON.stringify({tokens:["メタン"]})), op(3, "answer", "q0", JSON.stringify({tokens:["エタン"]}))]);
    expect(state.frontier).toBe(2);
    expect(state.fields["q0:name"]).toBe("passedRetry");
    expect(state.fields["q1:name"]).toBe("correct");
    expect(state.fields["q2:name"]).toBeUndefined();
  });
  it("does not count a passed field as correct until its retry succeeds", () => {
    const state = immediateReviewState(questions, [op(1, "pass", "q0"), op(2, "answer", "q0", JSON.stringify({tokens:["メタン"]}))]);
    expect(state.frontier).toBe(1);
    expect(state.correctCount).toBe(1);
    expect(state.fields["q0:name"]).toBe("correct");
  });
});

describe("normal question resumption after reviewing passed answers", () => {
  it("resumes at the next normal question after a passed answer is solved", async () => {
    const { immediateResumeTarget } = await import('../../src/features/play/immediate-review-state');
    expect(immediateResumeTarget(questions, [op(1, 'pass', 'q0'), op(2, 'answer', 'q1', JSON.stringify({tokens:["メタン"]})), op(3, 'answer', 'q0', JSON.stringify({tokens:["メタン"]}))])).toEqual({ ordinal: 2, fieldId: 'name' });
  });
  it("resumes an incorrect current answer before later unstarted questions", async () => {
    const { immediateResumeTarget } = await import('../../src/features/play/immediate-review-state');
    expect(immediateResumeTarget(questions, [op(1, 'pass', 'q0'), op(2, 'answer', 'q1', JSON.stringify({tokens:["エタン"]}))])).toEqual({ ordinal: 1, fieldId: 'name' });
  });
  it("has no normal continuation after every question is resolved or passed", async () => {
    const { immediateResumeTarget } = await import('../../src/features/play/immediate-review-state');
    expect(immediateResumeTarget(questions, [op(1, 'pass', 'q0'), op(2, 'pass', 'q1'), op(3, 'pass', 'q2')])).toBeNull();
  });
  it("resumes a single unanswered alkane field after a passed earlier question", async () => {
    const { immediateResumeTarget } = await import('../../src/features/play/immediate-review-state');
    expect(immediateResumeTarget(questions, [op(1, 'pass', 'q0')])).toEqual({ ordinal: 1, fieldId: 'name' });
  });
});
