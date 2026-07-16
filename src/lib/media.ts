import type { ImageMetadata } from "astro";
import { getCollection } from "astro:content";

// src/assets/photos/ の画像(ギャラリー表示用に最適化される)
const photoModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/photos/*.{jpg,jpeg,png,webp,gif,JPG,JPEG,PNG,WEBP}",
  { eager: true },
);

// 同じ画像の生URL(背景スライドショー用)
const photoUrlModules = import.meta.glob<string>(
  "../assets/photos/*.{jpg,jpeg,png,webp,gif,JPG,JPEG,PNG,WEBP}",
  { eager: true, query: "?url", import: "default" },
);

// src/assets/backgrounds/ の背景専用写真(ギャラリーには表示されない)
const backgroundUrlModules = import.meta.glob<string>(
  "../assets/backgrounds/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}",
  { eager: true, query: "?url", import: "default" },
);

// src/assets/backgrounds/ の背景専用動画(ループ再生される)
const backgroundVideoModules = import.meta.glob<string>(
  "../assets/backgrounds/*.{mp4,webm,MP4,WEBM}",
  { eager: true, query: "?url", import: "default" },
);

// src/assets/videos/ の動画のURL
const videoUrlModules = import.meta.glob<string>(
  "../assets/videos/*.{mp4,webm,mov,MP4,WEBM,MOV}",
  { eager: true, query: "?url", import: "default" },
);

const fileName = (path: string) => path.split("/").pop() ?? "";
const baseName = (path: string) => fileName(path).replace(/\.[^.]+$/, "");

export interface PhotoItem {
  file: string; // 拡張子付きファイル名(ブログ frontmatter との照合キー)
  name: string; // 拡張子なし(キャプション)
  image: ImageMetadata;
  url: string;
}

export function getPhotos(): PhotoItem[] {
  return Object.entries(photoModules)
    .map(([path, mod]) => ({
      file: fileName(path),
      name: baseName(path),
      image: mod.default,
      url: photoUrlModules[path],
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export interface VideoItem {
  file: string;
  name: string;
  url: string;
}

export function getVideos(): VideoItem[] {
  return Object.entries(videoUrlModules)
    .map(([path, url]) => ({
      file: fileName(path),
      name: baseName(path),
      url,
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export interface BackgroundMedia {
  type: "image" | "video";
  url: string;
}

export interface TileMedia extends BackgroundMedia {}

// 背景スライドショーは背景専用フォルダ src/assets/backgrounds/ のメディアだけを使う。
// 投稿した写真・動画は自動では反映されない。背景に使いたいファイルは
// backgrounds/ フォルダへ手動でコピーして追加する。
export function getBackgroundMedia(): BackgroundMedia[] {
  return [
    ...Object.values(backgroundUrlModules).map(
      (url): BackgroundMedia => ({ type: "image", url }),
    ),
    ...Object.values(backgroundVideoModules).map(
      (url): BackgroundMedia => ({ type: "video", url }),
    ),
  ];
}

// ホームのセクションタイル用。追加した写真・動画も順番に使う。
export function getTileMedia(): TileMedia[] {
  return [
    ...Object.values(backgroundUrlModules).map(
      (url): TileMedia => ({ type: "image", url }),
    ),
    ...Object.values(backgroundVideoModules).map(
      (url): TileMedia => ({ type: "video", url }),
    ),
    ...Object.values(photoUrlModules).map(
      (url): TileMedia => ({ type: "image", url }),
    ),
    ...Object.values(videoUrlModules).map(
      (url): TileMedia => ({ type: "video", url }),
    ),
  ];
}

export interface PostRef {
  slug: string;
  title: string;
}

// メディアファイル名 → そのファイルを使っているブログ記事 の対応表
export async function getMediaPostMap(): Promise<Map<string, PostRef[]>> {
  const posts = await getCollection("blog");
  const map = new Map<string, PostRef[]>();
  for (const post of posts) {
    for (const file of [...post.data.photos, ...post.data.videos]) {
      const refs = map.get(file) ?? [];
      refs.push({ slug: post.id, title: post.data.title });
      map.set(file, refs);
    }
  }
  return map;
}
