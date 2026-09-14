# 配置

## ローカル

`deployment/pages/.dev.vars` を作成する。

```dotenv
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=<32文字以上のランダムな値>
CLASS_INVITE_CODE=<招待コード>
STORAGE_EPOCH=local-storage
```

ルートで `npm ci` → `npm run build` → `npm run db:pages:local` → `npm run db:storage:local` を実行する。添付を有効にする場合は次を実行し、`npm run dev` で起動する。

端末の通知設定を試す場合は、後述の `VAPID_*` も `.dev.vars` に設定する。

```sh
node --import ./scripts/runtime-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute STORAGE_DB --local --cwd deployment/pages --command "UPDATE storage_budget SET enabled=1,epoch='local-storage' WHERE id=1;"
```

## Cloudflare Pages

`wrangler.jsonc` に `DB`（課題）、`STORAGE_DB`（利用量）、`BUCKET`（非公開R2・Standard）を設定する。

PagesのSecretに認証URL・認証鍵・招待コード・`STORAGE_EPOCH` を設定する。通知には `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`CRON_SECRET`、文書読み取りには `CLOUDFLARE_ACCOUNT_ID`、`WORKERS_AI_API_TOKEN` が必要。

```sh
node --import ./scripts/runtime-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --cwd deployment/pages
node --import ./scripts/runtime-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply STORAGE_DB --remote --cwd deployment/pages
npm run build
node --import ./scripts/runtime-env.mjs ./node_modules/wrangler/bin/wrangler.js pages deploy --cwd deployment/pages --branch main
```

添付は初期状態で停止する。利用量DBの `epoch` をPagesの `STORAGE_EPOCH` と一致させ、容量・回数を確認してから `enabled=1` にする。Secret変更後は再配置する。

時刻通知は `deployment/cron/wrangler.jsonc` の接続先と `CRON_SECRET` を設定し、Workerを配置する。

## 添付の停止・復元

保存上限5GB、アップロード300回・取得3,000回・削除300回／UTC日。専用バケットを使い、公開URLやアプリ外の書き込みを有効にしない。アカウント内の他のR2利用はこの制限に含まれない。

停止：

```sh
node --import ./scripts/runtime-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute STORAGE_DB --remote --cwd deployment/pages --command "UPDATE storage_budget SET enabled=0 WHERE id=1;"
```

- 停止前に予約された処理は終了を待つ。再開時に容量予約・回数をリセットしない。
- 課題DBを復元しても、`STORAGE_DB` を巻き戻さない。R2・添付情報・容量予約を照合する。
- 利用量DBの復旧ではR2から予約を再構成し、不明な当日回数は上限消費済みとして扱う。
- 結果不明の保存予約は保持する。削除成功を確認した予約だけ解放する。
