import { describe, expect, it } from "vitest";
import { replayV2Operations, type V2Operation } from "../../src/competition-core/v2-operations";
import type { InternalQuestion } from "../../src/games/alkane-puzzle/shared/types";

const questions: InternalQuestion[] = [0, 1].map(ordinal => ({ id: `q${ordinal}`, ordinal, itemId: `i${ordinal}`, category: "chain", variant: "name", maxScore: 1,
  prompt: { kind: "alkane", mode: "name", grid: Array.from({ length: 5 }, (_, row) => Array.from({ length: 7 }, (_, col) => row === 2 && col === 2 ? { type: 1 as const, rotation: 0 } : row === 2 && col === 3 ? { type: 1 as const, rotation: 180 } : null)), wordBank: [[], [], [], ["エタン", "プロパン"]], alcoholEnabled: false, values: [] }, fields: [{ id: "name", type: "name" }],
  answer: { type: "name", canonical: JSON.stringify({ tokens: ["エタン"] }), accepted: [] },
}));
const op = (seq: number, type: V2Operation["type"], questionId?: string, value?: string, reason?: V2Operation["reason"]): V2Operation => ({ seq, operationId: `op${seq}`, type, questionId, fieldId: questionId ? "name" : undefined, value, reason, elapsedMs: seq * 100 });
const replay = (operations: V2Operation[]) => replayV2Operations(questions, "immediate", operations, 0, 10_000);

describe("immediate pass retry and submission", () => {
  it("keeps the frontier while a passed earlier answer is retried", () => {
    const initial = [op(1, "pass", "q0"), op(2, "answer", "q1", JSON.stringify({ tokens: ["エタン"] }))];
    expect(replay(initial).resolvedQuestionCount).toBe(2);
    expect(replay([...initial, op(3, "answer", "q0", JSON.stringify({ tokens: ["プロパン"] }))]).fields["q0:name"].state).toBe("passed");
    const corrected = replay([...initial, op(3, "answer", "q0", JSON.stringify({ tokens: ["プロパン"] })), op(4, "answer", "q0", JSON.stringify({ tokens: ["エタン"] }))]);
    expect(corrected.correctCount).toBe(2);
    expect(corrected.resolvedQuestionCount).toBe(2);
  });
  it("accepts explicit early submission and rejects later edits or duplicate finish", () => {
    const submitted = [op(1, "pass", "q0"), op(2, "finish", undefined, undefined, "submitted")];
    expect(replay(submitted).finishReason).toBe("submitted");
    expect(replay(submitted).finishedElapsedMs).toBe(200);
    expect(() => replay([...submitted, op(3, "answer", "q0", JSON.stringify({ tokens: ["エタン"] }))])).toThrow();
    expect(() => replay([...submitted, op(3, "finish", undefined, undefined, "submitted")])).toThrow();
  });
  it("rejects future answers and duplicate pass while retaining historical completed logs", () => {
    expect(() => replay([op(1, "answer", "q1", JSON.stringify({ tokens: ["エタン"] }))])).toThrow();
    expect(() => replay([op(1, "pass", "q0"), op(2, "pass", "q0")])).toThrow();
    expect(replay([op(1, "pass", "q0"), op(2, "pass", "q1"), op(3, "finish", undefined, undefined, "completed")]).finishReason).toBe("completed");
  });
});
