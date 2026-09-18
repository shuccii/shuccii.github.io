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

// src/assets/works/ の作品サムネイル(/works/ でのみ使う)
const workImageModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/works/*.{jpg,jpeg,png,webp,gif,JPG,JPEG,PNG,WEBP}",
  { eager: true },
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
  "20AAB8F4-8B89-43A7-BCF2-457682A64822_1_102_a.jpeg": 119.66,
  "27DEC8CA-52F7-44AD-A379-9222FD2589FC_1_102_a.jpeg": 118.36,
  "5133D0A0-8E7F-461E-900B-219232DE008C_1_102_a.jpeg": 109.4,
  "70C2E4C0-0101-41A9-A36B-DBA46E654CA7_1_201_a.jpeg": 112.46,
  "85A145E7-8C89-4AA4-B176-1C03AD772C92_1_105_c.jpeg": 120.91,
  "B295D987-B2E4-4964-98C0-3C190BE1A497.jpeg": 168.75,
  "D9A78B8E-8FF2-418B-9175-9476C0ABFEC0_1_102_o.jpeg": 54.85,
  "F123A185-49D7-46D7-A012-141DC4B7FA23_1_105_c.jpeg": 96.09,
  "IMG_0536.jpeg": 75.62,
  "IMG_1400.JPG": 105.61,
  "IMG_2672.JPG": 69.41,
  "IMG_2943.JPG": 132.86,
  "IMG_3379.jpeg": 54.88,
  "IMG_9900.jpeg": 46.68,
  "_DSC0031.jpeg": 181.35,
  "_DSC0221.jpeg": 142.11,
  "_DSC0235.jpeg": 146.82,
  "_DSC0380_045.JPG": 111.45,
  "_DSC0384_048.JPG": 183.53,
  "_DSC0621.jpeg": 106.36,
  "_DSC0793.jpeg": 113.88,
  "_DSC0965.jpeg": 72.96,
  "_DSC0985.jpeg": 137.09,
  "bg-city-dusk.jpg": 179.74,
  "bg-rainbow-bridge.jpg": 99.9,
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
      file: string;
      url: string;
      image: ImageMetadata;
    }
  | {
      type: "video";
      file: string;
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
        file: fileName(path),
        url: backgroundUrlModules[path],
        image: mod.default,
      }),
    ),
    ...Object.entries(backgroundVideoModules).map(
      ([path, url]): TileMedia => ({ type: "video", file: fileName(path), url }),
    ),
    ...Object.entries(photoModules).map(
      ([path, mod]): TileMedia => ({
        type: "image",
        file: fileName(path),
        url: photoUrlModules[path],
        image: mod.default,
      }),
    ),
    ...Object.entries(videoUrlModules).map(
      ([path, url]): TileMedia => ({ type: "video", file: fileName(path), url }),
    ),
  ];
}

// トップページの7項目は、背景専用フォルダ内の風景写真だけを使う。
// 夜景 / 紅葉 / 夕景 / 花畑 / 庭園 / 都市風景 / 灯台を割り当て、似た景色が続かないようにする。
const topPageTileFiles = [
  "IMG_0536.jpeg",
  "IMG_1400.JPG",
  "IMG_2672.JPG",
  "IMG_2943.JPG",
  "IMG_9900.jpeg",
  "bg-rainbow-bridge.jpg",
  "_DSC0221.jpeg",
];

export function getTopPageTileMedia(): TileMedia[] {
  const backgrounds = Object.entries(backgroundImageModules).map(
    ([path, mod]): TileMedia => ({
      type: "image",
      file: fileName(path),
      url: backgroundUrlModules[path],
      image: mod.default,
    }),
  );
  const byFile = new Map(backgrounds.map((media) => [media.file, media]));
  const selected = topPageTileFiles
    .map((file) => byFile.get(file))
    .filter((media): media is TileMedia => media !== undefined);
  const selectedFiles = new Set(selected.map((media) => media.file));

  return [...selected, ...backgrounds.filter((media) => !selectedFiles.has(media.file))];
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

// works の frontmatter に書かれたファイル名から、サムネイル画像を引き当てる。
export function getWorkImage(file: string): ImageMetadata | null {
  if (!file) return null;
  const found = Object.entries(workImageModules).find(
    ([path]) => fileName(path) === file,
  );
  return found ? found[1].default : null;
}
