# リレー暦

記事リレーの公開カレンダーを、登録なしで作成・共有できる小さなWebサービスです。

主催者は7〜31日の日程を作り、参加URLだけを仲間へ共有します。参加者は空いている日を予約し、記事ができたら自分専用の編集URLからHTTPSリンクを追加できます。公開ページは閲覧専用です。

## 開発

Node.js 24 と npm 11 を使います。

```powershell
npm install
npm run dev
npm run release:check
npm run check
npm test
npm run build
```

ローカルD1には `npx wrangler d1 migrations apply relay-goyomi --local` でスキーマを適用します。報告機能を試すときだけ `.dev.vars.example` を `.dev.vars` として複製し、十分に長いランダム値へ置き換えます。

## 公開

- サービス: <https://relay-goyomi.yhay81.com>
- 運営: [yhay81](https://github.com/yhay81)
- ライセンス: MIT

公開・参加・主催者・各枠の編集URLは役割が異なります。URLフラグメントに入る能力鍵は平文で保存せず、紛失時の再発行も行いません。
