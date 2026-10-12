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

## 2026-10-11 候補選択中の長押しと並べる即時操作

- 並べるの問題毎判定は、候補の下へ「パス／チェック／クリア／全解答確認」を1行に移動し均等幅・高さ44pxに統一。命名／一括判定の既存配置を維持。
- 候補選択中の配置済みC／F／OHを400msで持ち上げ、選択維持、同位置／cancel／blur復元・移動／盤面外削除を確認。直前のタップ回転予約が長押し中に動く競合を独立レビューで発見し、選択時にも保留して修正。SSR等79テストと型チェック／build成功。変更前の選択時長押しは回帰ブラウザ検査で失敗し、修正後成功。
- Playwright MCP Chromium:320pxの選択時長押し・C/F/OH移動削除、保存reload、音程、両者提出／結果成功。即時4ボタン320/390/768pxで均等幅・高さ／上端一致、clearと両者提出成功。WebKitでも同3幅とclear／提出成功。pageerrorなし。
- 本家はindex.htmlとパネル回帰テストだけを編集。既存のtransient.html未コミット削除は保持しcommit対象外。本家全86テスト成功、回転予約の修正後パネル操作43テスト(親込み)再実行成功。本家GitHub最新版参照済み。
- 公開: 本家 commit `845e952c4d2105d877a78426b09d4031ce12a042`、Pages run `38142865169`のdeploy成功をGitHub MCPで確認。コンペ release `cf3d0bc6e13bef03502184f72e8ece4a09c74bc3`、Cloudflare version `e34c7695-929b-46f7-9a81-04d34bc7931a`、HTML metaとhealthのrelease一致。
- 本家公開の320px Chromium CDPタッチ入力で、候補選択中のC／F／OHのsource非表示・元パネルの移動・候補維持・touchCancel復元・枠外削除を確認成功。OHは既存の「ON設定は次問へ適用」のため初回検査で候補不在となった。次問へ切替後、全3種類が成功。pageerrorなし。実端末での操作感は未検証。
- コンペ公開の実メイトで、候補選択中のC/F/OH長押し・直前タップ回転予約の保留・元位置／blur／pointercancel復元・移動削除・保存reload・音程・提出／結果成功。即時4ボタン320/390/768pxで均等幅、高さ44px、上端一致・クリア・提出／結果成功。pageerrorなし。

## 2026-10-11 名前の編集・マーキングと最下段操作

- 名付けるは解答欄の上にUndo矢印／クリア／黄色蛍光ペン／赤ペン／全マーキング消去を配置。解答のUndo・クリアと構造のマーキングを分離。色・線幅・アイコンは本家GitHub最新版index.htmlの仕様に合わせた。マーキングは採点・提出データに含めず、問題別に端末保存し、期限切れを削除する。
- 名付けるの問題毎判定は最下段に解答／パス／全解答確認を均等幅・高さ44pxで配置。並べるの一括判定は前の問題／次の問題／クリア／全解答確認を3:3:2:3、高さ44pxで配置。
- 全81テスト・型チェック・build成功。Chromiumの320/390/768pxでボタン配置、Undo、黄・赤描画、消去、問題移動・reload保持、両者提出／結果を確認。WebKitでも名前操作の同3幅・描画・提出を確認。
- WebKit混合10問で320/1366/1024pxの30盤面寸法、D&D・Undo・offline/reload復元、配置済みパネル長押し、レビュー切り出し、提出・結果が成功。pageerrorなし。ブラウザ検証であり実iPadOS17.7 Chromeの検証ではない。
- 独立コードレビューで起動時の旧マーキング全削除処理を指摘、期限切れのみ削除に変更し、reload保持をブラウザで確認した。
- 公開source release `bb6f9ec84f5a0fd883b44f7da09adbadfe7373b7`、Cloudflare version `732a1aff-ee3d-4794-901b-0a40336c6b78`。GitHub pushとMCP取得成功(CI statusなし)。公開HTML metaと/api/healthが同release。
- 公開実メイトChromiumで名前の3幅・Undo・黄/赤・全消去・CDPタッチ描画/キャンセル・両者提出と結果、並べる一括の3幅と3:3:2:3・クリア・提出、名前の問題移動/reload保持が成功。pageerrorなし。

## 2026-10-12 ペン行の4色・マーキングUndoと即時判定操作

- 名前の解答Undoを削除。ツール行はクリア／黄色蛍光ペン／緑色蛍光ペン／赤ペン／青ペン／マーキングUndo／全消去。解答クリアとマーキング履歴を分離。Undoは1描画と全消去の直前状態を復元する。本家と同じ背景#d7f0ec・枠#2a9d8f・文字#1f8175で選択表示。
- 蛍光緑は本家の黄緑色を基に幅22.5px・透明度.46、青は本家のrgba(22,141,225,.94)・幅3.2px。追加色テストが変更前に失敗し、変更後成功した。
- 両モードの問題毎判定の最下段はパス／解答チェック／全解答確認の均等3列・高さ44px。並べるのクリアを直上へ移動。一括判定の配置は維持。
- Chromiumで320/390/768pxの7ボタン順・高さ・配置と3列フッター、4色描画、選択色、描画Undo・全消去Undo、解答への非干渉、CDPタッチ描画・キャンセル、提出／結果成功。WebKitでも名前の同3幅・4色・Undo・消去・提出成功。pageerrorなし。
- ローカル疑似教員のクラス即時判定で解答チェック・パス・保存reload・提出／教員復習、メイト一括の解答復元を検証。320/390/768/1280pxで横はみ出しなし。独立読取レビューで重大な問題なし。実iPadOS17.7 Chrome、実Google認証は未検証。
- 全82テスト・型チェック・build成功。初回全テストのOAuth1件はUND_ERR_SOCKETで失敗したが、ローカルブラウザ検証を停止して同じ全テストを再実行し82件すべて通過した。
- 公開source release `cd3c8f93f9ec37ceaff584db9114e5c2b15f95cb`、Cloudflare version `f70db0db-8363-4339-9b45-87139ba53b49`。GitHub pushおよびMCPでcommit status取得成功(statusなし)。公開HTML metaと/api/healthのrelease一致。
- 公開実メイトChromiumで名前の7ボタン・3幅・4色・選択色・Undo/消去・解答非干渉・タッチ/キャンセル・提出／結果、並べるの即時3ボタン・直上クリア・3幅・提出／結果成功。WebKit公開版でも名前の同3幅・4色・Undo・消去・両者提出成功。pageerrorなし。実iPadOS17.7 Chromeの確認ではない。

## 2026-10-12 OHの水素結合表示・オール末尾化

- コンペの共有PanelIconを本家svgIconに合わせ、炭素の結合方向に対して反対向きにOHの水素を表示。O-H線は中心から13→25、水素中心は32、未接続／候補／ドラッグ中は64.1,35.9。本家と描画の重なり順も一致。採点データは変更していない。
- コンペと本家のアルカン名語群を「シクロ／ランダムなアルカン名／オール」の順に変更。アルコールOFFで非表示、グループ順ランダムは維持。
- 変更前は接続四方向とオール末尾のテストが失敗。変更後コンペ全88テスト・型チェック・build成功、描画順調整後にOH5テスト再実行成功。本家全88テスト成功。既存transient.htmlの削除は変更対象外。
- ローカルChromiumとWebKitで320pxのOH接続・炭素回転による切断・移動による再接続・reload保存・全解答確認・結果の水素座標を確認。名前5問すべてオール末尾、両者提出成功、pageerrorなし。
- 本家は保存設定を変更しない検証用HTMLフックで実buildWordBankのDOM出力を検査。すいすい／そこそこのアルコールONでオール末尾・OFFで非表示を確認。独立読取レビューで重大な問題なし。
- 公開: コンペsource release `2360302d1f60bb0e3ff855e847959be8baede53d`、Cloudflare version `9edd4946-89e1-47ca-bf9f-c7f84811d981`。本家commit `5f7259713b4705600add5edcf6c3b54f44843278`、Pages run `38194265000`のdeploy成功をGitHub MCPで確認。コンペHTML metaとhealthのrelease一致、本家配信HTMLの変更行も一致。
- 公開実メイトChromiumとWebKitで、OH接続・回転による切断・移動による再接続・reload・全解答確認・結果のH位置、名前5問のオール末尾と提出を確認成功。pageerrorなし。
- 本家公開ページの通常表示で名前語群を確認。公開配信HTMLにブラウザ内の検証フックを付け、すいすい／そこそこ・アルコールON/OFFの実DOMを確認成功。共有設定を保存・変更していない。実iPadOS17.7 Chromeは未検証。

## 2026-10-12 難易度設定の横画面化・即時4ボタン・一括強調

- 難易度設定を構造／置換基・シクロ／アルコールの3列に整理。範囲は最小〜最大の1行入力と増減操作、スイッチはON/OFFを明示。狭い画面で2列／1列に切り替え、設定本文だけをスクロール。セレクターと保存欄は常に見える。
- 全4設定の保存とrevision/CSRF契約を維持。入力検査・未保存表示、閉じる／Escape／読み直す／ページ離脱の破棄確認、保存失敗・409での変更保持を追加。初期値への復帰は全4設定を対象と明示し保存前に確認する。
- 並べる即時判定はパス／クリア／解答チェック／全解答確認を1:1:2:1、高さ44pxに統一。名前即時配置は維持。両モードの一括は最終問題または全問入力済みなら全解答確認、それ以外は次の問題を強調。空判定は既存isAnswerEmptyを利用し、正誤で判定しない。
- 変更前の即時配置テストは失敗し、変更後Chromium/WebKitの320/390/768pxで幅比・高さ・順序・clear・提出成功。一括も両モードの初期／最終／全問入力／途中clear／reload／提出を確認成功。pageerrorなし。
- ローカル疑似教員の実APIで、Chromium/WebKitの16配置(全4設定×1366x768・1024x768・768x600・320x568)を検査。前2サイズは本文を含めスクロールなし、全サイズで保存欄可視・横はみ出しなし。範囲入力・タブ間変更保持・409変更保持・保存／読み直す／初期値復帰を確認した。WebKitのSecure localhost Cookie制約はローカル検証用APIプロキシで扱い、本番認証コードは変更していない。
- 独立レビューでSPAの戻るによる変更消失を指摘。Appのルート更新前にキャンセル可能なイベントを送り、未保存編集が拒否したらURLと画面を維持するよう修正。ChromiumとWebKitのhistory.back・Escape・閉じるの拒否を検査し成功。再レビューで重大な問題なし。
- 型チェック・build・全88テスト成功。初回のOAuth1件はローカルMiniflareのUND_ERR_SOCKETで失敗し、同じ全テスト再実行で88件通過した。実Google認証と実iPadOS17.7 Chromeは今回再検証していない。
- 公開source release `d2f5413955bfeba2d4f6acb6d82e90268a57a2d6`、Cloudflare version `65983a0b-69c6-4627-8911-5751898040d4`。GitHub pushとMCPのcommit取得成功(statusなし)、公開HTML metaとhealthのrelease一致。
- 公開Chromiumの実メイトで即時4ボタンの320/390/768px幅比・clear・提出／結果、一括両モードの初期／最終／全問入力／clear／reload／提出を確認成功。公開設定UIは分離API fixtureでChromium/WebKitの16配置・変更保護・保存競合時の保持を確認成功。本番Google認証・本番共通設定への書込みは行っていない。pageerrorなし。

## 2026-10-12 ホームの参加状況表示による配置ずれ

- 参加状況のp要素が出入りしてヘッダーとカードの高さが変わり、中央配置によって入力欄・リンクが移動していた。既存のヘッダー〜入力欄の余白内に常設の表示枠を設け、文章の有無で高さが変わらないよう修正。aria role=statusと参加確認処理は維持。
- 修正前の320pxブラウザ検査でカード高さ40px、入力欄top28.5pxの変化を再現。修正後Chromium/WebKitの320/390/1024/1366pxでカード・入力欄・ナビゲーションのtop/height/left/widthが切替前後で一致、状態文章の収まりと横はみ出しなしを確認。完了状態APIは待機ゲート付きfixtureで、実参加資格は変更していない。pageerrorなし。型チェック・build成功。
- 公開source release `13bb6f570bd52b65fe5805e813cc6ab1b0ab34e3`、Cloudflare version `0c24f22f-b75c-4fb4-9c36-7e5cae24191c`。GitHub pushとMCP status取得成功(statusなし)、公開HTML metaとhealthのrelease一致。公開Chromium/WebKitで同4幅の状態切替前後の全位置・寸法一致を確認、pageerrorなし。状態APIは検証用fixture、実機iPadは未検証。

## 2026-10-12 メイト新規作成の許可設定・アルコールトグル

- マスターの管理設定に「メイトマッチの作成」を追加。許可教員は閲覧のみ。初期値ONの独立した設定行を既存AlkaneTeachers SQLiteに保存し、再起動時も保持する。変更APIはマスター認証・同一origin・CSRFを要求。不正値と不正methodを拒否する。
- OFFは新規作成だけを停止。ホームのリンクを薄い文字で無効化し、直接URLも作成フォームを閉じる。公開設定はno-storeで取得し、画面復帰時に再確認。取得不能時は作成を許可せず再試行を提供。WorkerとRoomの新規作成経路で許可を検査する。既存の参加・開始・解答・結果経路は維持。
- アルコールトグルはイオンコンペライトの錯イオントグルを参考に、外側を紙色・緑文字で維持し、ON表示部分だけを緑背景・白文字に変更。CSSの限定セレクターで既存choiceのON背景より優先させ、高さ・配置・保存値は維持。
- Lite全92テスト／15ファイル、型チェック、Vite build、公開dry-run、git diff --check成功。追加4テストは未実装APIの404で失敗を確認後、権限・不正入力・設定保存とDO再起動・OFF時のクラス作成継続・既存メイトの参加／開始／解答／結果まで通過。初回とOAuth単独再実行では既存教員登録テストのMiniflare UND_ERR_SOCKETが発生。変更前OAuth10件と、その後の現在コード全92件は通過した。製品コードに推測による対処は追加していない。
- Playwright MCP Chromiumのローカル疑似教員＋実テストAPIで、キーボードSpace切替、再読込後の保存保持、許可教員の無効スイッチ、保存503時の状態保持、設定取得503時の作成停止と再試行、画面復帰時の更新、OFF時のホーム／直接URL／API403、既存ルームの参加・開始・中断結果表示、再ONを確認。320／390／768／1280pxで横はみ出しなし、スイッチ44px高。アルコールON/OFFは同じ外背景と緑文字・50px高で、ON表示だけが緑と白に変わる。全ページpageerrorなし。ローカル画面のスクリーンショットも確認。
- 独立読取レビューで重大な指摘なし。実Google認証の再ログイン、本番マスターによる設定変更、実iPhone/iPadの操作はローカル検証と区別する。
- 公開source release `d2fd3a09c1b4b4dbabf9054a1250628c889a0de2`、Cloudflare version `b2e72f68-57a1-4ed1-b097-3640bfc76779`。既存GitHubブランチcodex/alkane-competitionへpushし、GitHub MCPでブランチSHA一致を確認。CI statusはなし。公開HTML metaとhealthは同release。公開public-configはHTTP200・no-store・mateEnabled=trueで、設定はONのまま。
- 公開Playwright Chromiumで320／390／768／1280pxのアルコールON/OFF表示、50px高、横はみ出しなしを確認。実メイトの作成・2人参加・開始・両者パス・中断結果表示まで成功。pageerrorとrequestfailedなし。匿名の設定変更PUTはHTTP401、続く別セッションの公開設定読取もONで保持され、教員ページはGoogleログイン画面を表示。本番でマスター設定をOFFへ変更していないため、本番マスター実ログイン・設定保存は未検証。

## 2026-10-12 並べるの履歴ジェスチャー保護

- 解答グリッド全体とパレットへ、ネイティブcapture・非passiveのtouchstart／touchmove／wheel保護を追加。キャンセル可能な単一タッチ・横成分のあるwheelを抑え、複数タッチ・純縦wheel・ctrlKey付きズームは追加で抑制しない。編集処理は従来のPointer Eventsだけが行う。disabledになっても解答用onChangeがある間は保護を維持し、読み取り専用盤面には追加しない。
- Playerは並べるの解答表示だけでHTMLルートにoverscroll-behavior-x:containを適用。名付ける・カウントダウン・全解答確認・提出・結果・アンマウントでは解除し、元のクラス状態を復元する。縦overscroll、履歴、ルーム／採点／下書き保存形式は変更しない。
- 実装前のブラウザ検査は盤面touchstart／touchmove／横wheelのdefaultPrevented=falseで失敗。変更後は全保護対象で成功。既存の盤面はoverflow:visibleのため、そこにoverscroll CSSだけを置く方法は採らなかった。
- Lite全95テスト／16ファイル、型チェック、Vite build、公開dry-run、diff check成功。追加3テストで単一タッチ／横wheelの選別と繰返し登録・解除を確認。Node EventTargetのcapture指定を登録・解除とも同じoptionsオブジェクトに揃えた。初回全体検査の既存OAuth1件はMiniflare UND_ERR_SOCKETで失敗し、その後の全95件は通過。
- Playwright MCP Chromium: 8領域／状態のイベント抑制・非抑制、実タップ配置・回転、450ms長押し移動、CDPの3マスなぞりとtrusted touchstart／wheelのキャンセル、盤面外縦スクロール、URL／履歴位置維持、reload保存復元、オフライン時の保護維持、通常の戻る／進む、全5問の混合モードと確認画面往復、提出・結果・ホーム時の解除を確認。pageerrorなし。
- 同じフローをPlaywright WebKit 26.5でも確認。CDPのなぞり計測はChromiumのみだが、WebKitは実タップ配置・長押し移動・縦スクロール・保存復元・戻る進む・混合／確認／提出／結果の解除まで通過、pageerrorなし。最初のWebKit検査はテスト開始直後の重複reloadがpublic-config読込を中断してaccess-controlメッセージを出していた。新しいページで設定読込完了を待ち、不要なreloadを除いて解消。製品コードにエラー隠蔽は追加していない。
- 既存のbrowser-panel-gesturesもChromiumで成功。選択中のC／F／OH長押し移動と盤面外削除、同位置／blur／pointercancel復元、56px・opacity .9ゴースト、削除保存reload、AudioContext APIの音程、両者提出・結果が通過。
- 独立読取レビューで重大な指摘なし。ブラウザ自動入力は実iPad/iPhoneやMacトラックパッドによるブラウザ履歴ジェスチャーの合格証拠ではない。特にページへ入力が届かない画面端操作は実機確認が未完了。
