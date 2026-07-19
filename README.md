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

## 背景画像・動画(手動管理)

サイト全体の背景スライドショーは `src/assets/backgrounds/` にあるファイルだけを使います。
写真・動画を投稿しても背景には自動で反映されません。背景に使いたいファイルは
`src/assets/backgrounds/` へ手動で追加(コミット)してください。

- 対応形式: jpg / jpeg / png / webp(画像)、mp4 / webm(動画)
- ファイルを削除すれば背景からも消えます

## コメント・いいね・意見ボックス

ブログ記事の末尾と `/feedback/` には、Supabaseを使ったコメント欄があります。
閲覧・投稿・返信・👍にログインは不要です。コメントは承認待ちで保存され、
Supabaseの `site_comments` テーブルで `status` を `approved` にすると公開されます。

初回設定:

1. Supabaseでプロジェクトを作成する
2. DashboardのSQL Editorで `supabase/comments.sql` を実行する
3. `.env` に次を設定する

```env
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

公開環境にも同じ2項目を設定してビルドしてください。`service_role` キーは
ブラウザやGitHubリポジトリへ絶対に置かないでください。

### コメントの承認

Supabase DashboardのTable Editorで `site_comments` を開き、内容を確認して
`status` を `pending` から `approved` に変更します。不適切な投稿は
`rejected` に変更するか削除してください。

## ビルド

```sh
npm run build
```

`main` ブランチへpushすると、`.github/workflows/deploy.yml` がGitHub Pagesへデプロイします。
