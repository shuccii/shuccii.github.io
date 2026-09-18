import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    // src/assets/photos/ 内のファイル名を書くと、記事内ギャラリーに表示され、
    // 写真ページにも同期される(例: photos: ["2026-07-14_風景.jpg"])
    photos: z.array(z.string()).default([]),
    // src/assets/videos/ 内のファイル名(例: videos: ["demo.mp4"])
    videos: z.array(z.string()).default([]),
  }),
});

// 作ったもの(出版物・アプリ・Webサイト)。/works/ に一覧が出る。
const works = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/works" }),
  schema: z.object({
    title: z.string(),
    // publication = 論文・発表・記事、app = アプリ、site = Webサイト
    type: z.enum(["publication", "app", "site"]).default("app"),
    // 公開日・発表日(新しい順に並ぶ)
    date: z.coerce.date(),
    description: z.string().optional(),
    // 公開ページ・DOI・ストアなどのURL。空ならリンクを出さない
    url: z.string().default(""),
    // ソースコードのURL(あれば)
    repo: z.string().default(""),
    // 掲載先。論文なら雑誌名・学会名、アプリなら動作環境やストア名
    venue: z.string().default(""),
    // 使った技術・言語(例: ["Astro", "TypeScript"])
    tech: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    // src/assets/works/ 内のファイル名(例: image: "screenshot.png")
    image: z.string().default(""),
  }),
});

export const collections = { blog, works };
