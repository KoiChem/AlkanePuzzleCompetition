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

## 2026-10-11 iPad表示・設定・語群順修正

- ユーザー動画(iPadOS17.7 Chrome): 名付けるのマスが縦に伸び語群／ナビに重なる症状を確認。グリッドのaspect-ratioと子SVG百分率高さへの依存を解消し、表示幅から行高と全体高を明示。SVG絶対配置。現在のWebKitの小さな旧CSS単体プローブでは動画の症状は再現しなかったため、17.7固有原因の確定や実機修正完了は未主張。
- アルコールのON/OFFピル型トグル、提出取り消し／確定の横並び1:2、囲みなし名前解答、まあまあ名付けるの4語群固定順／直前順回避を実装。既存のOFFプロフィールでもまあまあは適用。すいすいの調整は維持。
- 回帰72 tests / 10 filesと型チェック・build成功。新しい語群試験は旧コードで固定順のため失敗し、変更後成功。
- Playwright MCP Chromium:10問両方・まあまあ・アルコールONの各問で320x568/1366x900/1024x1250に変更、マス正方形・盤面内・語群重なりなし、名前D&D・長押し・offline/reload・確認・提出・結果まで成功。名前は子装飾spanなし、背景透明・枠0。提出幅87.3/174.7px(1:2)。アルコールOFF/ON/OFFと角丸24px確認。
- 同じフローをPlaywright WebKit26.5でも成功。WebKitの長押しはマウスによるPointer Events検証で、実機タッチではない。pageerrorなし。
- クラス即時(教員はローカル専用疑似認証)・メイト一括の既存フローも成功。320/390/768/1280px横はみ出しなし。新規コードの独立読取レビューはImportant/Critical指摘なし。
- iPadOS17.7の実機Chrome、実Google再ログインは今回未検証。公開後の結果は以下へ追記する。

- 公開 source release: `ed11db8735f66ce90e774806d1e7723445cbee4f`。Worker version: `fc31e6c0-4421-4a4d-846a-0345b5d4dcec`。HTML metaと/api/healthのrelease一致。GitHubへpush成功、MCPでcommit status取得成功(CIチェックなし)。
- 公開実メイトでChromium／WebKitそれぞれ10問・3サイズ(30寸法検査)成功。全検査で正方形・盤面内・語群との重なりなし。D&D・offline/reload復元・混合5問ずつ・語群順回避・名前装飾なし・横並び1:2・両者提出・結果まで成功。pageerrorなし。実iPadOS17.7のChromeは未検証。

## 2026-10-11 結果の復習欄・正解表示・長押し・名前操作ボタン

- ホストの参加者選択と選択した解答を、クラス集計・結果ナビゲーションの後の最下部へ移動。既存の紙色・緑色・カードに馴染む選択UIにした。ゲストの正解は「正解◯」と実際の解答だけを表示し、正解時の模範解答と表示上の「あなたの解答：」を省略。即時／一括、教員レビューとの区別をSSRテストで確認。
- 本家GitHub最新版のindex.htmlと公開ページを確認。400ms長押しで元のマスを空表示、56px・opacity .9・同じ影のゴーストと回転、盤面全体の枠色変更なし。表示だけを持ち上げ、保存する解答は移動／削除成立まで保持する。同位置・pointercancel・blurでは元に戻る。拾う／移動／削除の音程・波形・ノイズフィルター・時間差・本家マスター出力を移植し、音声失敗は編集を妨げない。
- 名前操作は「１つ前／クリア／解答／パス」、Gridで1:1:2:1、全て44px高。既存pass-actionのmargin-topが9pxずらすことを新しいブラウザ検査で再現し、限定CSSで修正。一括モードには必要なundo／clearのみ。
- 全79テスト／12ファイル成功、型チェック／Vite build成功、diff check成功。最初の全体テストはoauth教員登録のローカルMiniflare接続切断1件(UND_ERR_SOCKET)で失敗。同じ全体テストの単独再実行は全件成功し、再現しなかった。
- Playwright MCP Chromium: クラス即時(ローカル疑似教員)・メイト一括・320px混合・名前D&D・offline/reload・長押し・提出／結果成功。復習欄が最後のDOM要素にあることを検査しスクリーンショット確認。名前即時ボタン320/390/768pxで高さ・上端・幅比検査成功。長押しの同位置／blur／pointercancel復元・移動・盤面外削除・削除後reloadと実AudioContextの480/660/330/250Hz出力を検査成功。pageerrorなし。
- Playwright WebKitの既存タブレットフロー(320/1366/1024px、10問混合・まあまあ・アルコールON、全30盤面寸法)成功。実iPadOS17.7 Chromeの操作・音の聴感、実Google再ログインは今回未検証。
- 独立読取レビューでImportant/Criticalなし。パネル音は本家の出力.88を再現し、既存音量medium/highで変わらない点をminorとして確認。学生用の音量UI追加は行っていない。
- 修正後の名前即時ボタンをWebKitでも320/390/768pxで検査し、1:1:2:1・高さ44px・上端一致・undo成功。pageerrorなし。

- 公開 source release: `caeef8e196d6e415be9be54a8ad241727d477372`。Worker version: `6293d4df-7ee2-426b-a92f-1a44b8ad5919`。公開HTML metaと/api/healthのrelease一致、専用Workerへ更新成功。GitHub codex/alkane-competitionへpush成功、GitHub MCPでcommit status取得成功(CI statusなし)。
- 公開実メイトChromium: 長押しのsource非表示・56px/opacity .9・同位置・blur・pointercancel・移動・枠外削除・再読み込み保存、実AudioContextの音程出力・両者提出・結果まで成功。名前即時ボタン320/390/768pxで幅比1:1:2:1、高さ44px・上端一致・undo・両者提出／結果成功。
- 公開実メイトWebKit: 名前即時ボタン同3幅の検査・undo・両者提出／結果まで成功。pageerrorなし。公開先のconsole error/warningなし、healthと競技作成POST成功。ホストの復習欄はローカル疑似教員のクラスで確認したもの。公開Google認証と実iPadOS17.7 Chrome、実機の聴感は未検証。
