# 余白の庭

Astroで作った個人サイトです。GitHub Pagesで公開しています。

## 開発

```sh
npm install
npm run dev
```

開発サーバーでは、画面右下の「✎ 編集」から編集できます。保存時はローカルの
`src/data/site.json` に書き戻します。編集パスワードは、プロジェクト直下の
`.edit-secret` に設定してください。このファイルはGit管理対象外です。

## 公開サイトでの編集

GitHub Pagesは静的サイトのため、編集内容の保存先としてGitHub Contents APIを使います。
画面右下の「✎ 編集」を押すと、GitHubのfine-grained Personal Access Token (PAT)を求められます。

PATは次の条件で作成してください。

- Repository access: `Only select repositories` → `shuccii/shuccii.github.io`
- Repository permissions: `Contents` → `Read and write`
- 有効期限は必要な期間だけにする

入力したPATはブラウザのセッション中だけ保持し、サイト側へ送信せずGitHub APIへ直接送ります。
保存すると `src/data/site.json` の更新コミットが作成され、GitHub Actionsの再ビルド後に公開サイトへ反映されます。

ページ内テキストは `site.json` に、ブログ記事はMarkdownファイルとして保存されます。

## Webからの投稿・メディア追加

公開サイトの `/blog/`、`/photos/`、`/videos/` で「✎ 編集」を押すと、ブラウザからコンテンツを追加できます。

- ブログ: タイトル、日付、説明、タグ、Markdown本文、画像・動画の添付
- 写真: jpg / jpeg / png / webp / gif
- 動画: mp4 / webm / mov

メディアは1ファイル50MBまでです。ブログへ添付したメディアは、記事・写真・動画ページに自動で関連付けられます。

## 作ったもの(/works/)

出版物・発表、アプリ・ツール、Webサイトを `/works/` に載せられます。

公開サイトの `/works/` で「✎ 編集」を押すと、ブラウザから追加・編集・削除できます。
入力するのは、種類(出版物 / アプリ / Webサイト)、タイトル、公開日、説明、掲載先、
公開ページのURL、ソースコードのURL、使った技術、タグ、本文です。

本文を書くと詳細ページ(`/works/<ファイル名>/`)が作られ、一覧の見出しからそこへ進みます。
本文を空にすると詳細ページは作られず、一覧の見出しが公開ページのURLへ直接リンクします。

手で追加する場合は `src/content/works/` にMarkdownファイルを置きます。

```markdown
---
title: "論文・アプリ・サイトの名前"
type: "publication" # publication(出版物) / app(アプリ) / site(Webサイト)
date: 2026-09-18
description: "一覧に出る短い説明"
url: "https://doi.org/..." # 公開ページ・DOI。空でも可
repo: "https://github.com/..." # ソースコード。空でも可
venue: "雑誌名・学会名・ストア名など"
tech: ["Python", "scikit-learn"]
tags: ["研究", "機械学習"]
image: "" # src/assets/works/ に置いた画像のファイル名
---

本文(任意)。書くと詳細ページになります。
```

サムネイルを付けたいときは、画像を `src/assets/works/` へ手動で追加(コミット)し、
`image:` にファイル名を書きます。このフォルダの画像は写真ページには出ません。

## 背景画像・動画(手動管理)

サイト全体の背景スライドショーは `src/assets/backgrounds/` にあるファイルだけを使います。
写真・動画を投稿しても背景には自動で反映されません。背景に使いたいファイルは
`src/assets/backgrounds/` へ手動で追加(コミット)してください。

- 対応形式: jpg / jpeg / png / webp(画像)、mp4 / webm(動画)
- ファイルを削除すれば背景からも消えます

## コメント・いいね・非公開の意見ボックス

ブログ記事の末尾には、Supabaseを使ったコメント欄があります。
閲覧・投稿・返信・👍にログインは不要です。禁止語やスパムの検査を通過した
コメントは、送信後すぐに公開されます。

`/feedback/` は公開コメントとは別の非公開フォームです。アカウント登録なしで送信できますが、
内容はサイトに表示されず、管理者だけがSupabase Dashboardで確認できます。

初回設定:

1. Supabaseでプロジェクトを作成する
2. DashboardのSQL Editorで `supabase/comments.sql` と `supabase/private-feedback.sql` を順に実行する
3. `.env` に次を設定する

```env
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

公開環境にも同じ2項目を設定してビルドしてください。`service_role` キーは
ブラウザやGitHubリポジトリへ絶対に置かないでください。

既に旧版の `comments.sql` を実行済みの場合は、
`supabase/enable-immediate-comments.sql` も一度だけ実行してください。

### 管理者によるコメント削除

削除操作はサイトの公開キーには許可していません。管理者はSupabase Dashboardで
`Table Editor` → `site_comments` を開き、対象行を選択して削除できます。
非表示だけにしたい場合は `status` を `rejected` に変更してください。

### 非公開の意見を確認する

Supabase DashboardのTable Editorで `site_feedback` を開きます。確認済みの意見は
`status` を `new` から `read` に変更できます。ブラウザ用の公開キーには
このテーブルの読み取り権限を付与していません。
送信はブラウザ単位で1時間5件までに制限し、識別子はハッシュ化して保存します。

## アクセスされた地域を見る

サイトが開かれた地域(国・都道府県・市区町村)だけを Supabase に記録します。
Cloudflare Web Analytics は国までしか分からないため、県・市まで見たいとき用の仕組みです。

- 記録するのは「ページのパス」と「粗い地域」だけで、IP アドレス、User-Agent、
  リファラ、個人を追跡する識別子は保存しません
- 地域は閲覧者のブラウザから [ipwho.is](https://ipwho.is/)(応答がなければ
  [GeoJS](https://www.geojs.io/))に問い合わせて判定します
- ブラウザが Do Not Track / Global Privacy Control を出している場合は記録しません
- 同じセッション中の同じページは1回だけ数えます。記録は2年で消えます
- `localhost` では記録しません(開発中の閲覧は混ざりません)

初回設定:

1. Supabase の SQL Editor で `supabase/visits.sql` を実行する
2. 同じ SQL Editor で、管理ページの合言葉を登録する(長い文字列にしてください)

```sql
insert into public.site_admin_keys (name, key_hash)
values ('visits', encode(extensions.digest('ここに長い合言葉', 'sha256'), 'hex'))
on conflict (name) do update set key_hash = excluded.key_hash;
```

確認方法: `/visits/` を開き、合言葉と期間を入れて「表示」を押します。
国別・都道府県別・市区町村別・ページ別・直近の閲覧が表示されます。
都道府県は日本語(例: 奈良県)で、市区町村は判定元の表記(例: Ikoma)で出ます。

このページはナビゲーションには載せておらず、`noindex` と `robots.txt` で検索避けしています。
合言葉を知らないと中身は取得できません(ブラウザ用の公開キーでは表のデータを直接読めません)。

地域は IP アドレスからの推定なので、携帯回線や職場のネットワーク経由では実際の場所と
離れた県・市が出ることがあります。

## ビルド

```sh
npm run build
```

`main` ブランチへpushすると、`.github/workflows/deploy.yml` がGitHub Pagesへデプロイします。
