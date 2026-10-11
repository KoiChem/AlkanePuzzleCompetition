# 実装・検証記録

2026-10-05。AlkanePuzzle `f2e231b4db4bfae199ce06afdd44e8b4cf41cafe` の生成・命名・構造判定をDOMから分離し、IonicFormulaCompetitionGitHub `9bb8bff2bd4f19a59aed92c722320bb0e094ef93` の競技基盤へ統合した。

## ローカル実装

- 並べる／名付ける、すいすい／まあまあ、アルコール設定、四つの詳細出題規則と環置換基0/1/2以上。
- クラス42名／メイト4名、準備・開始・中断・レース・採点・結果。クラスは作成時の管理設定、メイトはアプリ標準規則を固定。
- 5×7構造JSON／名称語句順、IndexedDB保存と最新途中解答の2秒以内の送信開始。版・書き手・時刻・更新番号で古い送信を拒否し、同じブラウザの参加資格からサーバー復元できる。
- なぞりによる結合、回転・逆回転・削除、長押し移動、語句並べ替え、手書き。手書きメモは部屋の期限付きの端末内保存。
- 14日保持、期限付き参照、CASCADEによる競技データ削除と15分ごとのCron手順。匿名Auth削除は読み取り専用候補点検を用意した。
- イオンコンペの許可リストを中央とし、署名付きサーバー間通信とGoogleメール検証で共通教員認可。既存側変更は追加の認可サービスとmigrationに限定。

## 検証

- `RUN_LOAD=1 node node_modules/vitest/vitest.mjs run`：436件成功、失敗・スキップなし（88ファイル）。42名×15問の両モード・両判定方式を含む。実サービス負荷の証明ではない。
- TypeScript型チェック、Vite本番ビルド、Edge bundle生成、両リポジトリ `git diff --check` を実行して成功。
- Playwright MCP + ローカルPGlite API：教員画面、環置換基ラジオの保存、クラス・メイトのホスト／ゲスト、開始、並べるのなぞり4炭素と途中保存HTTP200、名付けるの正解採点、後判定の提出・結果を確認。
- IndexedDBを削除して再読み込みし名称途中解答をサーバーから復元。二つのタブで解答後に書き手を切り替え、次の解答を送信できることを確認。
- 390pxの盤面セル44.86px、390pxと1024pxで横はみ出しなしを確認。実iPad/Pencilは未検証。
- ローカルAPIはGoogleとprivate Realtimeクラウドを再現しない。WebSocket接続エラーは残り、ポーリング経由で競技を検証した。実Googleログイン、クラウドRealtime、公開後のCORSは未検証。
- 独立レビューの6件（書き手切替、なぞり、異なるマスの連続タップ、遅い保存中の新編集、同期表示、メモ期限）を修正。レビュー再確認で新たな重大指摘なし。

## Supabase確認と残作業

- 専用プロジェクト `fethojoncgermqwzrwtw` のGoogle／匿名Provider有効を読み取り確認。
- `rooms`、`participant_drafts`、`app_teacher_bindings` が存在し、公開キーで直接読むと42501 permission deniedとなることを確認。ライブDBの競技トランザクションは未検証。
- 管理者作業：専用DBのTransaction pooler URIなどEdge secrets、既存イオン側の共通認可migration・呼び出し元登録・共有HMAC、Cron、OAuth公開URL。
- GitHub／Edgeの公開はまだ実施していない。手順は OPERATIONS.md と SHARED_TEACHER_SETUP.md。


## 2026-10-11 Cloudflare Lite実装

上記のSupabase版とは独立して、`cloudflare-lite/` に専用Worker・SQLite Durable Objects版を実装した。クラス／メイト、本家互換パズル、登録教員のGoogle認証、マスター共通難易度、下書き復元・締切回収を含む。

新規61件と既存431件のテスト、ビルド・Worker dry-run、Playwright主要操作と幅320〜1280px、ローカル模擬50人試験が成功。公開と実Google認証設定は未実施。詳細は [検証記録](../cloudflare-lite/docs/verification.md) と [運用手順](../cloudflare-lite/README.md) を参照。

### 2026-10-11 公開

https://alkanecompetition.koichem.workers.dev/ に公開。実Googleマスターログイン、クラス作成・匿名参加・教員復習、メイト2人の入力復元・提出を確認。source release a8afda23647e635b9798716bfa183f4098e8605f、Secret設定後Worker version c6a7193a-48e0-4742-8513-18dc273e0754。GitHub pushは公開ソース転送の追加承認待ち。
