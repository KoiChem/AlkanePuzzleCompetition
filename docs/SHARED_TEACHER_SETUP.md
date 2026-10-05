# 共通教員認可の手動設定

この設定は、IonicFormulaCompetition の `teacher_allowlist` を唯一の許可リストとして使う。AlkanePuzzleCompetition のブラウザは自分の Supabase Auth にログインする。新アプリの Edge 関数が、署名したサーバー間リクエストで中央の Edge 関数へアクセストークンを渡す。中央は登録された新アプリ Auth URL の `/auth/v1/user` でトークンを検証し、確認済み Google メールだけを既存の許可リストと照合する。ブラウザから渡されたメール、ロール、UID は認可根拠にならない。

## 管理者の適用順

1. **SQL をプロジェクト別に適用する。** 既存の IonicFormulaCompetition プロジェクトには同リポジトリの `supabase/migrations/202610040001_shared_teacher_authority.sql` だけを追加適用する。既存の `teacher_allowlist` の行は変更しない。空の新アプリ専用プロジェクトには [SUPABASE_INITIAL_SETUP.sql](./SUPABASE_INITIAL_SETUP.sql) を SQL Editor で一度だけ実行する。この束は新アプリの `202610010001_core.sql` → `202610010002_auth_realtime.sql` → `202610010003_permissions_maintenance.sql` → `202610020001_question_profiles.sql` → `202610040001_teacher_leases.sql` → `202610040002_drafts_retention.sql` の順。束と個別ファイルを重複実行しない。両プロジェクトで SQL の結果、テーブル、関数を確認する。
2. **新アプリの Auth を有効にする。** Google Provider と Anonymous Sign-in を有効にし、実際の公開 origin とリダイレクト URL を登録する。中央の Auth 設定を新アプリに流用しない。Google ログインで `email_confirmed_at` と `identities[].provider = "google"` が返ることを確認する。
3. **新アプリ専用 DB 接続を設定する。** 新アプリの Supabase Dashboard の **Connect → Transaction pooler** から URI を取り、Edge secret `COMPETITION_DATABASE_URL` に保存する。ユーザー名は `postgres.<新アプリの project ref>`、ポートは `6543`。ホスト名やパスワードを旧 Ionic プロジェクトからコピーしない。接続 URI を Git、公開設定、チャット、ログに置かない。アプリはこの secret がなければ起動せず、旧プロジェクトへの代替接続を持たない。[Supabase の接続方式](https://supabase.com/docs/guides/database/connecting-to-postgres)では Edge に Transaction pooler を案内しており、ドライバは prepared statements を無効にしている。
4. **専用 HMAC 鍵と Edge secrets を設定する。** 32 バイト以上のランダム値をシークレット管理画面で生成し、中央の Edge secret `SHARED_TEACHER_ALKANE_HMAC_SECRET` と新アプリの Edge secret `SHARED_TEACHER_HMAC_SECRET` に同じ値を設定する。新アプリの `SHARED_TEACHER_AUTHORITY_URL` は中央 Edge 関数の絶対 URL（`.../functions/v1/competition/shared-teacher`）にする。新アプリの `MASTER_TEACHER_EMAIL` は中央の既存設定と一致させるが、それだけでは認可されない。`ALLOWED_ORIGINS`、Supabase URL/鍵、専用 DB URL も新アプリの値で設定する。HMAC 値とサービスロール鍵を SQL、Git、ブラウザ設定、ログへ書かない。
5. **中央の呼び出し元を登録する。** 中央の SQL 管理画面で次の形で `shared_teacher_callers` に1件登録する。`auth_url` は新アプリの固定 URL、`publishable_key` はそのプロジェクトの公開キーとする。`secret_env_name` には前段で設定した中央の secret 名を指定する。URL をブラウザから指定させない。

   ```sql
   INSERT INTO public.shared_teacher_callers
     (app_id, auth_url, publishable_key, secret_env_name, enabled)
   VALUES
     ('alkane-puzzle-competition', '<new-app-supabase-origin>',
      '<new-app-publishable-key>', 'SHARED_TEACHER_ALKANE_HMAC_SECRET', true)
   ON CONFLICT (app_id) DO UPDATE SET
     auth_url=EXCLUDED.auth_url,
     publishable_key=EXCLUDED.publishable_key,
     secret_env_name=EXCLUDED.secret_env_name,
     enabled=EXCLUDED.enabled;
   ```

6. **中央と新アプリの Edge 関数を順に公開する。** 中央の `competition` 関数を新しい bundle で公開し、次に新アプリの `competition` 関数を公開する。中央関数は署名付きエンドポイントを通すため `verify_jwt = false` とし、通常 API はコード内の Supabase Auth 検証を維持する。中央の署名付き照会を確認してから新アプリの教員操作を開く。中央で registry 行を `enabled=false` にすれば新規の教員操作を停止できる。公開キー以外の設定値をクライアントに配らない。
7. **14日保持の定期清掃を登録する。** 競技終了または中断で結果が確定した時点から、`expires_at_ms` は14日後に設定される。新アプリの Supabase Cron を有効にし、**新アプリの SQL Editor でのみ**次を実行する。100室ずつ15分間隔で削除し、`ON DELETE CASCADE` で参加者・問題・途中解答・結果も削除する。教員許可リストは対象外。Supabase の [Cron 手順](https://supabase.com/docs/guides/cron/quickstart)で SQL ジョブを登録できる。

   ```sql
   SELECT cron.schedule(
     'alkane-puzzle-prune-expired-rooms',
     '*/15 * * * *',
     'SELECT public.app_prune_expired_rooms(100);'
   );
   ```

   `cron.job` で登録行を、`cron.job_run_details` で初回以降の成功状態を確認する。期限切れ室が100件より多く残る場合は件数の減少を確認し、保管量を測ってから頻度と上限を再検討する。匿名 Auth アカウントはこのジョブでは削除しない。削除候補は教員 identity・有効な参加資格・保存期間内の結果・最終利用時刻を管理者が確認して、別の保守操作で扱う。

## 運用確認

- 中央のマスター教員で新アプリへログインし、教員セッション、許可リストの GET、CAS と `requestId` を使う変更を確認する。変更後、中央の既存アプリ側でも同じ改訂番号とメール集合を確認する。
- 許可済み教員がクラスを作成できること、未許可の Google アカウント、未確認メール、匿名アカウントが教員操作をできないことを確認する。新旧プロジェクトの UID は互いに置き換えず、照合には中央で検証したメールだけを用いる。
- 中央の呼び出しを一時的に失敗させ、新規教員操作が `503` で閉じる一方、生徒の参加・解答が続くことを確認する。ブラウザから署名やメールを追加しても権限が増えないことを確認する。
- 教員を中央で取り消し、次の教員操作が拒否されることを確認する。既に開いた Realtime 購読には最大60秒のリースがある。ルーム通知の送信前に期限切れリースを失効させてトピックを回転するため、古いトピックへの後続送信を止める。物理端末・実サービスでこの境界を別途確認する。

中央が一時的に利用できない間、教員の新規管理操作は実行しない。復旧後に同じ操作 ID を再送する場合、署名付き転送の request ID は新しくし、許可リスト変更の `requestId` は同じにする。これにより転送再利用を拒否しつつ、中央の変更を二重適用しない。
