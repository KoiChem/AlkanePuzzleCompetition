# AlkanePuzzleCompetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute authorized tasks continuously; parent AGENTS.md overrides repeated approval gates.

**Goal:** 合意した両ゲームのクラス・メイト競技を実装し、必要なSupabase設定を順次案内する。
**Architecture:** 現在のイオンコンペから競技基盤を移植する。DOM非依存の本家パズル処理、Reactのゲーム表示、共通教員認可を分離し、部屋設定と問題一式を固定する。
**Tech Stack:** React 19 / TypeScript / Vite / Supabase / PostgreSQL / Vitest / Playwright。
**Spec:** docs/superpowers/specs/2026-10-03-alkane-puzzle-competition-design.md

## Global Constraints
- 並べる・名付ける、すいすい・まあまあ、5/10/15問、3〜10分、クラス42名、メイト4名。
- 全UIの配色は本家AlkanePuzzle。開始前のホスト・ゲストUIの構成と操作は現在のイオンコンペ。
- シクロ置換基数は0/1/2以上の単一選択、OH除外。すいすい既定0、まあまあ既定1。
- 出題・設定固定、途中解答復元、同じ問題と表示順、1問1点、14日保存を初版で実装。
- ソースの既存差分を保存し、公開・既存サービスへの適用は行わない。
- source ionic baseline: 9bb8bff2bd4f19a59aed92c722320bb0e094ef93; alkane baseline: f2e231b4db4bfae199ce06afdd44e8b4cf41cafe.

## Review Focus
- 環の置換基数とOHの組み合わせが生成不能なら開始前に停止する。
- 途中解答を古いサーバー値や別writer世代で上書きしない。
- まとめて判定の構造図と語群から正誤を表示しない。
- 共通許可取り消しと認可元障害が既存生徒の競技を妨げない。
- 既存イオンコンペのAuth UUIDへ別プロジェクトUUIDを混ぜない。

### Task 1: パズル純粋処理と設定
**Files:** src/games/alkane-puzzle/shared/{types,question-profile,answer-evaluator}.ts; shared/engine.js; server/{question-generator,answer-evaluator}.ts; tests/alkane/core.test.ts.
**Interfaces:** AlkaneGameSettings uses mode arrange|name, difficulty easy|medium, alcoholEnabled, gradingMode, chemistryContentVersion; retains unused optional legacy keys only where required to compile transport. InternalQuestion retains transport field IDs formula (structure) and name (tokens); alkane prompt payload contains grid, options, wordBank and mode. Export existing generator entry signatures generateQuestionSet, validateGameSettings, validateQuestionProfile, publicQuestion; evaluateField and EVALUATOR_VERSION; DEFAULT_QUESTION_PROFILE, validateQuestionProfileShape, questionProfileCatalog. Profile is mode/difficulty-indexed with exact settings from spec and cycloSubstituentCount: 0|1|2.
- [ ] Write and run failing tests for generator/evaluator, translated/rotated grids, cyclo 0/1/2+, alcohol, malformed inputs and bounded generation failures.
- [ ] Extract committed original pure generation/naming code without DOM, preserving rules; implement profile validation, deterministic room question generation and token parsing.
- [ ] Run focused tests; record provenance and outcomes.

### Task 2: UIと設定画面
**Files:** src/games/alkane-puzzle/client/QuestionView.tsx and alkane styles; src/features/setup/CompetitionSettingsForm.tsx; app/teacher/{QuestionProfileDialog,TeacherManagement}.tsx; app/{styles,globals}.css; tests/alkane/ui.test.tsx.
**Interfaces:** QuestionView keeps existing props question, fieldId, value, onChange, disabled; uses Task 1 question. Produce reusable AlkaneBoard read-only renderer for result review. Profile dialog GET/PATCH payload remains profile/revision/catalog. Transport field ID formula means board only, never display ionic wording.
- [ ] Write failing UI tests for game labels, all profile fields, 3 cyclo choices, original color tokens and board/token edits.
- [ ] Implement original puzzle board panels, long-press dragging, rotation, naming word-bank and local markup; apply original palette throughout while keeping pregame ionic structure.
- [ ] Rewrite settings form and profile modal; preserve server save/revision conflicts, keyboard/focus and disabled states.
- [ ] Run UI tests/typecheck; no iframe or independent embedded game state.

### Task 3: 共通教員認可
**Files:** both apps src/platform/shared-teacher*.ts, edge-entry.ts, supabase-gateway.ts; ionic supabase/migrations/202610040001_shared_teacher_authority.sql; alkane supabase/migrations/202610040001_teacher_leases.sql; tests/alkane/shared-teacher.test.ts; docs/SHARED_TEACHER_SETUP.md.
**Interfaces:** Signed server request uses appId, requestId, issuedAtMs, action, bearer token and optional allowlist mutation; central registry stores allowed caller auth URL/publishable key and app HMAC secret in Edge secrets. verify remote token through fixed /auth/v1/user, check Google confirmed email; central returns allowed/master/email/revision. Alkane provider verifies each teacher management operation, writes own uid binding with <=60s lease. Browser-only declarations do not authorize. Common mutations use original allowlist command with CAS/request IDs.
- [ ] Write failing tests for signature/token/email spoofing, expiration/replay, role denial, remote project isolation, revoke and unavailable authority.
- [ ] Implement central service additively in ionic app and client adapter/gateway in alkane; do not alter deployed secrets or data.
- [ ] Provide exact manual secret/registry instructions without printing secrets; run source app auth regression tests and new tests.

### Task 4: 競技統合・復元・結果
**Files:** src/platform/http.ts, result-answer.ts; src/persistence/*; src/features/play/CompetitionPlayerV2.tsx and draft storage; src/features/results/*; src/web/*; app/page.tsx and defaults; tests/alkane/competition.test.ts.
**Interfaces:** Task1 single-field typed JSON enters existing V2 operation sequencing, and Task2 editor onChange writes drafts. publicQuestion must preserve alkane data. Internal names and local keys namespace AlkanePuzzleCompetition. Latest-draft server storage distinguishes draft from grading and records epoch/revision/editedElapsedMs. Results retain typed raw answer for board and name rendering.
- [ ] Write failing integration tests for both modes and grading modes, room profile snapshots, stable questions, progress count, server scoring and typed results.
- [ ] Adapt parseSettings and game version guards; class room captures profile, mate room uses DEFAULT; reuse existing start/preparation/time/retry/ranking logic.
- [ ] Write failing tests for draft recovery, older draft rejection, lost acknowledgement and duplicate sends; implement completed-edit local persistence and <=2s draft sync without changing deadline.
- [ ] Add review renderers and expiry display; run core/persistence/API regression and integration tests.

### Task 5: Supabase運用と保守
**Files:** supabase/migrations/202610040002_drafts_retention.sql; src/config/public.ts; scripts/*; docs/{OPERATIONS,IMPLEMENTATION_PROGRESS}.md; README.md; .env.example.
**Interfaces:** Dedicated project public config defaults empty; no existing project target copied. Retention starts at result finalization, 14 days default; scheduled prune every15min, bounded deletion; protect teachers/current participants in Auth maintenance.
- [ ] Write failing tests for retention, expired room access, bounded scheduled cleanup and anonymous maintenance protection.
- [ ] Implement dedicated migration, scheduler SQL, draft cleanup, config setup and sizing tool; report capacity from measurements, not assumed quotas.
- [ ] Guide project creation/public config, OAuth, SQL application, function secrets/deploy, private Realtime and cron in concrete stages as required; live steps wait for required inputs while independent local work continues.

### Task 6: 統合検証とレビュー
**Files:** tests/browser/ local fixtures; tests/e2e/ alkane flows; docs/IMPLEMENTATION_PROGRESS.md.
- [ ] Run typecheck, production build, Edge bundle and focused+generic suites; compare original engine reference cases.
- [ ] Use Playwright MCP on local fixtures to verify teacher/guest pregame, modes, both grading styles, restore, results, modal and 390px/tablet/PC overflow, console/network errors.
- [ ] Run 42-participant flow in local PostgreSQL fixture and record scope; live Google/Supabase and real iOS checks remain separate.
- [ ] Fresh review of feature units and complete branch; fix material issues and re-run affected checks.
- [ ] Commit verified local work only. No push/deploy without publication authorization. Report exact remaining manual steps and unverified live/device checks.
