# AlkanePuzzleCompetition 運用手順

このアプリは専用 Supabase プロジェクト `fethojoncgermqwzrwtw` を使用する。ブラウザに公開する URL と publishable key は新プロジェクトのものに限る。Google/匿名 Auth、PostgreSQL、Edge 関数、private Realtime の設定と共通教員認可の手順は [SHARED_TEACHER_SETUP.md](./SHARED_TEACHER_SETUP.md) に記す。旧 IonicFormulaCompetition プロジェクトの DB 接続 URI や Auth UID をコピーしない。

## 初期設定と公開前確認

1. 新アプリの空の DB に [SUPABASE_INITIAL_SETUP.sql](./SUPABASE_INITIAL_SETUP.sql) を一度だけ適用する。個別 migration と二重適用しない。既存の IonicFormulaCompetition DB には共通認可の追加 migration だけを適用する。
2. 新アプリの Connect → Transaction pooler URI を Edge secret `COMPETITION_DATABASE_URL` に保存する。URI の project ref が `fethojoncgermqwzrwtw`、ポートが `6543` であることを接続先画面で確認する。ソースの `postgres` クライアントは `prepare:false`、1接続を使う。ライブ接続・トランザクションの動作は公開前に実プロジェクトで確認する。
3. Google と Anonymous Sign-in、公開 origin と OAuth リダイレクト、`ALLOWED_ORIGINS`、中央との HMAC secrets と呼び出し元登録を設定する。秘密値をローカル資料やチャットへ転記しない。
4. 中央と新アプリの Edge bundle を生成・公開し、公開先が対応するプロジェクトか確認する。GitHub Pages へ公開する前に、両モードのクラス/メイトの作成、参加、準備、途中解答復帰、結果、教員取り消しを新プロジェクト上で確認する。ブラウザのコンソールと通信失敗も確認する。実端末のタッチ・通信切断復帰は別に確認する。
5. 新プロジェクトのプラン上限、DB 使用量、Auth ユーザー、Realtime メッセージ、Edge 実行量を Dashboard で記録する。42名×15問の両モードを実プロジェクトで測る前に、複数クラス同時利用の安全容量を断定しない。

## 14日保持と Cron

競技結果の保存期限は終了・中断で結果が確定してから14日。待機室は2時間、開始前に取り消した室は1日。`rooms.expires_at_ms` に達した室の子データは外部キーの `ON DELETE CASCADE` で削除する。教員許可リストと詳細難易度設定はこの清掃の対象外。

新アプリの Supabase Dashboard で Cron を有効にし、同プロジェクトの SQL Editor で次を登録する。既存ジョブ名との重複を先に確認する。[Supabase Cron の公式手順](https://supabase.com/docs/guides/cron/quickstart)にも SQL 関数の登録例がある。

```sql
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname = 'alkane-puzzle-prune-expired-rooms';

SELECT cron.schedule(
  'alkane-puzzle-prune-expired-rooms',
  '*/15 * * * *',
  'SELECT public.app_prune_expired_rooms(100);'
);
```

初回実行後と定期点検では、次を確認する。1回の上限は100室であり、期限切れ室がそれより多い場合は次回へ残る。失敗や増加が続く場合は SQL エラーとテーブル容量を調べ、削除範囲を広げる前に原因を確認する。

```sql
SELECT jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'alkane-puzzle-prune-expired-rooms')
ORDER BY start_time DESC LIMIT 20;

SELECT count(*) AS expired_rooms
FROM public.rooms
WHERE expires_at_ms <= floor(extract(epoch FROM now()) * 1000)::bigint;
```

## 匿名 Auth の点検

競技データの期限切れ削除は Auth ユーザーを削除しない。`node scripts/anonymous-maintenance.mjs --count` または `--list` で**読み取り専用 SQL**を出し、新アプリの SQL Editor で実行する。候補条件は匿名、教員紐付けなし、他 provider identity なし、保存期間内の参加資格なし、確認できる最終サインインから14日以上。最終サインインが空欄のユーザーは候補から除外する。

候補 ID と件数を記録し、各ユーザーの教員 identity、結果、アクティブな部屋、最新利用を削除直前に再確認する。現行スクリプトには削除操作がない。Auth 削除は別の管理者操作で個別に判断し、旧プロジェクトのユーザーに触れない。

## ローカル容量基準値

`node scripts/measure-local-capacity.mjs` はネットワーク接続せず、PGlite に実際の一括 SQL を適用し、各モードの中程度・アルコール ON・42名×15問を作ってテーブルと索引の増分を測る。直近のローカル結果は「並べる」約 **2.02 MB/室**、「名付ける」約 **1.23 MB/室**。1日1室を14日保持すると、それぞれ約28.2 MB、17.2 MB に相当する。これらは PGlite のローカル測定値であり、Supabase の利用可能容量を示さない。Auth、Realtime、WAL、バックアップ、Edge ログ、実際の同時接続負荷は含まない。公開前に実プロジェクトで再測定し、プランの現在の上限と比較する。
