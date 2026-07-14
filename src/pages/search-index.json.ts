import { getCollection } from "astro:content";
import site from "../data/site.json";

// サイト内検索用のインデックス。ビルド時に静的な JSON として生成される。
export async function GET() {
  const posts = await getCollection("blog");

  const items = posts.map((post) => ({
    type: "ブログ",
    title: post.data.title,
    url: `/blog/${post.id}/`,
    tags: post.data.tags,
    text: [post.data.description ?? "", post.body ?? ""].join(" ").slice(0, 6000),
    date: post.data.date.toISOString().slice(0, 10),
  }));

  items.push({
    type: "ページ",
    title: "研究内容",
    url: "/research/",
    tags: site.research.keywords,
    text: [
      site.research.lead,
      site.research.bg1,
      site.research.bg2,
      site.research.task1,
      site.research.task2,
      site.research.task3,
    ].join(" "),
    date: "",
  });

  items.push({
    type: "ページ",
    title: "プロフィール",
    url: "/profile/",
    tags: [],
    text: [
      site.profile.lead,
      site.profile.message,
      site.profile.affiliation,
      site.profile.specialty,
      site.profile.background,
      site.profile.timeline1,
      site.profile.timeline2,
      site.profile.timeline3,
      site.profile.skillsML,
      site.profile.skillsPython,
      site.profile.skillsTools,
      site.profile.interests,
      site.profile.qualifications,
    ].join(" "),
    date: "",
  });

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
