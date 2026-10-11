# アルカンコンペ Cloudflare Lite 検証記録

2026-10-11。実装・ローカル検証およびCloudflare公開完了。

## 実装範囲

クラス50人、メイト作成者を含む4人。並べる／名付ける、すいすい／まあまあ、アルコールON/OFF、5/10/15問、3〜10分、問題毎／まとめて判定を実装。教員ホストのレース画面、メイト主催者の参加、提出・復習、再接続・端末保存、開始から7日保持を含む。

マスターは taiyaki.taiyaki.taiyaki@gmail.com。Google認証と登録教員の許可リストでクラス作成を制限。マスターの4種類の共通難易度設定を両コンペに適用し、作成済みルームには設定を固定する。

教材参照はAlkanePuzzle commit 78fa8bf3bbf82222fefe888d09ab3259e275ce5c、初期設定revision da168ccf-a4bd-4542-9808-57cc8fdd0a08。競技基盤はIonicFormulaCompetitionCloudFlareのLiteを参照。既存Supabase版のアプリ・データは変更していない。

## 確認結果

- 新規テスト: 7ファイル・61件成功。生成・採点、Google署名付き認証フィクスチャ、登録教員権限、共通設定の競合・固定、重複送信、タブ交代、再接続、締切回収、再起動、期限清掃を確認。
- 既存アプリ回帰: 431件成功、5件スキップ。スキップした負荷テスト等は成功件数に含めない。
- TypeScript確認、Viteビルド、Worker deploy --dry-run成功。dry-runは公開操作ではない。
- Playwright: クラス（並べる・問題毎）とメイト（名付ける・まとめて）の作成、参加、開始、入力、再読み込み復元、オフライン編集の再同期、提出、結果・復習を確認。320/390/768/1280pxで横方向のはみ出しなし。pageerrorなし。
- 追加ブラウザ確認: 名付ける・まとめての40語句入力で語群の位置が安定、全消去で入力済み数が減少、新しいタブによる旧タブの操作停止。メイトの並べる・問題毎で炭素トレースの入力・再読み込み復元と中断後の結果表示を確認。
- 認証前WebSocketは実ブラウザで約12秒後に1008で閉じた。Miniflare直接接続ではcloseイベント観測に差があったため、その観測だけを根拠に成功扱いしていない。
- 独立レビューで、認証後にも接続前の期限が残る問題を検出し修正。認証済み接続が10秒後も利用でき、別の認証前接続の清掃で切断されない回帰テストが成功。

## ローカル50人試験

[測定データ](local-load.json)。Miniflare上の模擬50接続で各15問、まあまあ・アルコールありを試験。4条件とも全員15問正答、51人目拒否を確認。問題毎は各750回答、まとめては各50人分の一括下書きと最終提出を処理。

| モード | 判定 | 回答または一括下書きACK中央値 | p95 |
| --- | --- | ---: | ---: |
| 並べる | 問題毎 | 27.16ms | 48.53ms |
| 並べる | まとめて | 48.74ms | 83.73ms |
| 名付ける | 問題毎 | 25.03ms | 44.69ms |
| 名付ける | まとめて | 39.37ms | 70.46ms |

本番Cloudflare・学校回線・実端末の速度を示す測定ではない。

## 公開時に必要な作業

Worker名は alkanecompetition、標準URLは https://alkanecompetition.koichem.workers.dev。alkanecompetitionの綴りは正しい。ユーザー指定の .workers は標準公開URLに合わせて .workers.dev とする。

1. Google OAuthのWebクライアントを設定し、GOOGLE_CLIENT_IDを指定する。リダイレクトURIは https://alkanecompetition.koichem.workers.dev/api/auth/google/callback。
2. Worker Secret GOOGLE_CLIENT_SECRETを登録する。秘密値をリポジトリへ保存しない。
3. READMEの手順で専用Workerを公開する。独立したSQLite Durable Objectsを使用し、D1・Supabaseは使用しない。
4. 公開後、実Googleログイン、マスター・登録教員の操作、匿名参加、公開ページの主要競技操作を確認する。

公開前の時点では、実Googleの資格情報による認証、Cloudflare上での保存・アラーム・50人運用、iPad/iPhone等の実機タッチ操作は未検証だった。現在の本番確認結果は以下に記す。ブラウザ試験の教員ログインはローカル専用フィクスチャであり、本番入口には含めていない。


## 2026-10-11 本番公開記録

- 公開URL: https://alkanecompetition.koichem.workers.dev/
- source release: `a8afda23647e635b9798716bfa183f4098e8605f`。HTMLのalkane-releaseと/api/healthのreleaseが一致。
- 初回Worker version: `520afd50-e485-4045-92f2-dc132a46d3a5`。Secret登録後の公開version: `c6a7193a-48e0-4742-8513-18dc273e0754`（100%）。
- Google Cloud既存クライアントにアルカン専用callbackを追加。既存URIは維持。Client IDは公開設定、Client SecretはWorker Secretで保存し、Git・出力へ含めていない。
- Googleにログイン済みの実ブラウザで指定マスターのOAuthログイン、マスター表示、クラス作成、教員レース、参加者の解答・復習を確認。共通難易度を初期値のまま保存でき、成功表示を確認。
- 公開クラスで匿名生徒の参加・開始、盤面入力・同期・再読み込み復元、チェック・パス・提出、教員と生徒の結果を確認。
- 公開メイトで作成者と別参加者の名付ける／まとめて判定、オフライン編集・再同期、語句と問題位置の再読み込み復元、両者提出、作成者自身の結果を確認。320/390/768/1280pxの横方向はみ出しなし、pageerrorなし。
- 匿名POST /api/rooms（class）は401。公開/api/auth/sessionはready:true、匿名identity:null。healthはgame:alkane、d1:false、class50/mate4。
- 学校回線の50実端末、実iPhone/iPad、7日経過による本番清掃、別の実Googleアカウントでの登録／未登録教員ログインは未検証。対応する権限・期限処理はローカル回帰試験で確認。
- ユーザーの追加許可を受け、実装と公開検証記録を公開GitHubリポジトリ KoiChem/AlkanePuzzleCompetition の codex/alkane-competition ブランチへpushした。

## 2026-10-11 本家UIUX・両方モード修正

- 本家のソースと公開画面を確認し、2段のパネル、名前のチップ入力・挿入位置・D&D・枠外削除・undo、チェック／クリアの配置を合わせた。不要ガイドと書き込み開始の文字を削除。小さい画面の名付ける構造は本家と同じ周囲縮小と幅／高さ制限を使用。
- 68 tests / 9 files 成功、型チェック・Vite build成功。混合5/10/15問の均等配分と奇数の多数側のランダム化、モード別設定・採点、即時／一括のルーム経路を検証。
- Playwrightローカル: 320x568の名前パネル追加・挿入・D&D・並べ替え・枠外削除・undo・オフライン再同期／再読み込み、タッチ長押し移動と選択なし、パネルD&D、ナビ3個1行、10問5問ずつ、全解答確認・提出・結果表示成功。配置2マスの解答は確認／結果とも2マスを表示。pageerrorなし。
- クラス即時とメイト一括の既存主要フローも成功。320/390/768/1280pxで横はみ出しなし。追加の読み取りコードレビューでCritical／Important指摘なし。
- 実iPhone/iPadのSafari操作は今回未検証。公開先の検証は以下に記録する。

- 更新公開 source release: `d90e26e36e0605de49f979b51857b4eea2820fb8`。Worker version: `f7bf344b-e5e0-4b41-8a77-40452e00f4c6`。HTMLと/api/healthのrelease一致。GitHub codex/alkane-competitionへpush成功。
- 公開先の実メイトルームに作成者と別参加者が参加し、320x568の両方10問(各5問)、名前D&D全操作・offline/reload復元、タッチ長押し移動・選択なし、FパネルD&D、3ナビ1行、レビューcrop、両者提出、結果cropまで成功。pageerrorなし。Google再ログインと実機Safariは今回再検証していない。

## 2026-10-11 不要なマーキングUI削除

鉛筆風ボタン・色ペン・描画canvas・マーキング専用undo/redo/clearを削除。旧マーキングの端末保存も起動時に清掃する。ゲーム画面の残る操作はパネル／名前の入力操作と競技に必要なナビ・提出のみ。型チェック・ビルド成功、Playwrightの320px幅混合10問でマーキングUI不在、D&D・長押し・復元・レビュー・提出・結果を確認。
