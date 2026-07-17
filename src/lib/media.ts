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
const backgroundImageModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/backgrounds/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}",
  { eager: true },
);

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

// 背景の32x32平均輝度。ブラウザで元写真をCanvas解析せず、
// 同じ明暗判定を即座に適用できるようビルド前に算出した値。
const backgroundBrightness: Record<string, number> = {
  "B295D987-B2E4-4964-98C0-3C190BE1A497.jpeg": 168.42,
  "IMG_0536.jpeg": 75.31,
  "IMG_1400.JPG": 105.33,
  "IMG_2672.JPG": 69.34,
  "IMG_2943.JPG": 132.69,
  "IMG_3379.jpeg": 54.56,
  "IMG_9900.jpeg": 45.45,
  "_DSC0031.jpeg": 181.07,
  "_DSC0221.jpeg": 141.79,
  "_DSC0235.jpeg": 146.51,
  "_DSC0380_045.JPG": 106.34,
  "_DSC0384_048.JPG": 181.09,
  "_DSC0621.jpeg": 106.08,
  "_DSC0793.jpeg": 111.67,
  "_DSC0965.jpeg": 72.24,
  "_DSC0985.jpeg": 136.82,
  "bg-city-dusk.jpg": 179.58,
  "bg-rainbow-bridge.jpg": 99.76,
};

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

export type BackgroundMedia =
  | {
      type: "image";
      url: string;
      image: ImageMetadata;
      brightness: number;
    }
  | {
      type: "video";
      url: string;
    };

export type TileMedia =
  | {
      type: "image";
      url: string;
      image: ImageMetadata;
    }
  | {
      type: "video";
      url: string;
    };

// 背景スライドショーは背景専用フォルダ src/assets/backgrounds/ のメディアだけを使う。
// 投稿した写真・動画は自動では反映されない。背景に使いたいファイルは
// backgrounds/ フォルダへ手動でコピーして追加する。
export function getBackgroundMedia(): BackgroundMedia[] {
  return [
    ...Object.entries(backgroundImageModules).map(
      ([path, mod]): BackgroundMedia => ({
        type: "image",
        url: backgroundUrlModules[path],
        image: mod.default,
        brightness: backgroundBrightness[fileName(path)] ?? 150,
      }),
    ),
    ...Object.values(backgroundVideoModules).map(
      (url): BackgroundMedia => ({ type: "video", url }),
    ),
  ];
}

// ホームのセクションタイル用。追加した写真・動画も順番に使う。
export function getTileMedia(): TileMedia[] {
  return [
    ...Object.entries(backgroundImageModules).map(
      ([path, mod]): TileMedia => ({
        type: "image",
        url: backgroundUrlModules[path],
        image: mod.default,
      }),
    ),
    ...Object.values(backgroundVideoModules).map(
      (url): TileMedia => ({ type: "video", url }),
    ),
    ...Object.entries(photoModules).map(
      ([path, mod]): TileMedia => ({
        type: "image",
        url: photoUrlModules[path],
        image: mod.default,
      }),
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
