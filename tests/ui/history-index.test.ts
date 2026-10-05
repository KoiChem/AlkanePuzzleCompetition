import { describe, expect, it } from "vitest";
import { discoverHistoryCandidates, rememberHistoryRoom } from "../../src/features/results/history-index";

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => { values.clear(); } } as Storage;
}

describe("same-browser history index", () => {
  it("recovers older participant and teacher rooms without copying tokens into the index", () => {
    const local = storage();
    local.setItem("alkane-puzzle-competition:room:room-1", JSON.stringify({ token: "secret", participantId: "p1" }));
    local.setItem("alkane-puzzle-competition:meta:room-2", JSON.stringify({ joinCode: "ABCDEF" }));
    local.setItem("alkane-puzzle-competition:meta:room-3", JSON.stringify({ joinCode: "ABCDEF", host: true }));
    rememberHistoryRoom(local, { roomId: "room-1", role: "participant" });
    expect(discoverHistoryCandidates(local)).toEqual(expect.arrayContaining([{ roomId: "room-1", role: "participant" }, { roomId: "room-2", role: "teacher" }]));
    expect(discoverHistoryCandidates(local)).toHaveLength(2);
    expect(local.getItem("alkane-puzzle-competition:history:v1")).not.toContain("secret");
  });
  it("ignores damaged and irrelevant entries", () => {
    const local = storage();
    local.setItem("alkane-puzzle-competition:history:v1", "{");
    local.setItem("alkane-puzzle-competition:room:../bad", JSON.stringify({ token: "x" }));
    local.setItem("alkane-puzzle-competition:room:failed-join", JSON.stringify({ token: "pending-only" }));
    expect(discoverHistoryCandidates(local)).toEqual([]);
  });
  it("keeps verified summary metadata without storing credentials", () => {
    const local = storage();
    rememberHistoryRoom(local, { roomId: "old-class", role: "teacher", kind: "class", createdAtMs: 1000, expiresAtMs: 2000 });
    expect(discoverHistoryCandidates(local)).toEqual([{ roomId: "old-class", role: "teacher", kind: "class", createdAtMs: 1000, expiresAtMs: 2000 }]);
  });
});
