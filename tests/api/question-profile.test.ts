import { afterEach, describe, expect, it } from 'vitest';
import { createApiHandlers } from '../../src/platform/http';
import { DEFAULT_QUESTION_PROFILE } from '../../src/games/alkane-puzzle/shared/question-profile';
import { apiRequest, createApiTestContext, joinClassRoom, createMateRoom, SETTINGS } from './helpers';

const contexts: ReturnType<typeof createApiTestContext>[] = [];
afterEach(() => contexts.splice(0).forEach(context => context.close()));
function setup() {
  const context = createApiTestContext();
  contexts.push(context);
  context.dependencies.serverConfig.masterTeacherEmail = 'teacher@example.com';
  return { ...context, handlers: createApiHandlers(context.dependencies) };
}
function nextProfile() {
  const profile = structuredClone(DEFAULT_QUESTION_PROFILE);
  profile.rules.arrange.easy.gridCols = 5;
  return profile;
}
function patch(handlers: ReturnType<typeof createApiHandlers>, profile = nextProfile(), expectedRevision = 0, requestId = crypto.randomUUID()) {
  return handlers.teacherQuestionProfile(apiRequest('/api/teacher/question-profile', {
    method: 'PATCH', json: { profile, expectedRevision, requestId },
  }));
}
async function startRoom(context: ReturnType<typeof setup>, id: string, revision: number, token?: string) {
  return context.handlers.startRoom(apiRequest('/api/rooms/x/start', {
    method: 'POST', token, json: { requestId: crypto.randomUUID(), expectedRevision: revision },
  }), { id });
}

describe('master Alkane question profiles', () => {
  it('denies GET and PATCH to ordinary and anonymous teachers', async () => {
    for (const teacher of [undefined, null]) {
      const context = createApiTestContext({ teacher });
      contexts.push(context);
      for (const method of ['GET', 'PATCH']) {
        const response = await context.handlers.teacherQuestionProfile(apiRequest('/api/teacher/question-profile', {
          method, ...(method === 'PATCH' ? { json: {} } : {}),
        }));
        expect([401, 403]).toContain(response.status);
      }
    }
  });

  it('returns the four default rules and enforces revision, replay, and body binding', async () => {
    const context = setup();
    const initial = await (await context.handlers.teacherQuestionProfile(apiRequest('/api/teacher/question-profile'))).json() as any;
    expect(initial.profile).toEqual(DEFAULT_QUESTION_PROFILE);
    expect(initial.catalog.modes).toEqual(['arrange', 'name']);
    expect(initial.catalog.difficulties).toEqual(['easy', 'medium']);
    const id = crypto.randomUUID();
    expect((await patch(context.handlers, nextProfile(), 0, id)).status).toBe(200);
    expect((await patch(context.handlers, nextProfile(), 0, id)).status).toBe(200);
    expect((await patch(context.handlers)).status).toBe(409);
    expect((await patch(context.handlers, DEFAULT_QUESTION_PROFILE, 0, id)).status).toBe(409);
    expect((await patch(context.handlers, DEFAULT_QUESTION_PROFILE, 1)).status).toBe(200);
  });

  it('rejects malformed and impossible rule combinations and foreign origins', async () => {
    const context = setup();
    const malformed = nextProfile();
    malformed.rules.arrange.easy.cycloSubstituentCount = 3 as 0;
    expect((await patch(context.handlers, malformed)).status).toBe(400);
    const impossible = nextProfile();
    Object.assign(impossible.rules.arrange.medium, { gridCols: 3, gridRows: 3, lenMin: 10, lenMax: 10, ringSizes: [10] });
    expect((await patch(context.handlers, impossible)).status).toBe(400);
    const foreign = await context.handlers.teacherQuestionProfile(apiRequest('/api/teacher/question-profile', {
      method: 'PATCH', headers: { origin: 'https://evil.example' },
      json: { profile: nextProfile(), expectedRevision: 0, requestId: crypto.randomUUID() },
    }));
    expect(foreign.status).toBe(403);
  });

  it('pins a profile at room creation across saves, retries, and settings edits', async () => {
    const context = setup();
    const requestId = crypto.randomUUID();
    const create = () => context.handlers.createClassRoom(apiRequest('/api/class-rooms', {
      method: 'POST', json: { requestId, settings: SETTINGS },
    }));
    const first = await create();
    expect(first.status).toBe(201);
    const firstBody = await first.json() as any;
    const firstSnapshot = context.database.sqlite.prepare('SELECT profile_revision, profile_json FROM room_question_profiles WHERE room_id = (SELECT id FROM rooms WHERE public_id = ?)').get(firstBody.room.id) as any;
    expect(firstSnapshot.profile_revision).toBe(0);
    expect(JSON.parse(firstSnapshot.profile_json).rules.arrange.easy.gridCols).toBe(7);
    expect((await patch(context.handlers)).status).toBe(200);
    expect(await (await create()).json()).toEqual(firstBody);
    const changed = await context.handlers.updateRoomSettings(apiRequest('/api/rooms/x/settings', {
      method: 'PATCH', json: { requestId: crypto.randomUUID(), expectedRevision: 0, settings: { ...SETTINGS, questionCount: 10 } },
    }), { id: firstBody.room.id });
    expect(changed.status).toBe(200);
    await joinClassRoom(context, firstBody.room.id);
    expect((await startRoom(context, firstBody.room.id, 2)).status).toBe(200);
    const oldQuestions = context.database.sqlite.prepare('SELECT answer_snapshot_json FROM room_questions WHERE room_id = (SELECT id FROM rooms WHERE public_id = ?)').all(firstBody.room.id) as any[];
    expect(oldQuestions).toHaveLength(10);
    expect(JSON.parse(oldQuestions[0].answer_snapshot_json).prompt.bounds.cols).toBe(7);

    const second = await context.handlers.createClassRoom(apiRequest('/api/class-rooms', {
      method: 'POST', json: { requestId: crypto.randomUUID(), settings: SETTINGS },
    }));
    expect(second.status).toBe(201);
    const secondBody = await second.json() as any;
    const secondSnapshot = context.database.sqlite.prepare('SELECT profile_revision, profile_json FROM room_question_profiles WHERE room_id = (SELECT id FROM rooms WHERE public_id = ?)').get(secondBody.room.id) as any;
    expect(secondSnapshot.profile_revision).toBe(1);
    expect(JSON.parse(secondSnapshot.profile_json).rules.arrange.easy.gridCols).toBe(5);
  });

  it('prepares a deferred name match with one field per question', async () => {
    const context = setup();
    const host = await createMateRoom(context, { settings: { ...SETTINGS, mode: 'name', difficulty: 'medium', gradingMode: 'deferred', questionCount: 15 } });
    expect(host.response.status).toBe(201);
    await joinClassRoom(context, host.body.room.id);
    expect((await startRoom(context, host.body.room.id, 1, host.token)).status).toBe(200);
    const rows = context.database.sqlite.prepare('SELECT answer_snapshot_json FROM room_questions WHERE room_id = (SELECT id FROM rooms WHERE public_id = ?)').all(host.body.room.id) as any[];
    expect(rows).toHaveLength(15);
    expect(rows.every(row => {
      const question = JSON.parse(row.answer_snapshot_json);
      return question.prompt.mode === 'name' && question.fields.length === 1 && question.fields[0].id === 'name';
    })).toBe(true);
  });

  it('allows an old room without a profile snapshot to use the default profile', async () => {
    const context = setup();
    const created = await context.handlers.createClassRoom(apiRequest('/api/class-rooms', {
      method: 'POST', json: { requestId: crypto.randomUUID(), settings: SETTINGS },
    }));
    const body = await created.json() as any;
    context.database.sqlite.prepare('DELETE FROM room_question_profiles').run();
    await joinClassRoom(context, body.room.id);
    expect((await startRoom(context, body.room.id, 1)).status).toBe(200);
    expect(context.database.sqlite.prepare('SELECT count(*) AS n FROM room_questions').get()?.n).toBe(5);
  });

  it('serializes concurrent saves and recovers a committed response', async () => {
    const context = setup();
    const replies = await Promise.all([patch(context.handlers), patch(context.handlers, DEFAULT_QUESTION_PROFILE)]);
    expect(replies.map(response => response.status).sort()).toEqual([200, 409]);
    context.database.throwAfterNextBatchCommit();
    expect((await patch(context.handlers, DEFAULT_QUESTION_PROFILE, 1)).status).toBe(200);
    const current = await (await context.handlers.teacherQuestionProfile(apiRequest('/api/teacher/question-profile'))).json() as any;
    expect(current.revision).toBe(2);
  });

  it('captures one coherent profile when an admin saves during room creation', async () => {
    const context = setup();
    const pause = context.database.pauseNextBatch();
    const creating = context.handlers.createClassRoom(apiRequest('/api/class-rooms', {
      method: 'POST', json: { requestId: crypto.randomUUID(), settings: SETTINGS },
    }));
    await pause.reached;
    const saving = patch(context.handlers);
    pause.release();
    expect((await creating).status).toBe(201);
    expect((await saving).status).toBe(200);
    const row = context.database.sqlite.prepare('SELECT profile_revision, profile_json FROM room_question_profiles').get() as any;
    expect(row.profile_revision).toBe(0);
    expect(JSON.parse(row.profile_json).rules.arrange.easy.gridCols).toBe(7);
  });
});
