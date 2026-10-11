# アルカンコンペ（Cloudflare Lite方式）

授業用のクラスコンペと2〜4人のメイトマッチ。並べる／名付ける、すいすい／まあまあ、アルコールON/OFF、問題ごと／まとめて判定を提供します。

- クラス最大50人。Google認証済みのマスターと登録教員が作成します。
- マスター: `taiyaki.taiyaki.taiyaki@gmail.com`。教員許可リストはこのアプリ専用です。
- マスターが4組の詳細難易度を共通保存。新しく作るクラス・メイトに適用し、既存ルームの版は保持します。
- 5/10/15問、3〜10分。開始5秒前カウントダウン、開始から7日保持。待機は2時間。
- Worker `alkanecompetition`。公開予定URL: **https://alkanecompetition.koichem.workers.dev**。

本家の教材処理と既存競技UIを再利用します。サーバーは専用WorkerとSQLite Durable Objects（AlkaneRoom / AlkaneTeachers）のみ。既存Supabase版・本家・イオン版の公開設定とデータは変更しません。

## 開発・検証

Node.js 22.12以降（24推奨）、pnpm 11を使用します。コマンドはこのディレクトリ内で実行します。共通UIの型定義も参照するため、初回はリポジトリのルートでも `pnpm install --frozen-lockfile` を実行してください。ReactはViteのdedupeでこのアプリ側へ統一します。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm run deploy --dry-run
pnpm dev:fixture
```

`dev:fixture` はlocalhost:8792限定の疑似認証環境です。テスト用Google署名・cookie・SQL操作を本番に配信しません。Playwright MCPの `browser_run_code_unsafe` に `tests/browser-flow.js` と `tests/browser-additional.js` を読み込むと主要操作を検証できます。50同時接続・15問のローカル計測は `node tests/load.mjs`。本番サーバーに負荷をかけません。

通常開発は `pnpm dev`。Google認証を試す場合は `.dev.vars` に `GOOGLE_CLIENT_SECRET` を置き、ローカル用Client IDと承認済みリダイレクトURIも設定します。

## 公開時の設定（まだ公開していません）

1. CloudflareアカウントのWorkersサブドメインが `koichem` であることを確認します。
2. Google OAuthのWebクライアントを用意し、`wrangler.jsonc` の `GOOGLE_CLIENT_ID` を設定します。
3. 承認済みリダイレクトURIを `https://alkanecompetition.koichem.workers.dev/api/auth/google/callback` に設定します。対象ユーザー・公開状態も授業利用の範囲に合わせます。
4. `pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --name alkanecompetition` でSecretを登録します。ソースやブラウザには保存しません。
5. テスト・ビルド後に変更をcommitし、公開を承認された場合にのみ `pnpm run deploy`。専用Worker名・origin・DO・マスターをガードします。ルートの旧公開コマンドは使いません。
6. `/api/health` のreleaseとHTMLの `alkane-release`、Google実ログイン、登録／未登録教員、メイト参加・解答・復習を公開先で確認します。

Client ID／Secretが未設定ならクラス作成は閉じ、匿名メイトは利用できます。公開用Google認証、実CloudflareのCPU・遅延・費用、学校回線の50端末、実iPhone/iPadの長押し・音声・カメラはローカル自動検証とは別に確認してください。

## 保存・制限

解答は端末IndexedDBとRoomの最新状態に保存します。確認応答を得るまで同期・提出完了と表示しません。採点と操作番号・内容を同一トランザクションで保存し、再送で二重加点しません。複数タブでは新しい接続を優先します。

まとめて判定の締切後は編集を停止し、締切以前の下書きを最大3秒回収。回収不能なら受領済み内容で採点し「最終同期未確認」を表示します。所要時間の終点はサーバー受領または締切／中断時刻で、自己申告の遅延補正は行いません。

匿名作成は共有IPごと60部屋/10分、教員は20部屋/10分。HTTP参加照会・接続は共有IPごと180回/分、WS操作は接続ごと120回/10秒。通常の50人同時参加を許容します。IPは短期間のハッシュだけを保存します。生成は抽選回数・時間で上限を設け、生成不能なら待機を維持します。

Roomの期限後はAPIで拒否しalarmでRoom・参加者・解答を削除します。教員一覧・共通難易度は保持。端末データは起動・復帰時に期限清掃します。閉じたブラウザのローカルデータやCloudflare側のログ／バックアップをサーバーから即時削除する機能ではありません。

参照仕様: [設計書](../docs/superpowers/specs/2026-10-11-alkane-competition-cloudflare-lite-design.md)。検証記録: [実装・検証](docs/verification.md)。
