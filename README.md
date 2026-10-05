# AlkanePuzzleCompetition

「並べる」「名付ける」のクラスコンペとメイトマッチ。クラス42名・メイト4名まで参加でき、問題ごと判定とまとめて判定に対応します。専用 Supabase プロジェクトの Auth、PostgreSQL、Edge Functions、private Realtime を使います。

## ローカル開発

Node.js 22.13 以上を使い、依存関係を導入した後、`.env.example` を参考に `.env.local` を作成します。`VITE_` 付きの値だけがブラウザに公開されます。Edge secrets と DB 接続 URI は `.env.local` やリポジトリへ書かず、Supabase 側で管理します。

```sh
npm run dev
npm test
npm run typecheck
npm run build
```

ローカルの UI と DB テストは実際の Google OAuth、Realtime、42台の実端末での動作を保証しません。公開前には [運用手順](docs/OPERATIONS.md) と [共通教員認可の設定](docs/SHARED_TEACHER_SETUP.md) に従って専用プロジェクトを設定し、実サービスで確認します。新規プロジェクトの一括 SQL は [SUPABASE_INITIAL_SETUP.sql](docs/SUPABASE_INITIAL_SETUP.sql) です。

## 保存と保守

競技結果は確定から14日間保持し、期限切れの部屋と関連データを定期清掃します。匿名 Auth ユーザーの削除は自動化せず、`scripts/anonymous-maintenance.mjs` が出力する読み取り専用 SQL で候補件数と対象を管理者が確認します。容量のローカル基準値は `scripts/measure-local-capacity.mjs` で測り、実プロジェクトの使用量とプラン上限を別途確認します。
