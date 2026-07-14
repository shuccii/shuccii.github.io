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

export const collections = { blog };
