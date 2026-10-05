import { afterEach, describe, expect, it } from "vitest";
import { apiRequest, createApiTestContext, createClassRoom, joinClassRoom, SETTINGS } from "./helpers";

const contexts: ReturnType<typeof createApiTestContext>[] = [];
afterEach(() => contexts.splice(0).forEach(context => context.close()));

describe("field pass", () => {
  it("resolves a single arrange field and advances to the next question", async () => {
    const ctx = createApiTestContext(); contexts.push(ctx);
    const created = await createClassRoom(ctx);
    const room = created.body.room.id;
    const joined = await joinClassRoom(ctx, room, "参加者");
    await ctx.handlers.startRoom(apiRequest(`/api/rooms/${room}/start`, { method: "POST", json: { requestId: "start-arrange", expectedRevision: 1 } }), { id: room });
    ctx.setNow(6_000);
    const before = await ctx.handlers.state(apiRequest(`/api/rooms/${room}/state`, { token: joined.token }), { id: room });
    const data = await before.json() as { question: { id: string; fields: Array<{ id: string }>; progress: { fieldStates: Record<string, string> } } };
    expect(data.question.fields.map(field => field.id)).toEqual(["formula"]);
    expect(data.question.progress.fieldStates).toMatchObject({ formula: "pending" });
    const pass = await ctx.handlers.actions(apiRequest(`/api/rooms/${room}/actions`, { method: "POST", token: joined.token,
      json: { requestId: "pass-formula", questionId: data.question.id, expectedParticipantRevision: 0, clientElapsedMs: 0, action: { type: "pass", fieldId: "formula" } },
    }), { id: room });
    expect(pass.status).toBe(200);
    expect(await pass.json()).toMatchObject({ correctCount: 0, currentOrdinal: 1, resolvedQuestionCount: 1 });
    const after = await ctx.handlers.state(apiRequest(`/api/rooms/${room}/state`, { token: joined.token }), { id: room });
    const changed = await after.json() as typeof data;
    expect(changed.question.id).not.toBe(data.question.id);
  });

  it("requires a field for a new pass request", async () => {
    const ctx = createApiTestContext(); contexts.push(ctx);
    const room = (await createClassRoom(ctx)).body.room.id;
    const joined = await joinClassRoom(ctx, room);
    await ctx.handlers.startRoom(apiRequest(`/api/rooms/${room}/start`, { method: "POST", json: { requestId: "start", expectedRevision: 1 } }), { id: room });
    ctx.setNow(6_000);
    const state = await ctx.handlers.state(apiRequest(`/api/rooms/${room}/state`, { token: joined.token }), { id: room });
    const questionId = ((await state.json()) as { question: { id: string } }).question.id;
    const pass = await ctx.handlers.actions(apiRequest(`/api/rooms/${room}/actions`, { method: "POST", token: joined.token, json: { requestId: "old-client-pass", questionId, expectedParticipantRevision: 0, clientElapsedMs: 0, action: { type: "pass" } } }), { id: room });
    expect(pass.status).toBe(400);
  });

  it("accepts a valid action without granting malformed wait credit", async () => {
    const ctx = createApiTestContext(); contexts.push(ctx);
    const room = (await createClassRoom(ctx)).body.room.id;
    const joined = await joinClassRoom(ctx, room);
    await ctx.handlers.startRoom(apiRequest(`/api/rooms/${room}/start`, { method: "POST", json: { requestId: "start-credit", expectedRevision: 1 } }), { id: room });
    ctx.setNow(6_000);
    const state = await ctx.handlers.state(apiRequest(`/api/rooms/${room}/state`, { token: joined.token }), { id: room });
    const questionId = ((await state.json()) as { question: { id: string } }).question.id;
    const pass = await ctx.handlers.actions(apiRequest(`/api/rooms/${room}/actions`, { method: "POST", token: joined.token, json: {
      requestId: "pass-invalid-credit", questionId, expectedParticipantRevision: 0, clientElapsedMs: 0,
      waitCredit: { sourceRequestId: "bad$id", waitMs: -1 }, action: { type: "pass", fieldId: "formula" },
    } }), { id: room });
    expect(pass.status).toBe(200);
    expect(await pass.json()).toMatchObject({ waitCreditMs: 0, participantRevision: 1 });
  });
});
