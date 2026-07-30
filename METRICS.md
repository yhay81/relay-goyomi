# Metrics

匿名の操作イベントだけを45日間保存します。内容、URL、能力鍵、IP、User-Agent、参照元は記録しません。

- `visited`: トップ訪問
- `calendar_created`: 作成
- `calendar_updated`: 主催者修正
- `calendar_opened`: 公開ページ表示
- `join_opened`: 参加画面表示
- `slot_reserved`: 予約
- `slot_updated`: 予約内容の修正
- `slot_published`: 記事URLの初回追加
- `slot_cancelled`: 参加者による取消
- `slot_released`: 主催者による解放
- `outbound_opened`: 記事リンクを開く
- `calendar_reported`: 不正報告
- `calendar_deleted`: 削除
- `returned`: 再訪

`x-relay-goyomi-qa: 1` の操作はQAとして分離し、製品判断から除外します。
