---
title: "余白の庭(個人サイト)"
type: "site"
date: 2026-07-14
description: "研究・日記・写真・音楽を置いておく個人サイト。ブラウザから記事や写真を追加できるようにしている。"
url: "https://shuccii.github.io"
repo: "https://github.com/shuccii/shuccii.github.io"
venue: "GitHub Pages"
tech: ["Astro", "TypeScript", "Supabase", "GitHub Actions"]
tags: ["個人サイト", "Astro"]
image: ""
---

Astro で作った個人サイト。GitHub Actions で GitHub Pages へデプロイしている。

画面右下の編集ボタンからブラウザ上で本文を書き換えられるようにしてあり、保存すると
GitHub Contents API 経由でリポジトリへコミットが作られる。ブログ記事・写真・動画も
同じ仕組みでブラウザから追加できる。

コメント欄、非公開の意見ボックス、閲覧された地域の記録は Supabase に置いている。
記録するのはページのパスと粗い地域だけで、IP アドレスや User-Agent は保存しない。
