// src/platform/postgres-runtime.ts
import postgres from "npm:postgres@3.4.9";

// src/platform/postgres-database.ts
function postgresQuery(input, values = []) {
  let sql = input.replaceAll("`", '"').replace(/CAST\(unixepoch\('subsec'\) \* 1000 AS INTEGER\)/g, "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint").replace(/CAST\(([^()]+) AS INTEGER\)/gi, "CAST($1 AS bigint)").replace(/json_object\(/g, "json_build_object(").replace(/(?<!CROSS )\bJOIN\s+json_each\(/g, "CROSS JOIN LATERAL json_each(").replace(/json_each\(([^()]+)\)/g, "jsonb_array_elements(($1)::text::jsonb)").replace(/json_extract\(([^,()]+),\s*'\$((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+)'\)/g, (_match, expression, path) => {
    const keys = Array.from(path.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g), (m) => m[1] ?? m[2]);
    const extract = `((${expression})::text::jsonb #>> '{${keys.join(",")}}')`;
    return ["correctCount", "elapsedCs", "rank"].includes(keys.at(-1)) ? `${extract}::bigint` : extract;
  }).replace(/MAX\((expires_at_ms|0),/g, "GREATEST($1,");
  const ignore = /\bINSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/\bINSERT OR IGNORE\b/gi, "INSERT");
  if (ignore) sql = sql.trim().replace(/;$/, "") + " ON CONFLICT DO NOTHING";
  sql = sql.replace(/CASE WHEN \? THEN/g, "CASE WHEN ?::bigint <> 0 THEN");
  sql = sql.replace(/json_build_object\(([^]*?)\)(?=\s*,\s*(?:\?|CAST|r\.|revision|ended_at_ms))/g, "json_build_object($1)::text");
  let quoted = false;
  let index = 0;
  let result = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (quoted && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (c === "?" && !quoted) {
      const numeric = typeof values[index] === "number";
      result += `$${++index}${numeric ? "::bigint" : ""}`;
    } else result += c;
  }
  return result;
}
function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key2, value]) => [
    key2,
    typeof value === "bigint" ? Number(value) : typeof value === "string" && /^(?:-?\d+)$/.test(value) && /(?:_ms|_cs|count|revision|ordinal|generation|epoch|seq|rank|enabled|score|joined_order)$/.test(key2) ? Number(value) : value
  ]));
}
var PostgresStatement = class _PostgresStatement {
  constructor(execute, query, values = []) {
    this.execute = execute;
    this.query = query;
    this.values = values;
  }
  bind(...values) {
    return new _PostgresStatement(this.execute, this.query, values);
  }
  async all() {
    const result = await this.execute(postgresQuery(this.query, this.values), this.values);
    return { results: result.rows.map(normalize) };
  }
  async first() {
    return (await this.all()).results[0] ?? null;
  }
  async run() {
    const result = await this.execute(postgresQuery(this.query, this.values), this.values);
    return { success: true, meta: { changes: result.affectedRows ?? result.rows.length } };
  }
};
var PostgresDatabase = class {
  constructor(execute) {
    this.execute = execute;
  }
  prepare(query) {
    return new PostgresStatement(this.execute, query);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
};

// src/platform/postgres-runtime.ts
function transactionIsolation(scope) {
  return scope.startsWith("room:") || scope.startsWith("broadcast:") ? "read committed" : "serializable";
}
function postgresTransactions(connectionString) {
  const sql = postgres(connectionString, { prepare: false, max: 1, ssl: "require", idle_timeout: 1, connect_timeout: 10 });
  return async (scope, run) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sql.begin(`isolation level ${transactionIsolation(scope)}`, async (tx) => {
          await tx.unsafe("SET LOCAL statement_timeout = 9000");
          await tx.unsafe("SET LOCAL lock_timeout = 7000");
          await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope]);
          const execute = async (query, values) => {
            try {
              const rows = await tx.unsafe(query, values);
              return { rows: Array.from(rows), affectedRows: rows.count };
            } catch (error) {
              console.error(JSON.stringify({ event: "database_query_failed", code: error.code, query }));
              throw error;
            }
          };
          const result = await run(new PostgresDatabase(execute));
          if (result instanceof Response && result.status >= 500) throw result;
          return result;
        });
      } catch (error) {
        if (error instanceof Response) return error;
        if (attempt < 4 && ["40001", "40P01"].includes(error.code ?? "")) {
          await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 50)));
          continue;
        }
        throw error;
      }
    }
  };
}

// src/persistence/db.ts
var PersistenceConflictError = class extends Error {
  constructor(code, message, status = 409, retryAfterSeconds) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = "PersistenceConflictError";
    this.status = status;
  }
  status;
};
async function loadCommandReceipt(database, roomId, actorId, requestId2, bodyHash2) {
  const receipt2 = await database.prepare(
    `SELECT c.body_hash, c.result_json
     FROM command_receipts c JOIN rooms r ON r.id = c.room_id
     WHERE c.room_id = ? AND c.actor_id = ? AND c.request_id = ?
       AND c.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
       AND r.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)`
  ).bind(roomId, actorId, requestId2).first();
  if (!receipt2) return null;
  if (receipt2.body_hash !== bodyHash2) {
    throw new PersistenceConflictError("request_id_reused", "requestId was already used with another payload");
  }
  return JSON.parse(receipt2.result_json);
}
function json(value) {
  return JSON.stringify(value);
}
function commandMarker(actorId, requestId2) {
  return `${actorId}:${requestId2}:${crypto.randomUUID()}`;
}
function changed(result) {
  return Number(result?.meta.changes ?? 0) > 0;
}
function isRetryableDatabaseConflict(error) {
  if (typeof error !== "object" || error === null) return false;
  const value = error;
  if (value.code === "SQLITE_BUSY" || value.code === "SQLITE_LOCKED") return true;
  return typeof value.message === "string" && /(?:database.*(?:busy|locked)|D1_ERROR.*conflict)/i.test(value.message);
}

// src/persistence/participant-drafts.ts
async function readParticipantDrafts(db, roomId, participantId) {
  const { results } = await db.prepare("SELECT question_id,field_id,value_json,version,writer_epoch,edited_elapsed_ms FROM participant_drafts WHERE room_id=? AND participant_id=?").bind(roomId, participantId).all();
  return Object.fromEntries(results.map((row) => [`${row.question_id}:${row.field_id}`, { value: JSON.parse(row.value_json), version: row.version, writerEpoch: row.writer_epoch, editedElapsedMs: row.edited_elapsed_ms }]));
}
async function saveParticipantDrafts(db, input) {
  const state = await db.prepare(`SELECT m.manifest_id,m.state,m.cutoff_at_ms,r.start_at_ms,r.deadline_at_ms,r.expires_at_ms,v.writer_epoch,v.finished_elapsed_ms FROM rooms r JOIN v2_room_manifests m ON m.room_id=r.id JOIN v2_participant_progress v ON v.room_id=r.id AND v.participant_id=? JOIN participants p ON p.room_id=v.room_id AND p.id=v.participant_id WHERE r.id=? AND p.status='ACTIVE'`).bind(input.participantId, input.roomId).first();
  if (!state) throw new PersistenceConflictError("not_authorized", "\u53C2\u52A0\u8CC7\u683C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093", 403);
  if (state.manifest_id !== input.manifestId) throw new PersistenceConflictError("stale_manifest", "\u554F\u984C\u304C\u66F4\u65B0\u3055\u308C\u3066\u3044\u307E\u3059");
  if (state.writer_epoch !== input.writerEpoch) throw new PersistenceConflictError("stale_writer", "\u5225\u306E\u30BF\u30D6\u304C\u89E3\u7B54\u3057\u3066\u3044\u307E\u3059");
  const cutoff = state.cutoff_at_ms ?? state.deadline_at_ms;
  if (state.state !== "COUNTDOWN" || state.start_at_ms == null || input.nowMs < state.start_at_ms || cutoff == null || input.nowMs >= cutoff || state.expires_at_ms <= input.nowMs || state.finished_elapsed_ms !== null) throw new PersistenceConflictError("deadline", "\u9014\u4E2D\u89E3\u7B54\u306E\u4FDD\u5B58\u53D7\u4ED8\u306F\u7D42\u4E86\u3057\u3066\u3044\u307E\u3059");
  if (input.items.length > 15) throw new TypeError("too many drafts");
  for (const item of input.items) if (!Number.isSafeInteger(item.version) || item.version < 1 || !Number.isSafeInteger(item.editedElapsedMs) || item.editedElapsedMs < 0 || item.editedElapsedMs > input.nowMs - state.start_at_ms + 250 || item.editedElapsedMs >= cutoff - state.start_at_ms) throw new TypeError("invalid draft time or version");
  await db.batch(input.items.map((item) => db.prepare(`INSERT INTO participant_drafts(room_id,participant_id,question_id,field_id,manifest_id,writer_epoch,version,value_json,edited_elapsed_ms,updated_at_ms)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms r JOIN v2_room_manifests m ON m.room_id=r.id JOIN v2_participant_progress v ON v.room_id=r.id AND v.participant_id=? WHERE r.id=? AND m.manifest_id=? AND m.state='COUNTDOWN' AND v.writer_epoch=? AND v.finished_elapsed_ms IS NULL AND CAST(unixepoch('subsec') * 1000 AS INTEGER)<r.deadline_at_ms)
 ON CONFLICT(room_id,participant_id,question_id,field_id) DO UPDATE SET manifest_id=excluded.manifest_id,writer_epoch=excluded.writer_epoch,version=excluded.version,value_json=excluded.value_json,edited_elapsed_ms=excluded.edited_elapsed_ms,updated_at_ms=excluded.updated_at_ms
 WHERE participant_drafts.manifest_id<>excluded.manifest_id OR participant_drafts.writer_epoch<excluded.writer_epoch OR (participant_drafts.writer_epoch=excluded.writer_epoch AND participant_drafts.version<excluded.version)`).bind(input.roomId, input.participantId, item.questionId, item.fieldId, input.manifestId, input.writerEpoch, item.version, json(item.value), item.editedElapsedMs, input.nowMs, input.participantId, input.roomId, input.manifestId, input.writerEpoch)));
  const saved = await readParticipantDrafts(db, input.roomId, input.participantId);
  return { versions: Object.fromEntries(Object.entries(saved).map(([key2, row]) => [key2, row.version])) };
}

// src/games/alkane-puzzle/shared/question-profile.ts
var easyBase = { typeMin: 1, typeMax: 1, lenMin: 1, lenMax: 6, subMin: 0, subMax: 4, ringSizes: [4, 6], cycloSubstituentCount: 0, alcoholRate: 40, hydroxylLimitOne: true, hydroxylCountsAsSubstituent: true };
var mediumBase = { typeMin: 1, typeMax: 2, lenMin: 4, lenMax: 8, subMin: 3, subMax: 6, ringSizes: [6, 8], cycloSubstituentCount: 1, alcoholRate: 40, hydroxylLimitOne: false, hydroxylCountsAsSubstituent: true };
var DEFAULT_QUESTION_PROFILE = Object.freeze({
  version: 1,
  rules: {
    arrange: { easy: { ...easyBase, ringSizes: [4, 6], gridCols: 7, gridRows: 5 }, medium: { ...mediumBase, ringSizes: [6, 8], gridCols: 7, gridRows: 5 } },
    name: { easy: { ...easyBase, ringSizes: [4, 6], bendMin: 0, bendMax: 1, shuffleWordBankGroups: false }, medium: { ...mediumBase, typeMax: 1, ringSizes: [6, 8], bendMin: 2, bendMax: 3, shuffleWordBankGroups: false } }
  }
});
var isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var between = (v, min, max) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
function checkKeys(o, allowed, required2 = allowed) {
  if (Object.keys(o).some((k) => !allowed.includes(k)) || required2.some((k) => !Object.hasOwn(o, k))) throw new TypeError("\u51FA\u984C\u8A2D\u5B9A\u306E\u9805\u76EE\u304C\u4E0D\u6B63\u3067\u3059");
}
function validateQuestionProfileShape(raw) {
  if (!isObject(raw)) throw new TypeError("\u51FA\u984C\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
  checkKeys(raw, ["version", "rules"]);
  if (raw.version !== 1 || !isObject(raw.rules)) throw new TypeError("\u51FA\u984C\u8A2D\u5B9A\u306E\u7248\u304C\u4E0D\u6B63\u3067\u3059");
  checkKeys(raw.rules, ["arrange", "name"]);
  for (const mode of ["arrange", "name"]) {
    const levels = raw.rules[mode];
    if (!isObject(levels)) throw new TypeError("\u96E3\u6613\u5EA6\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
    checkKeys(levels, ["easy", "medium"]);
    for (const difficulty of ["easy", "medium"]) {
      const rule = levels[difficulty];
      if (!isObject(rule)) throw new TypeError("\u8A73\u7D30\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
      const common = ["typeMin", "typeMax", "lenMin", "lenMax", "subMin", "subMax", "ringSizes", "cycloSubstituentCount", "alcoholRate", "hydroxylLimitOne", "hydroxylCountsAsSubstituent"];
      const special = mode === "arrange" ? ["gridCols", "gridRows"] : ["bendMin", "bendMax", "shuffleWordBankGroups"];
      checkKeys(rule, [...common, ...special], [...common, ...special]);
      const ranges = [["typeMin", "typeMax", 1, 6], ["lenMin", "lenMax", 1, 10], ["subMin", "subMax", 0, 10]];
      for (const [low, high, min, max] of ranges) if (!between(rule[low], min, max) || !between(rule[high], min, max) || Number(rule[low]) > Number(rule[high])) throw new RangeError("\u8A2D\u5B9A\u7BC4\u56F2\u304C\u4E0D\u6B63\u3067\u3059");
      if (!Array.isArray(rule.ringSizes) || rule.ringSizes.length === 0 || new Set(rule.ringSizes).size !== rule.ringSizes.length || rule.ringSizes.some((n) => typeof n !== "number" || ![4, 6, 8, 10].includes(n))) throw new RangeError("\u30B7\u30AF\u30ED\u4E3B\u9396\u304C\u4E0D\u6B63\u3067\u3059");
      if (typeof rule.cycloSubstituentCount !== "number" || ![0, 1, 2].includes(rule.cycloSubstituentCount)) throw new RangeError("\u30B7\u30AF\u30ED\u7F6E\u63DB\u57FA\u6570\u304C\u4E0D\u6B63\u3067\u3059");
      if (!between(rule.alcoholRate, 0, 100) || Number(rule.alcoholRate) % 10 !== 0) throw new RangeError("\u30A2\u30EB\u30B3\u30FC\u30EB\u51FA\u984C\u7387\u304C\u4E0D\u6B63\u3067\u3059");
      if (typeof rule.hydroxylLimitOne !== "boolean" || typeof rule.hydroxylCountsAsSubstituent !== "boolean") throw new TypeError("OH\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
      if (mode === "arrange") {
        if (!between(rule.gridCols, 3, 7) || !between(rule.gridRows, 3, 5)) throw new RangeError("\u67A0\u6570\u304C\u4E0D\u6B63\u3067\u3059");
      } else {
        if (!between(rule.bendMin, 0, 10) || !between(rule.bendMax, 0, 10) || Number(rule.bendMin) > Number(rule.bendMax) || typeof rule.shuffleWordBankGroups !== "boolean") throw new RangeError("\u6298\u308C\u66F2\u304C\u308A\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
      }
    }
  }
  return structuredClone(raw);
}
function questionProfileCatalog() {
  return { modes: ["arrange", "name"], difficulties: ["easy", "medium"], ringSizes: [4, 6, 8, 10] };
}

// src/persistence/question-profiles.ts
async function readQuestionProfile(database) {
  const row = await database.prepare("SELECT profile_json, revision FROM question_profiles WHERE id = 1").first();
  return row ? { profile: validateQuestionProfileShape(JSON.parse(row.profile_json)), revision: row.revision } : { profile: structuredClone(DEFAULT_QUESTION_PROFILE), revision: 0 };
}
async function readRoomQuestionProfile(database, roomId) {
  const row = await database.prepare("SELECT profile_json FROM room_question_profiles WHERE room_id = ?").bind(roomId).first();
  return row ? validateQuestionProfileShape(JSON.parse(row.profile_json)) : null;
}
async function updateQuestionProfile(database, input) {
  const receipt2 = async () => {
    const row = await database.prepare("SELECT body_hash, result_json FROM question_profile_receipts WHERE teacher_id = ? AND request_id = ?").bind(input.teacherId, input.requestId).first();
    if (!row) return null;
    if (row.body_hash !== input.bodyHash) throw new PersistenceConflictError("request_id_reused", "\u64CD\u4F5CID\u304C\u5225\u306E\u5909\u66F4\u306B\u4F7F\u308F\u308C\u3066\u3044\u307E\u3059");
    return JSON.parse(row.result_json);
  };
  const previous = await receipt2();
  if (previous) return previous;
  const result = { profile: input.profile, revision: input.expectedRevision + 1 };
  const marker = commandMarker(`question-profile:${input.teacherId}`, input.requestId);
  const statements = [
    database.prepare("INSERT INTO question_profiles (id, profile_json, revision, updated_at_ms) VALUES (1, ?, 0, 0) ON CONFLICT(id) DO NOTHING").bind(json(DEFAULT_QUESTION_PROFILE)),
    database.prepare(`UPDATE question_profiles SET profile_json = ?, revision = revision + 1, updated_at_ms = ?, last_command_id = ? WHERE id = 1 AND revision = ? AND NOT EXISTS (SELECT 1 FROM question_profile_receipts WHERE teacher_id = ? AND request_id = ?)`).bind(json(input.profile), input.nowMs, marker, input.expectedRevision, input.teacherId, input.requestId),
    database.prepare(`INSERT INTO question_profile_receipts (teacher_id, request_id, body_hash, result_json) SELECT ?, ?, ?, ? FROM question_profiles WHERE id = 1 AND last_command_id = ?`).bind(input.teacherId, input.requestId, input.bodyHash, json(result), marker)
  ];
  try {
    const batch = await database.batch(statements);
    if (changed(batch[1])) return result;
  } catch (error) {
    const committed = await receipt2();
    if (committed) return committed;
    throw error;
  }
  const raced = await receipt2();
  if (raced) return raced;
  throw new PersistenceConflictError("stale_question_profile", "\u8A2D\u5B9A\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044");
}

// src/games/alkane-puzzle/shared/content-version.ts
var CHEMISTRY_CONTENT_VERSION = "alkane-puzzle-f2e231b-1";

// src/platform/server-only.ts
if (typeof document !== "undefined") {
  throw new Error("This module is server-only");
}

// src/competition-core/state-machine.ts
function effectiveRoomState(room, nowMs) {
  if (room.storedState === "CANCELLED" || room.storedState === "EXPIRED") {
    return room.storedState;
  }
  if (room.storedState === "FINISHED") return "FINISHED";
  if ((room.storedState === "COUNTDOWN" || room.storedState === "RUNNING") && room.deadlineAtMs != null && nowMs >= room.deadlineAtMs) {
    return "FINISHED";
  }
  if (room.storedState === "COUNTDOWN" && room.startAtMs != null && nowMs >= room.startAtMs) {
    return "RUNNING";
  }
  return room.storedState;
}

// src/config/public.ts
var PUBLIC_CONFIG = {
  questionCounts: [5, 10, 15],
  defaultQuestionCount: 10,
  timeLimitMinutes: [3, 4, 5, 6, 7, 8, 9, 10],
  defaultTimeLimitMinutes: 5,
  participantLimits: {
    classCompetition: 42,
    mateMatch: 4
  },
  retentionMs: {
    classCompetition: 14 * 24 * 60 * 60 * 1e3,
    mateMatch: 14 * 24 * 60 * 60 * 1e3,
    cancelledRoom: 24 * 60 * 60 * 1e3
  },
  waitingRoomLifetimeMs: 2 * 60 * 60 * 1e3,
  pollingMs: {
    lobby: 2e3,
    runningParticipant: 5e3,
    progress: 2e3,
    participantFinished: 3e3
  },
  countdownSeconds: 5,
  timingToleranceMs: {
    aheadOfServer: 250,
    behindServer: 2e3
  }
};

// src/games/alkane-puzzle/shared/engine.js
function createAlkaneEngine(random = Math.random) {
  const ROWS = 5, COLS = 7;
  const DIR_ORDER = Object.freeze(["N", "E", "S", "W"]);
  const DIRECTION_BIT = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
  const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" };
  const DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
  const VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const PANEL_ARM_TABLE = { 1: ["E"], 2: ["N", "S"], 3: ["N", "E"], 4: ["N", "W", "E"], 5: ["N", "E", "S", "W"] };
  const PANEL_LABELS = { 1: "\u672B\u7AEF", 2: "\u76F4\u7DDA", 3: "\u304B\u3069", 4: "\u5206\u5C90", 5: "\u56DB\u7D1A" };
  const CHAIN_NAMES = [
    "",
    "\u30E1\u30BF\u30F3",
    "\u30A8\u30BF\u30F3",
    "\u30D7\u30ED\u30D1\u30F3",
    "\u30D6\u30BF\u30F3",
    "\u30DA\u30F3\u30BF\u30F3",
    "\u30D8\u30AD\u30B5\u30F3",
    "\u30D8\u30D7\u30BF\u30F3",
    "\u30AA\u30AF\u30BF\u30F3",
    "\u30CE\u30CA\u30F3",
    "\u30C7\u30AB\u30F3",
    "\u30A6\u30F3\u30C7\u30AB\u30F3",
    "\u30C9\u30C7\u30AB\u30F3",
    "\u30C8\u30EA\u30C7\u30AB\u30F3",
    "\u30C6\u30C8\u30E9\u30C7\u30AB\u30F3",
    "\u30DA\u30F3\u30BF\u30C7\u30AB\u30F3",
    "\u30D8\u30AD\u30B5\u30C7\u30AB\u30F3",
    "\u30D8\u30D7\u30BF\u30C7\u30AB\u30F3",
    "\u30AA\u30AF\u30BF\u30C7\u30AB\u30F3",
    "\u30CE\u30CA\u30C7\u30AB\u30F3",
    "\u30A4\u30B3\u30B5\u30F3",
    "\u30D8\u30F3\u30A4\u30B3\u30B5\u30F3",
    "\u30C9\u30B3\u30B5\u30F3",
    "\u30C8\u30EA\u30B3\u30B5\u30F3",
    "\u30C6\u30C8\u30E9\u30B3\u30B5\u30F3",
    "\u30DA\u30F3\u30BF\u30B3\u30B5\u30F3",
    "\u30D8\u30AD\u30B5\u30B3\u30B5\u30F3",
    "\u30D8\u30D7\u30BF\u30B3\u30B5\u30F3",
    "\u30AA\u30AF\u30BF\u30B3\u30B5\u30F3",
    "\u30CE\u30CA\u30B3\u30B5\u30F3",
    "\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3",
    "\u30D8\u30F3\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3",
    "\u30C9\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3",
    "\u30C8\u30EA\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3",
    "\u30C6\u30C8\u30E9\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3",
    "\u30DA\u30F3\u30BF\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3"
  ];
  const STRAIGHT_ALKYL_NAMES = [
    "",
    "\u30E1\u30C1\u30EB",
    "\u30A8\u30C1\u30EB",
    "\u30D7\u30ED\u30D4\u30EB",
    "\u30D6\u30C1\u30EB",
    "\u30DA\u30F3\u30C1\u30EB",
    "\u30D8\u30AD\u30B7\u30EB",
    "\u30D8\u30D7\u30C1\u30EB",
    "\u30AA\u30AF\u30C1\u30EB",
    "\u30CE\u30CB\u30EB",
    "\u30C7\u30B7\u30EB",
    "\u30A6\u30F3\u30C7\u30B7\u30EB",
    "\u30C9\u30C7\u30B7\u30EB",
    "\u30C8\u30EA\u30C7\u30B7\u30EB",
    "\u30C6\u30C8\u30E9\u30C7\u30B7\u30EB",
    "\u30DA\u30F3\u30BF\u30C7\u30B7\u30EB"
  ];
  const SUBSTITUENT_NAME_BY_LENGTH = Object.fromEntries(
    STRAIGHT_ALKYL_NAMES.slice(1).map((name, index) => [index + 1, name])
  );
  const SUBSTITUENT_ORDER = {
    "\u30D6\u30ED\u30E2": 0,
    "\u30D6\u30C1\u30EB": 1,
    "sec-\u30D6\u30C1\u30EB": 1.1,
    "tert-\u30D6\u30C1\u30EB": 1.2,
    "\u30AF\u30ED\u30ED": 2,
    "\u30C7\u30B7\u30EB": 3,
    "\u30C9\u30C7\u30B7\u30EB": 4,
    "\u30A8\u30C1\u30EB": 5,
    "\u30D5\u30EB\u30AA\u30ED": 6,
    "\u30D8\u30D7\u30C1\u30EB": 7,
    "\u30D8\u30AD\u30B7\u30EB": 8,
    "\u30E8\u30FC\u30C9": 9,
    "\u30A4\u30BD\u30D6\u30C1\u30EB": 10,
    "\u30A4\u30BD\u30D7\u30ED\u30D4\u30EB": 11,
    "\u30E1\u30C1\u30EB": 12,
    "\u30CE\u30CB\u30EB": 13,
    "\u30AA\u30AF\u30C1\u30EB": 14,
    "\u30DA\u30F3\u30BF\u30C7\u30B7\u30EB": 15,
    "\u30DA\u30F3\u30C1\u30EB": 16,
    "\u30D7\u30ED\u30D4\u30EB": 17,
    "\u30C6\u30C8\u30E9\u30C7\u30B7\u30EB": 18,
    "\u30C8\u30EA\u30C7\u30B7\u30EB": 19,
    "\u30A6\u30F3\u30C7\u30B7\u30EB": 20
  };
  function substituentOrder(name) {
    return SUBSTITUENT_ORDER[name] ?? Number.MAX_SAFE_INTEGER;
  }
  const MULTIPLIER_PREFIX = [
    "",
    "",
    "\u30B8",
    "\u30C8\u30EA",
    "\u30C6\u30C8\u30E9",
    "\u30DA\u30F3\u30BF",
    "\u30D8\u30AD\u30B5",
    "\u30D8\u30D7\u30BF",
    "\u30AA\u30AF\u30BF",
    "\u30CE\u30CA",
    "\u30C7\u30AB",
    "\u30A6\u30F3\u30C7\u30AB",
    "\u30C9\u30C7\u30AB",
    "\u30C8\u30EA\u30C7\u30AB",
    "\u30C6\u30C8\u30E9\u30C7\u30AB",
    "\u30DA\u30F3\u30BF\u30C7\u30AB",
    "\u30D8\u30AD\u30B5\u30C7\u30AB",
    "\u30D8\u30D7\u30BF\u30C7\u30AB",
    "\u30AA\u30AF\u30BF\u30C7\u30AB",
    "\u30CE\u30CA\u30C7\u30AB",
    "\u30A4\u30B3\u30B5"
  ];
  const HALOGEN_INFO = {
    F: { name: "\u30D5\u30EB\u30AA\u30ED", stroke: "#B08D1A", fill: "#F7F2A0" },
    Cl: { name: "\u30AF\u30ED\u30ED", stroke: "#7CB518", fill: "#E8F5D0" },
    Br: { name: "\u30D6\u30ED\u30E2", stroke: "#A0522D", fill: "#F3E0D6" },
    I: { name: "\u30E8\u30FC\u30C9", stroke: "#7B4397", fill: "#EBDFF5" }
  };
  const HYDROXYL_ELEMENT = "OH";
  const HYDROXYL_FILL = "#E8564F";
  const HALOGEN_ELEMENT_BY_NAME = { "\u30D5\u30EB\u30AA\u30ED": "F", "\u30AF\u30ED\u30ED": "Cl", "\u30D6\u30ED\u30E2": "Br", "\u30E8\u30FC\u30C9": "I" };
  const SUBSTITUENT_SPECIES = ["\u30E1\u30C1\u30EB", "\u30A8\u30C1\u30EB", "\u30D5\u30EB\u30AA\u30ED", "\u30AF\u30ED\u30ED", "\u30D6\u30ED\u30E2", "\u30E8\u30FC\u30C9"];
  const SUBSTITUENT_LENGTH = { "\u30E1\u30C1\u30EB": 1, "\u30A8\u30C1\u30EB": 2, "\u30D5\u30EB\u30AA\u30ED": 1, "\u30AF\u30ED\u30ED": 1, "\u30D6\u30ED\u30E2": 1, "\u30E8\u30FC\u30C9": 1, [HYDROXYL_ELEMENT]: 1 };
  const RING_SUBSTITUENT_SPECIES = ["\u30E1\u30C1\u30EB", "\u30D5\u30EB\u30AA\u30ED", "\u30AF\u30ED\u30ED", "\u30D6\u30ED\u30E2", "\u30E8\u30FC\u30C9"];
  function rotateCW(dir, times) {
    const steps = (times % 4 + 4) % 4;
    const bit = DIRECTION_BIT[dir];
    const rotated = (bit << steps | bit >> 4 - steps) & 15;
    return DIR_ORDER.find((candidate) => DIRECTION_BIT[candidate] === rotated);
  }
  function getActiveDirections(panel) {
    const base = PANEL_ARM_TABLE[panel.type];
    const steps = panel.rotation / 90 % 4;
    return new Set(base.map((d) => rotateCW(d, steps)));
  }
  function isHalogenPanel(panel) {
    return !!panel && !!panel.element && panel.element !== "C";
  }
  function incomingCarbonDirections(grid, r, c) {
    const dirs = [];
    for (const dir of DIR_ORDER) {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const neighbor = grid[nr][nc];
      if (!neighbor || isHalogenPanel(neighbor)) continue;
      if (getActiveDirections(neighbor).has(OPPOSITE[dir])) dirs.push(dir);
    }
    return dirs;
  }
  function getBondDirections(grid, r, c) {
    const panel = grid[r][c];
    if (!panel) return /* @__PURE__ */ new Set();
    if (isHalogenPanel(panel)) {
      const incoming = incomingCarbonDirections(grid, r, c);
      return incoming.length === 1 ? new Set(incoming) : /* @__PURE__ */ new Set();
    }
    return getActiveDirections(panel);
  }
  function toBaseDir(actualDir, rotationDeg) {
    const steps = rotationDeg / 90 % 4;
    return rotateCW(actualDir, (4 - steps) % 4);
  }
  function checkMismatches(grid) {
    const mismatches = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const panel = grid[r][c];
        if (!panel) continue;
        const bonds = getBondDirections(grid, r, c);
        for (const dir of bonds) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          const inBounds = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS;
          const neighbor = inBounds ? grid[nr][nc] : null;
          if (!neighbor) {
            mismatches.push({ r, c, dir, reason: "DANGLING_BOND" });
            continue;
          }
          const neighborBonds = getBondDirections(grid, nr, nc);
          if (!neighborBonds.has(OPPOSITE[dir])) {
            mismatches.push({ r, c, dir, reason: "ONE_SIDED_BOND" });
          }
        }
      }
    }
    return mismatches;
  }
  function physicalCarbonDirections(panel) {
    const baseMask = PANEL_ARM_TABLE[panel.type].reduce((mask, dir) => mask | DIRECTION_BIT[dir], 0);
    const steps = (panel.rotation / 90 % 4 + 4) % 4;
    const rotatedMask = (baseMask << steps | baseMask >> 4 - steps) & 15;
    return new Set(DIR_ORDER.filter((dir) => (rotatedMask & DIRECTION_BIT[dir]) !== 0));
  }
  function physicalBondDirections(grid, r, c) {
    const panel = grid[r][c];
    if (!panel) return /* @__PURE__ */ new Set();
    if (!isHalogenPanel(panel)) return physicalCarbonDirections(panel);
    const incoming = [];
    for (const dir of DIR_ORDER) {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr, nc = c + dc;
      const neighbor = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS ? grid[nr][nc] : null;
      if (neighbor && !isHalogenPanel(neighbor) && physicalCarbonDirections(neighbor).has(OPPOSITE[dir])) incoming.push(dir);
    }
    return incoming.length === 1 ? new Set(incoming) : /* @__PURE__ */ new Set();
  }
  function checkPhysicalPanelDirections(grid) {
    const mismatches = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c]) continue;
        for (const dir of physicalBondDirections(grid, r, c)) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          const neighbor = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS ? grid[nr][nc] : null;
          if (!neighbor || !physicalBondDirections(grid, nr, nc).has(OPPOSITE[dir])) {
            mismatches.push({ r, c, dir });
          }
        }
      }
    }
    return mismatches;
  }
  function buildGraph(grid) {
    const adjacency = /* @__PURE__ */ new Map();
    const nodeIds = [];
    const elements = /* @__PURE__ */ new Map();
    const idOf = (r, c) => `${r},${c}`;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c]) {
          nodeIds.push(idOf(r, c));
          adjacency.set(idOf(r, c), /* @__PURE__ */ new Set());
          elements.set(idOf(r, c), grid[r][c].element || "C");
        }
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const panel = grid[r][c];
        if (!panel) continue;
        for (const dir of getBondDirections(grid, r, c)) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || !grid[nr][nc]) continue;
          adjacency.get(idOf(r, c)).add(idOf(nr, nc));
          adjacency.get(idOf(nr, nc)).add(idOf(r, c));
        }
      }
    }
    return { nodeIds, adjacency, elements };
  }
  function checkConnectivity(graph) {
    const { nodeIds, adjacency } = graph;
    if (nodeIds.length === 0) return { allConnected: true, islands: [] };
    const visited = /* @__PURE__ */ new Set([nodeIds[0]]);
    const queue = [nodeIds[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency.get(cur)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return { allConnected: visited.size === nodeIds.length, islands: nodeIds.filter((id) => !visited.has(id)) };
  }
  function countEdges(graph) {
    let sum = 0;
    for (const n of graph.adjacency.values()) sum += n.size;
    return sum / 2;
  }
  function classifyStructure(graph) {
    const V = graph.nodeIds.length, E = countEdges(graph);
    const cyclomatic = E - V + 1;
    if (cyclomatic === 0) return "ALKANE";
    if (cyclomatic === 1) return "CYCLOALKANE";
    return "UNSUPPORTED_MULTI_RING";
  }
  function bfsDistancesAndParents(adjacency, start) {
    const dist = /* @__PURE__ */ new Map([[start, 0]]);
    const parent = /* @__PURE__ */ new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency.get(cur)) {
        if (!dist.has(next)) {
          dist.set(next, dist.get(cur) + 1);
          parent.set(next, cur);
          queue.push(next);
        }
      }
    }
    return { dist, parent };
  }
  function reconstructPath(parent, from, to) {
    const path = [to];
    let cur = to;
    while (cur !== from) {
      cur = parent.get(cur);
      path.push(cur);
    }
    return path.reverse();
  }
  function nameCarbonSubstituent(graph, backboneSet, backboneNode, root) {
    const nodes = /* @__PURE__ */ new Set();
    const queue = [{ id: root, parent: backboneNode }];
    while (queue.length) {
      const { id: cur, parent } = queue.shift();
      if (nodes.has(cur)) throw new Error("UNSUPPORTED_SUBSTITUENT");
      if (graph.elements.get(cur) !== "C") throw new Error("UNSUPPORTED_SUBSTITUENT");
      nodes.add(cur);
      for (const next of graph.adjacency.get(cur)) {
        if (next === parent) continue;
        if (backboneSet.has(next)) throw new Error("UNSUPPORTED_SUBSTITUENT");
        if (nodes.has(next)) throw new Error("UNSUPPORTED_SUBSTITUENT");
        queue.push({ id: next, parent: cur });
      }
    }
    const carbonNeighbors = (id) => [...graph.adjacency.get(id)].filter((next) => nodes.has(next));
    const length = nodes.size;
    const rootDegree = carbonNeighbors(root).length;
    const isStraight = [...nodes].every((id) => carbonNeighbors(id).length <= 2);
    if (isStraight && rootDegree <= 1) {
      const name = SUBSTITUENT_NAME_BY_LENGTH[length];
      if (!name) throw new Error("UNSUPPORTED_SUBSTITUENT");
      return { backboneNode, length, name };
    }
    if (isStraight && length === 3 && rootDegree === 2) {
      return { backboneNode, length, name: "\u30A4\u30BD\u30D7\u30ED\u30D4\u30EB" };
    }
    if (isStraight && length === 4 && rootDegree === 2) {
      return { backboneNode, length, name: "sec-\u30D6\u30C1\u30EB" };
    }
    if (length === 4 && rootDegree === 1) {
      const junction = carbonNeighbors(root)[0];
      if (junction && carbonNeighbors(junction).length === 3) {
        return { backboneNode, length, name: "\u30A4\u30BD\u30D6\u30C1\u30EB" };
      }
    }
    if (length === 4 && rootDegree === 3 && [...nodes].every((id) => id === root || carbonNeighbors(id).length === 1)) {
      return { backboneNode, length, name: "tert-\u30D6\u30C1\u30EB" };
    }
    throw new Error("UNSUPPORTED_SUBSTITUENT");
  }
  function extractSubstituents(graph, backboneSet) {
    const substituents = [];
    for (const node of backboneSet) {
      for (const neighbor of graph.adjacency.get(node)) {
        if (backboneSet.has(neighbor)) continue;
        const neighborElement = graph.elements.get(neighbor);
        if (neighborElement !== "C") {
          if (neighborElement === HYDROXYL_ELEMENT) continue;
          const further = [...graph.adjacency.get(neighbor)].filter((n) => n !== node);
          if (further.length > 0) throw new Error("UNSUPPORTED_SUBSTITUENT");
          substituents.push({ backboneNode: node, length: 1, name: HALOGEN_INFO[neighborElement].name });
          continue;
        }
        substituents.push(nameCarbonSubstituent(graph, backboneSet, node, neighbor));
      }
    }
    return substituents;
  }
  function hydroxylLocants(graph, orderedBackbone) {
    const backboneSet = new Set(orderedBackbone);
    const locants = [];
    for (const node of orderedBackbone) {
      for (const neighbor of graph.adjacency.get(node)) {
        if (graph.elements.get(neighbor) === HYDROXYL_ELEMENT) {
          if (graph.adjacency.get(neighbor).size !== 1) throw new Error("INVALID_HYDROXYL");
          locants.push(orderedBackbone.indexOf(node) + 1);
        }
      }
    }
    const allHydroxyls = graph.nodeIds.filter((id) => graph.elements.get(id) === HYDROXYL_ELEMENT);
    if (locants.length !== allHydroxyls.length || new Set(locants).size !== locants.length) {
      throw new Error("UNSUPPORTED_HYDROXYL_LAYOUT");
    }
    return locants.sort((a, b) => a - b);
  }
  function validateHydroxyls(graph) {
    for (const id of graph.nodeIds) {
      if (graph.elements.get(id) !== HYDROXYL_ELEMENT) continue;
      const neighbors = [...graph.adjacency.get(id)];
      if (neighbors.length !== 1 || graph.elements.get(neighbors[0]) !== "C") throw new Error("INVALID_HYDROXYL");
    }
    for (const id of graph.nodeIds) {
      if (graph.elements.get(id) !== "C") continue;
      const hydroxylCount = [...graph.adjacency.get(id)].filter((n) => graph.elements.get(n) === HYDROXYL_ELEMENT).length;
      if (hydroxylCount > 1) throw new Error("GEMINAL_DIOL");
    }
  }
  function buildSubstituentPrefix(locantedSubstituents, omitSoleEthaneLocant = false) {
    if (locantedSubstituents.length === 0) return "";
    if (omitSoleEthaneLocant && locantedSubstituents.length === 1 && locantedSubstituents[0].locant === 1) {
      return locantedSubstituents[0].name;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const s of locantedSubstituents) {
      if (!groups.has(s.name)) groups.set(s.name, []);
      groups.get(s.name).push(s.locant);
    }
    const sortedNames = [...groups.keys()].sort((a, b) => substituentOrder(a) - substituentOrder(b));
    return sortedNames.map((name) => {
      const locants = groups.get(name).sort((a, b) => a - b);
      return `${locants.join(",")}-${MULTIPLIER_PREFIX[locants.length] || ""}${name}`;
    }).join("-");
  }
  function buildMethaneSubstituentPrefix(substituents) {
    if (substituents.length === 0) return "";
    const counts = /* @__PURE__ */ new Map();
    for (const s of substituents) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    return [...counts.keys()].sort((a, b) => substituentOrder(a) - substituentOrder(b)).map((name) => `${MULTIPLIER_PREFIX[counts.get(name)] || ""}${name}`).join("");
  }
  function buildAlcoholName(parentName, hydroxylLocantList, locantedSubstituents, isCyclo) {
    const prefix = parentName === "\u30E1\u30BF\u30F3" ? buildMethaneSubstituentPrefix(locantedSubstituents) : buildSubstituentPrefix(locantedSubstituents);
    const count = hydroxylLocantList.length;
    if (count === 0) return prefix + parentName;
    const alcoholStem = parentName.endsWith("\u30F3") ? parentName.slice(0, -1) + "\u30CE\u30FC\u30EB" : parentName + "\u30AA\u30FC\u30EB";
    if (count === 1) {
      const omitLocant = isCyclo || parentName === "\u30E1\u30BF\u30F3" || parentName === "\u30A8\u30BF\u30F3";
      const alcoholPart2 = omitLocant ? alcoholStem : `${hydroxylLocantList[0]}-${alcoholStem}`;
      return prefix ? omitLocant ? prefix + alcoholPart2 : `${prefix}-${alcoholPart2}` : alcoholPart2;
    }
    const alcoholPart = `${hydroxylLocantList.join(",")}-${parentName}${MULTIPLIER_PREFIX[count]}\u30AA\u30FC\u30EB`;
    return prefix ? `${prefix}-${alcoholPart}` : alcoholPart;
  }
  function buildName(baseName, locantedSubstituents) {
    return buildSubstituentPrefix(locantedSubstituents, baseName === "\u30A8\u30BF\u30F3") + baseName;
  }
  function compareLocantArrays(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? Infinity, bv = b[i] ?? Infinity;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
  function alphabeticalLocants(rawSubstituents, locantOf) {
    return rawSubstituents.map((s) => ({ order: substituentOrder(s.name), locant: locantOf(s) })).sort((a, b) => a.order - b.order || a.locant - b.locant).map((x) => x.locant);
  }
  function compareNumberingCandidates(a, b) {
    const bySet = compareLocantArrays(a.locants, b.locants);
    if (bySet !== 0) return bySet;
    return compareLocantArrays(a.alphaLocants, b.alphaLocants);
  }
  function buildMethaneName(substituents) {
    if (substituents.length === 0) return "\u30E1\u30BF\u30F3";
    const counts = /* @__PURE__ */ new Map();
    for (const s of substituents) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    const sortedNames = [...counts.keys()].sort((a, b) => substituentOrder(a) - substituentOrder(b));
    const parts = sortedNames.map((name) => {
      const count = counts.get(name);
      const multiplier = MULTIPLIER_PREFIX[count] || "";
      return `${multiplier}${name}`;
    });
    return parts.join("") + "\u30E1\u30BF\u30F3";
  }
  function nameAlkane(graph) {
    const { nodeIds, adjacency, elements } = graph;
    const carbonIds = nodeIds.filter((id) => elements.get(id) === "C");
    if (carbonIds.length === 1) {
      const centerId = carbonIds[0];
      const rawSubstituents = extractSubstituents(graph, /* @__PURE__ */ new Set([centerId]));
      const hydroxyls = hydroxylLocants(graph, [centerId]);
      if (hydroxyls.length) return buildAlcoholName("\u30E1\u30BF\u30F3", hydroxyls, rawSubstituents.map((s) => ({ locant: 1, name: s.name })), false);
      return buildMethaneName(rawSubstituents);
    }
    const leaves = carbonIds.filter((id) => {
      let carbonNeighborCount = 0;
      for (const n of adjacency.get(id)) if (elements.get(n) === "C") carbonNeighborCount++;
      return carbonNeighborCount === 1;
    });
    const distMaps = /* @__PURE__ */ new Map();
    for (const leaf of leaves) distMaps.set(leaf, bfsDistancesAndParents(adjacency, leaf));
    const candidatePairs = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const d = distMaps.get(leaves[i]).dist.get(leaves[j]);
        if (Number.isFinite(d)) candidatePairs.push([leaves[i], leaves[j]]);
      }
    }
    const structuralCandidates = candidatePairs.flatMap(([a, b]) => {
      const path = reconstructPath(distMaps.get(a).parent, a, b);
      const hydroxylCount = path.reduce((count, node) => count + [...adjacency.get(node)].filter((neighbor) => elements.get(neighbor) === HYDROXYL_ELEMENT).length, 0);
      return [path, [...path].reverse()].map((orderedPath) => ({ orderedPath, hydroxylCount }));
    });
    const maxHydroxylCount = Math.max(...structuralCandidates.map((candidate) => candidate.hydroxylCount));
    const maxParentLength = Math.max(...structuralCandidates.filter((candidate) => candidate.hydroxylCount === maxHydroxylCount).map((candidate) => candidate.orderedPath.length));
    let best = null;
    const candidateErrors = /* @__PURE__ */ new Set();
    for (const { orderedPath, hydroxylCount } of structuralCandidates) {
      if (hydroxylCount !== maxHydroxylCount || orderedPath.length !== maxParentLength) continue;
      if (orderedPath.length > 35) throw new Error("UNSUPPORTED: \u4E3B\u9396\u304C\u30DA\u30F3\u30BF\u30C8\u30EA\u30A2\u30B3\u30F3\u30BF\u30F3\u3092\u8D85\u3048\u3066\u3044\u307E\u3059");
      const pathSet = new Set(orderedPath);
      try {
        const rawSubstituents = extractSubstituents(graph, pathSet);
        const hydroxyls = hydroxylLocants(graph, orderedPath);
        const locantOf = (s) => orderedPath.indexOf(s.backboneNode) + 1;
        const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
        const alphaLocants = alphabeticalLocants(rawSubstituents, locantOf);
        const branchCount = rawSubstituents.length;
        const candidate = { orderedPath, rawSubstituents, hydroxyls, locants, alphaLocants, branchCount };
        if (best === null || compareLocantArrays(candidate.hydroxyls, best.hydroxyls) < 0 || compareLocantArrays(candidate.hydroxyls, best.hydroxyls) === 0 && candidate.branchCount > best.branchCount || compareLocantArrays(candidate.hydroxyls, best.hydroxyls) === 0 && candidate.branchCount === best.branchCount && compareNumberingCandidates(candidate, best) < 0) best = candidate;
      } catch (e) {
        candidateErrors.add(e.message);
      }
    }
    if (!best) {
      if (candidateErrors.has("UNSUPPORTED_SUBSTITUENT")) throw new Error("UNSUPPORTED_SUBSTITUENT");
      if (candidateErrors.has("UNSUPPORTED_HYDROXYL_LAYOUT")) throw new Error("UNSUPPORTED_HYDROXYL_LAYOUT");
      throw new Error("UNSUPPORTED_SUBSTITUENT");
    }
    const locantedSubstituents = best.rawSubstituents.map((s) => ({ locant: best.orderedPath.indexOf(s.backboneNode) + 1, name: s.name }));
    if (best.hydroxyls.length) return buildAlcoholName(CHAIN_NAMES[best.orderedPath.length], best.hydroxyls, locantedSubstituents, false);
    return buildName(CHAIN_NAMES[best.orderedPath.length], locantedSubstituents);
  }
  function findRing(graph) {
    const { nodeIds, adjacency } = graph;
    const visited = /* @__PURE__ */ new Set();
    const parent = /* @__PURE__ */ new Map();
    const stack = [[nodeIds[0], null]];
    while (stack.length) {
      const [node, from] = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node);
      parent.set(node, from);
      for (const next of adjacency.get(node)) {
        if (next === from) continue;
        if (visited.has(next)) {
          const ring = [node];
          let cur = node;
          while (cur !== next) {
            cur = parent.get(cur);
            ring.push(cur);
          }
          return ring;
        }
        stack.push([next, node]);
      }
    }
    throw new Error("RING_NOT_FOUND");
  }
  function nameCycloalkane(graph) {
    const ring = findRing(graph);
    const ringSize = ring.length;
    if (ringSize % 2 !== 0) throw new Error("UNSUPPORTED: \u5947\u6570\u54E1\u74B0");
    if (ringSize < 4 || ringSize > 34) throw new Error(`UNSUPPORTED: \u30B7\u30AF\u30ED${ringSize}\u54E1\u74B0\u306F\u5BFE\u8C61\u5916`);
    const ringSet = new Set(ring);
    const rawSubstituents = extractSubstituents(graph, ringSet);
    const hydroxylCount = graph.nodeIds.filter((id) => graph.elements.get(id) === HYDROXYL_ELEMENT).length;
    const parentName = "\u30B7\u30AF\u30ED" + CHAIN_NAMES[ringSize];
    if (hydroxylCount > 0) {
      let bestAlcohol = null;
      for (let startIdx = 0; startIdx < ringSize; startIdx++) {
        for (const direction of [1, -1]) {
          const ordered = [];
          for (let step = 0; step < ringSize; step++) ordered.push(ring[((startIdx + step * direction) % ringSize + ringSize) % ringSize]);
          try {
            const hydroxyls = hydroxylLocants(graph, ordered);
            const locantOf = (s) => ordered.indexOf(s.backboneNode) + 1;
            const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
            const candidate = { ordered, hydroxyls, locants, alphaLocants: alphabeticalLocants(rawSubstituents, locantOf) };
            if (bestAlcohol === null || compareLocantArrays(candidate.hydroxyls, bestAlcohol.hydroxyls) < 0 || compareLocantArrays(candidate.hydroxyls, bestAlcohol.hydroxyls) === 0 && compareNumberingCandidates(candidate, bestAlcohol) < 0) bestAlcohol = candidate;
          } catch (e) {
          }
        }
      }
      if (!bestAlcohol) throw new Error("UNSUPPORTED_HYDROXYL_LAYOUT");
      const locantedSubstituents2 = rawSubstituents.map((s) => ({ locant: bestAlcohol.ordered.indexOf(s.backboneNode) + 1, name: s.name }));
      return buildAlcoholName(parentName, bestAlcohol.hydroxyls, locantedSubstituents2, true);
    }
    if (rawSubstituents.length === 0) return "\u30B7\u30AF\u30ED" + CHAIN_NAMES[ringSize];
    if (rawSubstituents.length === 1) {
      return rawSubstituents[0].name + "\u30B7\u30AF\u30ED" + CHAIN_NAMES[ringSize];
    }
    let best = null;
    for (let startIdx = 0; startIdx < ringSize; startIdx++) {
      for (const direction of [1, -1]) {
        const ordered = [];
        for (let step = 0; step < ringSize; step++) {
          const idx = ((startIdx + step * direction) % ringSize + ringSize) % ringSize;
          ordered.push(ring[idx]);
        }
        const locantOf = (s) => ordered.indexOf(s.backboneNode) + 1;
        const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
        const alphaLocants = alphabeticalLocants(rawSubstituents, locantOf);
        const candidate = { ordered, locants, alphaLocants };
        if (best === null || compareNumberingCandidates(candidate, best) < 0) best = candidate;
      }
    }
    const locantedSubstituents = rawSubstituents.map((s) => ({ locant: best.ordered.indexOf(s.backboneNode) + 1, name: s.name }));
    return buildName("\u30B7\u30AF\u30ED" + CHAIN_NAMES[ringSize], locantedSubstituents);
  }
  function generateName(grid) {
    const mismatches = checkMismatches(grid);
    if (mismatches.length > 0) return { ok: false, error: "INCOMPLETE_BONDS", mismatches };
    const graph = buildGraph(grid);
    if (graph.nodeIds.length === 0) return { ok: false, error: "EMPTY_GRID" };
    const connectivity = checkConnectivity(graph);
    if (!connectivity.allConnected) return { ok: false, error: "DISCONNECTED", islands: connectivity.islands };
    const structureType = classifyStructure(graph);
    try {
      validateHydroxyls(graph);
      if (structureType === "ALKANE") return { ok: true, name: nameAlkane(graph) };
      if (structureType === "CYCLOALKANE") return { ok: true, name: nameCycloalkane(graph) };
      return { ok: false, error: structureType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  function randInt(min, max) {
    return min + Math.floor(random() * (max - min + 1));
  }
  function choice(arr) {
    return arr[randInt(0, arr.length - 1)];
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }
  function pickUpToNDistinct(pool, n) {
    const count = randInt(1, Math.max(1, Math.min(n, pool.length)));
    const shuffled2 = shuffle([...pool]);
    return shuffled2.slice(0, count);
  }
  function pickSpeciesForRange(typeRange, slotCount, forceHydroxyl = false) {
    const [rawMin, rawMax] = Array.isArray(typeRange) ? typeRange : [1, typeRange || 1];
    const pool = forceHydroxyl ? [...SUBSTITUENT_SPECIES, HYDROXYL_ELEMENT] : SUBSTITUENT_SPECIES;
    const hi = Math.max(1, Math.min(rawMax, pool.length, Math.max(1, slotCount)));
    const lo = Math.max(1, Math.min(rawMin, hi));
    const count = randInt(lo, hi);
    if (forceHydroxyl) {
      return [HYDROXYL_ELEMENT, ...shuffle([...SUBSTITUENT_SPECIES]).slice(0, count - 1)];
    }
    return shuffle([...pool]).slice(0, count);
  }
  function panelFor(type, targetDirs) {
    const targetSet = new Set(targetDirs);
    const base = PANEL_ARM_TABLE[type];
    for (let steps = 0; steps < 4; steps++) {
      const candidate = new Set(base.map((d) => rotateCW(d, steps)));
      if (candidate.size === targetSet.size && [...candidate].every((d) => targetSet.has(d))) {
        return { type, rotation: steps * 90 };
      }
    }
    throw new Error("NO_ROTATION_MATCH");
  }
  function spinePanel(hasUp, hasDown, isLeftEnd, isRightEnd) {
    const chainDirs = isLeftEnd ? ["E"] : isRightEnd ? ["W"] : ["W", "E"];
    const dirs = chainDirs.concat(hasUp ? ["N"] : [], hasDown ? ["S"] : []);
    return panelForDirections(dirs);
  }
  function branchPanelsForName(side, name) {
    const back = side === "up" ? "S" : "N";
    const fwd = side === "up" ? "N" : "S";
    const length = SUBSTITUENT_LENGTH[name];
    if (length === 1) {
      const panel = panelFor(1, [back]);
      if (name === HYDROXYL_ELEMENT) panel.element = HYDROXYL_ELEMENT;
      const el = HALOGEN_ELEMENT_BY_NAME[name];
      if (el) panel.element = el;
      return [panel];
    }
    return [panelFor(2, [back, fwd]), panelFor(1, [back])];
  }
  function generateAlkaneGrid(typeRange, opts) {
    const { lenMin = 2, lenMax = 7, subMin = 0, subMax = 3, forceHydroxyl = false, hydroxylLimitOne = false } = opts || {};
    const len = randInt(Math.max(2, lenMin), Math.max(2, lenMax));
    const startCol = Math.floor((COLS - len) / 2);
    const spineRow = 2;
    const grid = emptyGrid();
    const slots = [];
    for (let i = 0; i < len; i++) {
      slots.push([i, "up"]);
      slots.push([i, "down"]);
    }
    shuffle(slots);
    const distinctNames = pickSpeciesForRange(typeRange, slots.length, forceHydroxyl);
    const count = Math.min(slots.length, randInt(subMin, subMax));
    const posInfo = {};
    let hydroxylCount = 0;
    for (let i = 0; i < count; i++) {
      const [idx, side] = slots[i];
      if (!posInfo[idx]) posInfo[idx] = {};
      const candidates = distinctNames.filter((name2) => name2 !== HYDROXYL_ELEMENT || !Object.values(posInfo[idx]).includes(HYDROXYL_ELEMENT) && (!hydroxylLimitOne || hydroxylCount === 0));
      if (candidates.length === 0) continue;
      const name = candidates.length === 1 ? candidates[0] : choice(candidates);
      posInfo[idx][side] = name;
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
    }
    for (let i = 0; i < len; i++) {
      const col = startCol + i;
      const info = posInfo[i] || {};
      grid[spineRow][col] = spinePanel(!!info.up, !!info.down, i === 0, i === len - 1);
      if (info.up) {
        const bp = branchPanelsForName("up", info.up);
        grid[spineRow - 1][col] = bp[0];
        if (bp[1]) grid[spineRow - 2][col] = bp[1];
      }
      if (info.down) {
        const bp = branchPanelsForName("down", info.down);
        grid[spineRow + 1][col] = bp[0];
        if (bp[1]) grid[spineRow + 2][col] = bp[1];
      }
    }
    return grid;
  }
  function directionBetween([r1, c1], [r2, c2]) {
    if (r2 === r1 - 1 && c2 === c1) return "N";
    if (r2 === r1 + 1 && c2 === c1) return "S";
    if (r2 === r1 && c2 === c1 + 1) return "E";
    if (r2 === r1 && c2 === c1 - 1) return "W";
    throw new Error("NOT_ADJACENT");
  }
  function computeChainDirs(path, i) {
    const dirs = [];
    if (i > 0) dirs.push(directionBetween(path[i], path[i - 1]));
    if (i < path.length - 1) dirs.push(directionBetween(path[i], path[i + 1]));
    return dirs;
  }
  function countBends(path) {
    let bends = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const [dPrev, dNext] = computeChainDirs(path, i);
      if (OPPOSITE[dPrev] !== dNext) bends++;
    }
    return bends;
  }
  function panelForDirections(dirs) {
    const set = new Set(dirs);
    const n = set.size;
    if (n === 1) return panelFor(1, [...set]);
    if (n === 2) {
      const [a, b] = [...set];
      return panelFor(OPPOSITE[a] === b ? 2 : 3, [...set]);
    }
    if (n === 3) return panelFor(4, [...set]);
    if (n === 4) return panelFor(5, [...set]);
    throw new Error("INVALID_DIRECTION_COUNT");
  }
  function tryGenerateBentChain(len, forceTurn) {
    const occupied = /* @__PURE__ */ new Set();
    const key2 = (r2, c2) => `${r2},${c2}`;
    let r = randInt(1, ROWS - 2);
    let c = randInt(2, COLS - 3);
    const path = [[r, c]];
    occupied.add(key2(r, c));
    let lastDir = null;
    for (let step = 1; step < len; step++) {
      let candidates = shuffle(["N", "E", "S", "W"]).filter((d) => !lastDir || d !== OPPOSITE[lastDir]);
      if (forceTurn && lastDir) {
        candidates = candidates.filter((d) => d !== lastDir).concat(candidates.filter((d) => d === lastDir));
      }
      let moved = false;
      for (const d of candidates) {
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || occupied.has(key2(nr, nc))) continue;
        r = nr;
        c = nc;
        path.push([r, c]);
        occupied.add(key2(r, c));
        lastDir = d;
        moved = true;
        break;
      }
      if (!moved) return null;
    }
    return { path, occupied };
  }
  function planBentSubstituents(path, occupied, typeRange, subMin, subMax, forceHydroxyl, hydroxylLimitOne) {
    const len = path.length;
    const distinctNames = pickSpeciesForRange(typeRange, len * 3, forceHydroxyl);
    const targetCount = randInt(subMin, subMax);
    const posInfo = {};
    let placed = 0;
    let hydroxylCount = 0;
    const place = (i, dir, name) => {
      const length = SUBSTITUENT_LENGTH[name];
      const [dr, dc] = DELTA[dir];
      const [r0, c0] = path[i];
      let rr = r0, cc = c0;
      for (let k = 0; k < length; k++) {
        rr += dr;
        cc += dc;
        occupied.add(`${rr},${cc}`);
      }
      if (!posInfo[i]) posInfo[i] = {};
      posInfo[i][dir] = name;
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
      placed++;
    };
    const canPlace = (i, dir, name) => {
      const length = SUBSTITUENT_LENGTH[name];
      const [dr, dc] = DELTA[dir];
      const [r0, c0] = path[i];
      let rr = r0, cc = c0;
      for (let k = 0; k < length; k++) {
        rr += dr;
        cc += dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || occupied.has(`${rr},${cc}`)) return false;
      }
      return true;
    };
    const eligibleNamesAt = (i) => {
      const currentNames = posInfo[i] ? Object.values(posInfo[i]) : [];
      return distinctNames.filter((name) => name !== HYDROXYL_ELEMENT || !currentNames.includes(HYDROXYL_ELEMENT) && (!hydroxylLimitOne || hydroxylCount === 0));
    };
    const choicesAt = (i, names) => {
      const chainDirs = computeChainDirs(path, i);
      const usedDirs = new Set(Object.keys(posInfo[i] || {}));
      const directions = DIR_ORDER.filter((dir) => !chainDirs.includes(dir) && !usedDirs.has(dir));
      const choices = [];
      for (const dir of directions) {
        for (const name of names) if (canPlace(i, dir, name)) choices.push({ dir, name });
      }
      return choices;
    };
    while (placed < targetCount) {
      const positions = [];
      for (let i2 = 0; i2 < len; i2++) {
        const choices2 = choicesAt(i2, eligibleNamesAt(i2));
        if (choices2.length) positions.push({ i: i2, choices: choices2 });
      }
      if (!positions.length) break;
      const { i, choices } = choice(positions);
      const { dir, name } = choice(choices);
      place(i, dir, name);
    }
    return posInfo;
  }
  function buildBentGrid(path, posInfo) {
    const grid = emptyGrid();
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i];
      const chainDirs = computeChainDirs(path, i);
      const info = posInfo[i] || {};
      const branchDirs = Object.keys(info);
      grid[r][c] = panelForDirections(chainDirs.concat(branchDirs));
      for (const dir of branchDirs) {
        const name = info[dir];
        const length = SUBSTITUENT_LENGTH[name];
        const el = HALOGEN_ELEMENT_BY_NAME[name];
        const [dr, dc] = DELTA[dir];
        let rr = r, cc = c;
        for (let k = 0; k < length; k++) {
          rr += dr;
          cc += dc;
          const isLast = k === length - 1;
          grid[rr][cc] = panelForDirections(isLast ? [OPPOSITE[dir]] : [OPPOSITE[dir], dir]);
          if (isLast && name === HYDROXYL_ELEMENT) grid[rr][cc].element = HYDROXYL_ELEMENT;
          if (isLast && el) grid[rr][cc].element = el;
        }
      }
    }
    return grid;
  }
  function generateBentAlkaneGrid(typeRange, opts, forceTurn, bendRange) {
    const { lenMin = 6, lenMax = 9, subMin = 2, subMax = 4, forceHydroxyl = false, hydroxylLimitOne = false } = opts || {};
    const [bendMin, bendMax] = bendRange || [0, Infinity];
    for (let attempt = 0; attempt < 60; attempt++) {
      const len = randInt(Math.max(2, lenMin), Math.max(2, lenMax));
      const walk = tryGenerateBentChain(len, forceTurn);
      if (!walk) continue;
      const bends = countBends(walk.path);
      if (bends < bendMin || bends > bendMax) continue;
      const occupied = new Set(walk.occupied);
      const posInfo = planBentSubstituents(walk.path, occupied, typeRange, subMin, subMax, forceHydroxyl, hydroxylLimitOne);
      return buildBentGrid(walk.path, posInfo);
    }
    return null;
  }
  function makeRingTemplate(width) {
    const cells = [];
    for (let c = 0; c < width; c++) cells.push([0, c]);
    for (let c = width - 1; c >= 0; c--) cells.push([1, c]);
    return { width, height: 2, cells };
  }
  const RING_TEMPLATES = {
    4: makeRingTemplate(2),
    // シクロブタン
    6: makeRingTemplate(3),
    // シクロヘキサン
    8: makeRingTemplate(4),
    // シクロオクタン
    10: makeRingTemplate(5)
    // シクロデカン
  };
  function computeRingDirs(path, i) {
    const n = path.length;
    const prev = path[(i - 1 + n) % n];
    const next = path[(i + 1) % n];
    return [directionBetween(path[i], prev), directionBetween(path[i], next)];
  }
  function tryGenerateRingWalk(size) {
    const startR = randInt(0, ROWS - 1);
    const startC = randInt(0, COLS - 1);
    const path = [[startR, startC]];
    const occupied = /* @__PURE__ */ new Set([`${startR},${startC}`]);
    let budget = 4e3;
    function backtrack() {
      if (--budget <= 0) return false;
      const [r, c] = path[path.length - 1];
      if (path.length === size) {
        const [sr, sc] = path[0];
        return Math.abs(r - sr) + Math.abs(c - sc) === 1;
      }
      for (const d of shuffle(["N", "E", "S", "W"])) {
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        const key2 = `${nr},${nc}`;
        if (occupied.has(key2)) continue;
        path.push([nr, nc]);
        occupied.add(key2);
        if (backtrack()) return true;
        path.pop();
        occupied.delete(key2);
      }
      return false;
    }
    return backtrack() ? { path, occupied } : null;
  }
  function buildRingGridFromPath(path, forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne) {
    const size = path.length;
    const grid = emptyGrid();
    const occupied = new Set(path.map(([r, c]) => `${r},${c}`));
    for (let i = 0; i < size; i++) {
      const [r, c] = path[i];
      grid[r][c] = panelForDirections(computeRingDirs(path, i));
    }
    const slots = [];
    for (let i = 0; i < size; i++) {
      const [r, c] = path[i];
      const ringDirs = computeRingDirs(path, i);
      for (const d of ["N", "E", "S", "W"]) {
        if (ringDirs.includes(d)) continue;
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        if (occupied.has(`${nr},${nc}`)) continue;
        let safe2 = true;
        for (const d2 of ["N", "E", "S", "W"]) {
          const [dr2, dc2] = DELTA[d2];
          const nnr = nr + dr2, nnc = nc + dc2;
          if (nnr === r && nnc === c) continue;
          if (occupied.has(`${nnr},${nnc}`)) {
            safe2 = false;
            break;
          }
        }
        if (safe2) slots.push({ r, c, dir: d, nr, nc });
      }
    }
    shuffle(slots);
    const distinctNames = pickSpeciesForRange(typeRange, slots.length, forceHydroxyl);
    let want;
    if (subMin === void 0 || subMax === void 0) {
      want = forceSubstituent || random() < 0.5 ? 1 : 0;
    } else {
      want = randInt(subMin, subMax);
      if (forceSubstituent && want < 1) want = 1;
    }
    let placed = 0;
    let hydroxylCount = 0;
    const hydroxylParents = /* @__PURE__ */ new Set();
    for (const slot of slots) {
      if (placed >= want) break;
      if (occupied.has(`${slot.nr},${slot.nc}`)) continue;
      const parentKey = `${slot.r},${slot.c}`;
      const candidates = distinctNames.filter((name2) => name2 !== HYDROXYL_ELEMENT || !hydroxylParents.has(parentKey) && (!hydroxylLimitOne || hydroxylCount === 0));
      if (candidates.length === 0) continue;
      const name = candidates.length === 1 ? candidates[0] : choice(candidates);
      const existing = getActiveDirections(grid[slot.r][slot.c]);
      grid[slot.r][slot.c] = panelForDirections([...existing, slot.dir]);
      const panel = panelFor(1, [OPPOSITE[slot.dir]]);
      if (name === HYDROXYL_ELEMENT) panel.element = HYDROXYL_ELEMENT;
      const el = HALOGEN_ELEMENT_BY_NAME[name];
      if (el) panel.element = el;
      grid[slot.nr][slot.nc] = panel;
      occupied.add(`${slot.nr},${slot.nc}`);
      if (name === HYDROXYL_ELEMENT) hydroxylParents.add(parentKey);
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
      placed++;
    }
    return grid;
  }
  function generateCycloalkaneGrid(forceSubstituent, ringSizes, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne) {
    const ringSize = choice(ringSizes || [4, 6]);
    const tmpl = RING_TEMPLATES[ringSize];
    const templatePath = () => {
      const baseRow = Math.floor((ROWS - tmpl.height) / 2);
      const baseCol = Math.floor((COLS - tmpl.width) / 2);
      return tmpl.cells.map(([dr, dc]) => [baseRow + dr, baseCol + dc]);
    };
    if (random() < 0.5) {
      return buildRingGridFromPath(templatePath(), forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      const walk = tryGenerateRingWalk(ringSize);
      if (walk) return buildRingGridFromPath(walk.path, forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
    }
    return buildRingGridFromPath(templatePath(), forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
  }
  function groupTypesInName(name) {
    const types = [];
    if (name.includes("\u30E1\u30C1\u30EB")) types.push("\u30E1\u30C1\u30EB");
    if (name.includes("\u30A8\u30C1\u30EB")) types.push("\u30A8\u30C1\u30EB");
    if (name.includes("\u30D5\u30EB\u30AA\u30ED")) types.push("\u30D5\u30EB\u30AA\u30ED");
    if (name.includes("\u30AF\u30ED\u30ED")) types.push("\u30AF\u30ED\u30ED");
    if (name.includes("\u30D6\u30ED\u30E2")) types.push("\u30D6\u30ED\u30E2");
    if (name.includes("\u30E8\u30FC\u30C9")) types.push("\u30E8\u30FC\u30C9");
    if (name.endsWith("\u30CE\u30FC\u30EB") || name.endsWith("\u30AA\u30FC\u30EB")) types.push("OH");
    return types;
  }
  function groupTypeSignature(name) {
    const types = groupTypesInName(name);
    return types.length ? types.join("|") : "\u306A\u3057";
  }
  function generateMethaneGrid(forceHydroxyl = false, maxTypeCount = Infinity, subMin = 1, subMax = 4) {
    const dirsByCount = { 1: ["E"], 2: ["E", "W"], 3: ["E", "W", "N"], 4: ["E", "W", "N", "S"] };
    const typeByCount = { 1: 1, 2: 2, 3: 4, 4: 5 };
    const minCount = Math.max(1, Math.min(4, Number(subMin) || 0));
    const maxCount = Math.max(0, Math.min(4, Number(subMax) || 0));
    if (minCount > maxCount) return null;
    if (forceHydroxyl && maxTypeCount <= 1 && minCount > 1) return null;
    const count = forceHydroxyl && maxTypeCount <= 1 ? 1 : randInt(minCount, maxCount);
    const dirs = dirsByCount[count];
    const grid = emptyGrid();
    const cr = 2, cc = Math.floor(COLS / 2);
    grid[cr][cc] = panelFor(typeByCount[count], dirs);
    const opp = { E: "W", W: "E", N: "S", S: "N" };
    const names = forceHydroxyl ? [...Object.keys(HALOGEN_ELEMENT_BY_NAME), HYDROXYL_ELEMENT] : Object.keys(HALOGEN_ELEMENT_BY_NAME);
    const forcedHydroxylDir = forceHydroxyl ? choice(dirs) : null;
    dirs.forEach((d) => {
      const [dr, dc] = DELTA[d];
      const panel = panelFor(1, [opp[d]]);
      const candidates = names.filter((name2) => name2 !== HYDROXYL_ELEMENT || d === forcedHydroxylDir);
      const name = d === forcedHydroxylDir ? HYDROXYL_ELEMENT : choice(candidates);
      panel.element = name === HYDROXYL_ELEMENT ? HYDROXYL_ELEMENT : HALOGEN_ELEMENT_BY_NAME[name];
      grid[cr + dr][cc + dc] = panel;
    });
    return grid;
  }
  function gridExtent(g) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!g[r][c]) continue;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
    if (maxR < 0) return { w: 0, h: 0 };
    return { w: maxC - minC + 1, h: maxR - minR + 1 };
  }
  function generateStructureWithOptions(opts) {
    const {
      typeMin = 1,
      typeMax = 1,
      lenMin = 2,
      lenMax = 7,
      subMin = 0,
      subMax = 4,
      useBent = false,
      forceTurn = false,
      forceRingSubstituent = false,
      ringSizes = [4, 6],
      bendRange = null,
      allowMethane = false,
      categoryWeights = null,
      alcoholEnabled = false,
      alcoholRate = 40,
      hydroxylLimitOne = false,
      hydroxylCountsAsSubstituent = true,
      maxWidth = COLS,
      maxHeight = ROWS
    } = opts || {};
    const normalizedAlcoholRate = Math.max(0, Math.min(100, Number(alcoholRate) || 0));
    const forceHydroxyl = alcoholEnabled && random() * 100 < normalizedAlcoholRate;
    const hydroxylCounts = !!hydroxylCountsAsSubstituent;
    const extraHydroxylForGeneration = forceHydroxyl && !hydroxylCounts ? 1 : 0;
    const generationTypeRange = [typeMin + extraHydroxylForGeneration, typeMax + extraHydroxylForGeneration];
    const generationSubMin = subMin + extraHydroxylForGeneration;
    const generationSubMax = subMax + extraHydroxylForGeneration;
    function hydroxylCountInGrid(g) {
      return g.flat().filter((panel) => panel && panel.element === HYDROXYL_ELEMENT).length;
    }
    function finalize(g, expectedParentLength = null) {
      const extent = gridExtent(g);
      if (extent.w > maxWidth || extent.h > maxHeight) return null;
      if (checkPhysicalPanelDirections(g).length > 0) return null;
      const result = generateName(g);
      if (!result.ok) return null;
      const hydroxylCount = hydroxylCountInGrid(g);
      if (forceHydroxyl && hydroxylCount === 0) return null;
      if (hydroxylLimitOne && hydroxylCount > 1) return null;
      const groupSummary = namedGroupSummary(result.name);
      if (!groupSummary) return null;
      const countedTotal = groupSummary.total - (hydroxylCounts ? 0 : groupSummary.hydroxylCount);
      if (countedTotal < subMin || countedTotal > subMax) return null;
      if (expectedParentLength !== null && groupSummary.parentCarbonCount !== expectedParentLength) return null;
      const typeCount = hydroxylCounts ? groupSummary.types.length : groupSummary.types.filter((type) => type !== "OH").length;
      if (typeCount > typeMax) return null;
      if (typeCount > 0 && typeCount < typeMin) return null;
      return { grid: g, name: result.name, parentCarbonCount: groupSummary.parentCarbonCount, fellBack: false };
    }
    function tryMethane() {
      try {
        const g = generateMethaneGrid(forceHydroxyl, generationTypeRange[1], generationSubMin, generationSubMax);
        return g ? finalize(g) : null;
      } catch (e) {
        return null;
      }
    }
    function tryCyclo() {
      try {
        return finalize(generateCycloalkaneGrid(forceRingSubstituent, ringSizes, generationSubMin, generationSubMax, generationTypeRange, forceHydroxyl, hydroxylLimitOne));
      } catch (e) {
        return null;
      }
    }
    function tryChainLen(len) {
      try {
        const lenOpts = { ...opts, lenMin: len, lenMax: len, subMin: generationSubMin, subMax: generationSubMax, forceHydroxyl, hydroxylLimitOne };
        const g = useBent ? generateBentAlkaneGrid(generationTypeRange, lenOpts, forceTurn, bendRange) : generateAlkaneGrid(generationTypeRange, lenOpts);
        return g ? finalize(g, len) : null;
      } catch (e) {
        return null;
      }
    }
    const methaneMinCount = Math.max(1, Number(generationSubMin) || 0);
    const methaneMaxCount = Math.min(4, Number(generationSubMax) || 0);
    const methaneEligible = allowMethane && methaneMinCount <= methaneMaxCount && !(forceHydroxyl && generationTypeRange[1] <= 1 && methaneMinCount > 1);
    const categories = [];
    if (methaneEligible) categories.push({ kind: "methane" });
    for (let l = Math.max(2, lenMin); l <= Math.max(2, lenMax); l++) categories.push({ kind: "chain", len: l });
    categories.push({ kind: "cyclo" });
    const chainCategories = categories.filter((cat) => cat.kind === "chain");
    function tryCategory(cat) {
      if (cat.kind === "methane") return tryMethane();
      if (cat.kind === "cyclo") return tryCyclo();
      return tryChainLen(cat.len);
    }
    const familyChoices = [
      ...methaneEligible ? [{ kind: "methane", weight: categoryWeights?.methane ?? 10 }] : [],
      ...chainCategories.length ? [{ kind: "chain", weight: categoryWeights?.chain ?? 75 }] : [],
      { kind: "cyclo", weight: categoryWeights?.cyclo ?? 15 }
    ].filter((item) => item.weight > 0);
    const totalWeight = familyChoices.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * totalWeight;
    let family = familyChoices[familyChoices.length - 1].kind;
    for (const item of familyChoices) {
      roll -= item.weight;
      if (roll < 0) {
        family = item.kind;
        break;
      }
    }
    const preferred = family === "chain" ? choice(chainCategories) : categories.find((cat) => cat.kind === family);
    const orderedCategories = [preferred, ...shuffle(categories.filter((cat) => cat !== preferred))];
    const attemptsPerCategory = 25;
    for (const cat of orderedCategories) {
      for (let i = 0; i < attemptsPerCategory; i++) {
        const r = tryCategory(cat);
        if (r) return r;
      }
    }
    for (let i = 0; i < 80; i++) {
      const r = tryCategory(choice(categories));
      if (r) return r;
    }
    return null;
  }
  const BASE_NAME_TOKENS = CHAIN_NAMES.slice(1, 11);
  const BASE_NAME_SET = new Set(BASE_NAME_TOKENS);
  const CYCLO_TOKEN = "\u30B7\u30AF\u30ED";
  const ALCOHOL_TOKEN = "\u30AA\u30FC\u30EB";
  const SUB_NAME_SET = /* @__PURE__ */ new Set(["\u30E1\u30C1\u30EB", "\u30A8\u30C1\u30EB", "\u30D5\u30EB\u30AA\u30ED", "\u30AF\u30ED\u30ED", "\u30D6\u30ED\u30E2", "\u30E8\u30FC\u30C9"]);
  const MULTIPLIER_TOKENS = MULTIPLIER_PREFIX.slice(2);
  const MULTIPLIER_SET = new Set(MULTIPLIER_TOKENS);
  function reconstructNameFromTokens(tokens) {
    let i = 0;
    const groups = [];
    let usedLocants = false;
    while (i < tokens.length && /^\d+$/.test(tokens[i])) {
      const start = i;
      const locants = [];
      while (i < tokens.length && /^\d+$/.test(tokens[i])) {
        locants.push(tokens[i]);
        i++;
      }
      let multiplier = "";
      if (i < tokens.length && MULTIPLIER_SET.has(tokens[i])) {
        multiplier = tokens[i];
        i++;
      }
      if (i >= tokens.length || !SUB_NAME_SET.has(tokens[i])) {
        i = start;
        break;
      }
      usedLocants = true;
      groups.push(`${locants.join(",")}-${multiplier}${tokens[i]}`);
      i++;
    }
    while (i < tokens.length && (SUB_NAME_SET.has(tokens[i]) || MULTIPLIER_SET.has(tokens[i]))) {
      let multiplier = "";
      if (MULTIPLIER_SET.has(tokens[i])) {
        multiplier = tokens[i];
        i++;
      }
      if (i >= tokens.length || !SUB_NAME_SET.has(tokens[i])) return null;
      groups.push(`${multiplier}${tokens[i]}`);
      i++;
    }
    const alcoholLocants = [];
    while (i < tokens.length && /^\d+$/.test(tokens[i])) {
      alcoholLocants.push(tokens[i]);
      i++;
    }
    let cycloPrefix = "";
    if (i < tokens.length && tokens[i] === CYCLO_TOKEN) {
      cycloPrefix = CYCLO_TOKEN;
      i++;
    }
    if (i >= tokens.length || !BASE_NAME_SET.has(tokens[i])) return null;
    const baseToken = tokens[i];
    const base = cycloPrefix + baseToken;
    i++;
    let alcoholMultiplier = "";
    if (i < tokens.length && MULTIPLIER_SET.has(tokens[i])) {
      alcoholMultiplier = tokens[i];
      i++;
    }
    const hasAlcohol = i < tokens.length && tokens[i] === ALCOHOL_TOKEN;
    if (hasAlcohol) i++;
    if (i !== tokens.length) return null;
    if (hasAlcohol) {
      const multiplierCount = alcoholMultiplier ? MULTIPLIER_PREFIX.indexOf(alcoholMultiplier) : 1;
      if (!multiplierCount) return null;
      if (alcoholLocants.length > 0) {
        if (new Set(alcoholLocants).size !== alcoholLocants.length) return null;
        if (alcoholLocants.length !== multiplierCount) return null;
      } else if (multiplierCount !== 1) {
        return null;
      }
      const carbonCount = CHAIN_NAMES.indexOf(baseToken);
      if (alcoholLocants.some((n) => Number(n) < 1 || Number(n) > carbonCount)) return null;
      const alcoholStem = base.endsWith("\u30F3") ? `${base.slice(0, -1)}\u30CE\u30FC\u30EB` : `${base}\u30CE\u30FC\u30EB`;
      const suffix = multiplierCount === 1 ? alcoholStem : `${base}${alcoholMultiplier}\u30AA\u30FC\u30EB`;
      const alcoholPrefix = alcoholLocants.length ? `${alcoholLocants.join(",")}-` : "";
      const subPrefix = groups.join(usedLocants ? "-" : "");
      return subPrefix + (subPrefix && alcoholPrefix ? "-" : "") + alcoholPrefix + suffix;
    }
    if (alcoholLocants.length || alcoholMultiplier) return null;
    return groups.join(usedLocants ? "-" : "") + base;
  }
  function parseGame2SubstituentDescriptor(descriptor) {
    const substituentNames = [...SUB_NAME_SET].sort((a, b) => b.length - a.length);
    for (const name of substituentNames) {
      if (!descriptor.endsWith(name)) continue;
      const multiplier = descriptor.slice(0, -name.length);
      if (multiplier === "") return [name];
      if (MULTIPLIER_SET.has(multiplier)) return [multiplier, name];
    }
    return null;
  }
  function parseGame2UnlocantedPrefix(prefix) {
    const pieces = [];
    for (const name of SUB_NAME_SET) {
      pieces.push({ text: name, tokens: [name] });
      for (const multiplier of MULTIPLIER_TOKENS) {
        pieces.push({ text: multiplier + name, tokens: [multiplier, name] });
      }
    }
    pieces.sort((a, b) => b.text.length - a.text.length);
    const parsedAt = Array(prefix.length + 1).fill(null);
    parsedAt[0] = [];
    for (let index = 0; index < prefix.length; index++) {
      if (parsedAt[index] === null) continue;
      for (const piece of pieces) {
        if (!prefix.startsWith(piece.text, index)) continue;
        const nextIndex = index + piece.text.length;
        if (parsedAt[nextIndex] === null) parsedAt[nextIndex] = parsedAt[index].concat(piece.tokens);
      }
    }
    return parsedAt[prefix.length];
  }
  function parseGame2SubstituentPrefix(rawPrefix) {
    const prefix = rawPrefix.endsWith("-") ? rawPrefix.slice(0, -1) : rawPrefix;
    if (prefix === "") return [];
    if (!/^\d/.test(prefix)) return parseGame2UnlocantedPrefix(prefix);
    const parts = prefix.split("-");
    if (parts.length % 2 !== 0) return null;
    const tokens = [];
    for (let index = 0; index < parts.length; index += 2) {
      if (!/^\d+(?:,\d+)*$/.test(parts[index])) return null;
      const descriptorTokens = parseGame2SubstituentDescriptor(parts[index + 1]);
      if (descriptorTokens === null) return null;
      tokens.push(...parts[index].split(","), ...descriptorTokens);
    }
    return tokens;
  }
  function expectedGame2AnswerTokens(name) {
    const baseNames = [...BASE_NAME_TOKENS].sort((a, b) => b.length - a.length);
    const tryCandidate = (prefix, alcoholLocants, cyclo, baseName, alcoholMultiplier = "", hasAlcohol = false) => {
      const prefixTokens = parseGame2SubstituentPrefix(prefix);
      if (prefixTokens === null) return null;
      const tokens = [...prefixTokens, ...alcoholLocants];
      if (cyclo) tokens.push(CYCLO_TOKEN);
      tokens.push(baseName);
      if (alcoholMultiplier) tokens.push(alcoholMultiplier);
      if (hasAlcohol) tokens.push(ALCOHOL_TOKEN);
      return reconstructNameFromTokens(tokens) === name ? tokens : null;
    };
    for (const baseName of baseNames) {
      for (const cyclo of [false, true]) {
        const parentName = (cyclo ? CYCLO_TOKEN : "") + baseName;
        for (const multiplier of MULTIPLIER_TOKENS) {
          const suffix = parentName + multiplier + ALCOHOL_TOKEN;
          if (!name.endsWith(suffix)) continue;
          const beforeSuffix = name.slice(0, -suffix.length);
          const match = beforeSuffix.match(/^(.*?)(\d+(?:,\d+)*)-$/);
          if (!match) continue;
          const candidate = tryCandidate(match[1], match[2].split(","), cyclo, baseName, multiplier, true);
          if (candidate) return candidate;
        }
        const alcoholStem = parentName.endsWith("\u30F3") ? parentName.slice(0, -1) + "\u30CE\u30FC\u30EB" : parentName + "\u30AA\u30FC\u30EB";
        if (name.endsWith(alcoholStem)) {
          const beforeStem = name.slice(0, -alcoholStem.length);
          const locanted = beforeStem.match(/^(.*?)(\d+)-$/);
          if (locanted) {
            const candidate2 = tryCandidate(locanted[1], [locanted[2]], cyclo, baseName, "", true);
            if (candidate2) return candidate2;
          }
          const candidate = tryCandidate(beforeStem, [], cyclo, baseName, "", true);
          if (candidate) return candidate;
        }
        if (name.endsWith(parentName)) {
          const candidate = tryCandidate(name.slice(0, -parentName.length), [], cyclo, baseName);
          if (candidate) return candidate;
        }
      }
    }
    return null;
  }
  function namedGroupSummary(name) {
    const tokens = expectedGame2AnswerTokens(name);
    if (tokens === null) return null;
    const baseName = tokens.find((token) => BASE_NAME_SET.has(token));
    const parentCarbonCount = baseName ? BASE_NAME_TOKENS.indexOf(baseName) + 1 : 0;
    let total = 0;
    let hydroxylCount = 0;
    const countForIndex = (index) => {
      const multiplierIndex = MULTIPLIER_PREFIX.indexOf(tokens[index - 1]);
      return multiplierIndex >= 2 ? multiplierIndex : 1;
    };
    tokens.forEach((token, index) => {
      const count = countForIndex(index);
      if (SUB_NAME_SET.has(token)) total += count;
      if (token === ALCOHOL_TOKEN) {
        total += count;
        hydroxylCount += count;
      }
    });
    return { total, hydroxylCount, types: groupTypesInName(name), signature: groupTypeSignature(name), parentCarbonCount };
  }
  function questionGridSignature(g) {
    return g.flat().map((panel) => panel ? `${panel.type}:${panel.rotation}:${panel.element || "C"}` : ".").join("|");
  }
  function questionTypeSignature(result) {
    return namedGroupSummary(result.name)?.signature || groupTypeSignature(result.name);
  }
  function questionBackboneSignature(result) {
    const parentCount = result.parentCarbonCount || namedGroupSummary(result.name)?.parentCarbonCount || 0;
    const parentKind = result.name.includes("\u30B7\u30AF\u30ED") ? "\u74B0" : "\u9396";
    let longestAlkyl = 0;
    let longestAlkylLocants = "";
    for (const [length, alkylName] of [[1, "\u30E1\u30C1\u30EB"], [2, "\u30A8\u30C1\u30EB"]]) {
      const matches = [...result.name.matchAll(new RegExp(`(?:^|-)(\\d+(?:,\\d+)*)-(?:\u30B8|\u30C8\u30EA|\u30C6\u30C8\u30E9|\u30DA\u30F3\u30BF|\u30D8\u30AD\u30B5|\u30D8\u30D7\u30BF|\u30AA\u30AF\u30BF|\u30CE\u30CA|\u30C7\u30AB)?${alkylName}`, "g"))];
      if (!matches.length) continue;
      if (length > longestAlkyl) {
        longestAlkyl = length;
        longestAlkylLocants = matches.flatMap((match) => match[1].split(",")).sort((a, b) => Number(a) - Number(b)).join(",");
      }
    }
    return `${parentKind}${parentCount}|\u5074\u9396${longestAlkyl}@${longestAlkylLocants || "-"}`;
  }
  const LOCANT_BALANCE_WINDOW = 36;
  const LOCANT_BALANCE_EXTRA_CANDIDATES = 4;
  const recentGame1LocantProfiles = [];
  function questionChainLocantProfile(result) {
    const summary = namedGroupSummary(result.name);
    if (!summary || summary.parentCarbonCount < 2 || result.name.includes("\u30B7\u30AF\u30ED")) return null;
    const tokens = expectedGame2AnswerTokens(result.name);
    if (!tokens) return null;
    const parentCount = summary.parentCarbonCount;
    const locants = tokens.filter((token) => /^\d+$/.test(token)).map(Number).filter((locant) => locant >= 1 && locant <= parentCount);
    const alcoholIndex = tokens.lastIndexOf(ALCOHOL_TOKEN);
    if (parentCount === 2 && alcoholIndex >= 0 && !MULTIPLIER_SET.has(tokens[alcoholIndex - 1])) locants.push(1);
    return locants.length ? { parentCount, locants } : null;
  }
  function rememberGame1LocantProfile(result) {
    const profile = questionChainLocantProfile(result);
    if (!profile) return;
    recentGame1LocantProfiles.push(profile);
    if (recentGame1LocantProfiles.length > LOCANT_BALANCE_WINDOW) recentGame1LocantProfiles.shift();
  }
  function resetGame1LocantProfiles() {
    recentGame1LocantProfiles.length = 0;
  }
  function locantBalancePenalty(result) {
    const profile = questionChainLocantProfile(result);
    if (!profile) return null;
    const relevant = recentGame1LocantProfiles.filter((item) => item.parentCount === profile.parentCount);
    if (relevant.length < 2) return null;
    const counts = Array(profile.parentCount + 1).fill(0);
    for (const item of relevant) for (const locant of item.locants) counts[locant]++;
    for (const locant of profile.locants) counts[locant]++;
    const mean = counts.slice(1).reduce((sum, count) => sum + count, 0) / profile.parentCount;
    return counts.slice(1).reduce((sum, count) => sum + (count - mean) ** 2, 0);
  }
  function pickLocantBalancedQuestion(candidates) {
    const scored = candidates.map((result) => ({ result, penalty: locantBalancePenalty(result) }));
    const usable = scored.filter((item) => item.penalty !== null);
    if (!usable.length) return choice(candidates);
    const bestPenalty = Math.min(...usable.map((item) => item.penalty));
    return choice(usable.filter((item) => item.penalty === bestPenalty)).result;
  }
  function rememberQuestion(history, result) {
    history.push({
      name: result.name,
      signature: questionGridSignature(result.grid),
      typeSignature: questionTypeSignature(result),
      backboneSignature: questionBackboneSignature(result)
    });
    if (history.length > 8) history.shift();
  }
  function generateAvoidingRecentRepeat(opts, history, accept = () => true) {
    const recentNames = new Set(history.slice(-8).map((item) => item.name));
    const recentSignatures = new Set(history.slice(-4).map((item) => item.signature));
    const recentBackbones = new Set(history.slice(-4).map((item) => item.backboneSignature));
    const previous = history[history.length - 1] || null;
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      const result = generateStructureWithOptions(opts);
      if (!result || !accept(result)) continue;
      const signature2 = questionGridSignature(result.grid);
      const typeSignature = questionTypeSignature(result);
      const backboneSignature = questionBackboneSignature(result);
      const nameIsFresh = !recentNames.has(result.name);
      const gridIsFresh = !recentSignatures.has(signature2);
      const backboneIsFresh = !recentBackbones.has(backboneSignature);
      const typeIsFresh = !previous || typeSignature !== previous.typeSignature;
      candidates.push({ result, signature: signature2, typeSignature, backboneSignature, nameIsFresh, gridIsFresh, backboneIsFresh, typeIsFresh });
      if (!result.fellBack && nameIsFresh && gridIsFresh && backboneIsFresh && typeIsFresh) {
        if (!opts.balanceLocants || !questionChainLocantProfile(result)) return result;
        const parentCount = questionChainLocantProfile(result).parentCount;
        const alternatives = [result];
        const alternativeNames = /* @__PURE__ */ new Set([result.name]);
        const alternativeSignatures = /* @__PURE__ */ new Set([signature2]);
        const alternativeOpts = {
          ...opts,
          lenMin: parentCount,
          lenMax: parentCount,
          allowMethane: false,
          categoryWeights: { chain: 100, cyclo: 0, methane: 0 }
        };
        for (let extra = 0; extra < LOCANT_BALANCE_EXTRA_CANDIDATES; extra++) {
          const alternative = generateStructureWithOptions(alternativeOpts);
          if (!alternative || !accept(alternative)) continue;
          const alternativeProfile = questionChainLocantProfile(alternative);
          if (!alternativeProfile || alternativeProfile.parentCount !== parentCount || alternative.fellBack) continue;
          const alternativeSignature = questionGridSignature(alternative.grid);
          const alternativeType = questionTypeSignature(alternative);
          const alternativeBackbone = questionBackboneSignature(alternative);
          if (recentNames.has(alternative.name) || recentSignatures.has(alternativeSignature) || recentBackbones.has(alternativeBackbone) || previous && alternativeType === previous.typeSignature || alternativeNames.has(alternative.name) || alternativeSignatures.has(alternativeSignature)) continue;
          alternatives.push(alternative);
          alternativeNames.add(alternative.name);
          alternativeSignatures.add(alternativeSignature);
        }
        return pickLocantBalancedQuestion(alternatives);
      }
    }
    const normalCandidates = candidates.filter((item) => !item.result.fellBack);
    const changedCombination = normalCandidates.find((item) => item.typeIsFresh && item.backboneIsFresh && (!previous || item.result.name !== previous.name) && (!previous || item.signature !== previous.signature));
    if (changedCombination) return changedCombination.result;
    const otherwiseFresh = normalCandidates.find((item) => item.nameIsFresh && item.gridIsFresh && item.backboneIsFresh);
    return (otherwiseFresh || normalCandidates[0] || candidates[0])?.result || null;
  }
  return { generateName, generateStructureWithOptions, generateAvoidingRecentRepeat, rememberQuestion, rememberGame1LocantProfile, expectedGame2AnswerTokens, reconstructNameFromTokens, namedGroupSummary, groupTypeSignature, gridExtent, buildGraph, findRing, getActiveDirections, shuffle, CHAIN_NAMES, MULTIPLIER_TOKENS, SUB_NAME_SET };
}

// src/games/alkane-puzzle/server/question-generator.ts
var modes = ["arrange", "name"];
var difficulties = ["easy", "medium"];
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function optionsFor(settings, rule) {
  const easy = settings.difficulty === "easy";
  return {
    typeMin: rule.typeMin,
    typeMax: rule.typeMax,
    lenMin: rule.lenMin,
    lenMax: rule.lenMax,
    subMin: rule.subMin,
    subMax: rule.subMax,
    ringSizes: rule.ringSizes,
    forceRingSubstituent: rule.cycloSubstituentCount !== 0,
    alcoholEnabled: settings.alcoholEnabled,
    alcoholRate: rule.alcoholRate,
    hydroxylLimitOne: rule.hydroxylLimitOne,
    hydroxylCountsAsSubstituent: rule.hydroxylCountsAsSubstituent,
    useBent: true,
    forceTurn: false,
    allowMethane: easy,
    categoryWeights: easy ? { methane: 10, chain: 75, cyclo: 15 } : { chain: 80, cyclo: 20 },
    ...settings.mode === "arrange" ? { maxWidth: rule.gridCols, maxHeight: rule.gridRows, balanceLocants: true } : { bendRange: [rule.bendMin, rule.bendMax] }
  };
}
function cycloCount(result, engine2) {
  if (!result.name.includes("\u30B7\u30AF\u30ED")) return null;
  const graph = engine2.buildGraph(result.grid);
  const ring = new Set(engine2.findRing(graph));
  let count = 0;
  for (const id of ring) {
    for (const neighbor of graph.adjacency.get(id) ?? []) {
      if (!ring.has(neighbor) && graph.elements.get(neighbor) !== "OH") count++;
    }
  }
  return count;
}
function acceptable(result, rule, engine2) {
  const count = cycloCount(result, engine2);
  if (count === null) return true;
  return rule.cycloSubstituentCount === 2 ? count >= 2 : count === rule.cycloSubstituentCount;
}
function wordBank(rule, settings, name, engine2, random) {
  const bases = /* @__PURE__ */ new Set();
  for (let n = rule.lenMin; n <= rule.lenMax; n++) bases.add(engine2.CHAIN_NAMES[n]);
  for (const n of rule.ringSizes) bases.add(engine2.CHAIN_NAMES[n]);
  const tokens = engine2.expectedGame2AnswerTokens(name) ?? [];
  for (const token of tokens) if (engine2.CHAIN_NAMES.includes(token)) bases.add(token);
  const maxNumber = Math.max(rule.lenMax, ...rule.ringSizes);
  const rows = [
    Array.from({ length: maxNumber }, (_, i) => String(i + 1)),
    shuffled(engine2.MULTIPLIER_TOKENS.slice(0, Math.max(rule.subMax, settings.alcoholEnabled ? 2 : 1) - 1), random),
    shuffled([...engine2.SUB_NAME_SET], random),
    ["\u30B7\u30AF\u30ED", ...settings.alcoholEnabled ? ["\u30AA\u30FC\u30EB"] : [], ...shuffled([...bases], random)]
  ];
  return rule.shuffleWordBankGroups ? shuffled(rows, random) : rows;
}
function arrangementPalette(alcoholEnabled) {
  const carbon = [1, 2, 3, 4, 5].map((type) => ({ type, rotation: type === 2 ? 90 : 0 }));
  const atoms = (alcoholEnabled ? ["F", "Cl", "Br", "I", "OH"] : ["F", "Cl", "Br", "I"]).map((element) => ({ type: 1, rotation: 0, element }));
  return [...carbon, ...atoms];
}
function validateGameSettings(settings, profile = DEFAULT_QUESTION_PROFILE) {
  validateQuestionProfileShape(profile ?? DEFAULT_QUESTION_PROFILE);
  if (!modes.includes(settings.mode) || !difficulties.includes(settings.difficulty)) throw new TypeError("\u30E2\u30FC\u30C9\u30FB\u96E3\u6613\u5EA6\u304C\u4E0D\u6B63\u3067\u3059");
  if (![5, 10, 15].includes(settings.questionCount) || !Number.isInteger(settings.timeLimitMinutes) || settings.timeLimitMinutes < 3 || settings.timeLimitMinutes > 10) throw new RangeError("\u554F\u984C\u6570\u30FB\u5236\u9650\u6642\u9593\u304C\u4E0D\u6B63\u3067\u3059");
  if (typeof settings.alcoholEnabled !== "boolean" || settings.gradingMode !== void 0 && !["immediate", "deferred"].includes(settings.gradingMode)) throw new TypeError("\u7AF6\u6280\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
  return { availableCount: settings.questionCount, maxScore: settings.questionCount };
}
function validateQuestionProfile(profile) {
  validateQuestionProfileShape(profile);
  for (const mode of modes) for (const difficulty of difficulties) {
    const rule = profile.rules[mode][difficulty];
    let seed = 9173;
    const random = () => (seed = seed * 1664525 + 1013904223 >>> 0) / 4294967296;
    const engine2 = createAlkaneEngine(random);
    for (const alcoholEnabled of [false, true]) {
      const settings = { mode, difficulty, alcoholEnabled, questionCount: 5, timeLimitMinutes: 5 };
      const options = optionsFor(settings, rule);
      let feasible = false;
      for (let attempt = 0; attempt < 24; attempt++) {
        const result = engine2.generateStructureWithOptions(options);
        if (result && acceptable(result, rule, engine2)) {
          feasible = true;
          break;
        }
      }
      if (!feasible) throw new RangeError(`${mode}\u30FB${difficulty}\u306E\u8A2D\u5B9A\u306B\u5408\u3046\u554F\u984C\u3092\u751F\u6210\u3067\u304D\u307E\u305B\u3093`);
    }
  }
}
function identifier(random) {
  return Array.from({ length: 4 }, () => Math.floor(random() * 65536).toString(16).padStart(4, "0")).join("");
}
function generateQuestionSet(settings, random = Math.random, profile = DEFAULT_QUESTION_PROFILE) {
  validateGameSettings(settings, profile);
  const engine2 = createAlkaneEngine(random);
  const rule = (profile ?? DEFAULT_QUESTION_PROFILE).rules[settings.mode][settings.difficulty];
  const options = optionsFor(settings, rule);
  const result = [];
  const history = [];
  const deadline = Date.now() + 1e4;
  for (let ordinal = 0; ordinal < settings.questionCount; ordinal++) {
    const chosen = Date.now() < deadline ? engine2.generateAvoidingRecentRepeat(options, history, (generated) => acceptable(generated, rule, engine2)) : null;
    if (!chosen) throw new RangeError("\u8A2D\u5B9A\u306B\u5408\u3046\u554F\u984C\u3092\u751F\u6210\u3067\u304D\u307E\u305B\u3093\u3002\u4E3B\u9396\u30FB\u7F6E\u63DB\u57FA\u30FB\u67A0\u6570\u30FB\u6298\u308C\u66F2\u304C\u308A\u306E\u8A2D\u5B9A\u3092\u898B\u76F4\u3057\u3066\u304F\u3060\u3055\u3044");
    engine2.rememberQuestion(history, chosen);
    if (settings.mode === "arrange") engine2.rememberGame1LocantProfile(chosen);
    const field = settings.mode === "arrange" ? "formula" : "name";
    const tokens = engine2.expectedGame2AnswerTokens(chosen.name);
    if (!tokens) throw new RangeError("\u6B63\u7B54\u306E\u8A9E\u53E5\u3092\u751F\u6210\u3067\u304D\u307E\u305B\u3093");
    const prompt = settings.mode === "arrange" ? { kind: "alkane", mode: "arrange", grid: null, name: chosen.name, options: arrangementPalette(settings.alcoholEnabled), bounds: { cols: rule.gridCols, rows: rule.gridRows }, alcoholEnabled: settings.alcoholEnabled, values: [] } : { kind: "alkane", mode: "name", grid: chosen.grid, wordBank: wordBank(rule, settings, chosen.name, engine2, random), alcoholEnabled: settings.alcoholEnabled, values: [] };
    result.push({
      id: identifier(random),
      ordinal,
      itemId: "alkane-" + ordinal,
      category: chosen.name.includes("\u30B7\u30AF\u30ED") ? "cyclo" : "chain",
      variant: settings.mode,
      prompt,
      fields: [{ id: field, type: field }],
      maxScore: 1,
      answer: { type: field, canonical: JSON.stringify(settings.mode === "arrange" ? { grid: chosen.grid } : { tokens }), accepted: [] }
    });
  }
  return freeze(result);
}
function toPublicQuestion(question, progress) {
  return freeze({ id: question.id, ordinal: question.ordinal, prompt: question.prompt, fields: question.fields, progress });
}

// src/games/alkane-puzzle/shared/answer-evaluator.ts
var EVALUATOR_VERSION = "alkane-puzzle-evaluator-1";
var engine = createAlkaneEngine(() => 0.5);
var invalid = (empty) => ({ correct: false, empty, matchedAnswerKind: null, note: null });
function parseInput(value) {
  if (typeof value !== "string") return value;
  if (value.length > 1e4) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function validGrid(raw) {
  if (!Array.isArray(raw) || raw.length !== 5) return false;
  return raw.every((row) => Array.isArray(row) && row.length === 7 && row.every((panel) => {
    if (panel === null) return true;
    if (!panel || typeof panel !== "object" || Array.isArray(panel)) return false;
    const p = panel;
    return [1, 2, 3, 4, 5].includes(p.type) && [0, 90, 180, 270].includes(p.rotation) && (p.element === void 0 || ["C", "F", "Cl", "Br", "I", "OH"].includes(p.element)) && (p.element === void 0 || p.element === "C" || p.type === 1) && Object.keys(p).every((k) => ["type", "rotation", "element"].includes(k));
  }));
}
var validTokens = /* @__PURE__ */ new Set([
  ...engine.CHAIN_NAMES.slice(1, 11),
  ...engine.MULTIPLIER_TOKENS,
  ...engine.SUB_NAME_SET,
  "\u30B7\u30AF\u30ED",
  "\u30AA\u30FC\u30EB",
  ...Array.from({ length: 10 }, (_, i) => String(i + 1))
]);
function validateAlkaneAnswer(value, prompt) {
  const parsed = parseInput(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed;
  if (Object.keys(record).length !== 1) return null;
  if (Object.hasOwn(record, "grid")) {
    if (!validGrid(record.grid)) return null;
    const grid = record.grid;
    const bounds = prompt?.bounds;
    const startCol = bounds ? Math.floor((7 - bounds.cols) / 2) : 0;
    const startRow = bounds ? Math.floor((5 - bounds.rows) / 2) : 0;
    for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) {
      const panel = grid[row][col];
      if (!panel) continue;
      if (bounds && (row < startRow || row >= startRow + bounds.rows || col < startCol || col >= startCol + bounds.cols)) return null;
      if (prompt?.alcoholEnabled === false && panel.element === "OH") return null;
    }
    return { grid };
  }
  if (Object.hasOwn(record, "tokens") && Array.isArray(record.tokens) && record.tokens.length <= 40 && record.tokens.every((token) => typeof token === "string" && validTokens.has(token)) && (prompt?.alcoholEnabled !== false || !record.tokens.includes("\u30AA\u30FC\u30EB")) && (!prompt?.wordBank || record.tokens.every((token) => prompt.wordBank.some((row) => row.includes(token))))) return { tokens: [...record.tokens] };
  return null;
}
function evaluateField(question, fieldId, value) {
  if (!question.fields.some((field) => field.id === fieldId)) throw new TypeError("\u3053\u306E\u554F\u984C\u306B\u5B58\u5728\u3057\u306A\u3044\u89E3\u7B54\u6B04\u3067\u3059");
  const parsed = validateAlkaneAnswer(value, question.prompt);
  const empty = value === null || value === void 0 || value === "";
  if (empty) return invalid(true);
  let correct = false;
  if (fieldId === "formula" && question.prompt.mode === "arrange") {
    const grid = parsed && "grid" in parsed ? parsed.grid : null;
    if (validGrid(grid)) {
      const result = engine.generateName(grid);
      const expectedAnswer = validateAlkaneAnswer(question.answer.canonical);
      const expected = expectedAnswer && "grid" in expectedAnswer ? engine.generateName(expectedAnswer.grid) : null;
      correct = result.ok && expected?.ok === true && result.name === expected.name;
    }
  } else if (fieldId === "name" && question.prompt.mode === "name") {
    const tokens = parsed && "tokens" in parsed ? parsed.tokens : null;
    if (tokens) {
      const expectedAnswer = validateAlkaneAnswer(question.answer.canonical);
      const expectedTokens = expectedAnswer && "tokens" in expectedAnswer ? expectedAnswer.tokens : [];
      const expected = engine.reconstructNameFromTokens(expectedTokens);
      correct = expected !== null && engine.reconstructNameFromTokens(tokens) === expected;
    }
  }
  return { correct, empty: false, matchedAnswerKind: correct ? "canonical" : null, note: null };
}

// src/competition-core/scoring.ts
function withFields(score, fields) {
  const values = Object.values(fields);
  return {
    ...score,
    fields,
    correctCount: values.filter((field) => field?.state === "correct").length,
    resolved: values.length > 0 && values.every((field) => field?.state === "correct" || field?.state === "passed")
  };
}
function applyFieldResult(score, fieldId, correct, elapsedMs) {
  const field = score.fields[fieldId];
  if (!field) throw new TypeError(`Unknown answer field: ${fieldId}`);
  if (field.state !== "pending") return score;
  const updated = correct ? { state: "correct", attemptCount: field.attemptCount + 1, resolvedAtMs: elapsedMs } : { state: "pending", attemptCount: field.attemptCount + 1 };
  return withFields(score, { ...score.fields, [fieldId]: updated });
}
function applyPass(score, fieldId, elapsedMs) {
  if (!score.fields[fieldId]) throw new TypeError(`Unknown answer field: ${fieldId}`);
  const fields = Object.fromEntries(
    Object.entries(score.fields).map(([currentId, field]) => [
      currentId,
      currentId === fieldId && field?.state === "pending" ? { ...field, state: "passed", resolvedAtMs: elapsedMs } : field
    ])
  );
  return withFields(score, fields);
}

// src/competition-core/timing.ts
function toCentiseconds(elapsedMs) {
  return Math.floor(elapsedMs / 10);
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function acceptElapsed(input) {
  if (input.serverNowMs < input.startAtMs) {
    return { accepted: false, reason: "not_started" };
  }
  if (input.serverNowMs >= input.deadlineAtMs) {
    return { accepted: false, reason: "deadline" };
  }
  const limitMs = input.deadlineAtMs - input.startAtMs;
  const authoritativeElapsedMs = clamp(
    input.serverNowMs - input.startAtMs,
    0,
    limitMs
  );
  const fallbackElapsedMs = clamp(
    authoritativeElapsedMs,
    input.previousAcceptedElapsedMs,
    limitMs
  );
  const aheadToleranceMs = input.aheadToleranceMs ?? PUBLIC_CONFIG.timingToleranceMs.aheadOfServer;
  const behindToleranceMs = input.behindToleranceMs ?? PUBLIC_CONFIG.timingToleranceMs.behindServer;
  const clientElapsedMs = input.clientElapsedMs;
  const validClientTime = input.previousTimingSource === "client" && typeof clientElapsedMs === "number" && Number.isFinite(clientElapsedMs) && clientElapsedMs >= input.previousAcceptedElapsedMs && clientElapsedMs >= 0 && clientElapsedMs <= limitMs && clientElapsedMs - authoritativeElapsedMs <= aheadToleranceMs && authoritativeElapsedMs - clientElapsedMs <= behindToleranceMs;
  const acceptedElapsedMs = validClientTime ? clientElapsedMs : fallbackElapsedMs;
  const timingSource = validClientTime ? "client" : "server_fallback";
  return {
    accepted: true,
    acceptedElapsedMs,
    elapsedCs: toCentiseconds(acceptedElapsedMs),
    timingSource
  };
}

// src/competition-core/wait-credit.ts
function validateWaitCredit(input) {
  const { waitMs, sourceActionAtMs, nextAcceptedAtMs, previousRawElapsedMs, nextRawElapsedMs } = input;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || !Number.isSafeInteger(sourceActionAtMs)) return 0;
  if (sourceActionAtMs >= nextAcceptedAtMs || waitMs > nextAcceptedAtMs - sourceActionAtMs) return 0;
  if (waitMs > nextRawElapsedMs - previousRawElapsedMs) return 0;
  return waitMs;
}

// src/persistence/actions.ts
var ACTION_RATE_LIMIT = 120;
var ACTION_RATE_WINDOW_MS = 6e4;
var ACTION_OPERATION = "player_action";
function replayAttemptFailure(attempt, bodyHash2) {
  if (attempt.body_hash !== bodyHash2) {
    throw new PersistenceConflictError("request_id_reused", "requestId was already used with another payload");
  }
  if (attempt.outcome_code) {
    throw new PersistenceConflictError(
      attempt.outcome_code,
      "the previous rejected action was replayed",
      attempt.outcome_status ?? 409,
      attempt.retry_after_seconds ?? void 0
    );
  }
}
async function loadOperationAttempt(database, input) {
  return await database.prepare(`
    SELECT a.body_hash, a.outcome_code, a.outcome_status, a.retry_after_seconds
    FROM operation_attempts a JOIN rooms r ON r.id = a.room_id
    WHERE a.room_id = ? AND a.actor_id = ? AND a.operation = ? AND a.request_id = ?
      AND r.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
  `).bind(input.roomId, input.participantId, ACTION_OPERATION, input.requestId).first();
}
async function claimOperationAttempt(database, input) {
  const existing = await loadOperationAttempt(database, input);
  if (existing) {
    replayAttemptFailure(existing, input.bodyHash);
    return;
  }
  const claimed = await database.prepare(`
    INSERT INTO operation_attempts (
      room_id, actor_id, operation, request_id, body_hash,
      processed_at_ms, expires_at_ms
    )
    SELECT p.room_id, p.id, ?, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER), r.expires_at_ms
    FROM participants p JOIN rooms r ON r.id = p.room_id
    WHERE p.room_id = ? AND p.id = ?
      AND r.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND NOT EXISTS (
        SELECT 1 FROM operation_attempts duplicate
        WHERE duplicate.room_id = p.room_id AND duplicate.actor_id = p.id
          AND duplicate.operation = ? AND duplicate.request_id = ?
      )
      AND (
        SELECT COUNT(*) FROM operation_attempts recent
        WHERE recent.room_id = p.room_id AND recent.actor_id = p.id
          AND recent.operation = ?
          AND recent.processed_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER) - ?
      ) < ?
  `).bind(
    ACTION_OPERATION,
    input.requestId,
    input.bodyHash,
    input.roomId,
    input.participantId,
    ACTION_OPERATION,
    input.requestId,
    ACTION_OPERATION,
    ACTION_RATE_WINDOW_MS,
    ACTION_RATE_LIMIT
  ).run();
  if (changed(claimed)) return;
  const raced = await loadOperationAttempt(database, input);
  if (raced) {
    replayAttemptFailure(raced, input.bodyHash);
    return;
  }
  const rate = await database.prepare(`
    SELECT COUNT(*) AS recent_count, MIN(processed_at_ms) AS oldest_recent,
      CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms
    FROM operation_attempts
    WHERE room_id = ? AND actor_id = ? AND operation = ?
      AND processed_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER) - ?
  `).bind(input.roomId, input.participantId, ACTION_OPERATION, ACTION_RATE_WINDOW_MS).first();
  if (Number(rate?.recent_count ?? 0) >= ACTION_RATE_LIMIT) {
    const nowMs = rate?.database_now_ms ?? input.serverNowMs;
    const remainingMs = Math.max(1e3, (rate?.oldest_recent ?? nowMs) + ACTION_RATE_WINDOW_MS - nowMs);
    throw new PersistenceConflictError(
      "rate_limited",
      "participant action rate limit reached",
      429,
      Math.max(1, Math.ceil(remainingMs / 1e3))
    );
  }
  const room = await database.prepare(`
    SELECT expires_at_ms,
      CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms
    FROM rooms WHERE id = ?
  `).bind(input.roomId).first();
  if (room && room.expires_at_ms <= room.database_now_ms) {
    throw new PersistenceConflictError("expired", "room expired", 410);
  }
  throw new PersistenceConflictError("not_found", "participant or room not found", 404);
}
async function recordAttemptFailure(database, input, error) {
  await database.prepare(`
    UPDATE operation_attempts
    SET outcome_code = ?, outcome_status = ?, retry_after_seconds = ?
    WHERE room_id = ? AND actor_id = ? AND operation = ? AND request_id = ?
      AND body_hash = ? AND outcome_code IS NULL
  `).bind(
    error.code,
    error.status,
    error.retryAfterSeconds ?? null,
    input.roomId,
    input.participantId,
    ACTION_OPERATION,
    input.requestId,
    input.bodyHash
  ).run();
}
function scoreFromRows(rows) {
  const fields = Object.fromEntries(rows.map((field) => [field.field_id, {
    state: field.state,
    attemptCount: field.attempt_count,
    ...field.resolved_at_ms == null ? {} : { resolvedAtMs: field.resolved_at_ms }
  }]));
  return {
    fields,
    correctCount: Object.values(fields).filter((field) => field?.state === "correct").length,
    resolved: Object.values(fields).every((field) => field?.state === "correct" || field?.state === "passed")
  };
}
async function applyPlayerActionOnce(database, input) {
  const existing = await loadCommandReceipt(
    database,
    input.roomId,
    input.participantId,
    input.requestId,
    input.bodyHash
  );
  if (existing) return existing;
  const room = await database.prepare(
    "SELECT state, start_at_ms, deadline_at_ms, expires_at_ms FROM rooms WHERE id = ?"
  ).bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.serverNowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.start_at_ms == null || room.deadline_at_ms == null || input.serverNowMs < room.start_at_ms) {
    throw new PersistenceConflictError("invalid_state", "competition has not started");
  }
  if (input.serverNowMs >= room.deadline_at_ms) throw new PersistenceConflictError("deadline", "competition deadline reached");
  if (room.state !== "RUNNING" && room.state !== "COUNTDOWN") {
    throw new PersistenceConflictError("invalid_state", `cannot act in ${room.state}`);
  }
  const participant = await database.prepare(`
    SELECT revision, status, current_ordinal, correct_count, resolved_question_count,
      accepted_elapsed_ms, wait_credit_ms, last_action_request_id, elapsed_cs, timing_source
    FROM participants WHERE room_id = ? AND id = ?
  `).bind(input.roomId, input.participantId).first();
  if (!participant) throw new PersistenceConflictError("not_found", "participant not found", 404);
  if (participant.revision !== input.expectedParticipantRevision) {
    throw new PersistenceConflictError("stale_participant_revision", "participant revision is stale");
  }
  const question = await database.prepare(`
    SELECT question_id, ordinal, answer_snapshot_json FROM room_questions
    WHERE room_id = ? AND question_id = ?
  `).bind(input.roomId, input.questionId).first();
  if (!question || question.ordinal !== participant.current_ordinal) {
    throw new PersistenceConflictError("stale_participant_revision", "question is no longer current");
  }
  const { results: fieldRows } = await database.prepare(`
    SELECT field_id, state, resolved_at_ms, attempt_count FROM participant_fields
    WHERE room_id = ? AND participant_id = ? AND question_id = ? ORDER BY field_id
  `).bind(input.roomId, input.participantId, input.questionId).all();
  const before = scoreFromRows(fieldRows);
  if (!before.fields[input.action.fieldId] || before.fields[input.action.fieldId]?.state !== "pending") {
    throw new PersistenceConflictError("invalid_state", "answer field is already resolved");
  }
  const internalQuestion = JSON.parse(question.answer_snapshot_json);
  const evaluation = input.action.type === "answer" ? evaluateField(internalQuestion, input.action.fieldId, input.action.value) : null;
  const elapsed = acceptElapsed({
    clientElapsedMs: input.clientElapsedMs,
    serverNowMs: input.serverNowMs,
    startAtMs: room.start_at_ms,
    deadlineAtMs: room.deadline_at_ms,
    previousAcceptedElapsedMs: participant.accepted_elapsed_ms,
    previousTimingSource: participant.timing_source
  });
  if (!elapsed.accepted) throw new PersistenceConflictError(elapsed.reason === "deadline" ? "deadline" : "invalid_state", elapsed.reason);
  let addedWaitCreditMs = 0;
  if (input.waitCredit && participant.last_action_request_id === input.waitCredit.sourceRequestId) {
    const source = await database.prepare(`
      SELECT processed_at_ms FROM command_receipts
      WHERE room_id = ? AND actor_id = ? AND request_id = ? AND result_code = 'accepted'
    `).bind(input.roomId, input.participantId, input.waitCredit.sourceRequestId).first();
    if (source) addedWaitCreditMs = validateWaitCredit({
      waitMs: input.waitCredit.waitMs,
      sourceActionAtMs: participant.timing_source === "client" ? Math.min(source.processed_at_ms, room.start_at_ms + participant.accepted_elapsed_ms) : source.processed_at_ms,
      nextAcceptedAtMs: input.serverNowMs,
      previousRawElapsedMs: participant.accepted_elapsed_ms,
      nextRawElapsedMs: elapsed.acceptedElapsedMs
    });
  }
  const waitCreditMs = participant.wait_credit_ms + addedWaitCreditMs;
  const recordedElapsedCs = Math.max(participant.elapsed_cs, Math.floor((elapsed.acceptedElapsedMs - waitCreditMs) / 10));
  const after = input.action.type === "answer" ? applyFieldResult(before, input.action.fieldId, evaluation.correct, elapsed.acceptedElapsedMs) : applyPass(before, input.action.fieldId, elapsed.acceptedElapsedMs);
  const newlyResolved = !before.resolved && after.resolved;
  const nextOrdinal = participant.current_ordinal + (newlyResolved ? 1 : 0);
  const questionCountRow = await database.prepare("SELECT COUNT(*) AS count FROM room_questions WHERE room_id = ?").bind(input.roomId).first();
  const finished = newlyResolved && nextOrdinal >= Number(questionCountRow?.count ?? 0);
  const result = {
    code: "accepted",
    correct: evaluation?.correct ?? null,
    participantRevision: participant.revision + 1,
    correctCount: participant.correct_count + (after.correctCount - before.correctCount),
    resolvedQuestionCount: participant.resolved_question_count + (newlyResolved ? 1 : 0),
    currentOrdinal: nextOrdinal,
    finished,
    elapsedCs: recordedElapsedCs,
    rawElapsedMs: elapsed.acceptedElapsedMs,
    waitCreditMs,
    timingSource: elapsed.timingSource
  };
  const marker = commandMarker(input.participantId, input.requestId);
  const statements = [database.prepare(`
    UPDATE participants
    SET revision = revision + 1, last_command_id = ?, correct_count = ?,
      resolved_question_count = ?, current_ordinal = ?, status = ?, finished_at_ms = ?,
      accepted_elapsed_ms = ?, wait_credit_ms = ?, last_action_request_id = ?, elapsed_cs = ?, timing_source = ?
    WHERE room_id = ? AND id = ? AND revision = ? AND status = 'ACTIVE' AND current_ordinal = ?
      AND EXISTS (
        SELECT 1 FROM room_questions q
        WHERE q.room_id = participants.room_id AND q.question_id = ? AND q.ordinal = participants.current_ordinal
      )
      AND EXISTS (
        SELECT 1 FROM rooms r WHERE r.id = participants.room_id
          AND r.state IN ('COUNTDOWN', 'RUNNING')
          AND r.start_at_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
          AND r.deadline_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
          AND r.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
      AND NOT EXISTS (
        SELECT 1 FROM command_receipts c
        WHERE c.room_id = participants.room_id AND c.actor_id = participants.id AND c.request_id = ?
      )
  `).bind(
    marker,
    result.correctCount,
    result.resolvedQuestionCount,
    result.currentOrdinal,
    finished ? "FINISHED" : "ACTIVE",
    finished ? input.serverNowMs : null,
    elapsed.acceptedElapsedMs,
    waitCreditMs,
    input.requestId,
    recordedElapsedCs,
    elapsed.timingSource,
    input.roomId,
    input.participantId,
    input.expectedParticipantRevision,
    participant.current_ordinal,
    input.questionId,
    input.requestId
  )];
  for (const [fieldId, field] of Object.entries(after.fields)) {
    if (!field) continue;
    const submitted = input.action.type === "answer" && input.action.fieldId === fieldId;
    const answerJson = submitted ? json(input.action.value) : null;
    statements.push(database.prepare(`
      UPDATE participant_fields
      SET state = ?, attempt_count = ?, resolved_at_ms = ?, last_command_id = ?,
          last_answer_json = CASE WHEN ? = 1 THEN ? ELSE last_answer_json END,
          last_answer_correct = CASE WHEN ? = 1 THEN ? ELSE last_answer_correct END
      WHERE room_id = ? AND participant_id = ? AND question_id = ? AND field_id = ?
        AND EXISTS (
          SELECT 1 FROM participants p
          WHERE p.room_id = participant_fields.room_id AND p.id = participant_fields.participant_id
            AND p.last_command_id = ?
        )
    `).bind(
      field.state,
      field.attemptCount,
      field.resolvedAtMs ?? null,
      marker,
      submitted ? 1 : 0,
      answerJson,
      submitted ? 1 : 0,
      submitted ? evaluation.correct ? 1 : 0 : null,
      input.roomId,
      input.participantId,
      input.questionId,
      fieldId,
      marker
    ));
  }
  statements.push(database.prepare(`
    INSERT INTO command_receipts (
      room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
    )
    SELECT p.room_id, p.id, ?, ?, 'accepted', ?, ?, r.expires_at_ms
    FROM participants p JOIN rooms r ON r.id = p.room_id
    WHERE p.room_id = ? AND p.id = ? AND p.last_command_id = ?
  `).bind(
    input.requestId,
    input.bodyHash,
    json(result),
    input.serverNowMs,
    input.roomId,
    input.participantId,
    marker
  ));
  const batch = await database.batch(statements);
  if (changed(batch[0])) return result;
  const raced = await loadCommandReceipt(
    database,
    input.roomId,
    input.participantId,
    input.requestId,
    input.bodyHash
  );
  if (raced) return raced;
  const latestRoom = await database.prepare(`
    SELECT state, deadline_at_ms, expires_at_ms,
      CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms
    FROM rooms WHERE id = ?
  `).bind(input.roomId).first();
  if (!latestRoom || latestRoom.expires_at_ms <= latestRoom.database_now_ms) throw new PersistenceConflictError("expired", "room expired", 410);
  if (latestRoom.database_now_ms >= latestRoom.deadline_at_ms) throw new PersistenceConflictError("deadline", "competition deadline reached");
  throw new PersistenceConflictError("stale_participant_revision", "participant changed while applying the action");
}
async function applyPlayerAction(database, input) {
  const existing = await loadCommandReceipt(
    database,
    input.roomId,
    input.participantId,
    input.requestId,
    input.bodyHash
  );
  if (existing) return existing;
  await claimOperationAttempt(database, input);
  const retryStartedAt = performance.now();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const serverNowMs = attempt === 1 ? input.serverNowMs : input.retryServerNowMs?.(attempt) ?? input.serverNowMs + Math.max(0, Math.ceil(performance.now() - retryStartedAt));
    try {
      return await applyPlayerActionOnce(database, { ...input, serverNowMs });
    } catch (error) {
      if (error instanceof PersistenceConflictError) {
        const committed = await loadCommandReceipt(
          database,
          input.roomId,
          input.participantId,
          input.requestId,
          input.bodyHash
        );
        if (committed) return committed;
        await recordAttemptFailure(database, input, error);
        throw error;
      }
      if (!isRetryableDatabaseConflict(error)) throw error;
      const stored = await loadCommandReceipt(
        database,
        input.roomId,
        input.participantId,
        input.requestId,
        input.bodyHash
      );
      if (stored) return stored;
      if (attempt === 3) {
        throw new PersistenceConflictError(
          "database_conflict",
          "database conflict; retry with the same requestId",
          503
        );
      }
    }
  }
  throw new PersistenceConflictError("database_conflict", "database conflict", 503);
}

// src/persistence/cleanup.ts
async function cleanupExpired(database, input) {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new TypeError("cleanup limit must be a positive integer");
  const { results: expiredRooms } = await database.prepare(`
    SELECT id FROM rooms WHERE expires_at_ms <= ? ORDER BY expires_at_ms, id LIMIT ?
  `).bind(input.nowMs, input.limit).all();
  const { results: expiredSiteSettingReceipts } = await database.prepare(`
    SELECT teacher_id, request_id FROM site_setting_receipts
    WHERE expires_at_ms <= ? ORDER BY expires_at_ms, teacher_id, request_id LIMIT ?
  `).bind(input.nowMs, input.limit).all();
  if (!expiredRooms.length && !expiredSiteSettingReceipts.length) {
    return { deletedRooms: 0, deletedSiteSettingReceipts: 0 };
  }
  const roomStatements = expiredRooms.map(({ id }) => database.prepare(
    "DELETE FROM rooms WHERE id = ? AND expires_at_ms <= ?"
  ).bind(id, input.nowMs));
  const siteSettingReceiptStatements = expiredSiteSettingReceipts.map(({ teacher_id: teacherId, request_id: requestId2 }) => database.prepare(`
      DELETE FROM site_setting_receipts
      WHERE teacher_id = ? AND request_id = ? AND expires_at_ms <= ?
    `).bind(teacherId, requestId2, input.nowMs));
  const deleted = await database.batch([...roomStatements, ...siteSettingReceiptStatements]);
  return {
    deletedRooms: deleted.slice(0, roomStatements.length).reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
    deletedSiteSettingReceipts: deleted.slice(roomStatements.length).reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0)
  };
}

// src/persistence/participants.ts
async function renameParticipant(database, input) {
  const actorId = `rename:${input.participantId}`;
  const existing = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (existing) return existing;
  const result = { nickname: input.nickname, revision: input.expectedParticipantRevision + 1 };
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE participants SET nickname = ?, nickname_key = ?, revision = revision + 1, last_command_id = ?
    WHERE room_id = ? AND id = ? AND revision = ? AND status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = participants.room_id AND r.state = 'WAITING'
        AND r.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        AND NOT EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = r.id AND m.state != 'WAITING'))
      AND NOT EXISTS (SELECT 1 FROM command_receipts c WHERE c.room_id = participants.room_id
        AND c.actor_id = ? AND c.request_id = ?)
  `).bind(
    input.nickname,
    input.nicknameKey,
    marker,
    input.roomId,
    input.participantId,
    input.expectedParticipantRevision,
    actorId,
    input.requestId
  ), database.prepare(`
    INSERT INTO command_receipts (room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms)
    SELECT p.room_id, ?, ?, ?, 'renamed', ?, ?, r.expires_at_ms
    FROM participants p JOIN rooms r ON r.id = p.room_id
    WHERE p.room_id = ? AND p.id = ? AND p.last_command_id = ?
  `).bind(
    actorId,
    input.requestId,
    input.bodyHash,
    json(result),
    input.nowMs,
    input.roomId,
    input.participantId,
    marker
  )];
  try {
    const batch = await database.batch(statements);
    if (changed(batch[0])) return result;
  } catch (error) {
    const committed = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (committed) return committed;
    throw error;
  }
  const raced = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (raced) return raced;
  throw new PersistenceConflictError("invalid_state", "room started or participant state changed");
}
async function loadJoinReceipt(database, input) {
  const receipt2 = await loadCommandReceipt(
    database,
    input.roomId,
    `join:${input.tokenHash}`,
    input.requestId,
    input.bodyHash
  );
  if (!receipt2) return null;
  const participant = await database.prepare(
    "SELECT status FROM participants WHERE room_id = ? AND id = ? AND token_hash = ?"
  ).bind(input.roomId, receipt2.participantId, input.tokenHash).first();
  if (!participant || participant.status === "REMOVED") {
    throw new PersistenceConflictError("not_authorized", "removed participant credentials cannot rejoin", 403);
  }
  return receipt2;
}
async function joinRoom(database, input) {
  const actorId = `join:${input.tokenHash}`;
  const existing = await loadJoinReceipt(database, input);
  if (existing) return existing;
  const room = await database.prepare("SELECT kind FROM rooms WHERE id = ?").bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  const capacity = room.kind === "class" ? PUBLIC_CONFIG.participantLimits.classCompetition : PUBLIC_CONFIG.participantLimits.mateMatch;
  const marker = commandMarker(actorId, input.requestId);
  const statements = [
    database.prepare(`
      UPDATE rooms
      SET revision = revision + 1, last_command_id = ?
      WHERE id = ? AND state = 'WAITING' AND expires_at_ms > ?
        AND NOT EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state != 'WAITING')
        AND (SELECT COUNT(*) FROM participants WHERE room_id = rooms.id AND status != 'REMOVED') < ?
        AND NOT EXISTS (
          SELECT 1 FROM command_receipts
          WHERE room_id = rooms.id AND actor_id = ? AND request_id = ?
        )
    `).bind(marker, input.roomId, input.nowMs, capacity, actorId, input.requestId),
    database.prepare(`
      INSERT INTO participants (
        room_id, id, token_hash, nickname, nickname_key, joined_at_ms, joined_order
      )
      SELECT r.id, ?, ?, ?, ?, ?,
        (SELECT COUNT(*) + 1 FROM participants WHERE room_id = r.id)
      FROM rooms r WHERE r.id = ? AND r.last_command_id = ?
    `).bind(
      input.participantId,
      input.tokenHash,
      input.nickname,
      input.nicknameKey,
      input.nowMs,
      input.roomId,
      marker
    ),
    database.prepare(`
      INSERT INTO command_receipts (
        room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
      )
      SELECT r.id, ?, ?, ?, 'joined',
        json_object(
          'roomId', r.id,
          'participantId', p.id,
          'joinedOrder', p.joined_order,
          'participantRevision', p.revision
        ), ?, r.expires_at_ms
      FROM rooms r JOIN participants p ON p.room_id = r.id AND p.id = ?
      WHERE r.id = ? AND r.last_command_id = ?
    `).bind(actorId, input.requestId, input.bodyHash, input.nowMs, input.participantId, input.roomId, marker)
  ];
  try {
    const batch = await database.batch(statements);
    if (changed(batch[0])) {
      const stored = await loadJoinReceipt(database, input);
      if (stored) return stored;
    }
  } catch (error) {
    const raced2 = await loadJoinReceipt(database, input);
    if (raced2) return raced2;
    throw error;
  }
  const raced = await loadJoinReceipt(database, input);
  if (raced) return raced;
  const latest = await database.prepare(`
    SELECT state, expires_at_ms,
      (SELECT COUNT(*) FROM participants WHERE room_id = rooms.id AND status != 'REMOVED') AS participant_count
    FROM rooms WHERE id = ?
  `).bind(input.roomId).first();
  if (!latest) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (latest.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (latest.state !== "WAITING") throw new PersistenceConflictError("invalid_state", "room is no longer accepting participants");
  if (latest.participant_count >= capacity) throw new PersistenceConflictError("capacity", "room capacity reached");
  throw new PersistenceConflictError("stale_room_revision", "room changed while joining");
}
async function removeParticipant(database, input) {
  const actorId = `remove:${input.actorId}`;
  const existing = await loadCommandReceipt(
    database,
    input.roomId,
    actorId,
    input.requestId,
    input.bodyHash
  );
  if (existing) return existing;
  const result = {
    participantId: input.targetParticipantId,
    participantStatus: "REMOVED",
    participantRevision: input.expectedParticipantRevision + 1,
    roomRevision: input.expectedRoomRevision + 1
  };
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE rooms
    SET revision = revision + 1, last_command_id = ?
    WHERE id = ? AND revision = ? AND state = 'WAITING'
      AND NOT EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state != 'WAITING')
      AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND (mate_host_id IS NULL OR mate_host_id != ?)
      AND EXISTS (
        SELECT 1 FROM participants p
        WHERE p.room_id = rooms.id AND p.id = ? AND p.status != 'REMOVED' AND p.revision = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM command_receipts
        WHERE room_id = rooms.id AND actor_id = ? AND request_id = ?
      )
  `).bind(
    marker,
    input.roomId,
    input.expectedRoomRevision,
    input.targetParticipantId,
    input.targetParticipantId,
    input.expectedParticipantRevision,
    actorId,
    input.requestId
  ), database.prepare(`
    UPDATE participants
    SET status = 'REMOVED', revision = revision + 1, last_command_id = ?
    WHERE room_id = ? AND id = ? AND revision = ? AND status != 'REMOVED'
      AND EXISTS (
        SELECT 1 FROM rooms r WHERE r.id = participants.room_id AND r.last_command_id = ?
      )
  `).bind(
    marker,
    input.roomId,
    input.targetParticipantId,
    input.expectedParticipantRevision,
    marker
  ), database.prepare(`
    INSERT INTO command_receipts (
      room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
    )
    SELECT r.id, ?, ?, ?, 'participant_removed', ?, ?, r.expires_at_ms
    FROM rooms r JOIN participants p ON p.room_id = r.id AND p.id = ?
    WHERE r.id = ? AND r.last_command_id = ? AND p.last_command_id = ?
  `).bind(
    actorId,
    input.requestId,
    input.bodyHash,
    json(result),
    input.nowMs,
    input.targetParticipantId,
    input.roomId,
    marker,
    marker
  )];
  try {
    const batch = await database.batch(statements);
    if (changed(batch[0])) return result;
  } catch (error) {
    const committed = await loadCommandReceipt(
      database,
      input.roomId,
      actorId,
      input.requestId,
      input.bodyHash
    );
    if (committed) return committed;
    throw error;
  }
  const raced = await loadCommandReceipt(
    database,
    input.roomId,
    actorId,
    input.requestId,
    input.bodyHash
  );
  if (raced) return raced;
  const latest = await database.prepare(`
    SELECT r.state, r.revision, r.expires_at_ms, r.mate_host_id,
      CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms,
      p.status AS participant_status, p.revision AS participant_revision
    FROM rooms r LEFT JOIN participants p ON p.room_id = r.id AND p.id = ?
    WHERE r.id = ?
  `).bind(input.targetParticipantId, input.roomId).first();
  if (!latest) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (latest.expires_at_ms <= latest.database_now_ms) {
    throw new PersistenceConflictError("expired", "room expired", 410);
  }
  if (latest.state !== "WAITING") {
    throw new PersistenceConflictError("invalid_state", `cannot remove a participant in ${latest.state}`);
  }
  if (latest.mate_host_id === input.targetParticipantId) {
    throw new PersistenceConflictError("not_authorized", "the mate host cannot be removed", 403);
  }
  if (latest.participant_status === null || latest.participant_status === "REMOVED") {
    throw new PersistenceConflictError("participant_not_found", "participant not found", 404);
  }
  if (latest.revision !== input.expectedRoomRevision) {
    throw new PersistenceConflictError("stale_room_revision", "room revision is stale");
  }
  if (latest.participant_revision !== input.expectedParticipantRevision) {
    throw new PersistenceConflictError("stale_participant_revision", "participant revision is stale");
  }
  throw new PersistenceConflictError("database_conflict", "participant removal did not commit");
}

// src/persistence/results.ts
async function finalizeRoom(database, input) {
  const actorId = `finalize:${input.roomId}`;
  const existing = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (existing) return existing;
  const room = await database.prepare(
    "SELECT state, revision, start_at_ms, deadline_at_ms, expires_at_ms FROM rooms WHERE id = ?"
  ).bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.state === "FINISHED") throw new PersistenceConflictError("invalid_state", "room was finalized by another command");
  if (room.state !== "COUNTDOWN" && room.state !== "RUNNING") {
    throw new PersistenceConflictError("invalid_state", `cannot finalize ${room.state}`);
  }
  if (room.start_at_ms == null || room.deadline_at_ms == null) throw new PersistenceConflictError("invalid_state", "room has no schedule");
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE rooms SET
      state = 'FINISHED',
      revision = revision + 1,
      ended_at_ms = CASE
        WHEN NOT EXISTS (SELECT 1 FROM participants p WHERE p.room_id = rooms.id AND p.status = 'ACTIVE')
          THEN COALESCE((SELECT MAX(p.finished_at_ms) FROM participants p WHERE p.room_id = rooms.id AND p.status = 'FINISHED'), deadline_at_ms)
        ELSE deadline_at_ms
      END,
      expires_at_ms = (CASE
        WHEN NOT EXISTS (SELECT 1 FROM participants p WHERE p.room_id = rooms.id AND p.status = 'ACTIVE')
          THEN COALESCE((SELECT MAX(p.finished_at_ms) FROM participants p WHERE p.room_id = rooms.id AND p.status = 'FINISHED'), deadline_at_ms)
        ELSE deadline_at_ms
      END) + CASE kind WHEN 'class' THEN ? ELSE ? END,
      last_command_id = ?
    WHERE id = ? AND revision = ? AND state IN ('COUNTDOWN', 'RUNNING')
      AND (
        deadline_at_ms <= ?
        OR (
          EXISTS (SELECT 1 FROM participants p WHERE p.room_id = rooms.id AND p.status != 'REMOVED')
          AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.room_id = rooms.id AND p.status = 'ACTIVE')
        )
      )
      AND expires_at_ms > ?
  `).bind(
    PUBLIC_CONFIG.retentionMs.classCompetition,
    PUBLIC_CONFIG.retentionMs.mateMatch,
    marker,
    input.roomId,
    room.revision,
    input.nowMs,
    input.nowMs
  )];
  statements.push(database.prepare(`
    UPDATE creation_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE command_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO final_results (
      room_id, participant_id, correct_count, elapsed_cs, rank, finish_reason
    )
    SELECT room_id, participant_id, correct_count, effective_elapsed_cs,
      RANK() OVER (ORDER BY correct_count DESC, effective_elapsed_cs ASC), finish_reason
    FROM (
      SELECT p.room_id, p.id AS participant_id, p.correct_count,
        CASE WHEN p.status = 'FINISHED' THEN p.elapsed_cs
          ELSE CAST((r.deadline_at_ms - r.start_at_ms) / 10 AS INTEGER) END AS effective_elapsed_cs,
        CASE WHEN p.status = 'FINISHED' THEN 'completed' ELSE 'timeout' END AS finish_reason,
        p.joined_order
      FROM participants p JOIN rooms r ON r.id = p.room_id
      WHERE p.room_id = ? AND p.status != 'REMOVED' AND r.last_command_id = ?
    ) frozen
    ORDER BY correct_count DESC, effective_elapsed_cs ASC, joined_order ASC
  `).bind(input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE participant_fields SET state = 'unanswered', last_command_id = ?
    WHERE room_id = ? AND state = 'pending'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = participant_fields.room_id AND r.last_command_id = ?)
  `).bind(marker, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE participants
    SET status = 'FINISHED', finished_at_ms = COALESCE(finished_at_ms, (SELECT ended_at_ms FROM rooms WHERE id = ?)),
      accepted_elapsed_ms = CASE WHEN status = 'ACTIVE' THEN (SELECT deadline_at_ms - start_at_ms FROM rooms WHERE id = ?) ELSE accepted_elapsed_ms END,
      elapsed_cs = CASE WHEN status = 'ACTIVE' THEN (SELECT CAST((deadline_at_ms - start_at_ms) / 10 AS INTEGER) FROM rooms WHERE id = ?) ELSE elapsed_cs END,
      timing_source = CASE WHEN status = 'ACTIVE' THEN 'timeout' ELSE timing_source END
    WHERE room_id = ? AND status != 'REMOVED'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = participants.room_id AND r.last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO command_receipts (
      room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
    )
    SELECT id, ?, ?, ?, 'finalized',
      json_object(
        'roomId', id,
        'state', 'FINISHED',
        'endedAtMs', ended_at_ms,
        'participantCount', (SELECT COUNT(*) FROM participants p WHERE p.room_id = rooms.id AND p.status != 'REMOVED')
      ), ?, expires_at_ms FROM rooms
    WHERE id = ? AND last_command_id = ?
  `).bind(actorId, input.requestId, input.bodyHash, input.nowMs, input.roomId, marker));
  let batch;
  try {
    batch = await database.batch(statements);
  } catch (error) {
    const committed = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (committed) return committed;
    throw error;
  }
  if (changed(batch[0])) {
    const stored = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (stored) return stored;
  }
  const raced = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (raced) return raced;
  throw new PersistenceConflictError("stale_room_revision", "room changed while finalizing");
}
async function interruptRoom(database, input) {
  const actorId = `room:${input.roomId}`;
  const existing = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (existing) return existing;
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE rooms SET state = 'FINISHED', revision = revision + 1, end_reason = 'interrupted',
      ended_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER),
      expires_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER) + ?, last_command_id = ?
    WHERE id = ? AND kind = 'class' AND revision = ? AND state IN ('COUNTDOWN', 'RUNNING')
      AND start_at_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND deadline_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND EXISTS (SELECT 1 FROM participants p WHERE p.room_id = rooms.id AND p.status = 'ACTIVE')
  `).bind(PUBLIC_CONFIG.retentionMs.classCompetition, marker, input.roomId, input.expectedRoomRevision)];
  statements.push(database.prepare(`
    UPDATE creation_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE command_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO final_results (room_id, participant_id, correct_count, elapsed_cs, rank, finish_reason)
    SELECT room_id, participant_id, correct_count, effective_elapsed_cs,
      RANK() OVER (ORDER BY correct_count DESC, effective_elapsed_cs ASC), finish_reason
    FROM (
      SELECT p.room_id, p.id AS participant_id, p.correct_count,
        CASE WHEN p.status = 'FINISHED' THEN p.elapsed_cs
          ELSE CAST((r.ended_at_ms - r.start_at_ms) / 10 AS INTEGER) END AS effective_elapsed_cs,
        CASE WHEN p.status = 'FINISHED' THEN 'completed' ELSE 'interrupted' END AS finish_reason,
        p.joined_order
      FROM participants p JOIN rooms r ON r.id = p.room_id
      WHERE p.room_id = ? AND p.status != 'REMOVED' AND r.last_command_id = ?
    ) frozen ORDER BY correct_count DESC, effective_elapsed_cs ASC, joined_order ASC
  `).bind(input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE participant_fields SET state = 'unanswered', last_command_id = ?
    WHERE room_id = ? AND state = 'pending'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = participant_fields.room_id AND r.last_command_id = ?)
  `).bind(marker, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE participants SET status = 'FINISHED', revision = revision + CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END,
      finished_at_ms = COALESCE(finished_at_ms, (SELECT ended_at_ms FROM rooms WHERE id = ?)),
      accepted_elapsed_ms = CASE WHEN status = 'ACTIVE' THEN (SELECT ended_at_ms - start_at_ms FROM rooms WHERE id = ?) ELSE accepted_elapsed_ms END,
      elapsed_cs = CASE WHEN status = 'ACTIVE' THEN (SELECT CAST((ended_at_ms - start_at_ms) / 10 AS INTEGER) FROM rooms WHERE id = ?) ELSE elapsed_cs END,
      timing_source = CASE WHEN status = 'ACTIVE' THEN 'timeout' ELSE timing_source END
    WHERE room_id = ? AND status != 'REMOVED'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = participants.room_id AND r.last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO command_receipts (room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms)
    SELECT id, ?, ?, ?, 'interrupted',
      json_object('state', 'FINISHED', 'roomRevision', revision, 'endedAtMs', ended_at_ms),
      ended_at_ms, expires_at_ms FROM rooms WHERE id = ? AND last_command_id = ?
  `).bind(actorId, input.requestId, input.bodyHash, input.roomId, marker));
  let batch;
  try {
    batch = await database.batch(statements);
  } catch (error) {
    const committed = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (committed) return committed;
    throw error;
  }
  if (changed(batch[0])) {
    const stored = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (stored) return stored;
  }
  const raced = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (raced) return raced;
  const room = await database.prepare("SELECT state, revision, expires_at_ms FROM rooms WHERE id = ?").bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.revision !== input.expectedRoomRevision) throw new PersistenceConflictError("stale_room_revision", "room revision is stale");
  throw new PersistenceConflictError("invalid_state", `cannot interrupt ${room.state}`);
}
async function loadAuthorizedResult(database, input) {
  const result = await database.prepare(`
    SELECT f.participant_id, f.correct_count, f.elapsed_cs, f.rank, f.finish_reason,
      CASE WHEN f.finish_reason = 'completed' THEN p.wait_credit_ms ELSE 0 END AS wait_credit_ms,
      p.timing_source
    FROM final_results f
    JOIN participants p ON p.room_id = f.room_id AND p.id = f.participant_id
    JOIN rooms r ON r.id = f.room_id
    WHERE f.room_id = ? AND f.participant_id = ? AND p.token_hash = ?
      AND r.state = 'FINISHED' AND r.expires_at_ms > ?
  `).bind(input.roomId, input.participantId, input.tokenHash, input.nowMs).first();
  if (!result) {
    const room = await database.prepare("SELECT expires_at_ms FROM rooms WHERE id = ?").bind(input.roomId).first();
    if (room && room.expires_at_ms <= input.nowMs) {
      throw new PersistenceConflictError("expired", "room expired", 410);
    }
    throw new PersistenceConflictError("not_authorized", "result is unavailable", 403);
  }
  return {
    participantId: result.participant_id,
    correctCount: result.correct_count,
    elapsedCs: result.elapsed_cs,
    waitCreditMs: result.wait_credit_ms,
    timingSource: result.timing_source,
    rank: result.rank,
    finishReason: result.finish_reason
  };
}

// src/persistence/rooms.ts
var MATE_CREATION_LIMIT = 3;
var MATE_CREATION_WINDOW_MS = 10 * 60 * 1e3;
async function loadCreationReceipt(database, input) {
  const receipt2 = await database.prepare(
    `SELECT c.body_hash, c.result_json, c.expires_at_ms,
       CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms
     FROM creation_receipts c JOIN rooms r ON r.id = c.room_id
     WHERE c.actor_key_hash = ? AND c.request_id = ?`
  ).bind(input.actorKeyHash, input.requestId).first();
  if (!receipt2) return null;
  if (receipt2.expires_at_ms <= receipt2.database_now_ms) {
    throw new PersistenceConflictError("expired", "creation receipt expired", 410);
  }
  if (receipt2.body_hash !== input.bodyHash) {
    throw new PersistenceConflictError("request_id_reused", "requestId was already used with another payload");
  }
  return JSON.parse(receipt2.result_json);
}
async function createRoom(database, input) {
  const existing = await loadCreationReceipt(database, input);
  if (existing) return existing;
  if (input.kind === "mate" && !input.host) throw new TypeError("mate rooms require a host participant");
  if (input.kind === "class" && input.host) throw new TypeError("class rooms cannot have a mate host");
  const mateSettingBefore = input.kind === "mate" ? await database.prepare("SELECT mate_match_enabled, revision FROM site_settings WHERE id = 1").first() : null;
  const result = {
    roomId: input.roomId,
    publicId: input.publicId,
    joinCode: input.joinCode,
    kind: input.kind,
    state: "WAITING",
    revision: 0,
    ...input.host ? {
      hostParticipant: {
        id: input.host.participantId,
        nickname: input.host.nickname,
        revision: 0
      }
    } : {}
  };
  const marker = commandMarker(input.actorKeyHash, input.requestId);
  const statements = [
    database.prepare(`
      INSERT INTO rooms (
        id, public_id, join_code, kind, owner_teacher_id, mate_host_id, settings_json,
        game_id, game_version, dataset_version, state, revision, max_score,
        created_at_ms, expires_at_ms, last_command_id
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING', 0, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM creation_receipts WHERE actor_key_hash = ? AND request_id = ?
      )
        AND (
          ? != 'mate'
          OR (
            COALESCE((SELECT mate_match_enabled FROM site_settings WHERE id = 1), 1) = 1
            AND
            NOT EXISTS (
              SELECT 1 FROM creation_receipts active_receipt
              JOIN rooms active_room ON active_room.id = active_receipt.room_id
              WHERE active_receipt.actor_key_hash = ? AND active_room.kind = 'mate'
                AND active_room.state NOT IN ('FINISHED', 'CANCELLED', 'EXPIRED')
                AND active_room.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
            )
            AND (
              SELECT COUNT(*) FROM creation_receipts recent_receipt
              JOIN rooms recent_room ON recent_room.id = recent_receipt.room_id
              WHERE recent_receipt.actor_key_hash = ? AND recent_room.kind = 'mate'
                AND recent_receipt.processed_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER) - ?
            ) < ?
          )
        )
    `).bind(
      input.roomId,
      input.publicId,
      input.joinCode,
      input.kind,
      input.ownerTeacherId,
      input.host?.participantId ?? null,
      json(input.settings),
      input.gameId,
      input.gameVersion,
      input.datasetVersion,
      input.maxScore,
      input.nowMs,
      input.expiresAtMs,
      marker,
      input.actorKeyHash,
      input.requestId,
      input.kind,
      input.actorKeyHash,
      input.actorKeyHash,
      MATE_CREATION_WINDOW_MS,
      MATE_CREATION_LIMIT
    )
  ];
  if (input.questionProfile) {
    statements.push(database.prepare(`INSERT INTO room_question_profiles (room_id, profile_json, profile_revision)
      SELECT id, ?, ? FROM rooms WHERE id = ? AND last_command_id = ?`).bind(
      json(input.questionProfile.profile),
      input.questionProfile.revision,
      input.roomId,
      marker
    ));
  }
  if (input.host) {
    statements.push(database.prepare(`
      INSERT INTO participants (
        room_id, id, token_hash, nickname, nickname_key, joined_at_ms, joined_order
      )
      SELECT id, ?, ?, ?, ?, ?, 1 FROM rooms
      WHERE id = ? AND last_command_id = ?
    `).bind(
      input.host.participantId,
      input.host.tokenHash,
      input.host.nickname,
      input.host.nicknameKey,
      input.nowMs,
      input.roomId,
      marker
    ));
  }
  statements.push(database.prepare(`
    INSERT INTO creation_receipts (
      actor_key_hash, request_id, body_hash, room_id, result_json, processed_at_ms, expires_at_ms
    )
    SELECT ?, ?, ?, id, ?, ?, expires_at_ms FROM rooms
    WHERE id = ? AND last_command_id = ?
  `).bind(
    input.actorKeyHash,
    input.requestId,
    input.bodyHash,
    json(result),
    input.nowMs,
    input.roomId,
    marker
  ));
  try {
    await database.batch(statements);
  } catch (error) {
    const raced = await loadCreationReceipt(database, input);
    if (raced) return raced;
    throw error;
  }
  const stored = await loadCreationReceipt(database, input);
  if (!stored && input.kind === "mate") {
    const siteSettings = await database.prepare(
      "SELECT mate_match_enabled, revision FROM site_settings WHERE id = 1"
    ).first();
    if (siteSettings?.mate_match_enabled === 0) {
      throw new PersistenceConflictError("mate_disabled", "mate match creation is disabled", 403);
    }
    const limits = await database.prepare(`
      SELECT
        EXISTS (
          SELECT 1 FROM creation_receipts active_receipt
          JOIN rooms active_room ON active_room.id = active_receipt.room_id
          WHERE active_receipt.actor_key_hash = ? AND active_room.kind = 'mate'
            AND active_room.state NOT IN ('FINISHED', 'CANCELLED', 'EXPIRED')
            AND active_room.expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        ) AS has_active,
        COUNT(CASE WHEN recent_receipt.processed_at_ms >
          CAST(unixepoch('subsec') * 1000 AS INTEGER) - ? THEN 1 END) AS recent_count,
        MIN(CASE WHEN recent_receipt.processed_at_ms >
          CAST(unixepoch('subsec') * 1000 AS INTEGER) - ? THEN recent_receipt.processed_at_ms END) AS oldest_recent,
        CAST(unixepoch('subsec') * 1000 AS INTEGER) AS database_now_ms
      FROM creation_receipts recent_receipt
      JOIN rooms recent_room ON recent_room.id = recent_receipt.room_id
      WHERE recent_receipt.actor_key_hash = ? AND recent_room.kind = 'mate'
    `).bind(
      input.actorKeyHash,
      MATE_CREATION_WINDOW_MS,
      MATE_CREATION_WINDOW_MS,
      input.actorKeyHash
    ).first();
    if (limits?.has_active) {
      throw new PersistenceConflictError("active_room_exists", "creation credential already has an unfinished room");
    }
    if (Number(limits?.recent_count ?? 0) >= MATE_CREATION_LIMIT) {
      const remainingMs = Math.max(
        1e3,
        (limits?.oldest_recent ?? limits?.database_now_ms ?? input.nowMs) + MATE_CREATION_WINDOW_MS - (limits?.database_now_ms ?? input.nowMs)
      );
      throw new PersistenceConflictError(
        "rate_limited",
        "mate room creation rate limit reached",
        429,
        Math.max(1, Math.ceil(remainingMs / 1e3))
      );
    }
    const settingRevisionBefore = mateSettingBefore?.revision ?? 0;
    const settingRevisionAfter = siteSettings?.revision ?? 0;
    if (settingRevisionAfter !== settingRevisionBefore) {
      throw new PersistenceConflictError("mate_disabled", "mate match creation was disabled during this request", 403);
    }
  }
  if (!stored) throw new PersistenceConflictError("invalid_state", "room creation did not commit");
  return stored;
}
async function cancelRoom(database, input) {
  const actorId = `room:${input.roomId}`;
  const existing = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (existing) return existing;
  const result = { state: "CANCELLED", roomRevision: input.expectedRoomRevision + 1 };
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE rooms SET state = 'CANCELLED', revision = revision + 1, ended_at_ms = ?,
      expires_at_ms = ? + ?, last_command_id = ?
    WHERE id = ? AND revision = ? AND state = 'WAITING' AND expires_at_ms > ?
      AND NOT EXISTS (SELECT 1 FROM command_receipts WHERE room_id = rooms.id AND actor_id = ? AND request_id = ?)
  `).bind(
    input.nowMs,
    input.nowMs,
    PUBLIC_CONFIG.retentionMs.cancelledRoom,
    marker,
    input.roomId,
    input.expectedRoomRevision,
    input.nowMs,
    actorId,
    input.requestId
  )];
  statements.push(database.prepare(`
    UPDATE creation_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE command_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO command_receipts (room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms)
    SELECT id, ?, ?, ?, 'cancelled', ?, ?, expires_at_ms FROM rooms WHERE id = ? AND last_command_id = ?
  `).bind(actorId, input.requestId, input.bodyHash, json(result), input.nowMs, input.roomId, marker));
  let batch;
  try {
    batch = await database.batch(statements);
  } catch (error) {
    const committed = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (committed) return committed;
    throw error;
  }
  if (changed(batch[0])) return result;
  const raced = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (raced) return raced;
  const room = await database.prepare("SELECT state, revision, expires_at_ms FROM rooms WHERE id = ?").bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.revision !== input.expectedRoomRevision) throw new PersistenceConflictError("stale_room_revision", "room revision is stale");
  throw new PersistenceConflictError("invalid_state", `cannot cancel a room in ${room.state}`);
}
async function startRoom(database, input) {
  const actorId = `room:${input.roomId}`;
  const existing = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (existing) return existing;
  if (!input.questions.length) throw new TypeError("a room needs at least one question");
  if (input.startAtMs <= input.nowMs || input.deadlineAtMs <= input.startAtMs) throw new TypeError("invalid room schedule");
  const marker = commandMarker(actorId, input.requestId);
  const result = {
    roomId: input.roomId,
    state: "COUNTDOWN",
    roomRevision: input.expectedRoomRevision + 1,
    startAtMs: input.startAtMs,
    deadlineAtMs: input.deadlineAtMs,
    questionIds: input.questions.map((question) => question.id)
  };
  const statements = [database.prepare(`
    UPDATE rooms
    SET state = 'COUNTDOWN', revision = revision + 1, start_at_ms = ?, deadline_at_ms = ?,
      expires_at_ms = MAX(expires_at_ms, ? + CASE kind WHEN 'class' THEN ? ELSE ? END),
      last_command_id = ?
    WHERE id = ? AND revision = ? AND state = 'WAITING' AND expires_at_ms > ?
      AND (SELECT COUNT(*) FROM participants p WHERE p.room_id = rooms.id AND p.status != 'REMOVED')
        >= CASE rooms.kind WHEN 'class' THEN 1 ELSE 2 END
      AND NOT EXISTS (
        SELECT 1 FROM command_receipts
        WHERE room_id = rooms.id AND actor_id = ? AND request_id = ?
      )
  `).bind(
    input.startAtMs,
    input.deadlineAtMs,
    input.deadlineAtMs,
    PUBLIC_CONFIG.retentionMs.classCompetition,
    PUBLIC_CONFIG.retentionMs.mateMatch,
    marker,
    input.roomId,
    input.expectedRoomRevision,
    input.nowMs,
    actorId,
    input.requestId
  )];
  statements.push(database.prepare(`
    UPDATE creation_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  statements.push(database.prepare(`
    UPDATE command_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)
  `).bind(input.roomId, input.roomId, input.roomId, marker));
  for (const question of input.questions) {
    statements.push(database.prepare(`
      INSERT INTO room_questions (
        room_id, question_id, ordinal, public_payload_json, answer_snapshot_json, field_spec_json, max_score
      )
      SELECT id, ?, ?, ?, ?, ?, ? FROM rooms
      WHERE id = ? AND last_command_id = ?
    `).bind(
      question.id,
      question.ordinal,
      json(toPublicQuestion(question, { resolvedFieldIds: [] })),
      json(question),
      json(question.fields),
      question.maxScore,
      input.roomId,
      marker
    ));
  }
  statements.push(database.prepare(`
    INSERT INTO participant_fields (room_id, participant_id, question_id, field_id)
    SELECT p.room_id, p.id, q.question_id, json_extract(field.value, '$.id')
    FROM participants p
    JOIN rooms r ON r.id = p.room_id
    JOIN room_questions q ON q.room_id = p.room_id
    JOIN json_each(q.field_spec_json) AS field
    WHERE p.room_id = ? AND p.status = 'ACTIVE' AND r.last_command_id = ?
  `).bind(input.roomId, marker));
  statements.push(database.prepare(`
    INSERT INTO command_receipts (
      room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
    )
    SELECT id, ?, ?, ?, 'started', ?, ?, expires_at_ms FROM rooms
    WHERE id = ? AND last_command_id = ?
  `).bind(actorId, input.requestId, input.bodyHash, json(result), input.nowMs, input.roomId, marker));
  let batch;
  try {
    batch = await database.batch(statements);
  } catch (error) {
    const committed = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
    if (committed) return committed;
    throw error;
  }
  if (changed(batch[0])) return result;
  const raced = await loadCommandReceipt(database, input.roomId, actorId, input.requestId, input.bodyHash);
  if (raced) return raced;
  const room = await database.prepare("SELECT state, revision, expires_at_ms FROM rooms WHERE id = ?").bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.revision !== input.expectedRoomRevision) throw new PersistenceConflictError("stale_room_revision", "room revision is stale");
  throw new PersistenceConflictError("invalid_state", `cannot start a room in ${room.state}`);
}

// src/persistence/settings.ts
async function updateRoomSettingsCommand(database, input) {
  const actorId = `settings:${input.actorId}`;
  const existing = await loadCommandReceipt(
    database,
    input.roomId,
    actorId,
    input.requestId,
    input.bodyHash
  );
  if (existing) return existing;
  const result = {
    revision: input.expectedRevision + 1,
    settings: input.settings,
    maxScore: input.maxScore
  };
  const marker = commandMarker(actorId, input.requestId);
  const statements = [database.prepare(`
    UPDATE rooms SET settings_json = ?, dataset_version = ?, max_score = ?, revision = revision + 1, last_command_id = ?
    WHERE id = ? AND state = 'WAITING' AND revision = ?
      AND NOT EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state != 'WAITING')
      AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND NOT EXISTS (
        SELECT 1 FROM command_receipts
        WHERE room_id = rooms.id AND actor_id = ? AND request_id = ?
      )
  `).bind(
    json(input.settings),
    input.settings.chemistryContentVersion ?? CHEMISTRY_CONTENT_VERSION,
    input.maxScore,
    marker,
    input.roomId,
    input.expectedRevision,
    actorId,
    input.requestId
  )];
  statements.push(database.prepare(`
    INSERT INTO command_receipts (
      room_id, actor_id, request_id, body_hash, result_code, result_json, processed_at_ms, expires_at_ms
    )
    SELECT id, ?, ?, ?, 'settings_updated', ?, ?, expires_at_ms
    FROM rooms WHERE id = ? AND last_command_id = ?
  `).bind(
    actorId,
    input.requestId,
    input.bodyHash,
    json(result),
    input.nowMs,
    input.roomId,
    marker
  ));
  try {
    const batch = await database.batch(statements);
    if (changed(batch[0])) return result;
  } catch (error) {
    const committed = await loadCommandReceipt(
      database,
      input.roomId,
      actorId,
      input.requestId,
      input.bodyHash
    );
    if (committed) return committed;
    throw error;
  }
  const raced = await loadCommandReceipt(
    database,
    input.roomId,
    actorId,
    input.requestId,
    input.bodyHash
  );
  if (raced) return raced;
  throw new PersistenceConflictError("stale_room_revision", "room settings changed");
}
var SITE_SETTING_RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1e3;
async function loadSiteSettingReceipt(database, teacherId, requestId2, bodyHash2) {
  const receipt2 = await database.prepare(`
    SELECT body_hash, result_json FROM site_setting_receipts
    WHERE teacher_id = ? AND request_id = ?
      AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)
  `).bind(teacherId, requestId2).first();
  if (!receipt2) return null;
  if (receipt2.body_hash !== bodyHash2) {
    throw new PersistenceConflictError("request_id_reused", "requestId was already used with another payload");
  }
  return JSON.parse(receipt2.result_json);
}
async function updateSiteSettingsCommand(database, input) {
  const existing = await loadSiteSettingReceipt(
    database,
    input.teacherId,
    input.requestId,
    input.bodyHash
  );
  if (existing) return existing;
  const result = { enabled: input.enabled, revision: input.expectedRevision + 1 };
  const marker = commandMarker(`site-settings:${input.teacherId}`, input.requestId);
  const statements = [database.prepare(`
    DELETE FROM site_setting_receipts
    WHERE teacher_id = ? AND request_id = ?
      AND expires_at_ms <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
  `).bind(input.teacherId, input.requestId), database.prepare(`
    INSERT INTO site_settings (id, mate_match_enabled, revision, updated_at_ms)
    VALUES (1, 1, 0, 0) ON CONFLICT(id) DO NOTHING
  `), database.prepare(`
    UPDATE site_settings
    SET mate_match_enabled = ?, revision = revision + 1, updated_at_ms = ?, last_command_id = ?
    WHERE id = 1 AND revision = ?
      AND NOT EXISTS (
        SELECT 1 FROM site_setting_receipts WHERE teacher_id = ? AND request_id = ?
      )
  `).bind(
    input.enabled ? 1 : 0,
    input.nowMs,
    marker,
    input.expectedRevision,
    input.teacherId,
    input.requestId
  ), database.prepare(`
    INSERT INTO site_setting_receipts (
      teacher_id, request_id, body_hash, result_json, processed_at_ms, expires_at_ms
    )
    SELECT ?, ?, ?, ?, ?, ? FROM site_settings WHERE id = 1 AND last_command_id = ?
  `).bind(
    input.teacherId,
    input.requestId,
    input.bodyHash,
    json(result),
    input.nowMs,
    input.nowMs + SITE_SETTING_RECEIPT_RETENTION_MS,
    marker
  )];
  try {
    const batch = await database.batch(statements);
    if (changed(batch[2])) return result;
  } catch (error) {
    const committed = await loadSiteSettingReceipt(
      database,
      input.teacherId,
      input.requestId,
      input.bodyHash
    );
    if (committed) return committed;
    throw error;
  }
  const raced = await loadSiteSettingReceipt(
    database,
    input.teacherId,
    input.requestId,
    input.bodyHash
  );
  if (raced) return raced;
  throw new PersistenceConflictError("stale_room_revision", "site settings changed");
}

// src/persistence/v2-manifest.ts
async function prepareV2Room(db, input) {
  const actor = `v2-prepare:${input.roomId}`;
  const receipt2 = await loadCommandReceipt(db, input.roomId, actor, input.requestId, input.bodyHash);
  if (receipt2) return receipt2;
  const room = await db.prepare("SELECT state, revision, expires_at_ms, settings_json, start_at_ms, deadline_at_ms FROM rooms WHERE id = ?").bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.state !== "WAITING" || room.revision !== input.expectedRoomRevision) throw new PersistenceConflictError("invalid_state", "room is not waiting at the expected revision");
  if (!input.questions.length || input.questions.some((question, index) => question.ordinal !== index)) throw new TypeError("invalid question order");
  const settings = JSON.parse(room.settings_json);
  if (settings.gradingMode !== input.gradingMode || settings.questionCount !== input.questions.length) throw new TypeError("settings and manifest differ");
  const existing = await db.prepare("SELECT *, state AS v2_state FROM v2_room_manifests WHERE room_id = ?").bind(input.roomId).first();
  if (existing && existing.v2_state !== "WAITING") throw new PersistenceConflictError("invalid_state", "previous preparation is still active");
  const reuseQuestions = !!existing && existing.settings_json === room.settings_json;
  const manifestId = reuseQuestions ? existing.manifest_id : input.manifestId;
  const generation = existing ? existing.preparation_generation + 1 : 1;
  const response = { state: "PREPARING", manifestId, preparationGeneration: generation, roomRevision: room.revision + 1 };
  const marker = commandMarker(actor, input.requestId);
  const statements = [db.prepare(`UPDATE rooms SET revision = revision + 1, last_command_id = ?
    WHERE id = ? AND state = 'WAITING' AND revision = ? AND expires_at_ms > ?
      AND (SELECT COUNT(*) FROM participants p WHERE p.room_id = rooms.id AND p.status = 'ACTIVE') >= CASE kind WHEN 'class' THEN 1 ELSE 2 END`).bind(marker, input.roomId, input.expectedRoomRevision, input.nowMs)];
  if (existing) {
    statements.push(db.prepare(`UPDATE v2_room_manifests SET state = 'PREPARING', manifest_id = ?, evaluator_version = ?, grading_mode = ?,
      settings_revision = ?, settings_json = ?, preparation_generation = ?, prepared_at_ms = ?, collecting_at_ms = NULL,
      cutoff_at_ms = NULL, collection_until_ms = NULL, finalized_at_ms = NULL
      WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(
      manifestId,
      input.evaluatorVersion,
      input.gradingMode,
      room.revision,
      room.settings_json,
      generation,
      input.nowMs,
      input.roomId,
      input.roomId,
      marker
    ));
  } else {
    statements.push(db.prepare(`INSERT INTO v2_room_manifests(room_id, state, manifest_id, evaluator_version, grading_mode, settings_revision,
      settings_json, preparation_generation, prepared_at_ms) SELECT id, 'PREPARING', ?, ?, ?, ?, settings_json, 1, ? FROM rooms WHERE id = ? AND last_command_id = ?`).bind(manifestId, input.evaluatorVersion, input.gradingMode, room.revision, input.nowMs, input.roomId, marker));
  }
  if (!reuseQuestions) {
    if (existing) statements.push(db.prepare(`DELETE FROM room_questions WHERE room_id = ?
      AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, input.roomId, marker));
    for (const question of input.questions) statements.push(db.prepare(`INSERT INTO room_questions
      (room_id, question_id, ordinal, public_payload_json, answer_snapshot_json, field_spec_json, max_score)
      SELECT id, ?, ?, ?, ?, ?, ? FROM rooms WHERE id = ? AND last_command_id = ?`).bind(
      question.id,
      question.ordinal,
      json(toPublicQuestion(question, { resolvedFieldIds: [] })),
      json(question),
      json(question.fields),
      question.maxScore,
      input.roomId,
      marker
    ));
  }
  statements.push(db.prepare(`INSERT OR IGNORE INTO v2_participant_progress(room_id, participant_id)
    SELECT p.room_id, p.id FROM participants p JOIN rooms r ON r.id = p.room_id
    WHERE p.room_id = ? AND p.status = 'ACTIVE' AND r.last_command_id = ?`).bind(input.roomId, marker));
  statements.push(db.prepare(`INSERT INTO command_receipts(room_id, actor_id, request_id, body_hash, result_code,
    result_json, processed_at_ms, expires_at_ms) SELECT id, ?, ?, ?, 'prepared', ?, ?, expires_at_ms
    FROM rooms WHERE id = ? AND last_command_id = ?`).bind(actor, input.requestId, input.bodyHash, json(response), input.nowMs, input.roomId, marker));
  try {
    const result = await db.batch(statements);
    if (changed(result[0])) return response;
  } catch (error) {
    const raced2 = await loadCommandReceipt(db, input.roomId, actor, input.requestId, input.bodyHash);
    if (raced2) return raced2;
    throw error;
  }
  const raced = await loadCommandReceipt(db, input.roomId, actor, input.requestId, input.bodyHash);
  if (raced) return raced;
  throw new PersistenceConflictError("invalid_state", "room preparation did not commit");
}
async function loadV2Manifest(db, roomId, participantId) {
  const row = await db.prepare(`SELECT m.manifest_id, m.evaluator_version, m.grading_mode, m.preparation_generation, m.state, p.status
    FROM v2_room_manifests m JOIN rooms r ON r.id = m.room_id
    JOIN participants p ON p.room_id = m.room_id AND p.id = ? WHERE m.room_id = ?`).bind(participantId, roomId).first();
  if (!row || row.status === "REMOVED") throw new PersistenceConflictError("not_authorized", "participant cannot read manifest", 403);
  if (!["PREPARING", "COUNTDOWN", "RUNNING", "COLLECTING"].includes(row.state)) throw new PersistenceConflictError("invalid_state", "manifest is unavailable");
  const questionRows = await db.prepare("SELECT public_payload_json, answer_snapshot_json FROM room_questions WHERE room_id = ? ORDER BY ordinal").bind(roomId).all();
  return {
    manifestId: row.manifest_id,
    evaluatorVersion: row.evaluator_version,
    gradingMode: row.grading_mode,
    preparationGeneration: row.preparation_generation,
    questions: questionRows.results.map((question) => JSON.parse(row.grading_mode === "immediate" ? question.answer_snapshot_json : question.public_payload_json))
  };
}
async function markV2Ready(db, input) {
  const room = await db.prepare(`SELECT m.state, r.start_at_ms, r.deadline_at_ms, r.expires_at_ms, r.settings_json,
      m.manifest_id, m.evaluator_version, m.preparation_generation, m.prepared_at_ms
    FROM rooms r JOIN v2_room_manifests m ON m.room_id = r.id WHERE r.id = ?`).bind(input.roomId).first();
  if (!room) throw new PersistenceConflictError("not_found", "room not found", 404);
  if (room.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (room.manifest_id !== input.manifestId || room.evaluator_version !== input.evaluatorVersion || room.preparation_generation !== input.preparationGeneration) throw new PersistenceConflictError("invalid_state", "stale preparation generation");
  if (room.state !== "PREPARING" && room.state !== "COUNTDOWN" && room.state !== "RUNNING") throw new PersistenceConflictError("invalid_state", "room is not preparing");
  await db.prepare(`UPDATE v2_participant_progress SET ready_generation = ? WHERE room_id = ? AND participant_id = ?
    AND EXISTS (SELECT 1 FROM participants p WHERE p.room_id = ? AND p.id = ? AND p.status = 'ACTIVE')`).bind(input.preparationGeneration, input.roomId, input.participantId, input.roomId, input.participantId).run();
  const counts = await db.prepare(`SELECT COUNT(*) AS participant_count,
    SUM(CASE WHEN v.ready_generation = ? THEN 1 ELSE 0 END) AS ready_count
    FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
    WHERE p.room_id = ? AND p.status = 'ACTIVE'`).bind(input.preparationGeneration, input.roomId).first();
  const participantCount = Number(counts?.participant_count ?? 0);
  const readyCount = Number(counts?.ready_count ?? 0);
  if (participantCount && readyCount === participantCount && room.state === "PREPARING" && input.nowMs < room.prepared_at_ms + 3e4) {
    const startAtMs = input.nowMs + PUBLIC_CONFIG.countdownSeconds * 1e3;
    const timeLimit = JSON.parse(room.settings_json).timeLimitMinutes * 6e4;
    const marker = commandMarker("v2-ready", `${input.roomId}:${input.preparationGeneration}`);
    await db.batch([
      db.prepare(`UPDATE rooms SET state = 'COUNTDOWN', revision = revision + 1,
      start_at_ms = ?, deadline_at_ms = ?, expires_at_ms = MAX(expires_at_ms, ? + CASE kind WHEN 'class' THEN ? ELSE ? END), last_command_id = ?
      WHERE id = ? AND state = 'WAITING' AND EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id
        AND m.state = 'PREPARING' AND m.preparation_generation = ? AND ? < m.prepared_at_ms + 30000) AND NOT EXISTS (
        SELECT 1 FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
        WHERE p.room_id = rooms.id AND p.status = 'ACTIVE' AND COALESCE(v.ready_generation, 0) != ?)`).bind(
        startAtMs,
        startAtMs + timeLimit,
        startAtMs + timeLimit,
        PUBLIC_CONFIG.retentionMs.classCompetition,
        PUBLIC_CONFIG.retentionMs.mateMatch,
        marker,
        input.roomId,
        input.preparationGeneration,
        input.nowMs,
        input.preparationGeneration
      ),
      db.prepare(`UPDATE v2_room_manifests SET state = 'COUNTDOWN' WHERE room_id = ?
      AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, input.roomId, marker),
      db.prepare(`UPDATE creation_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
      WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, input.roomId, input.roomId, marker),
      db.prepare(`UPDATE command_receipts SET expires_at_ms = (SELECT expires_at_ms FROM rooms WHERE id = ?)
      WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, input.roomId, input.roomId, marker)
    ]);
  }
  const latest = await db.prepare(`SELECT m.state, r.start_at_ms, r.deadline_at_ms
    FROM rooms r JOIN v2_room_manifests m ON m.room_id = r.id WHERE r.id = ?`).bind(input.roomId).first();
  return {
    state: latest?.state ?? room.state,
    readyCount,
    participantCount,
    startAtMs: latest?.start_at_ms ?? null,
    deadlineAtMs: latest?.deadline_at_ms ?? null,
    preparationTimedOut: room.state === "PREPARING" && input.nowMs >= room.prepared_at_ms + 3e4
  };
}
async function cancelV2Preparation(db, input) {
  const marker = commandMarker("v2-cancel", input.roomId);
  const results = await db.batch([
    db.prepare(`UPDATE rooms SET revision = revision + 1, last_command_id = ? WHERE id = ? AND state = 'WAITING'
    AND revision = ? AND expires_at_ms > ? AND EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state = 'PREPARING')`).bind(marker, input.roomId, input.expectedRoomRevision, input.nowMs),
    db.prepare(`UPDATE v2_room_manifests SET state = 'WAITING' WHERE room_id = ? AND EXISTS
    (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, input.roomId, marker)
  ]);
  const result = results[0];
  if (!changed(result)) throw new PersistenceConflictError("invalid_state", "preparation could not be cancelled");
  return { state: "WAITING", roomRevision: input.expectedRoomRevision + 1 };
}
async function loadV2RoomPhase(db, roomId, nowMs) {
  const row = await db.prepare(`SELECT m.state, m.manifest_id, m.grading_mode, m.evaluator_version,
    m.preparation_generation, m.prepared_at_ms, m.cutoff_at_ms, m.collection_until_ms, m.finalized_at_ms,
    r.start_at_ms, r.deadline_at_ms, r.revision, r.end_reason
    FROM v2_room_manifests m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ?`).bind(roomId).first();
  if (!row) return null;
  const state = row.state === "COUNTDOWN" && row.start_at_ms != null && nowMs >= row.start_at_ms ? "RUNNING" : row.state;
  return {
    state,
    manifestId: row.manifest_id,
    gradingMode: row.grading_mode,
    evaluatorVersion: row.evaluator_version,
    preparationGeneration: row.preparation_generation,
    preparationTimedOut: row.state === "PREPARING" && nowMs >= row.prepared_at_ms + 3e4,
    startAtMs: row.start_at_ms,
    deadlineAtMs: row.deadline_at_ms,
    cutoffAtMs: row.cutoff_at_ms ?? row.deadline_at_ms,
    collectionUntilMs: row.collection_until_ms ?? (row.deadline_at_ms == null ? null : row.deadline_at_ms + 1e4),
    finalizedAtMs: row.finalized_at_ms,
    roomRevision: row.revision,
    endReason: row.end_reason
  };
}

// src/features/play/answer-content.ts
function answerHasContent(value) {
  if (typeof value === "string") {
    try {
      return answerHasContent(JSON.parse(value));
    } catch {
      return value.trim().length > 0;
    }
  }
  if (!value || typeof value !== "object") return false;
  if ("grid" in value) {
    const grid = value.grid;
    return Array.isArray(grid) && grid.some((row) => Array.isArray(row) && row.some((cell) => cell != null));
  }
  if ("tokens" in value) {
    const tokens = value.tokens;
    return Array.isArray(tokens) && tokens.some((token) => typeof token === "string" && token.trim().length > 0);
  }
  return false;
}

// src/competition-core/v2-operations.ts
function fieldKey(questionId, fieldId) {
  return `${questionId}:${fieldId}`;
}
function replayV2Operations(questions, gradingMode, operations, startAtMs, cutoffAtMs, interruption = false, gradeDeferred = true) {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const fields = {};
  let finishedElapsedMs = null;
  let finishReason = null;
  let boundaryAcknowledged = false;
  let previousElapsed = -1;
  let currentOrdinal = 0;
  for (const operation of operations) {
    if (!Number.isSafeInteger(operation.seq) || operation.seq < 1 || !Number.isFinite(operation.elapsedMs) || operation.elapsedMs < previousElapsed) throw new TypeError("invalid operation order");
    previousElapsed = operation.elapsedMs;
    if (operation.type === "finish") {
      if (finishedElapsedMs !== null) throw new TypeError("duplicate finish");
      if (operation.reason === "completed" && gradingMode !== "immediate") throw new TypeError("completed finish requires immediate mode");
      if (operation.reason === "completed" && currentOrdinal !== questions.length && startAtMs + operation.elapsedMs < cutoffAtMs)
        throw new TypeError("questions are not complete");
      if (operation.reason === "timeout" || operation.reason === "interrupted") {
        if (operation.boundaryAtMs === cutoffAtMs) boundaryAcknowledged = true;
      }
      if (operation.reason === "submitted" && startAtMs + operation.elapsedMs < cutoffAtMs) {
        finishedElapsedMs = operation.elapsedMs;
        finishReason = "submitted";
      } else if (operation.reason === "completed" && startAtMs + operation.elapsedMs < cutoffAtMs) {
        finishedElapsedMs = operation.elapsedMs;
        finishReason = "completed";
      }
      continue;
    }
    if (finishedElapsedMs !== null) {
      if (startAtMs + operation.elapsedMs < cutoffAtMs) throw new TypeError("operation after finish");
      continue;
    }
    const question = questionById.get(operation.questionId ?? "");
    if (!question || !operation.fieldId || !question.fields.some((field) => field.id === operation.fieldId)) throw new TypeError("invalid question or field");
    if ((operation.type === "answer" || operation.type === "draft") && !validateAlkaneAnswer(operation.value, question.prompt)) throw new TypeError("invalid alkane answer");
    const fieldId = operation.fieldId;
    const key2 = fieldKey(question.id, fieldId);
    const previous = fields[key2];
    const eventAtMs = startAtMs + operation.elapsedMs;
    const editAtMs = startAtMs + (operation.editedElapsedMs ?? operation.elapsedMs);
    const beforeCutoff = eventAtMs < cutoffAtMs || !interruption && operation.type === "draft" && eventAtMs === cutoffAtMs && editAtMs < cutoffAtMs;
    if (!beforeCutoff) continue;
    if (gradingMode === "immediate") {
      if (operation.type === "draft" || question.ordinal > currentOrdinal || question.ordinal < currentOrdinal && previous?.state !== "passed") throw new TypeError("invalid immediate operation");
      if (previous?.state === "correct" || operation.type === "pass" && previous?.state === "passed") throw new TypeError("field already resolved");
      if (operation.type === "pass") {
        fields[key2] = { state: "passed", value: previous?.value ?? null, editedElapsedMs: operation.elapsedMs };
      } else {
        const evaluation = evaluateField(question, fieldId, operation.value);
        fields[key2] = {
          state: evaluation.correct ? "correct" : previous?.state === "passed" ? "passed" : "unanswered",
          value: operation.value,
          editedElapsedMs: operation.elapsedMs
        };
      }
      if (question.ordinal === currentOrdinal && question.fields.every((field) => ["correct", "passed"].includes(fields[fieldKey(question.id, field.id)]?.state ?? ""))) {
        currentOrdinal += 1;
      }
    } else {
      if (operation.type !== "draft") throw new TypeError("invalid deferred operation");
      if (!Number.isFinite(operation.editedElapsedMs ?? operation.elapsedMs) || (operation.editedElapsedMs ?? operation.elapsedMs) > operation.elapsedMs || editAtMs >= cutoffAtMs) continue;
      fields[key2] = {
        state: answerHasContent(operation.value) ? "incorrect" : "unanswered",
        value: operation.value,
        editedElapsedMs: operation.editedElapsedMs ?? operation.elapsedMs
      };
    }
  }
  if (gradingMode === "deferred" && gradeDeferred) {
    for (const question of questions) for (const field of question.fields) {
      const key2 = fieldKey(question.id, field.id);
      const current = fields[key2];
      if (!current || current.state === "unanswered") continue;
      fields[key2] = { ...current, state: evaluateField(question, field.id, current.value).correct ? "correct" : "incorrect" };
    }
  }
  const correctCount = Object.values(fields).filter((field) => field.state === "correct").length;
  const answeredCount = Object.values(fields).filter((field) => answerHasContent(field.value)).length;
  const resolvedQuestionCount = gradingMode === "immediate" ? currentOrdinal : 0;
  return {
    fields,
    correctCount,
    answeredCount,
    resolvedQuestionCount,
    finishedElapsedMs,
    finishReason,
    boundaryAcknowledged
  };
}

// src/persistence/v2-operations.ts
function bodyHash(input) {
  return json({
    writerEpoch: input.writerEpoch,
    manifestId: input.manifestId,
    evaluatorVersion: input.evaluatorVersion,
    operations: input.operations
  });
}
async function receipt(db, input, hash) {
  const row = await db.prepare(`SELECT body_hash, response_json FROM v2_batch_receipts
    WHERE room_id = ? AND participant_id = ? AND request_id = ?`).bind(input.roomId, input.participantId, input.requestId).first();
  if (!row) return null;
  if (row.body_hash !== hash) throw new PersistenceConflictError("request_id_reused", "requestId was reused with different operations");
  return JSON.parse(row.response_json);
}
function validateBatch(input, previousSeq, previousElapsed) {
  if (!input.requestId || input.requestId.length > 128 || !Number.isSafeInteger(input.writerEpoch) || input.writerEpoch < 0) throw new TypeError("invalid batch identity");
  if (!input.operations.length || input.operations.length > 128 || json(input.operations).length > 128 * 1024) throw new TypeError("invalid batch size");
  let elapsed = previousElapsed;
  for (const [index, operation] of input.operations.entries()) {
    if (operation.seq !== previousSeq + index + 1 || !operation.operationId || operation.operationId.length > 128) {
      throw new PersistenceConflictError("stale_participant_revision", `expected sequence ${previousSeq + 1}`);
    }
    if (!Number.isSafeInteger(operation.elapsedMs) || operation.elapsedMs < elapsed) throw new TypeError("operation time must be nonnegative and monotonic");
    elapsed = operation.elapsedMs;
    if (!["answer", "pass", "draft", "finish"].includes(operation.type)) throw new TypeError("invalid operation type");
    if (operation.value !== void 0 && json(operation.value).length > 4096) throw new TypeError("answer too long");
    if (operation.type === "finish" && !["completed", "submitted", "timeout", "interrupted"].includes(operation.reason ?? "")) throw new TypeError("invalid finish reason");
  }
}
async function applyV2Operations(db, input) {
  const hash = bodyHash(input);
  const priorReceipt = await receipt(db, input, hash);
  if (priorReceipt) return priorReceipt;
  const context = await db.prepare(`SELECT r.state, r.start_at_ms, r.deadline_at_ms, r.expires_at_ms, r.end_reason,
    m.manifest_id, m.evaluator_version, m.grading_mode, m.cutoff_at_ms, m.collection_until_ms,
    p.status, v.writer_epoch, v.ack_seq, v.accepted_seq, v.last_elapsed_ms
    FROM rooms r JOIN v2_room_manifests m ON m.room_id = r.id
    JOIN participants p ON p.room_id = r.id AND p.id = ?
    JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
    WHERE r.id = ?`).bind(input.participantId, input.roomId).first();
  if (!context || context.status === "REMOVED") throw new PersistenceConflictError("not_authorized", "participant cannot save operations", 403);
  if (context.expires_at_ms <= input.nowMs) throw new PersistenceConflictError("expired", "room expired", 410);
  if (context.manifest_id !== input.manifestId || context.evaluator_version !== input.evaluatorVersion) {
    throw new PersistenceConflictError("invalid_state", "manifest or evaluator version differs");
  }
  if (context.writer_epoch !== input.writerEpoch) throw new PersistenceConflictError("stale_participant_revision", "writer epoch is stale");
  if (context.start_at_ms == null || context.deadline_at_ms == null || input.nowMs < context.start_at_ms) throw new PersistenceConflictError("invalid_state", "competition has not started");
  if (!["COUNTDOWN", "RUNNING", "COLLECTING"].includes(context.state)) throw new PersistenceConflictError("invalid_state", "competition is not accepting records");
  const cutoffAtMs = context.cutoff_at_ms ?? context.deadline_at_ms;
  const collectionUntilMs = context.collection_until_ms ?? cutoffAtMs + 1e4;
  if (input.nowMs >= collectionUntilMs) throw new PersistenceConflictError("deadline", "record collection has ended");
  validateBatch(input, context.ack_seq, context.last_elapsed_ms);
  const questions = (await db.prepare(`SELECT answer_snapshot_json FROM room_questions WHERE room_id = ? ORDER BY ordinal`).bind(input.roomId).all()).results.map((row) => JSON.parse(row.answer_snapshot_json));
  const previousOps = (await db.prepare(`SELECT payload_json FROM v2_operations WHERE room_id = ? AND participant_id = ? ORDER BY seq`).bind(input.roomId, input.participantId).all()).results.map((row) => JSON.parse(row.payload_json));
  const allOps = [...previousOps, ...input.operations];
  const interruption = context.end_reason === "interrupted";
  for (const operation of input.operations) {
    if (context.start_at_ms + operation.elapsedMs > input.nowMs + 250) {
      console.warn(JSON.stringify({ event: "operation_clock_rejected", type: operation.type, aheadByMs: context.start_at_ms + operation.elapsedMs - input.nowMs }));
      throw new TypeError("operation time is in the future");
    }
    if (operation.type === "finish" && operation.reason === "interrupted" && !interruption) throw new TypeError("unexpected interruption finish");
    if (context.grading_mode === "immediate" && operation.type === "draft") throw new TypeError("draft is not valid in immediate mode");
    if (context.grading_mode === "deferred" && ["answer", "pass"].includes(operation.type)) throw new TypeError("answer or pass is not valid in deferred mode");
  }
  const replay = replayV2Operations(questions, context.grading_mode, allOps, context.start_at_ms, cutoffAtMs, interruption, false);
  const ackSeq = input.operations.at(-1).seq;
  let acceptedSeq = context.accepted_seq;
  for (const operation of input.operations) {
    const at = context.start_at_ms + operation.elapsedMs;
    const valid = at < cutoffAtMs || !interruption && operation.type === "draft" && at === cutoffAtMs && context.start_at_ms + (operation.editedElapsedMs ?? operation.elapsedMs) < cutoffAtMs;
    if (valid) acceptedSeq = operation.seq;
  }
  const response = {
    ackSeq,
    acceptedSeq,
    roomState: context.state,
    cutoffAtMs,
    collectionUntilMs,
    correctCount: context.grading_mode === "immediate" ? replay.correctCount : 0,
    answeredCount: replay.answeredCount,
    resolvedQuestionCount: replay.resolvedQuestionCount
  };
  const marker = commandMarker(input.participantId, input.requestId);
  const statements = [db.prepare(`UPDATE v2_participant_progress SET ack_seq = ?, accepted_seq = ?, last_elapsed_ms = ?,
      answered_count = ?, finished_elapsed_ms = ?, finish_reason = ?, boundary_ack_at_ms = CASE WHEN ? THEN ? ELSE boundary_ack_at_ms END,
      last_sync_at_ms = ?, last_command_id = ?
    WHERE room_id = ? AND participant_id = ? AND writer_epoch = ? AND ack_seq = ?
      AND EXISTS (SELECT 1 FROM rooms r JOIN v2_room_manifests m ON m.room_id = r.id
        WHERE r.id = ? AND r.state IN ('COUNTDOWN', 'RUNNING', 'COLLECTING')
          AND ? < COALESCE(m.collection_until_ms, r.deadline_at_ms + 10000))`).bind(
    ackSeq,
    acceptedSeq,
    input.operations.at(-1).elapsedMs,
    replay.answeredCount,
    replay.finishedElapsedMs,
    replay.finishReason,
    replay.boundaryAcknowledged ? 1 : 0,
    replay.boundaryAcknowledged ? input.nowMs : null,
    input.nowMs,
    marker,
    input.roomId,
    input.participantId,
    input.writerEpoch,
    context.ack_seq,
    input.roomId,
    input.nowMs
  )];
  for (const operation of input.operations) statements.push(db.prepare(`INSERT INTO v2_operations
    (room_id, participant_id, seq, operation_id, payload_json, elapsed_ms, accepted_for_score, received_at_ms)
    SELECT room_id, participant_id, ?, ?, ?, ?, ?, ? FROM v2_participant_progress
    WHERE room_id = ? AND participant_id = ? AND last_command_id = ?`).bind(
    operation.seq,
    operation.operationId,
    json(operation),
    operation.elapsedMs,
    operation.seq <= acceptedSeq ? 1 : 0,
    input.nowMs,
    input.roomId,
    input.participantId,
    marker
  ));
  statements.push(db.prepare(`UPDATE participants SET correct_count = ?, resolved_question_count = ?,
    current_ordinal = ?, accepted_elapsed_ms = ?, wait_credit_ms = 0, revision = revision + 1
    WHERE room_id = ? AND id = ? AND EXISTS (SELECT 1 FROM v2_participant_progress v
      WHERE v.room_id = participants.room_id AND v.participant_id = participants.id AND v.last_command_id = ?)`).bind(
    context.grading_mode === "immediate" ? replay.correctCount : 0,
    replay.resolvedQuestionCount,
    replay.resolvedQuestionCount,
    input.operations.at(-1).elapsedMs,
    input.roomId,
    input.participantId,
    marker
  ));
  statements.push(db.prepare(`UPDATE rooms SET revision = revision + 1 WHERE id = ?
    AND EXISTS (SELECT 1 FROM v2_participant_progress v WHERE v.room_id = rooms.id
      AND v.participant_id = ? AND v.last_command_id = ?)`).bind(input.roomId, input.participantId, marker));
  statements.push(db.prepare(`INSERT INTO v2_batch_receipts(room_id, participant_id, request_id, body_hash, response_json, processed_at_ms)
    SELECT room_id, participant_id, ?, ?, ?, ? FROM v2_participant_progress
    WHERE room_id = ? AND participant_id = ? AND last_command_id = ?`).bind(
    input.requestId,
    hash,
    json(response),
    input.nowMs,
    input.roomId,
    input.participantId,
    marker
  ));
  try {
    const result = await db.batch(statements);
    if (changed(result[0])) return response;
  } catch (error) {
    const raced2 = await receipt(db, input, hash);
    if (raced2) return raced2;
    throw error;
  }
  const raced = await receipt(db, input, hash);
  if (raced) return raced;
  throw new PersistenceConflictError("stale_participant_revision", "operation sequence or writer changed");
}
async function takeOverV2Writer(db, roomId, participantId, expectedEpoch) {
  const result = await db.prepare(`UPDATE v2_participant_progress SET writer_epoch = writer_epoch + 1
    WHERE room_id = ? AND participant_id = ? AND writer_epoch = ?
      AND EXISTS (SELECT 1 FROM participants p WHERE p.room_id = ? AND p.id = ? AND p.status = 'ACTIVE')`).bind(roomId, participantId, expectedEpoch, roomId, participantId).run();
  if (!changed(result)) throw new PersistenceConflictError("stale_participant_revision", "writer epoch changed");
  return { writerEpoch: expectedEpoch + 1 };
}

// src/persistence/v2-results.ts
async function loadRoom(db, roomId) {
  return db.prepare(`SELECT r.state, r.revision, r.kind, r.start_at_ms, r.deadline_at_ms, r.expires_at_ms,
    r.end_reason, m.state AS phase_state, m.grading_mode, m.cutoff_at_ms, m.collection_until_ms, m.finalized_at_ms
    FROM rooms r JOIN v2_room_manifests m ON m.room_id = r.id WHERE r.id = ?`).bind(roomId).first();
}
async function collectV2Room(db, input) {
  const room = await loadRoom(db, input.roomId);
  if (!room) throw new PersistenceConflictError("not_found", "v2 room not found", 404);
  if (room.phase_state === "FINISHED") return { state: "FINISHED", cutoffAtMs: room.cutoff_at_ms ?? room.deadline_at_ms, collectionUntilMs: room.collection_until_ms ?? room.deadline_at_ms + 1e4 };
  if (room.phase_state === "COLLECTING") return { state: "COLLECTING", cutoffAtMs: room.cutoff_at_ms, collectionUntilMs: room.collection_until_ms };
  if (room.phase_state !== "COUNTDOWN" || room.start_at_ms == null || room.deadline_at_ms == null) {
    throw new PersistenceConflictError("invalid_state", "room has not started");
  }
  if (!input.interrupted && input.nowMs < room.deadline_at_ms) throw new PersistenceConflictError("invalid_state", "deadline has not arrived");
  const cutoffAtMs = input.interrupted ? Math.min(input.nowMs, room.deadline_at_ms) : room.deadline_at_ms;
  const marker = commandMarker("v2-collect", `${input.roomId}:${cutoffAtMs}`);
  const statements = [db.prepare(`UPDATE rooms SET state = 'RUNNING', revision = revision + 1,
    end_reason = ?, ended_at_ms = ?, last_command_id = ?
    WHERE id = ? AND revision = ? AND state IN ('COUNTDOWN', 'RUNNING')
      AND EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state = 'COUNTDOWN')`).bind(input.interrupted ? "interrupted" : "normal", cutoffAtMs, marker, input.roomId, room.revision)];
  statements.push(db.prepare(`UPDATE v2_room_manifests SET state = 'COLLECTING', collecting_at_ms = ?, cutoff_at_ms = ?, collection_until_ms = ?
    WHERE room_id = ? AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.nowMs, cutoffAtMs, cutoffAtMs + 1e4, input.roomId, input.roomId, marker));
  const results = await db.batch(statements);
  if (!changed(results[0])) return collectV2Room(db, input);
  return { state: "COLLECTING", cutoffAtMs, collectionUntilMs: cutoffAtMs + 1e4 };
}
async function maybeFinalizeV2Room(db, input) {
  let room = await loadRoom(db, input.roomId);
  if (!room) throw new PersistenceConflictError("not_found", "v2 room not found", 404);
  if (room.phase_state === "FINISHED") return {
    roomId: input.roomId,
    state: "FINISHED",
    cutoffAtMs: room.cutoff_at_ms ?? room.deadline_at_ms ?? 0,
    finalizedAtMs: room.finalized_at_ms ?? input.nowMs,
    participantCount: Number((await db.prepare("SELECT COUNT(*) AS count FROM final_results WHERE room_id = ?").bind(input.roomId).first())?.count ?? 0)
  };
  if (room.start_at_ms == null || room.deadline_at_ms == null) return null;
  if (input.nowMs >= room.deadline_at_ms && room.phase_state !== "COLLECTING") {
    await collectV2Room(db, { roomId: input.roomId, nowMs: input.nowMs });
    room = await loadRoom(db, input.roomId);
  }
  const participants = (await db.prepare(`SELECT p.id, p.joined_order, p.status, v.finished_elapsed_ms, v.finish_reason, v.boundary_ack_at_ms
    FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
    WHERE p.room_id = ? AND p.status != 'REMOVED' ORDER BY p.joined_order`).bind(input.roomId).all()).results;
  const allFinished = participants.length > 0 && participants.every((p) => p.finished_elapsed_ms != null);
  const boundaryReady = participants.every((p) => p.finished_elapsed_ms != null || p.boundary_ack_at_ms != null);
  const cutoff = room.cutoff_at_ms ?? room.deadline_at_ms;
  const until = room.collection_until_ms ?? room.deadline_at_ms + 1e4;
  if (room.phase_state === "COLLECTING") {
    if (!boundaryReady && input.nowMs < until) return null;
  } else if (!allFinished) return null;
  const questions = (await db.prepare("SELECT answer_snapshot_json FROM room_questions WHERE room_id = ? ORDER BY ordinal").bind(input.roomId).all()).results.map((row) => JSON.parse(row.answer_snapshot_json));
  const operationRows = (await db.prepare(`SELECT participant_id, payload_json FROM v2_operations WHERE room_id = ? ORDER BY participant_id, seq`).bind(input.roomId).all()).results;
  const operations = /* @__PURE__ */ new Map();
  for (const row of operationRows) {
    const current = operations.get(row.participant_id) ?? [];
    current.push(JSON.parse(row.payload_json));
    operations.set(row.participant_id, current);
  }
  const scored = participants.map((participant) => {
    const replay = replayV2Operations(
      questions,
      room.grading_mode,
      operations.get(participant.id) ?? [],
      room.start_at_ms,
      cutoff,
      room.end_reason === "interrupted"
    );
    const elapsedMs = replay.finishedElapsedMs ?? cutoff - room.start_at_ms;
    return {
      participantId: participant.id,
      joinedOrder: participant.joined_order,
      correctCount: replay.correctCount,
      elapsedCs: Math.floor(elapsedMs / 10),
      finishReason: replay.finishReason === "submitted" ? "submitted" : replay.finishReason ? "completed" : room.end_reason === "interrupted" ? "interrupted" : "timeout",
      finalSyncUnconfirmed: !replay.finishReason && !replay.boundaryAcknowledged,
      fields: replay.fields
    };
  });
  scored.sort((a, b) => b.correctCount - a.correctCount || a.elapsedCs - b.elapsedCs || a.joinedOrder - b.joinedOrder);
  const ranked = [];
  scored.forEach((row, index) => {
    const previous = ranked.at(-1);
    ranked.push({ ...row, rank: previous && previous.correctCount === row.correctCount && previous.elapsedCs === row.elapsedCs ? previous.rank : index + 1 });
  });
  const fieldRows = ranked.flatMap((row) => questions.flatMap((question) => question.fields.map((field) => {
    const scoredField = row.fields[`${question.id}:${field.id}`];
    return {
      participantId: row.participantId,
      questionId: question.id,
      fieldId: field.id,
      state: scoredField?.state ?? "unanswered",
      answerJson: scoredField?.value == null ? null : json(scoredField.value)
    };
  })));
  const marker = commandMarker("v2-finalize", input.roomId);
  const retention = room.kind === "class" ? PUBLIC_CONFIG.retentionMs.classCompetition : PUBLIC_CONFIG.retentionMs.mateMatch;
  const statements = [db.prepare(`UPDATE rooms SET state = 'FINISHED', revision = revision + 1,
    ended_at_ms = ?, expires_at_ms = ? + ?, last_command_id = ?
    WHERE id = ? AND revision = ? AND state IN ('COUNTDOWN', 'RUNNING')
      AND EXISTS (SELECT 1 FROM v2_room_manifests m WHERE m.room_id = rooms.id AND m.state IN ('COUNTDOWN', 'COLLECTING'))`).bind(cutoff, input.nowMs, retention, marker, input.roomId, room.revision)];
  statements.push(db.prepare(`UPDATE v2_room_manifests SET state = 'FINISHED', finalized_at_ms = ? WHERE room_id = ?
    AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.nowMs, input.roomId, input.roomId, marker));
  statements.push(db.prepare(`INSERT INTO final_results(room_id, participant_id, correct_count, elapsed_cs, rank, finish_reason)
    SELECT ?, json_extract(value,'$.participantId'), json_extract(value,'$.correctCount'),
      json_extract(value,'$.elapsedCs'), json_extract(value,'$.rank'), json_extract(value,'$.finishReason')
    FROM json_each(?) WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, json(ranked.map(({ participantId, correctCount, elapsedCs, rank, finishReason }) => ({ participantId, correctCount, elapsedCs, rank, finishReason }))), input.roomId, marker));
  statements.push(db.prepare(`INSERT INTO v2_final_fields(room_id, participant_id, question_id, field_id, state, answer_json)
    SELECT ?, json_extract(value,'$.participantId'), json_extract(value,'$.questionId'),
      json_extract(value,'$.fieldId'), json_extract(value,'$.state'), json_extract(value,'$.answerJson')
    FROM json_each(?) WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(input.roomId, json(fieldRows), input.roomId, marker));
  statements.push(db.prepare(`UPDATE participants SET status = 'FINISHED', finished_at_ms = ?,
    correct_count = COALESCE((SELECT f.correct_count FROM final_results f WHERE f.room_id = participants.room_id AND f.participant_id = participants.id), 0),
    elapsed_cs = COALESCE((SELECT f.elapsed_cs FROM final_results f WHERE f.room_id = participants.room_id AND f.participant_id = participants.id), 0),
    wait_credit_ms = 0 WHERE room_id = ? AND status != 'REMOVED'
      AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND last_command_id = ?)`).bind(cutoff, input.roomId, input.roomId, marker));
  try {
    const results = await db.batch(statements);
    if (changed(results[0])) return {
      roomId: input.roomId,
      state: "FINISHED",
      cutoffAtMs: cutoff,
      finalizedAtMs: input.nowMs,
      participantCount: participants.length
    };
  } catch (error) {
    const after2 = await loadRoom(db, input.roomId);
    if (after2?.phase_state === "FINISHED") return maybeFinalizeV2Room(db, input);
    throw error;
  }
  const after = await loadRoom(db, input.roomId);
  if (after?.phase_state === "FINISHED") return maybeFinalizeV2Room(db, input);
  return null;
}

// src/platform/result-answer.ts
function decodeDisplayAnswer(stored) {
  if (stored === null) return { lastAnswer: null, lastAnswerEntry: null };
  let raw;
  try {
    raw = JSON.parse(stored);
  } catch {
    return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  }
  if (raw === null) return { lastAnswer: null, lastAnswerEntry: null };
  if (typeof raw === "string") return { lastAnswer: raw, lastAnswerEntry: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  const candidate = raw;
  if (Array.isArray(candidate.grid) && candidate.grid.length <= 5 && candidate.grid.every((row) => Array.isArray(row) && row.length <= 7)) {
    return { lastAnswer: null, lastAnswerEntry: null, lastAnswerValue: { grid: candidate.grid } };
  }
  if (!Array.isArray(candidate.tokens) || !candidate.tokens.every((token) => typeof token === "string")) {
    return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  }
  if (Array.isArray(candidate.tokens) && candidate.charge === void 0) {
    return { lastAnswer: candidate.tokens.join(""), lastAnswerEntry: null, lastAnswerValue: { tokens: candidate.tokens } };
  }
  const charge = candidate.charge;
  if (charge !== null && charge !== void 0 && (!charge || typeof charge !== "object" || Array.isArray(charge) || !["+", "-"].includes(charge.sign) || !Number.isSafeInteger(charge.magnitude) || Number(charge.magnitude) < 1)) return { lastAnswer: null, lastAnswerEntry: null, answerDisplayUnavailable: true };
  const entry = {
    ...candidate,
    tokens: candidate.tokens,
    charge: charge ?? null,
    cursor: Number.isSafeInteger(candidate.cursor) ? candidate.cursor : candidate.tokens.length
  };
  const suffix = entry.charge ? `${entry.charge.magnitude === 1 ? "" : entry.charge.magnitude}${entry.charge.sign}` : "";
  return { lastAnswer: entry.tokens.join("") + suffix, lastAnswerEntry: entry };
}

// src/platform/participant-auth.ts
var ParticipantAuthorizationError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ParticipantAuthorizationError";
  }
};
function readParticipantBearerToken(request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new ParticipantAuthorizationError(
      401,
      "participant_authentication_required",
      "\u53C2\u52A0\u8005\u30C8\u30FC\u30AF\u30F3\u304C\u5FC5\u8981\u3067\u3059"
    );
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  if (!match) {
    throw new ParticipantAuthorizationError(403, "participant_forbidden", "\u53C2\u52A0\u8005\u30C8\u30FC\u30AF\u30F3\u304C\u4E0D\u6B63\u3067\u3059");
  }
  return match[1];
}
async function hashParticipantToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function identifyParticipant(database, request, roomId) {
  const token = readParticipantBearerToken(request);
  const tokenHash = await hashParticipantToken(token);
  const participant = await database.prepare(`
    SELECT id, status, nickname FROM participants
    WHERE room_id = ? AND token_hash = ?
  `).bind(roomId, tokenHash).first();
  if (!participant) {
    throw new ParticipantAuthorizationError(403, "participant_forbidden", "\u53C2\u52A0\u8005\u3068\u3057\u3066\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093");
  }
  const claimedId = request.headers.get("x-participant-id");
  if (claimedId && claimedId !== participant.id) {
    throw new ParticipantAuthorizationError(403, "participant_forbidden", "\u5225\u306E\u53C2\u52A0\u8005\u306E\u60C5\u5831\u306F\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
  }
  return { participantId: participant.id, tokenHash, status: participant.status, nickname: participant.nickname };
}
async function requireParticipant(database, request, roomId) {
  const participant = await identifyParticipant(database, request, roomId);
  if (participant.status === "REMOVED") {
    throw new ParticipantAuthorizationError(403, "participant_forbidden", "\u53C2\u52A0\u8005\u3068\u3057\u3066\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093");
  }
  return participant;
}

// src/platform/teacher-identity.ts
var TeacherIdentityError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "TeacherIdentityError";
  }
};
function normalizeTeacherEmail(email) {
  return email.normalize("NFKC").trim().toLowerCase();
}
async function requireVerifiedTeacher(request, provider) {
  let identity;
  try {
    identity = await provider.getVerifiedIdentity(request);
  } catch (error) {
    if (error instanceof TeacherIdentityError) throw error;
    throw new TeacherIdentityError(503, "identity_unavailable", "\u6559\u54E1\u8A8D\u8A3C\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093");
  }
  if (!identity || !identity.id.trim() || !identity.email.trim()) {
    throw new TeacherIdentityError(401, "authentication_required", "\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059");
  }
  const email = normalizeTeacherEmail(identity.email);
  return { id: identity.id.trim(), email };
}
async function requireTeacher(request, provider, allowedEmails) {
  const identity = await requireVerifiedTeacher(request, provider);
  const email = identity.email;
  const normalizedAllowlist = new Set(allowedEmails.map(normalizeTeacherEmail).filter(Boolean));
  if (!normalizedAllowlist.has(email)) {
    throw new TeacherIdentityError(403, "teacher_forbidden", "\u6559\u54E1\u3068\u3057\u3066\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
  }
  return { id: identity.id.trim(), email };
}

// src/platform/http.ts
var MAX_BODY_BYTES = 4096;
var MAX_OPERATION_BODY_BYTES = 128 * 1024;
var LAZY_CLEANUP_LIMIT = 25;
var JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
var ApiError = class extends Error {
  constructor(status, code, message, retryAfterSeconds) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = "ApiError";
  }
};
function responseHeaders() {
  return {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  };
}
function jsonResponse(value, status = 200, extraHeaders) {
  const headers = new Headers(responseHeaders());
  if (extraHeaders) new Headers(extraHeaders).forEach((headerValue, name) => headers.set(name, headerValue));
  return new Response(JSON.stringify(value), { status, headers });
}
function publicError(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...error.retryAfterSeconds ? { retryAfter: String(error.retryAfterSeconds) } : {}
    };
  }
  if (error instanceof PersistenceConflictError) {
    const status = [400, 401, 403, 404, 409, 410, 429, 503].includes(error.status) ? error.status : 409;
    const messages = {
      capacity: "\u5B9A\u54E1\u306B\u9054\u3057\u307E\u3057\u305F",
      active_room_exists: "\u7D42\u4E86\u3057\u3066\u3044\u306A\u3044\u30E1\u30A4\u30C8\u30DE\u30C3\u30C1\u304C\u3042\u308A\u307E\u3059",
      database_conflict: "\u4FDD\u5B58\u304C\u7AF6\u5408\u3057\u307E\u3057\u305F\u3002\u540C\u3058 requestId \u3067\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044",
      deadline: "\u5236\u9650\u6642\u9593\u3092\u904E\u304E\u3066\u3044\u307E\u3059",
      expired: "\u3053\u306E\u30EB\u30FC\u30E0\u306E\u95B2\u89A7\u671F\u9650\u306F\u7D42\u4E86\u3057\u307E\u3057\u305F",
      invalid_state: "\u73FE\u5728\u306E\u72B6\u614B\u3067\u306F\u64CD\u4F5C\u3067\u304D\u307E\u305B\u3093",
      mate_disabled: "\u30E1\u30A4\u30C8\u30DE\u30C3\u30C1\u306F\u73FE\u5728\u5229\u7528\u3067\u304D\u307E\u305B\u3093",
      not_authorized: "\u3053\u306E\u60C5\u5831\u3092\u95B2\u89A7\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093",
      not_found: "\u30EB\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093",
      participant_not_found: "\u53C2\u52A0\u8005\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093",
      not_ready: "\u307E\u3060\u958B\u59CB\u3067\u304D\u307E\u305B\u3093",
      rate_limited: "\u77ED\u6642\u9593\u306B\u4F5C\u6210\u3067\u304D\u308B\u56DE\u6570\u3092\u8D85\u3048\u307E\u3057\u305F",
      request_id_reused: "requestId \u304C\u5225\u306E\u64CD\u4F5C\u3067\u4F7F\u7528\u3055\u308C\u3066\u3044\u307E\u3059",
      stale_participant_revision: "\u5225\u306E\u753B\u9762\u3067\u72B6\u614B\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F",
      stale_room_revision: "\u30EB\u30FC\u30E0\u306E\u72B6\u614B\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F",
      stale_question_profile: "\u51FA\u984C\u8A2D\u5B9A\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002\u6700\u65B0\u306E\u8A2D\u5B9A\u3092\u8AAD\u307F\u76F4\u3057\u3066\u304F\u3060\u3055\u3044"
    };
    return {
      status,
      code: error.code,
      message: messages[error.code] ?? "\u8981\u6C42\u3092\u51E6\u7406\u3067\u304D\u307E\u305B\u3093",
      ...error.retryAfterSeconds ? { retryAfter: String(error.retryAfterSeconds) } : {}
    };
  }
  if (error instanceof TeacherIdentityError || error instanceof ParticipantAuthorizationError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return { status: 400, code: "invalid_request", message: "\u5165\u529B\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044" };
  }
  if (typeof error === "object" && error !== null && /(?:constraint|unique)/iu.test([
    String(error.code ?? ""),
    String(error.message ?? "")
  ].join(" "))) {
    return { status: 409, code: "conflict", message: "\u540C\u3058\u5185\u5BB9\u304C\u3059\u3067\u306B\u4F7F\u7528\u3055\u308C\u3066\u3044\u307E\u3059" };
  }
  return { status: 503, code: "service_unavailable", message: "\u30B5\u30FC\u30D3\u30B9\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093" };
}
async function safe(handler) {
  try {
    return await handler();
  } catch (error) {
    const mapped = publicError(error);
    if (mapped.status >= 500 || error instanceof TypeError || error instanceof RangeError) {
      const candidate = error;
      console.error(JSON.stringify({
        event: "handler_failed",
        category: typeof candidate?.name === "string" ? candidate.name : "Unknown",
        code: typeof candidate?.code === "string" && /^[A-Z0-9]{5}$/.test(candidate.code) ? candidate.code : void 0,
        frames: typeof candidate?.stack === "string" ? candidate.stack.split("\n").filter((line) => /^\s+at\s/.test(line)).slice(0, 3).map((line) => line.slice(0, 240)) : void 0
      }));
    }
    return jsonResponse(
      { error: { code: mapped.code, message: mapped.message } },
      mapped.status,
      mapped.retryAfter ? { "retry-after": mapped.retryAfter } : void 0
    );
  }
}
async function resultSafe(handler, operation) {
  const requestId2 = crypto.randomUUID();
  let protocolVersion;
  try {
    return await handler(requestId2, (version) => {
      protocolVersion = version;
    });
  } catch (error) {
    if (error instanceof ApiError || error instanceof PersistenceConflictError || error instanceof TeacherIdentityError || error instanceof ParticipantAuthorizationError) {
      const mapped = publicError(error);
      return jsonResponse(
        { error: { code: mapped.code, message: mapped.message } },
        mapped.status,
        mapped.retryAfter ? { "retry-after": mapped.retryAfter } : void 0
      );
    }
    console.error(JSON.stringify({
      event: "result_build_failed",
      operation,
      requestId: requestId2,
      protocolVersion,
      category: error instanceof Error ? error.name : "Unknown"
    }));
    return jsonResponse(
      { error: { code: "result_build_failed", message: "\u7D50\u679C\u306E\u8868\u793A\u3092\u6E96\u5099\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044", requestId: requestId2 } },
      500,
      { "x-request-id": requestId2 }
    );
  }
}
function assertSameOriginMutation(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== requestUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "origin_forbidden", "\u5225\u306E\u30B5\u30A4\u30C8\u304B\u3089\u306E\u64CD\u4F5C\u306F\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093");
  }
  if (request.headers.get("x-competition-csrf") !== "1") {
    throw new ApiError(403, "csrf_forbidden", "\u64CD\u4F5C\u306E\u78BA\u8A8D\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093");
  }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readMutationBody(request, maxBodyBytes = MAX_BODY_BYTES) {
  assertSameOriginMutation(request);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "JSON\u3067\u9001\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
    throw new ApiError(413, "body_too_large", "\u9001\u4FE1\u5185\u5BB9\u304C\u5927\u304D\u3059\u304E\u307E\u3059");
  }
  if (!request.body) throw new ApiError(400, "invalid_json", "JSON\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    bytesRead += chunk.byteLength;
    if (bytesRead > maxBodyBytes) {
      await reader.cancel("body too large");
      throw new ApiError(413, "body_too_large", "\u9001\u4FE1\u5185\u5BB9\u304C\u5927\u304D\u3059\u304E\u307E\u3059");
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "JSON\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093");
  }
  if (!isRecord(value)) throw new ApiError(400, "invalid_request", "JSON\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u304C\u5FC5\u8981\u3067\u3059");
  return { value, bodyHash: await sha256(text) };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertKeys(value, allowed) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key2) => !allowedSet.has(key2))) {
    throw new ApiError(400, "invalid_request", "\u53D7\u3051\u4ED8\u3051\u3066\u3044\u306A\u3044\u9805\u76EE\u304C\u3042\u308A\u307E\u3059");
  }
}
function stringValue(value, name, maximum = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new ApiError(400, "invalid_request", `${name}\u304C\u4E0D\u6B63\u3067\u3059`);
  }
  return value;
}
function integerValue(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ApiError(400, "invalid_request", `${name}\u304C\u4E0D\u6B63\u3067\u3059`);
  }
  return value;
}
function requestId(value) {
  const id = stringValue(value, "requestId", 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new ApiError(400, "invalid_request", "requestId\u304C\u4E0D\u6B63\u3067\u3059");
  return id;
}
function parseSettings(value) {
  if (!isRecord(value)) throw new ApiError(400, "invalid_settings", "\u7AF6\u6280\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
  assertKeys(value, ["questionCount", "timeLimitMinutes", "mode", "difficulty", "gradingMode", "alcoholEnabled", "chemistryContentVersion"]);
  const settings = { ...value, gradingMode: value.gradingMode ?? "immediate", alcoholEnabled: value.alcoholEnabled ?? false, chemistryContentVersion: CHEMISTRY_CONTENT_VERSION };
  try {
    validateGameSettings(settings);
  } catch (error) {
    throw new ApiError(400, "invalid_settings", error instanceof Error ? error.message : "\u7AF6\u6280\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
  }
  return settings;
}
function normalizeNickname(value) {
  if (typeof value !== "string") throw new ApiError(400, "invalid_nickname", "\u30CB\u30C3\u30AF\u30CD\u30FC\u30E0\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 16 || /[\u0000-\u001f\u007f-\u009f]/u.test(nickname)) {
    throw new ApiError(400, "invalid_nickname", "\u30CB\u30C3\u30AF\u30CD\u30FC\u30E0\u306F1\u301C16\u6587\u5B57\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");
  }
  return { nickname, nicknameKey: nickname.normalize("NFKC").toLocaleLowerCase("ja-JP") };
}
function joinCode(random) {
  return Array.from({ length: 6 }, () => {
    const index = Math.min(JOIN_CODE_ALPHABET.length - 1, Math.floor(random() * JOIN_CODE_ALPHABET.length));
    return JOIN_CODE_ALPHABET[index];
  }).join("");
}
async function loadRoom2(database, externalId) {
  if (!externalId || externalId.length > 128) throw new ApiError(404, "not_found", "\u30EB\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
  const room = await database.prepare(`
    SELECT id, public_id, join_code, kind, owner_teacher_id, mate_host_id,
      settings_json, game_version, state, revision, max_score, created_at_ms, start_at_ms, deadline_at_ms, expires_at_ms, ended_at_ms, end_reason,
      (SELECT state FROM v2_room_manifests WHERE room_id = rooms.id) AS v2_phase
    FROM rooms WHERE public_id = ? OR id = ?
  `).bind(externalId, externalId).first();
  if (!room) throw new ApiError(404, "not_found", "\u30EB\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
  return room;
}
function requireUnexpired(room, nowMs) {
  if (room.expires_at_ms <= nowMs) {
    throw new ApiError(410, "expired", "\u3053\u306E\u30EB\u30FC\u30E0\u306E\u95B2\u89A7\u671F\u9650\u306F\u7D42\u4E86\u3057\u307E\u3057\u305F");
  }
}
function stateOf(room, nowMs) {
  if (room.game_version === "2") {
    if (room.state === "CANCELLED" || room.state === "EXPIRED") return room.state;
    if (room.v2_phase === "PREPARING" || room.v2_phase === "COLLECTING" || room.v2_phase === "FINISHED") return room.v2_phase;
    if ((room.v2_phase === "COUNTDOWN" || room.state === "COUNTDOWN") && room.start_at_ms != null && nowMs >= room.start_at_ms) return "RUNNING";
    return room.v2_phase ?? room.state;
  }
  return effectiveRoomState({
    storedState: room.state,
    startAtMs: room.start_at_ms,
    deadlineAtMs: room.deadline_at_ms
  }, nowMs);
}
async function readTeacherAllowlist(database) {
  return await database.prepare("SELECT emails_json, revision, last_request_id, last_body_hash FROM teacher_allowlist WHERE id = 1").first() ?? { emails_json: "[]", revision: 0, last_request_id: null, last_body_hash: null };
}
async function isMasterTeacher(dependencies, identity) {
  if (dependencies.teacherAuthorization) {
    const role = await dependencies.teacherAuthorization(identity);
    return role.allowed && role.master;
  }
  return !!dependencies.serverConfig.masterTeacherEmail && identity.email === dependencies.serverConfig.masterTeacherEmail;
}
async function requireApplicationTeacher(dependencies, request) {
  if (dependencies.teacherAuthorization) {
    const identity2 = await requireVerifiedTeacher(request, dependencies.teacherIdentity);
    if (!(await dependencies.teacherAuthorization(identity2)).allowed) throw new TeacherIdentityError(403, "teacher_forbidden", "\u6559\u54E1\u3068\u3057\u3066\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
    return identity2;
  }
  const master = dependencies.serverConfig.masterTeacherEmail;
  if (!master) return requireTeacher(request, dependencies.teacherIdentity, dependencies.serverConfig.teacherAllowedEmails);
  const identity = await requireVerifiedTeacher(request, dependencies.teacherIdentity);
  if (identity.email === master) return identity;
  const list = await readTeacherAllowlist(dependencies.database);
  if (!JSON.parse(list.emails_json).includes(identity.email)) {
    throw new TeacherIdentityError(403, "teacher_forbidden", "\u6559\u54E1\u3068\u3057\u3066\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
  }
  return identity;
}
async function authorizeTeacherOwner(dependencies, request, room) {
  const teacher = await requireApplicationTeacher(dependencies, request);
  if (room.kind !== "class" || room.owner_teacher_id !== teacher.id) {
    throw new ApiError(403, "room_owner_forbidden", "\u3053\u306E\u30EB\u30FC\u30E0\u3092\u64CD\u4F5C\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093");
  }
  return teacher;
}
async function authorizeRoomOwner(dependencies, request, room) {
  if (request.headers.has("authorization")) {
    const participant = await requireParticipant(dependencies.database, request, room.id);
    if (room.kind !== "mate" || room.mate_host_id !== participant.participantId) {
      throw new ApiError(403, "room_owner_forbidden", "\u3053\u306E\u30EB\u30FC\u30E0\u3092\u64CD\u4F5C\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093");
    }
    return { kind: "participant", id: participant.participantId };
  }
  const teacher = await authorizeTeacherOwner(dependencies, request, room);
  return { kind: "teacher", id: teacher.id };
}
async function readMateEnabled(database) {
  const row = await database.prepare(
    "SELECT mate_match_enabled, revision FROM site_settings WHERE id = 1"
  ).first();
  return row ? { enabled: row.mate_match_enabled === 1, revision: row.revision } : { enabled: true, revision: 0 };
}
async function tryFinalize(database, room, nowMs) {
  if (room.game_version === "2") {
    if (room.v2_phase === "COUNTDOWN" || room.v2_phase === "COLLECTING" || room.v2_phase === "FINISHED")
      await maybeFinalizeV2Room(database, { roomId: room.id, nowMs });
    return;
  }
  const effective = stateOf(room, nowMs);
  if (effective !== "FINISHED" || room.state === "FINISHED") return;
  try {
    await finalizeRoom(database, {
      roomId: room.id,
      requestId: `deadline-${room.deadline_at_ms ?? nowMs}`,
      bodyHash: `deadline-${room.deadline_at_ms ?? nowMs}`,
      nowMs
    });
  } catch (error) {
    if (!(error instanceof PersistenceConflictError && error.code === "invalid_state")) throw error;
  }
}
async function participantState(database, room, participantId, nowMs) {
  const participant = await database.prepare(`
    SELECT id, nickname, status, joined_order, current_ordinal, correct_count, resolved_question_count,
      revision, elapsed_cs, accepted_elapsed_ms, wait_credit_ms, timing_source
    FROM participants WHERE room_id = ? AND id = ? AND status != 'REMOVED'
  `).bind(room.id, participantId).first();
  if (!participant) throw new ApiError(403, "participant_forbidden", "\u53C2\u52A0\u8005\u3068\u3057\u3066\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093");
  let question = null;
  if (room.game_version !== "2" && stateOf(room, nowMs) === "RUNNING" && participant.status === "ACTIVE") {
    const row = await database.prepare(`
      SELECT public_payload_json FROM room_questions
      WHERE room_id = ? AND ordinal = ?
    `).bind(room.id, participant.current_ordinal).first();
    if (row) {
      const publicQuestion = JSON.parse(row.public_payload_json);
      const { results: resolved } = await database.prepare(`
        SELECT field_id, state FROM participant_fields
        WHERE room_id = ? AND participant_id = ? AND question_id = ?
        ORDER BY field_id
      `).bind(room.id, participant.id, publicQuestion.id).all();
      question = {
        ...publicQuestion,
        progress: { resolvedFieldIds: resolved.filter((field) => field.state === "correct" || field.state === "passed").map((field) => field.field_id), fieldStates: Object.fromEntries(resolved.map((field) => [field.field_id, field.state])) }
      };
    }
  }
  return {
    participant: {
      id: participant.id,
      joinedOrder: participant.joined_order,
      nickname: participant.nickname,
      status: participant.status,
      currentOrdinal: participant.current_ordinal,
      correctCount: participant.correct_count,
      resolvedQuestionCount: participant.resolved_question_count,
      revision: participant.revision,
      elapsedCs: participant.elapsed_cs,
      rawElapsedMs: participant.accepted_elapsed_ms,
      waitCreditMs: participant.wait_credit_ms,
      timingSource: participant.timing_source
    },
    question
  };
}
async function teacherProgress(database, roomId) {
  const { results } = await database.prepare(`
    SELECT id, nickname, status, joined_order, current_ordinal, correct_count, resolved_question_count,
      revision, elapsed_cs, timing_source, COALESCE(v.answered_count, 0) AS answered_count,
      v.finished_elapsed_ms
    FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
    WHERE p.room_id = ? AND p.status != 'REMOVED' ORDER BY p.joined_order
  `).bind(roomId).all();
  return results.map((participant) => ({
    id: participant.id,
    joinedOrder: participant.joined_order,
    nickname: participant.nickname,
    status: participant.status,
    currentOrdinal: participant.current_ordinal,
    correctCount: participant.correct_count,
    resolvedQuestionCount: participant.resolved_question_count,
    revision: participant.revision,
    elapsedCs: participant.elapsed_cs,
    timingSource: participant.timing_source,
    answeredCount: participant.answered_count,
    submitted: participant.finished_elapsed_ms != null
  }));
}
function roomView(room, nowMs) {
  return {
    id: room.public_id,
    playProtocolVersion: room.game_version === "2" ? 2 : 1,
    gradingMode: JSON.parse(room.settings_json).gradingMode ?? "immediate",
    kind: room.kind,
    state: stateOf(room, nowMs),
    revision: room.revision,
    settings: JSON.parse(room.settings_json),
    maxScore: room.max_score,
    createdAtMs: room.created_at_ms,
    startAtMs: room.start_at_ms,
    deadlineAtMs: room.deadline_at_ms,
    expiresAtMs: room.expires_at_ms,
    endedAtMs: room.ended_at_ms,
    endReason: room.end_reason
  };
}
function correctAnswer(question, fieldId) {
  const specification = question.answer;
  return specification.canonical;
}
async function participantQuestionResults(database, roomId, participantId, protocolVersion = 1, requestId2) {
  const fieldSource = protocolVersion === 2 ? "v2_final_fields f" : "participant_fields f";
  const fieldColumns = protocolVersion === 2 ? "0 AS attempt_count, f.answer_json AS last_answer_json, CASE WHEN f.state = 'correct' THEN 1 WHEN f.state = 'incorrect' THEN 0 ELSE NULL END AS last_answer_correct" : "f.attempt_count, f.last_answer_json, f.last_answer_correct";
  const { results } = await database.prepare(`
    SELECT q.question_id, q.ordinal, q.public_payload_json, q.answer_snapshot_json,
      f.field_id, f.state, ${fieldColumns}
    FROM room_questions q
    JOIN ${fieldSource} ON f.room_id = q.room_id AND f.question_id = q.question_id
    WHERE q.room_id = ? AND f.participant_id = ?
    ORDER BY q.ordinal, json_extract(q.field_spec_json, '$[0].id') != f.field_id, f.field_id
  `).bind(roomId, participantId).all();
  const questions = /* @__PURE__ */ new Map();
  let unavailableCount = 0;
  for (const row of results) {
    const internal = JSON.parse(row.answer_snapshot_json);
    const publicQuestion = JSON.parse(row.public_payload_json);
    const question = questions.get(row.question_id) ?? {
      id: row.question_id,
      ordinal: row.ordinal,
      prompt: publicQuestion.prompt,
      fields: []
    };
    const displayAnswer = decodeDisplayAnswer(row.last_answer_json);
    if (displayAnswer.answerDisplayUnavailable) unavailableCount += 1;
    question.fields.push({
      id: row.field_id,
      state: row.state,
      correctAnswer: correctAnswer(internal, row.field_id),
      correctFormulaCore: null,
      correctFormulaCharge: null,
      correctAnswerValue: JSON.parse(internal.answer.canonical),
      ...displayAnswer,
      lastAnswerCorrect: row.last_answer_correct === null ? null : row.last_answer_correct === 1,
      attemptCount: row.attempt_count
    });
    questions.set(row.question_id, question);
  }
  if (unavailableCount) console.warn(JSON.stringify({
    event: "result_answer_unavailable",
    requestId: requestId2,
    protocolVersion,
    unavailableCount
  }));
  return [...questions.values()];
}
async function teacherResultAggregate(database, room) {
  const fieldTable = room.game_version === "2" ? "v2_final_fields" : "participant_fields";
  const totals = await database.prepare(`
    SELECT COUNT(*) AS participant_count,
      COALESCE(AVG(correct_count), 0) AS average_correct_count,
      COALESCE(SUM(CASE WHEN correct_count = ? THEN 1 ELSE 0 END), 0) AS perfect_count,
      COALESCE(SUM(CASE WHEN finish_reason = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
    FROM final_results WHERE room_id = ?
  `).bind(room.max_score, room.id).first();
  const participantCount = Number(totals?.participant_count ?? 0);
  const { results: rows } = await database.prepare(`
    SELECT q.question_id, q.ordinal, q.answer_snapshot_json, f.field_id,
      SUM(CASE WHEN f.state = 'correct' THEN 1 ELSE 0 END) AS correct_count,
      SUM(CASE WHEN f.state = 'passed' THEN 1 ELSE 0 END) AS passed_count,
      SUM(CASE WHEN f.state = 'unanswered' THEN 1 ELSE 0 END) AS unanswered_count
    FROM room_questions q
    JOIN ${fieldTable} f ON f.room_id = q.room_id AND f.question_id = q.question_id
    WHERE q.room_id = ?
    GROUP BY q.question_id, q.ordinal, q.answer_snapshot_json, f.field_id
    ORDER BY q.ordinal, f.field_id
  `).bind(room.id).all();
  const questions = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const internal = JSON.parse(row.answer_snapshot_json);
    const question = questions.get(row.question_id) ?? { id: row.question_id, ordinal: row.ordinal, fields: [] };
    const fieldCorrectCount = Number(row.correct_count);
    question.fields.push({
      id: row.field_id,
      correctAnswer: correctAnswer(internal, row.field_id),
      correctCount: fieldCorrectCount,
      passedCount: Number(row.passed_count),
      unansweredCount: Number(row.unanswered_count),
      correctRate: participantCount ? fieldCorrectCount / participantCount : 0
    });
    questions.set(row.question_id, question);
  }
  return {
    participantCount,
    averageCorrectCount: Number(totals?.average_correct_count ?? 0),
    perfectCount: Number(totals?.perfect_count ?? 0),
    completedCount: Number(totals?.completed_count ?? 0),
    questions: [...questions.values()]
  };
}
function createApiHandlers(dependencies) {
  const publicConfig = (request) => safe(async () => {
    const mate = await readMateEnabled(dependencies.database);
    return jsonResponse({
      ...PUBLIC_CONFIG,
      mateMatchEnabled: mate.enabled
    });
  });
  const joinInfo = (request) => safe(async () => {
    const search = new URL(request.url).searchParams;
    const rawCode = search.get("code");
    const rawPublicId = search.get("publicId");
    if (rawCode === null === (rawPublicId === null)) {
      throw new ApiError(400, "invalid_room_lookup", "\u53C2\u52A0\u5148\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    const code = rawCode?.trim().toUpperCase() ?? null;
    const publicId = rawPublicId?.trim() ?? null;
    if (code !== null && !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/u.test(code)) {
      throw new ApiError(400, "invalid_join_code", "\u53C2\u52A0\u30B3\u30FC\u30C9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    if (publicId !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(publicId)) {
      throw new ApiError(400, "invalid_public_id", "\u53C2\u52A0\u5148\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    const nowMs = dependencies.now();
    const room = await dependencies.database.prepare(`
      SELECT id, public_id, join_code, kind, owner_teacher_id, mate_host_id,
        settings_json, game_version, state, revision, max_score, start_at_ms, deadline_at_ms, expires_at_ms,
        (SELECT state FROM v2_room_manifests WHERE room_id = rooms.id) AS v2_phase
      FROM rooms WHERE (${code === null ? "public_id" : "join_code"}) = ?
    `).bind(publicId ?? code).first();
    if (!room) throw new ApiError(404, "not_found", "\u30EB\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    requireUnexpired(room, nowMs);
    const count = await dependencies.database.prepare(
      "SELECT COUNT(*) AS count FROM participants WHERE room_id = ? AND status != 'REMOVED'"
    ).bind(room.id).first();
    return jsonResponse({
      room: {
        id: room.public_id,
        kind: room.kind,
        state: stateOf(room, nowMs),
        settings: JSON.parse(room.settings_json)
      },
      participantCount: Number(count?.count ?? 0),
      capacity: room.kind === "class" ? PUBLIC_CONFIG.participantLimits.classCompetition : PUBLIC_CONFIG.participantLimits.mateMatch
    });
  });
  const createClassRoom = (request) => safe(async () => {
    const teacher = await requireApplicationTeacher(dependencies, request);
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "settings"]);
    const idempotencyKey = requestId(value.requestId);
    const requestedV2 = isRecord(value.settings) && value.settings.gradingMode !== void 0;
    const settings = parseSettings(value.settings);
    const questionProfile = await readQuestionProfile(dependencies.database);
    const validated = validateGameSettings(settings, questionProfile.profile);
    const nowMs = dependencies.now();
    await cleanupExpired(dependencies.database, { nowMs, limit: LAZY_CLEANUP_LIMIT });
    const created = await createRoom(dependencies.database, {
      roomId: dependencies.randomUUID(),
      publicId: dependencies.randomUUID(),
      joinCode: joinCode(dependencies.random),
      kind: "class",
      ownerTeacherId: teacher.id,
      settings,
      gameId: "alkane-puzzle",
      gameVersion: requestedV2 ? "2" : "1",
      datasetVersion: CHEMISTRY_CONTENT_VERSION,
      questionProfile,
      maxScore: validated.maxScore,
      actorKeyHash: await sha256(`teacher:${teacher.id}`),
      requestId: idempotencyKey,
      bodyHash: bodyHash2,
      nowMs,
      expiresAtMs: nowMs + PUBLIC_CONFIG.waitingRoomLifetimeMs
    });
    return jsonResponse({ room: { id: created.publicId, joinCode: created.joinCode, kind: created.kind, state: created.state, revision: created.revision } }, 201);
  });
  const createMateRoom = (request) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "settings", "nickname"]);
    const creationKey = request.headers.get("x-creation-key") ?? "";
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(creationKey)) {
      throw new ApiError(401, "creation_credential_required", "\u4F5C\u6210\u8CC7\u683C\u304C\u5FC5\u8981\u3067\u3059");
    }
    const token = readParticipantBearerToken(request);
    const tokenHash = await hashParticipantToken(token);
    const credentialBoundBodyHash = await sha256(`${bodyHash2}:${tokenHash}`);
    const nickname2 = normalizeNickname(value.nickname);
    const requestedV2 = isRecord(value.settings) && value.settings.gradingMode !== void 0;
    const settings = parseSettings(value.settings);
    const questionProfile = { profile: structuredClone(DEFAULT_QUESTION_PROFILE), revision: 0 };
    const validated = validateGameSettings(settings, questionProfile.profile);
    const nowMs = dependencies.now();
    await cleanupExpired(dependencies.database, { nowMs, limit: LAZY_CLEANUP_LIMIT });
    const hostId = dependencies.randomUUID();
    const created = await createRoom(dependencies.database, {
      roomId: dependencies.randomUUID(),
      publicId: dependencies.randomUUID(),
      joinCode: joinCode(dependencies.random),
      kind: "mate",
      ownerTeacherId: null,
      settings,
      gameId: "alkane-puzzle",
      gameVersion: requestedV2 ? "2" : "1",
      datasetVersion: CHEMISTRY_CONTENT_VERSION,
      questionProfile,
      maxScore: validated.maxScore,
      actorKeyHash: await sha256(`creator:${creationKey}`),
      requestId: requestId(value.requestId),
      bodyHash: credentialBoundBodyHash,
      nowMs,
      expiresAtMs: nowMs + PUBLIC_CONFIG.waitingRoomLifetimeMs,
      host: { participantId: hostId, tokenHash, ...nickname2 }
    });
    return jsonResponse({
      room: { id: created.publicId, joinCode: created.joinCode, kind: created.kind, state: created.state, revision: created.revision },
      participant: created.hostParticipant
    }, 201);
  });
  const join = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "nickname"]);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    const token = readParticipantBearerToken(request);
    const tokenHash = await hashParticipantToken(token);
    const nickname2 = normalizeNickname(value.nickname);
    const joined = await joinRoom(dependencies.database, {
      roomId: room.id,
      participantId: dependencies.randomUUID(),
      tokenHash,
      ...nickname2,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      nowMs
    });
    return jsonResponse({
      participant: {
        id: joined.participantId,
        nickname: nickname2.nickname,
        joinedOrder: joined.joinedOrder,
        revision: joined.participantRevision
      }
    }, 201);
  });
  const nickname = (request, parameters) => safe(async () => {
    assertSameOriginMutation(request);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "expectedParticipantRevision", "nickname"]);
    const normalized = normalizeNickname(value.nickname);
    const result = await renameParticipant(dependencies.database, {
      roomId: room.id,
      participantId: participant.participantId,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedParticipantRevision: integerValue(value.expectedParticipantRevision, "expectedParticipantRevision"),
      ...normalized,
      nowMs: dependencies.now()
    });
    return jsonResponse({ participant: result });
  });
  const updateRoomSettings = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "expectedRevision", "settings"]);
    const idempotencyKey = requestId(value.requestId);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    const owner = await authorizeRoomOwner(dependencies, request, room);
    const expectedRevision = integerValue(value.expectedRevision, "expectedRevision");
    const settings = parseSettings(value.settings);
    const questionProfile = await readRoomQuestionProfile(dependencies.database, room.id);
    const validated = validateGameSettings(settings, questionProfile);
    const result = await updateRoomSettingsCommand(dependencies.database, {
      roomId: room.id,
      actorId: `${owner.kind}:${owner.id}`,
      requestId: idempotencyKey,
      bodyHash: bodyHash2,
      expectedRevision,
      settings,
      maxScore: validated.maxScore,
      nowMs
    });
    return jsonResponse({ room: { id: room.public_id, ...result } });
  });
  const start = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "expectedRevision"]);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    await authorizeRoomOwner(dependencies, request, room);
    const settings = parseSettings(JSON.parse(room.settings_json));
    const questionProfile = await readRoomQuestionProfile(dependencies.database, room.id);
    if (room.game_version === "2") {
      return jsonResponse(await prepareV2Room(dependencies.database, {
        roomId: room.id,
        requestId: requestId(value.requestId),
        bodyHash: bodyHash2,
        expectedRoomRevision: integerValue(value.expectedRevision, "expectedRevision"),
        nowMs,
        manifestId: dependencies.randomUUID(),
        evaluatorVersion: EVALUATOR_VERSION,
        gradingMode: settings.gradingMode ?? "immediate",
        questions: generateQuestionSet(settings, dependencies.random, questionProfile)
      }));
    }
    const startAtMs = nowMs + PUBLIC_CONFIG.countdownSeconds * 1e3;
    const started = await startRoom(dependencies.database, {
      roomId: room.id,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRoomRevision: integerValue(value.expectedRevision, "expectedRevision"),
      nowMs,
      startAtMs,
      deadlineAtMs: startAtMs + settings.timeLimitMinutes * 6e4,
      questions: generateQuestionSet(settings, dependencies.random, questionProfile)
    });
    return jsonResponse({
      state: started.state,
      roomRevision: started.roomRevision,
      startAtMs: started.startAtMs,
      deadlineAtMs: started.deadlineAtMs
    });
  });
  const manifest = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (room.game_version !== "2") throw new ApiError(404, "not_found", "\u554F\u984C\u306E\u6E96\u5099\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093");
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const loaded = await loadV2Manifest(dependencies.database, room.id, participant.participantId);
    const drafts2 = await readParticipantDrafts(dependencies.database, room.id, participant.participantId);
    const progress = await dependencies.database.prepare("SELECT writer_epoch,ack_seq FROM v2_participant_progress WHERE room_id=? AND participant_id=?").bind(room.id, participant.participantId).first();
    const saved = await dependencies.database.prepare("SELECT payload_json FROM v2_operations WHERE room_id=? AND participant_id=? ORDER BY seq").bind(room.id, participant.participantId).all();
    return jsonResponse({ ...loaded, serverDrafts: drafts2, writerEpoch: progress?.writer_epoch ?? 1, ackSeq: progress?.ack_seq ?? 0, operations: saved.results.map((row) => JSON.parse(row.payload_json)) });
  });
  const ready = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (room.game_version !== "2") throw new ApiError(404, "not_found", "\u6E96\u5099\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093");
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const { value } = await readMutationBody(request);
    assertKeys(value, ["manifestId", "preparationGeneration", "evaluatorVersion"]);
    return jsonResponse(await markV2Ready(dependencies.database, {
      roomId: room.id,
      participantId: participant.participantId,
      manifestId: stringValue(value.manifestId, "manifestId", 128),
      evaluatorVersion: stringValue(value.evaluatorVersion, "evaluatorVersion", 128),
      preparationGeneration: integerValue(value.preparationGeneration, "preparationGeneration", 1),
      nowMs: dependencies.now()
    }));
  });
  const cancelPreparation = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (room.game_version !== "2") throw new ApiError(404, "not_found", "\u6E96\u5099\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093");
    await authorizeRoomOwner(dependencies, request, room);
    const { value } = await readMutationBody(request);
    assertKeys(value, ["expectedRevision"]);
    return jsonResponse(await cancelV2Preparation(dependencies.database, {
      roomId: room.id,
      expectedRoomRevision: integerValue(value.expectedRevision, "expectedRevision"),
      nowMs: dependencies.now()
    }));
  });
  const operations = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (room.game_version !== "2") throw new ApiError(404, "not_found", "\u4FDD\u5B58\u5148\u304C\u3042\u308A\u307E\u305B\u3093");
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const { value } = await readMutationBody(request, MAX_OPERATION_BODY_BYTES);
    assertKeys(value, ["requestId", "writerEpoch", "manifestId", "evaluatorVersion", "operations"]);
    if (!Array.isArray(value.operations)) throw new ApiError(400, "invalid_request", "\u89E3\u7B54\u8A18\u9332\u304C\u4E0D\u6B63\u3067\u3059");
    const response = await applyV2Operations(dependencies.database, {
      roomId: room.id,
      participantId: participant.participantId,
      requestId: requestId(value.requestId),
      writerEpoch: integerValue(value.writerEpoch, "writerEpoch"),
      manifestId: stringValue(value.manifestId, "manifestId", 128),
      evaluatorVersion: stringValue(value.evaluatorVersion, "evaluatorVersion", 128),
      operations: value.operations,
      nowMs: dependencies.now()
    });
    await maybeFinalizeV2Room(dependencies.database, { roomId: room.id, nowMs: dependencies.now() });
    return jsonResponse(response);
  });
  const drafts = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    const participant = await requireParticipant(dependencies.database, request, room.id);
    if (request.method === "GET") return jsonResponse({ drafts: await readParticipantDrafts(dependencies.database, room.id, participant.participantId) });
    const { value } = await readMutationBody(request, MAX_OPERATION_BODY_BYTES);
    assertKeys(value, ["manifestId", "writerEpoch", "items"]);
    if (!Array.isArray(value.items) || value.items.length > 15) throw new ApiError(400, "invalid_drafts", "\u9014\u4E2D\u89E3\u7B54\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    const questions = await dependencies.database.prepare("SELECT question_id,field_spec_json,public_payload_json FROM room_questions WHERE room_id=?").bind(room.id).all();
    const items = value.items.map((raw) => {
      if (!isRecord(raw)) throw new ApiError(400, "invalid_draft", "\u9014\u4E2D\u89E3\u7B54\u304C\u4E0D\u6B63\u3067\u3059");
      assertKeys(raw, ["questionId", "fieldId", "value", "version", "editedElapsedMs"]);
      const question = questions.results.find((q) => q.question_id === raw.questionId);
      if (!question || !JSON.parse(question.field_spec_json).some((f) => f.id === raw.fieldId)) throw new ApiError(400, "invalid_draft", "\u554F\u984C\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
      if (!validateAlkaneAnswer(raw.value, JSON.parse(question.public_payload_json).prompt)) throw new ApiError(400, "invalid_draft", "\u89E3\u7B54\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
      return { questionId: stringValue(raw.questionId, "questionId", 128), fieldId: raw.fieldId, value: raw.value, version: integerValue(raw.version, "version", 1), editedElapsedMs: integerValue(raw.editedElapsedMs, "editedElapsedMs") };
    });
    return jsonResponse(await saveParticipantDrafts(dependencies.database, { roomId: room.id, participantId: participant.participantId, manifestId: stringValue(value.manifestId, "manifestId", 128), writerEpoch: integerValue(value.writerEpoch, "writerEpoch", 1), nowMs, items }));
  });
  const writer = (request, parameters) => safe(async () => {
    const room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (room.game_version !== "2") throw new ApiError(404, "not_found", "\u66F8\u304D\u624B\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093");
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const { value } = await readMutationBody(request);
    assertKeys(value, ["expectedEpoch"]);
    return jsonResponse(await takeOverV2Writer(
      dependencies.database,
      room.id,
      participant.participantId,
      integerValue(value.expectedEpoch, "expectedEpoch", 1)
    ));
  });
  const cancel = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "expectedRevision"]);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    await authorizeRoomOwner(dependencies, request, room);
    return jsonResponse(await cancelRoom(dependencies.database, {
      roomId: room.id,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRoomRevision: integerValue(value.expectedRevision, "expectedRevision"),
      nowMs
    }));
  });
  const interrupt = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "expectedRevision"]);
    let room = await loadRoom2(dependencies.database, parameters.id);
    requireUnexpired(room, dependencies.now());
    if (request.headers.has("authorization")) throw new ApiError(403, "room_owner_forbidden", "\u4F5C\u6210\u6559\u54E1\u3060\u3051\u304C\u4E2D\u65AD\u3067\u304D\u307E\u3059");
    await authorizeTeacherOwner(dependencies, request, room);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    await tryFinalize(dependencies.database, room, nowMs);
    room = await loadRoom2(dependencies.database, room.id);
    if (room.game_version === "2") return jsonResponse(await collectV2Room(dependencies.database, { roomId: room.id, nowMs, interrupted: true }));
    return jsonResponse(await interruptRoom(dependencies.database, {
      roomId: room.id,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRoomRevision: integerValue(value.expectedRevision, "expectedRevision"),
      nowMs
    }));
  });
  const removeParticipant2 = (request, parameters) => safe(async () => {
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, [
      "requestId",
      "participantId",
      "expectedRoomRevision",
      "expectedParticipantRevision"
    ]);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    const owner = await authorizeRoomOwner(dependencies, request, room);
    const result = await removeParticipant(dependencies.database, {
      roomId: room.id,
      actorId: `${owner.kind}:${owner.id}`,
      targetParticipantId: stringValue(value.participantId, "participantId"),
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRoomRevision: integerValue(value.expectedRoomRevision, "expectedRoomRevision"),
      expectedParticipantRevision: integerValue(value.expectedParticipantRevision, "expectedParticipantRevision"),
      nowMs
    });
    return jsonResponse({
      roomRevision: result.roomRevision,
      participant: {
        id: result.participantId,
        status: result.participantStatus,
        revision: result.participantRevision
      }
    });
  });
  const actions = (request, parameters) => safe(async () => {
    assertSameOriginMutation(request);
    const room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    const participant = await requireParticipant(dependencies.database, request, room.id);
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "questionId", "expectedParticipantRevision", "clientElapsedMs", "waitCredit", "action"]);
    if (!isRecord(value.action)) throw new ApiError(400, "invalid_action", "\u64CD\u4F5C\u5185\u5BB9\u304C\u4E0D\u6B63\u3067\u3059");
    let action;
    if (value.action.type === "pass") {
      if (value.action.fieldId === void 0) {
        const replay = await loadCommandReceipt(dependencies.database, room.id, participant.participantId, requestId(value.requestId), bodyHash2);
        if (replay) return jsonResponse(replay);
        throw new ApiError(400, "invalid_action", "\u30A2\u30D7\u30EA\u3092\u66F4\u65B0\u3057\u3066\u3001\u30D1\u30B9\u3059\u308B\u6B04\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
      }
      assertKeys(value.action, ["type", "fieldId"]);
      if (value.action.fieldId !== "formula" && value.action.fieldId !== "name") throw new ApiError(400, "invalid_action", "\u30D1\u30B9\u3059\u308B\u6B04\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
      action = { type: "pass", fieldId: value.action.fieldId };
    } else if (value.action.type === "answer") {
      assertKeys(value.action, ["type", "fieldId", "value"]);
      if (value.action.fieldId !== "formula" && value.action.fieldId !== "name") {
        throw new ApiError(400, "invalid_action", "\u56DE\u7B54\u6B04\u304C\u4E0D\u6B63\u3067\u3059");
      }
      action = {
        type: "answer",
        fieldId: value.action.fieldId,
        value: (() => {
          const answer = validateAlkaneAnswer(value.action.value);
          if (!answer) throw new ApiError(400, "invalid_answer", "\u89E3\u7B54\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
          return JSON.stringify(answer);
        })()
      };
    } else {
      throw new ApiError(400, "invalid_action", "\u64CD\u4F5C\u5185\u5BB9\u304C\u4E0D\u6B63\u3067\u3059");
    }
    const clientElapsedMs = value.clientElapsedMs === null ? null : integerValue(value.clientElapsedMs, "clientElapsedMs");
    let waitCredit;
    if (isRecord(value.waitCredit)) {
      const source = value.waitCredit.sourceRequestId;
      const waitMs = value.waitCredit.waitMs;
      if (typeof source === "string" && source.length > 0 && source.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(source) && Number.isSafeInteger(waitMs) && waitMs >= 0) {
        waitCredit = { sourceRequestId: source, waitMs };
      }
    }
    const result = await applyPlayerAction(dependencies.database, {
      roomId: room.id,
      participantId: participant.participantId,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      questionId: stringValue(value.questionId, "questionId"),
      expectedParticipantRevision: integerValue(value.expectedParticipantRevision, "expectedParticipantRevision"),
      clientElapsedMs,
      waitCredit,
      serverNowMs: nowMs,
      action
    });
    if (result.finished) {
      const latest = await loadRoom2(dependencies.database, room.id);
      try {
        await finalizeRoom(dependencies.database, {
          roomId: room.id,
          requestId: `all-finished-${result.participantRevision}`,
          bodyHash: `all-finished-${result.participantRevision}`,
          nowMs
        });
      } catch (error) {
        if (!(error instanceof PersistenceConflictError && (error.code === "invalid_state" || error.code === "stale_room_revision"))) throw error;
      }
      void latest;
    }
    return jsonResponse(result);
  });
  const state = (request, parameters) => safe(async () => {
    let room = await loadRoom2(dependencies.database, parameters.id);
    const nowMs = dependencies.now();
    if (room.expires_at_ms <= nowMs) {
      await cleanupExpired(dependencies.database, { nowMs, limit: LAZY_CLEANUP_LIMIT });
      throw new ApiError(410, "expired", "\u3053\u306E\u30EB\u30FC\u30E0\u306E\u95B2\u89A7\u671F\u9650\u306F\u7D42\u4E86\u3057\u307E\u3057\u305F");
    }
    await cleanupExpired(dependencies.database, { nowMs, limit: LAZY_CLEANUP_LIMIT });
    requireUnexpired(room, nowMs);
    await tryFinalize(dependencies.database, room, nowMs);
    room = await loadRoom2(dependencies.database, room.id);
    const v2Phase = room.game_version === "2" ? await loadV2RoomPhase(dependencies.database, room.id, nowMs) : null;
    const v2Preparation = v2Phase?.state === "PREPARING" ? (await dependencies.database.prepare(`SELECT p.nickname, v.ready_generation FROM participants p
          LEFT JOIN v2_participant_progress v ON v.room_id = p.room_id AND v.participant_id = p.id
          WHERE p.room_id = ? AND p.status = 'ACTIVE' ORDER BY p.joined_order`).bind(room.id).all()).results : null;
    const v2 = v2Phase ? {
      ...v2Phase,
      readyCount: v2Preparation?.filter((p) => p.ready_generation === v2Phase.preparationGeneration).length ?? null,
      participantCount: v2Preparation?.length ?? null,
      notReadyNicknames: v2Preparation?.filter((p) => p.ready_generation !== v2Phase.preparationGeneration).map((p) => p.nickname) ?? []
    } : void 0;
    if (request.headers.has("authorization")) {
      const identity = await identifyParticipant(dependencies.database, request, room.id);
      if (identity.status === "REMOVED") {
        const roomState = stateOf(room, nowMs);
        return jsonResponse({ error: {
          code: "participant_removed",
          message: "\u30DB\u30B9\u30C8\u304C\u30ED\u30D3\u30FC\u304B\u3089\u3042\u306A\u305F\u306E\u30A8\u30F3\u30C8\u30EA\u30FC\u3092\u524A\u9664\u3057\u307E\u3057\u305F\u3002",
          nickname: identity.nickname,
          roomState,
          canRejoin: roomState === "WAITING"
        } }, 403);
      }
      const own = await participantState(dependencies.database, room, identity.participantId, nowMs);
      const participants = room.kind === "mate" && room.mate_host_id === identity.participantId ? await teacherProgress(dependencies.database, room.id) : void 0;
      return jsonResponse({
        serverNow: nowMs,
        room: roomView(room, nowMs),
        ...v2 ? { v2 } : {},
        ...own,
        ...participants ? { participants } : {}
      });
    }
    await authorizeTeacherOwner(dependencies, request, room);
    return jsonResponse({ serverNow: nowMs, room: roomView(room, nowMs), ...v2 ? { v2 } : {}, participants: await teacherProgress(dependencies.database, room.id) });
  });
  const results = (request, parameters) => resultSafe(async (requestId2, setProtocolVersion) => {
    let room = await loadRoom2(dependencies.database, parameters.id);
    setProtocolVersion(room.game_version === "2" ? 2 : 1);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    await tryFinalize(dependencies.database, room, nowMs);
    room = await loadRoom2(dependencies.database, room.id);
    if (stateOf(room, nowMs) !== "FINISHED") throw new ApiError(409, "results_not_ready", "\u7D50\u679C\u306F\u307E\u3060\u78BA\u5B9A\u3057\u3066\u3044\u307E\u305B\u3093");
    const { results: rankingRows } = await dependencies.database.prepare(`
      SELECT p.nickname, f.correct_count, f.elapsed_cs, f.rank, f.finish_reason,
        v.finished_elapsed_ms, v.boundary_ack_at_ms, v.finish_reason AS v2_finish_reason
      FROM final_results f JOIN participants p ON p.room_id = f.room_id AND p.id = f.participant_id
      LEFT JOIN v2_participant_progress v ON v.room_id = f.room_id AND v.participant_id = f.participant_id
      WHERE f.room_id = ? ORDER BY f.rank, p.joined_order
    `).bind(room.id).all();
    const ranking = rankingRows.map((row) => ({
      nickname: row.nickname,
      correctCount: row.correct_count,
      elapsedCs: row.elapsed_cs,
      rank: row.rank,
      finishReason: room.game_version === "2" && row.v2_finish_reason === "submitted" ? "submitted" : row.finish_reason,
      ...room.game_version === "2" ? { finalSyncUnconfirmed: row.finished_elapsed_ms == null && row.boundary_ack_at_ms == null } : {}
    }));
    if (request.headers.has("authorization")) {
      const identity = await requireParticipant(dependencies.database, request, room.id);
      const own = await loadAuthorizedResult(dependencies.database, {
        roomId: room.id,
        participantId: identity.participantId,
        tokenHash: identity.tokenHash,
        nowMs
      });
      const ownProgress = room.game_version === "2" ? await dependencies.database.prepare(`SELECT finished_elapsed_ms, boundary_ack_at_ms, finish_reason
        FROM v2_participant_progress WHERE room_id = ? AND participant_id = ?`).bind(room.id, identity.participantId).first() : null;
      return jsonResponse({
        room: roomView(room, nowMs),
        ranking: room.kind === "class" ? ranking.filter((row) => row.rank <= 3) : ranking,
        own: { ...own, ...ownProgress ? {
          finalSyncUnconfirmed: ownProgress.finished_elapsed_ms == null && ownProgress.boundary_ack_at_ms == null,
          finishReason: ownProgress.finish_reason === "submitted" ? "submitted" : own.finishReason
        } : {} },
        questions: await participantQuestionResults(dependencies.database, room.id, identity.participantId, room.game_version === "2" ? 2 : 1, requestId2)
      });
    }
    await authorizeTeacherOwner(dependencies, request, room);
    return jsonResponse({
      room: roomView(room, nowMs),
      ranking,
      aggregate: await teacherResultAggregate(dependencies.database, room)
    });
  }, "results");
  const resultSummary = (request, parameters) => resultSafe(async (_requestId, setProtocolVersion) => {
    let room = await loadRoom2(dependencies.database, parameters.id);
    setProtocolVersion(room.game_version === "2" ? 2 : 1);
    const nowMs = dependencies.now();
    requireUnexpired(room, nowMs);
    await tryFinalize(dependencies.database, room, nowMs);
    room = await loadRoom2(dependencies.database, room.id);
    if (stateOf(room, nowMs) !== "FINISHED") throw new ApiError(409, "results_not_ready", "\u7D50\u679C\u306F\u307E\u3060\u78BA\u5B9A\u3057\u3066\u3044\u307E\u305B\u3093");
    if (request.headers.has("authorization")) {
      const identity = await requireParticipant(dependencies.database, request, room.id);
      const own = await loadAuthorizedResult(dependencies.database, {
        roomId: room.id,
        participantId: identity.participantId,
        tokenHash: identity.tokenHash,
        nowMs
      });
      const progress = room.game_version === "2" ? await dependencies.database.prepare(`SELECT finished_elapsed_ms, boundary_ack_at_ms, finish_reason
        FROM v2_participant_progress WHERE room_id = ? AND participant_id = ?`).bind(room.id, identity.participantId).first() : null;
      return jsonResponse({ room: roomView(room, nowMs), own: {
        ...own,
        ...progress ? {
          finalSyncUnconfirmed: progress.finished_elapsed_ms == null && progress.boundary_ack_at_ms == null,
          finishReason: progress.finish_reason === "submitted" ? "submitted" : own.finishReason
        } : {}
      } });
    }
    await authorizeTeacherOwner(dependencies, request, room);
    return jsonResponse({ room: roomView(room, nowMs) });
  }, "result-summary");
  const teacherQuestionProfile = (request) => safe(async () => {
    const teacher = await requireApplicationTeacher(dependencies, request);
    if (!await isMasterTeacher(dependencies, teacher)) {
      throw new ApiError(403, "master_required", "\u7BA1\u7406\u8005\u6559\u54E1\u306E\u307F\u64CD\u4F5C\u3067\u304D\u307E\u3059");
    }
    const catalog = questionProfileCatalog();
    if (request.method === "GET") return jsonResponse({ ...await readQuestionProfile(dependencies.database), catalog });
    if (request.method !== "PATCH") throw new ApiError(405, "method_not_allowed", "\u3053\u306E\u64CD\u4F5C\u306F\u5229\u7528\u3067\u304D\u307E\u305B\u3093");
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "profile", "expectedRevision"]);
    let profile;
    try {
      profile = validateQuestionProfileShape(value.profile);
      validateQuestionProfile(profile);
    } catch (error) {
      throw new ApiError(400, "invalid_question_profile", error instanceof Error ? error.message : "\u51FA\u984C\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    const saved = await updateQuestionProfile(dependencies.database, {
      teacherId: teacher.id,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRevision: integerValue(value.expectedRevision, "expectedRevision"),
      profile,
      nowMs: dependencies.now()
    });
    return jsonResponse({ ...saved, catalog });
  });
  const teacherSiteSettings = (request) => safe(async () => {
    const teacher = await requireApplicationTeacher(dependencies, request);
    const nowMs = dependencies.now();
    await cleanupExpired(dependencies.database, { nowMs, limit: LAZY_CLEANUP_LIMIT });
    if (request.method === "GET") return jsonResponse(await readMateEnabled(dependencies.database));
    if (!await isMasterTeacher(dependencies, teacher)) {
      throw new ApiError(403, "master_required", "\u30DE\u30B9\u30BF\u30FC\u6559\u54E1\u306E\u307F\u64CD\u4F5C\u3067\u304D\u307E\u3059");
    }
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["requestId", "enabled", "expectedRevision"]);
    if (typeof value.enabled !== "boolean") throw new ApiError(400, "invalid_request", "enabled\u304C\u4E0D\u6B63\u3067\u3059");
    return jsonResponse(await updateSiteSettingsCommand(dependencies.database, {
      teacherId: teacher.id,
      requestId: requestId(value.requestId),
      bodyHash: bodyHash2,
      expectedRevision: integerValue(value.expectedRevision, "expectedRevision"),
      enabled: value.enabled,
      nowMs
    }));
  });
  const teacherSession = (request) => safe(async () => {
    const teacher = await requireApplicationTeacher(dependencies, request);
    return jsonResponse({ email: teacher.email, role: await isMasterTeacher(dependencies, teacher) ? "master" : "teacher" });
  });
  const teacherAllowlist = (request) => safe(async () => {
    if (dependencies.teacherAllowlistCommand) return dependencies.teacherAllowlistCommand(request);
    const teacher = await requireVerifiedTeacher(request, dependencies.teacherIdentity);
    const master = dependencies.serverConfig.masterTeacherEmail;
    if (!master || teacher.email !== master) throw new ApiError(403, "master_required", "\u30DE\u30B9\u30BF\u30FC\u6559\u54E1\u306E\u307F\u64CD\u4F5C\u3067\u304D\u307E\u3059");
    let current = await readTeacherAllowlist(dependencies.database);
    const view = (row) => ({ masterEmail: master, emails: JSON.parse(row.emails_json), revision: row.revision });
    if (request.method === "GET") return jsonResponse(view(current));
    const { value, bodyHash: bodyHash2 } = await readMutationBody(request);
    assertKeys(value, ["email", "enabled", "expectedRevision", "requestId"]);
    const key2 = requestId(value.requestId);
    const expected = integerValue(value.expectedRevision, "expectedRevision");
    if (typeof value.email !== "string" || typeof value.enabled !== "boolean") throw new ApiError(400, "invalid_request", "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3068\u64CD\u4F5C\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
    const email = normalizeTeacherEmail(value.email);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "invalid_email", "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    if (email === master) throw new ApiError(400, "master_fixed", "\u30DE\u30B9\u30BF\u30FC\u6559\u54E1\u306F\u3053\u306E\u753B\u9762\u3067\u306F\u5909\u66F4\u3067\u304D\u307E\u305B\u3093");
    if (current.last_request_id === key2) {
      if (current.last_body_hash !== bodyHash2) throw new ApiError(409, "request_id_reused", "\u64CD\u4F5CID\u304C\u518D\u5229\u7528\u3055\u308C\u3066\u3044\u307E\u3059");
      return jsonResponse(view(current));
    }
    if (current.revision !== expected) throw new ApiError(409, "stale_allowlist", "\u4E00\u89A7\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044");
    const emails = new Set(JSON.parse(current.emails_json));
    if (value.enabled) emails.add(email);
    else emails.delete(email);
    if (emails.size > 100) throw new ApiError(400, "allowlist_limit", "\u8A31\u53EF\u6559\u54E1\u306F100\u4EF6\u307E\u3067\u767B\u9332\u3067\u304D\u307E\u3059");
    const result = await dependencies.database.batch([
      dependencies.database.prepare("INSERT OR IGNORE INTO teacher_allowlist (id) VALUES (1)"),
      dependencies.database.prepare("UPDATE teacher_allowlist SET emails_json = ?, revision = revision + 1, last_request_id = ?, last_body_hash = ? WHERE id = 1 AND revision = ?").bind(JSON.stringify([...emails].sort()), key2, bodyHash2, expected)
    ]);
    current = await readTeacherAllowlist(dependencies.database);
    if (!result[1]?.meta.changes && !(current.last_request_id === key2 && current.last_body_hash === bodyHash2)) throw new ApiError(409, "stale_allowlist", "\u4E00\u89A7\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044");
    return jsonResponse(view(current));
  });
  return {
    teacherQuestionProfile,
    teacherSession,
    teacherAllowlist,
    publicConfig,
    joinInfo,
    createClassRoom,
    createMateRoom,
    joinRoom: join,
    nickname,
    updateRoomSettings,
    startRoom: start,
    manifest,
    ready,
    cancelPreparation,
    operations,
    writer,
    drafts,
    cancelRoom: cancel,
    interruptRoom: interrupt,
    removeParticipant: removeParticipant2,
    actions,
    state,
    results,
    resultSummary,
    teacherSiteSettings
  };
}

// src/platform/supabase-identity.ts
function googleIdentity(user) {
  if (user.is_anonymous || !user.email || !user.email_confirmed_at || !user.identities?.some((x) => x.provider === "google")) return null;
  return { id: user.id, email: normalizeTeacherEmail(user.email) };
}
async function verifySupabaseUser(request, url2, key2) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${url2}/auth/v1/user`, { headers: { authorization, apikey: key2 }, signal: AbortSignal.timeout(5e3) });
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user.id === "string" && user.id ? user : null;
}

// src/web/realtime-policy.ts
var reservedEventCost = (people) => 1 + people * 2;

// src/platform/realtime-outbox.ts
async function readRoom(db, publicId) {
  return db.prepare(`SELECT r.id,r.public_id,r.kind,r.state,r.revision,r.owner_teacher_id,r.mate_host_id,r.settings_json,r.start_at_ms,r.deadline_at_ms,r.expires_at_ms,
    m.state AS manifest_state,m.preparation_generation,m.cutoff_at_ms,m.collection_until_ms
    FROM rooms r LEFT JOIN v2_room_manifests m ON m.room_id=r.id WHERE r.public_id=?`).bind(publicId).first();
}
async function readParticipants(db, id) {
  return (await db.prepare(`SELECT p.id,p.nickname,p.status,p.joined_order,p.current_ordinal,p.correct_count,p.resolved_question_count,p.revision,p.elapsed_cs,p.timing_source,
    COALESCE(v.answered_count,0) AS answered_count,v.finished_elapsed_ms,v.ready_generation
    FROM participants p LEFT JOIN v2_participant_progress v ON v.room_id=p.room_id AND v.participant_id=p.id
    WHERE p.room_id=? ORDER BY p.joined_order,p.id`).bind(id).all()).results;
}
async function roomFingerprint(db, publicId) {
  const r = await readRoom(db, publicId);
  if (!r) return null;
  const participants = await readParticipants(db, r.id);
  return {
    control: JSON.stringify([
      r.state,
      r.manifest_state,
      r.settings_json,
      r.start_at_ms,
      r.deadline_at_ms,
      r.cutoff_at_ms,
      r.collection_until_ms,
      participants.map((p) => [p.id, p.nickname, p.status, p.ready_generation])
    ]),
    progress: JSON.stringify(participants.map((p) => [p.id, p.correct_count, p.answered_count, p.revision, p.finished_elapsed_ms]))
  };
}
async function queueRoomEvents(db, publicId, before, now) {
  const next = await roomFingerprint(db, publicId);
  const room = await readRoom(db, publicId);
  if (!room || !next) return;
  const kinds = [];
  if (!before || before.control !== next.control) kinds.push("control");
  if (!before || before.progress !== next.progress) kinds.push("host");
  if (!kinds.length) return;
  const topic = await db.prepare("UPDATE app_room_topics SET progress_revision=progress_revision+1,control_revision=control_revision+1 WHERE room_id=? RETURNING epoch,progress_revision,control_revision").bind(room.id).first();
  if (!topic) return;
  for (const kind of kinds) {
    const event = { eventId: crypto.randomUUID(), roomId: publicId, epoch: topic.epoch, revision: kind === "host" ? topic.progress_revision : topic.control_revision, serverNow: now, roomRevision: room.revision };
    if (kind === "host") {
      const people = await readParticipants(db, room.id);
      event.participants = people.filter((p) => p.status !== "REMOVED").map((p) => ({
        id: p.id,
        joinedOrder: p.joined_order,
        nickname: p.nickname,
        status: p.status,
        currentOrdinal: p.current_ordinal,
        correctCount: p.correct_count,
        resolvedQuestionCount: p.resolved_question_count,
        answeredCount: p.answered_count,
        revision: p.revision,
        elapsedCs: p.elapsed_cs,
        timingSource: p.timing_source,
        submitted: p.finished_elapsed_ms != null
      }));
    } else {
      event.phase = room.manifest_state ?? room.state;
      event.startAtMs = room.start_at_ms;
      event.deadlineAtMs = room.deadline_at_ms;
      event.cutoffAtMs = room.cutoff_at_ms;
      event.collectionUntilMs = room.collection_until_ms;
    }
    await db.prepare(`INSERT INTO app_outbox(room_id,kind,revision,payload_json,event_id) VALUES(?,?,?,?,?)
      ON CONFLICT(room_id,kind) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,event_id=excluded.event_id`).bind(room.id, kind, event.revision, JSON.stringify(event), event.eventId).run();
  }
}
async function flushRoomEvents(transact2, publicId, send, now = Date.now()) {
  const claimed = await transact2(`broadcast:${publicId}`, async (db) => {
    await db.prepare("SELECT app_expire_teacher_leases(?)").bind(now).run();
    const room = await readRoom(db, publicId);
    if (!room || room.expires_at_ms <= now) return [];
    const topic = await db.prepare("SELECT epoch,sent_control_ms,sent_progress_ms FROM app_room_topics WHERE room_id=?").bind(room.id).first();
    const pending = (await db.prepare(`SELECT * FROM app_outbox WHERE room_id=? AND lease_until_ms<? ORDER BY CASE kind WHEN 'control' THEN 0 ELSE 1 END`).bind(room.id, now).all()).results;
    const recipients = await db.prepare(`SELECT count(*) AS count FROM participants WHERE room_id=? AND status<>'REMOVED'`).bind(room.id).first();
    const hosts = 1;
    const result = [];
    for (const event of pending) {
      if (event.kind === "host" && room.kind === "class") {
        const owner = await db.prepare("SELECT uid FROM app_teacher_bindings WHERE uid=? AND active=true AND lease_until_ms>?").bind(room.owner_teacher_id, now).first();
        if (!owner) continue;
      }
      if (now - (event.kind === "host" ? topic.sent_progress_ms : topic.sent_control_ms) < 1e3) continue;
      const cost = reservedEventCost(event.kind === "host" ? hosts : Number(recipients?.count ?? 0) + (room.kind === "mate" ? 0 : 1));
      const budget = await db.prepare("SELECT window_ms,used FROM app_broadcast_budget WHERE id=1 FOR UPDATE").first();
      const window = Math.floor(now / 1e3) * 1e3;
      const used = budget.window_ms === window ? budget.used : 0;
      if (used + cost > 90) continue;
      await db.prepare("UPDATE app_broadcast_budget SET window_ms=?,used=? WHERE id=1").bind(window, used + cost).run();
      const lease = crypto.randomUUID();
      await db.prepare("UPDATE app_outbox SET lease_id=?,lease_until_ms=? WHERE room_id=? AND kind=?").bind(lease, now + 5e3, room.id, event.kind).run();
      result.push({
        ...event,
        lease,
        topic: `room:${publicId}:${event.kind === "host" ? "host" : "control"}:${topic.epoch}`,
        epoch: topic.epoch,
        room_kind: room.kind,
        owner_uid: room.owner_teacher_id
      });
    }
    return result;
  });
  for (const event of claimed) {
    try {
      const payload = JSON.parse(event.payload_json);
      if (payload.epoch !== event.epoch) continue;
      await transact2(`room:${publicId}`, async (db) => {
        await db.prepare("SELECT app_expire_teacher_leases(?)").bind(now).run();
        const current = await db.prepare("SELECT epoch FROM app_room_topics WHERE room_id=? FOR UPDATE").bind(event.room_id).first();
        if (current?.epoch !== event.epoch) return;
        if (event.kind === "host" && event.room_kind === "class") {
          const owner = await db.prepare("SELECT uid FROM app_teacher_bindings WHERE uid=? AND active=true AND lease_until_ms>?").bind(event.owner_uid, now).first();
          if (!owner) return;
        }
        await send(event.topic, event.kind === "host" ? "host.progress" : "room.changed", payload);
        await db.prepare("DELETE FROM app_outbox WHERE room_id=? AND kind=? AND event_id=? AND lease_id=?").bind(event.room_id, event.kind, event.event_id, event.lease).run();
        await db.prepare(`UPDATE app_room_topics SET ${event.kind === "host" ? "sent_progress_ms" : "sent_control_ms"}=? WHERE room_id=?`).bind(now, event.room_id).run();
      });
    } catch {
      await transact2(`broadcast:${publicId}`, async (db) => {
        await db.prepare("UPDATE app_outbox SET lease_until_ms=0 WHERE room_id=? AND kind=? AND lease_id=?").bind(event.room_id, event.kind, event.lease).run();
      });
    }
  }
}

// src/platform/supabase-gateway.ts
var topRoutes = {
  "/api/public-config": { method: ["GET"], name: "publicConfig" },
  "/api/join-info": { method: ["GET"], name: "joinInfo" },
  "/api/class-rooms": { method: ["POST"], name: "createClassRoom" },
  "/api/mate-rooms": { method: ["POST"], name: "createMateRoom" },
  "/api/teacher/session": { method: ["GET"], name: "teacherSession" },
  "/api/teacher/allowlist": { method: ["GET", "POST"], name: "teacherAllowlist" },
  "/api/teacher/question-profile": { method: ["GET", "PATCH"], name: "teacherQuestionProfile" },
  "/api/teacher/site-settings": { method: ["GET", "PATCH"], name: "teacherSiteSettings" }
};
var roomRoutes = {
  state: { method: ["GET"], name: "state" },
  join: { method: ["POST"], name: "joinRoom" },
  nickname: { method: ["PATCH"], name: "nickname" },
  settings: { method: ["PATCH"], name: "updateRoomSettings" },
  start: { method: ["POST"], name: "startRoom" },
  manifest: { method: ["GET"], name: "manifest" },
  ready: { method: ["POST"], name: "ready" },
  "cancel-preparation": { method: ["POST"], name: "cancelPreparation" },
  operations: { method: ["POST"], name: "operations" },
  drafts: { method: ["GET", "POST"], name: "drafts" },
  writer: { method: ["POST"], name: "writer" },
  cancel: { method: ["POST"], name: "cancelRoom" },
  interrupt: { method: ["POST"], name: "interruptRoom" },
  remove: { method: ["POST"], name: "removeParticipant" },
  actions: { method: ["POST"], name: "actions" },
  results: { method: ["GET"], name: "results" },
  "result-summary": { method: ["GET"], name: "resultSummary" }
};
function failure(status, code, message) {
  return jsonResponse({ error: { code, message } }, status);
}
function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,apikey,content-type,x-region,x-participant-authorization,x-competition-csrf,x-creation-key");
  headers.set("access-control-expose-headers", "retry-after,x-request-id");
  return new Response(response.body, { status: response.status, headers });
}
async function teacherProvider(db, user, decision, now) {
  const identity = googleIdentity(user);
  if (!identity) return { getVerifiedIdentity: async () => null };
  if (!decision) return { getVerifiedIdentity: async () => identity };
  if (!decision.allowed || decision.email !== identity.email) {
    await db.prepare("UPDATE app_teacher_bindings SET active=false,lease_until_ms=0 WHERE uid=? AND active=true").bind(user.id).run();
    return { getVerifiedIdentity: async () => identity };
  }
  const byUid = await db.prepare("SELECT email,active FROM app_teacher_bindings WHERE uid=?").bind(user.id).first();
  const byEmail = await db.prepare("SELECT uid FROM app_teacher_bindings WHERE email=?").bind(identity.email).first();
  if (byUid && byUid.email !== identity.email || byEmail && byEmail.uid !== user.id) throw new Error("Teacher identity binding conflict");
  if (!byUid) await db.prepare("INSERT INTO app_teacher_bindings(uid,email,active,lease_until_ms) VALUES(?,?,true,?)").bind(user.id, identity.email, now + 6e4).run();
  else await db.prepare("UPDATE app_teacher_bindings SET active=true,lease_until_ms=? WHERE uid=?").bind(now + 6e4, user.id).run();
  return { getVerifiedIdentity: async () => identity };
}
async function associateParticipant(db, user, request, publicId) {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
  if (!match) return;
  const hash = await hashParticipantToken(match[1]);
  const participant = await db.prepare(`SELECT p.room_id,p.id FROM participants p JOIN rooms r ON r.id=p.room_id
    WHERE r.public_id=? AND p.token_hash=? AND p.status<>'REMOVED'`).bind(publicId, hash).first();
  if (!participant) return;
  const old = await db.prepare("SELECT uid FROM app_memberships WHERE room_id=? AND participant_id=?").bind(participant.room_id, participant.id).first();
  await db.prepare(`INSERT INTO app_memberships(room_id,participant_id,uid) VALUES(?,?,?)
    ON CONFLICT(room_id,participant_id) DO UPDATE SET uid=excluded.uid WHERE app_memberships.uid<>excluded.uid`).bind(participant.room_id, participant.id, user.id).run();
  if (old && old.uid !== user.id) await db.prepare("INSERT INTO app_audit(actor_uid,event,room_id) VALUES(?,?,?)").bind(user.id, "participant_rebound", participant.room_id).run();
}
async function topicsFor(db, user, publicId, now) {
  const room = await db.prepare("SELECT id,owner_teacher_id,mate_host_id,expires_at_ms,state FROM rooms WHERE public_id=?").bind(publicId).first();
  if (!room || room.expires_at_ms <= now) return null;
  const member = await db.prepare(`SELECT m.participant_id FROM app_memberships m JOIN participants p ON p.room_id=m.room_id AND p.id=m.participant_id
    WHERE m.room_id=? AND m.uid=? AND p.status<>'REMOVED'`).bind(room.id, user.id).first();
  const teacher = await db.prepare("SELECT uid FROM app_teacher_bindings WHERE uid=? AND active=true AND lease_until_ms>?").bind(user.id, now).first();
  const owner = teacher?.uid === room.owner_teacher_id;
  if (!member && !owner) return null;
  const row = await db.prepare("SELECT epoch FROM app_room_topics WHERE room_id=?").bind(room.id).first();
  const epoch = row?.epoch ?? 1;
  return { control: `room:${publicId}:control:${epoch}`, host: owner || member?.participant_id === room.mate_host_id ? `room:${publicId}:host:${epoch}` : null, epoch, role: owner ? "teacher" : member?.participant_id === room.mate_host_id ? "host" : "participant" };
}
function createSupabaseGateway(options) {
  return async (incoming) => {
    const receivedAtMs = (options.now ?? Date.now)();
    const origin = incoming.headers.get("origin");
    if (!origin || !options.allowedOrigins.includes(origin)) return failure(403, "origin_forbidden", "\u8A31\u53EF\u3055\u308C\u305F\u30A2\u30D7\u30EA\u304B\u3089\u5229\u7528\u3057\u3066\u304F\u3060\u3055\u3044");
    if (incoming.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin);
    const url2 = new URL(incoming.url);
    const marker = url2.pathname.indexOf("/api/");
    if (marker < 0) return withCors(failure(404, "not_found", "API\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"), origin);
    const path = url2.pathname.slice(marker);
    const match = /^\/api\/rooms\/([A-Za-z0-9_-]{1,128})\/([a-z-]+)$/.exec(path);
    const route = topRoutes[path] ?? (match ? roomRoutes[match[2]] : void 0);
    const realtime = match?.[2] === "realtime";
    if (!route && !realtime) return withCors(failure(404, "not_found", "API\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"), origin);
    if (!(realtime ? ["GET"] : route.method).includes(incoming.method)) return withCors(failure(405, "method_not_allowed", "\u64CD\u4F5C\u65B9\u6CD5\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044"), origin);
    try {
      const user = await options.verifyUser(incoming);
      if (!user) return withCors(failure(401, "authentication_required", "\u53C2\u52A0\u8CC7\u683C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093"), origin);
      const headers = new Headers(incoming.headers);
      const participant = headers.get("x-participant-authorization");
      headers.delete("authorization");
      if (participant) headers.set("authorization", participant);
      headers.set("origin", "https://competition.internal");
      headers.delete("sec-fetch-site");
      const request = new Request(`https://competition.internal${path}${url2.search}`, { method: incoming.method, headers, body: ["GET", "HEAD"].includes(incoming.method) ? void 0 : incoming.body, duplex: "half" });
      let publicId = match?.[1] ?? "";
      const scope = path.startsWith("/api/teacher/") ? "teacher-configuration" : publicId ? `room:${publicId}` : `creation:${user.id}`;
      const response = await options.transact(scope, async (db) => {
        const now = (options.now ?? Date.now)();
        if (crypto.getRandomValues(new Uint32Array(1))[0] % 200 === 0) await db.prepare("SELECT app_prune_auxiliary()").run();
        await db.prepare("SELECT app_expire_teacher_leases(?)").bind(now).run();
        const bucket = `${user.id}:${Math.floor(now / 6e4)}`;
        const limit = await db.prepare(`INSERT INTO app_request_limits(bucket,window_ms,count) VALUES(?,?,1)
          ON CONFLICT(bucket) DO UPDATE SET count=app_request_limits.count+1 RETURNING count`).bind(bucket, now).first();
        if ((limit?.count ?? 0) > 180) {
          const limited = failure(429, "rate_limited", "\u901A\u4FE1\u304C\u96C6\u4E2D\u3057\u3066\u3044\u307E\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044");
          limited.headers.set("retry-after", String(Math.ceil((6e4 - now % 6e4) / 1e3)));
          return limited;
        }
        const identity = googleIdentity(user);
        const owner = publicId ? await db.prepare("SELECT owner_teacher_id FROM rooms WHERE public_id=?").bind(publicId).first() : null;
        const needsTeacher = !!identity && (path.startsWith("/api/teacher/") || route?.name === "createClassRoom" || owner?.owner_teacher_id === user.id);
        const bearer = incoming.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        const decision = needsTeacher && options.sharedTeacher && bearer ? await options.sharedTeacher.authorize(bearer) : null;
        const provider = await teacherProvider(db, user, decision, now);
        const handlers = createApiHandlers({
          database: db,
          teacherIdentity: provider,
          teacherAuthorization: async (checked) => ({ allowed: !!decision?.allowed && decision.email === checked.email, master: !!decision?.master }),
          teacherAllowlistCommand: async (forwarded) => options.sharedTeacher && bearer ? options.sharedTeacher.allowlist(bearer, forwarded) : failure(503, "identity_unavailable", "\u6559\u54E1\u8A8D\u8A3C\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093"),
          serverConfig: { teacherAllowedEmails: [], masterTeacherEmail: options.masterEmail.trim().toLowerCase() },
          now: options.now ?? Date.now,
          random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
          randomUUID: () => crypto.randomUUID()
        });
        const before = publicId ? await roomFingerprint(db, publicId) : null;
        const result = await handlers[realtime ? "state" : route.name](request.clone(), { id: publicId });
        if (!result.ok) return result;
        const body = await result.clone().json();
        publicId = publicId || body.room?.id || "";
        if (publicId) {
          const room = await db.prepare("SELECT id FROM rooms WHERE public_id=?").bind(publicId).first();
          if (room) {
            await db.prepare("INSERT OR IGNORE INTO app_room_topics(room_id) VALUES(?)").bind(room.id).run();
            await associateParticipant(db, user, request, publicId);
            await queueRoomEvents(db, publicId, before, now);
          }
          const topics = await topicsFor(db, user, publicId, now);
          if (realtime) return topics ? jsonResponse(topics) : failure(403, "not_authorized", "\u901A\u77E5\u3092\u8CFC\u8AAD\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093");
          if (route?.name === "state" && topics) return jsonResponse({ ...body, realtime: topics });
        }
        return result;
      });
      if (publicId) void options.flush(publicId).catch(() => {
      });
      const timedResponse = route?.name === "state" && response.ok ? jsonResponse({ ...await response.clone().json(), serverTiming: { receivedAtMs, sentAtMs: (options.now ?? Date.now)() } }) : response;
      return withCors(timedResponse, origin);
    } catch (error) {
      console.error(JSON.stringify({ event: "gateway_failed", category: error instanceof Error ? error.name : "Unknown", code: typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : void 0 }));
      return withCors(failure(503, "service_unavailable", "\u30B5\u30FC\u30D3\u30B9\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044"), origin);
    }
  };
}

// src/platform/shared-teacher-client.ts
var encoder = new TextEncoder();
async function signature(secret, body) {
  const key2 = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key2, encoder.encode(body)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function createSharedTeacherClient(options) {
  if (!/^https:\/\//.test(options.url) || !options.appId || options.secret.length < 32) throw new Error("Shared teacher client configuration is incomplete");
  const send = async (action, bearerToken, mutation) => {
    const body = JSON.stringify({ appId: options.appId, requestId: (options.randomUUID ?? crypto.randomUUID)(), issuedAtMs: (options.now ?? Date.now)(), action, bearerToken, ...mutation ? { mutation } : {} });
    try {
      return await (options.fetch ?? fetch)(options.url, { method: "POST", headers: {
        "content-type": "application/json",
        "x-shared-teacher-signature": await signature(options.secret, body)
      }, body, signal: AbortSignal.timeout(7e3) });
    } catch {
      throw new Error("authority_unavailable");
    }
  };
  return {
    async authorize(bearerToken) {
      const response = await send("authorize", bearerToken);
      if (response.status === 403) return { allowed: false, master: false, email: "", revision: -1 };
      if (!response.ok) throw new Error("authority_unavailable");
      let value;
      try {
        value = await response.json();
      } catch {
        throw new Error("authority_unavailable");
      }
      if (!value || typeof value !== "object") throw new Error("authority_unavailable");
      const result = value;
      if (result.allowed !== true || typeof result.master !== "boolean" || typeof result.email !== "string" || !Number.isSafeInteger(result.revision)) throw new Error("authority_unavailable");
      return result;
    },
    async allowlist(bearerToken, request) {
      let mutation;
      if (request.method === "POST") {
        try {
          const body = await request.text();
          if (encoder.encode(body).length > 4096) return new Response(JSON.stringify({ error: { code: "body_too_large" } }), { status: 413, headers: { "content-type": "application/json" } });
          mutation = JSON.parse(body);
        } catch {
          return new Response(JSON.stringify({ error: { code: "invalid_request" } }), { status: 400, headers: { "content-type": "application/json" } });
        }
      }
      const response = await send(request.method === "POST" ? "allowlist.mutate" : "allowlist.get", bearerToken, mutation);
      if (response.status >= 500) throw new Error("authority_unavailable");
      return response;
    }
  };
}

// src/platform/edge-entry.ts
var required = (name) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing backend configuration: ${name}`);
  return value;
};
var url = required("SUPABASE_URL");
var key = required("SUPABASE_ANON_KEY");
var serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
var databaseUrl = required("COMPETITION_DATABASE_URL");
var transact = postgresTransactions(databaseUrl);
var authorityUrl = Deno.env.get("SHARED_TEACHER_AUTHORITY_URL");
var authoritySecret = Deno.env.get("SHARED_TEACHER_HMAC_SECRET");
var sharedTeacher = authorityUrl && authoritySecret ? createSharedTeacherClient({
  url: authorityUrl,
  appId: "alkane-puzzle-competition",
  secret: authoritySecret
}) : void 0;
async function flush(publicId) {
  await flushRoomEvents(transact, publicId, async (topic, event, payload) => {
    const result = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
      signal: AbortSignal.timeout(3e3)
    });
    if (!result.ok) throw new Error("Broadcast delivery failed");
  });
}
var gateway = createSupabaseGateway({
  transact,
  verifyUser: (request) => verifySupabaseUser(request, url, key),
  masterEmail: required("MASTER_TEACHER_EMAIL"),
  allowedOrigins: required("ALLOWED_ORIGINS").split(",").map((x) => x.trim()).filter(Boolean),
  sharedTeacher,
  flush: async (id) => {
    EdgeRuntime.waitUntil(flush(id));
  }
});
Deno.serve(gateway);
