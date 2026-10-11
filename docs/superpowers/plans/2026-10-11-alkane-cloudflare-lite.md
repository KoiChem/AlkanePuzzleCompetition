# アルカンコンペ Cloudflare Lite Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Native execution in the existing checkout; new application files are isolated under cloudflare-lite/. Final fresh reviewer uses requesting-code-review.

**Goal:** 本家互換のアルカンパズルをクラス50名・メイト4名で競技できるCloudflareアプリを実装する。
**Architecture:** Static Assets + Worker + 1 Room = 1 SQLite Durable Object。管理DOは教員認証・許可リスト・共通難易度を保持する。
**Tech Stack:** React / TypeScript / Vite / Workers / SQLite DO / WebSocket / IndexedDB。
**Spec:** ../specs/2026-10-11-alkane-competition-cloudflare-lite-design.md

## Global Constraints
- URL: https://alkanecompetition.koichem.workers.dev, Worker: alkanecompetition。
- マスター: taiyaki.taiyaki.taiyaki@gmail.com。登録教員のみクラス作成。
- 並べる・名付ける、すいすい・まあまあ、OH ON/OFF、問題ごと・まとめて判定。
- クラス50名、メイト作成者を含む4名、5/10/15問、3〜10分、開始5秒後、開始から7日保持。
- 本家とイオン版の公開先・既存Supabaseデータを変更しない。公開は今回の実装依頼には含めない。

## Review Focus
- 二重タブ・同一seq別内容: 古い接続・操作を拒否し重複加点しない。
- 締切中の同期: 未同期盤面を成功扱いせず採用可否と状態を示す。
- メイト管理資格: 教員向け他者解答を読めない。
- 共通設定: 匿名作成者が任意設定を注入できず、作成済み部屋の版を保持する。
- 生成不能・CPU負荷: 設定外救済を排除し、不足なら待機に戻す。

### Task 1: 教材互換と専用構成
**Files:** cloudflare-lite/game/{engine.js,engine.d.ts,profile.ts,generator.ts,evaluator.ts}; cloudflare-lite/tests/game.test.ts; cloudflare-lite/{package.json,vitest.config.ts,wrangler.jsonc,tsconfig.json,tsconfig.worker.json}。
**Interfaces:** validateProfile(raw), DEFAULT_PROFILE, generateQuestionSet(settings,random,profile), evaluateField(question,fieldId,value), isAnswerEmpty(value)。既存AlkaneGameSettings型を使用。
- [x] 本家シクロOH合算、両難易度生成、空盤面判定の失敗テストを作成・実行する。
- [x] 本家の純粋処理と既存抽出を比較して移植する。旧独自シクロ制約は持ち込まない。
- [x] game.test.tsを実行し全件pass。新Worker名・originを指定する。

### Task 2: Roomと教員管理
**Files:** cloudflare-lite/worker/{index.ts,room.ts,auth.ts,google.ts,store.ts,response.ts}; cloudflare-lite/src/protocol.ts; cloudflare-lite/tests/{helpers.ts,room.test.ts,auth.test.ts}。
**Interfaces:** Worker /api/rooms POST {kind,settings,nickname?}, /api/rooms/:code/{info,state,socket}; /api/question-profile GET; /api/teacher/question-profile GET/PUT {revision,profile}。
- [x] 50/4上限、メイト作成者参加、一般教員拒否、設定revision競合、重複回答、入力済み全消去、締切・再起動の失敗テストを実行。
- [x] LiteのDO・Google認証を専用cookie/権限へ適応。設定を管理DOからRoomへコピーし操作seqと内容をトランザクションで確定。
- [x] MiniflareのSQLite・WebSocketテストを全件pass。

### Task 3: 参加と解答保全
**Files:** cloudflare-lite/src/{socket.ts,credentials.ts,drafts.ts,Player.tsx}; cloudflare-lite/tests/{socket.test.ts,drafts.test.ts}。
**Interfaces:** RoomConnection.send(ClientMessage):Promise<ServerMessage>; draft store read/write/prune; Player(state,send,status)。
- [x] ACK消失、同じ操作の再送、古いsnapshotの上書き防止、期限清掃を失敗テストで固定する。
- [x] IndexedDB盤面/語句保存、2秒以内同期、両判定方式・パス再挑戦・最大3秒回収を実装。
- [x] テストを全件pass。

### Task 4: 画面と共通難易度
**Files:** cloudflare-lite/src/{App.tsx,Settings.tsx,Results.tsx,QuestionProfileDialog.tsx,main.tsx,lite.css}; cloudflare-lite/game/client/{AlkaneBoard.tsx,QuestionView.tsx,NameWordBank.tsx}。
**Interfaces:** マスターUIからteacher profile API、Room UIからRoomConnection、設定フォームは既存AlkaneCompetitionSettingsForm。
- [x] クラス/メイト、マスターのみ微調整、非空解答レースをテストで固定する。
- [x] 本家パズルとイオン競技UIを移植。メイトホストは解答画面、教員はレース。
- [x] typecheck/buildとPlaywrightローカル主要操作・レスポンシブを確認。

### Task 5: 最終検証と引継ぎ
**Files:** cloudflare-lite/{README.md,deploy.mjs}; cloudflare-lite/tests/{browser-server.mjs,load.mjs}; docs/IMPLEMENTATION_PROGRESS.md。
- [x] 全テスト、typecheck、build、Worker dry-run、50接続負荷、git diff --checkを実行。
- [x] asking-code-reviewではなくrequesting-code-reviewで新しいレビューを依頼し重要な問題を修正する。
- [x] 公開用設定・Google callback・Secretsの必要作業と未検証の実機境界を記録する。

完了記録: [検証結果](../../../cloudflare-lite/docs/verification.md)。公開は未実施。
