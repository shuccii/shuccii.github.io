// 公開画面からのアップロード用に、ブラウザ内で位置情報を含むメタデータを除去する。
// 画素・音声・映像のデータは再圧縮せず、画像の向きと色プロファイルだけを残す。
// 安全に判定できないファイルは例外を投げ、送信させない。

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16 = (b, i, le = false) => le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
const u32 = (b, i, le = false) => le
  ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
  : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const fail = (message) => { throw new Error(message); };

// TIFF(EXIF)本体から Orientation(0x0112)だけを読む。読めなければ 1。
function readOrientation(tiff) {
  if (tiff.length < 8) return 1;
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") return 1;
  const le = order === "II";
  const ifd = u32(tiff, 4, le);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(tiff, ifd, le);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(tiff, entry, le) === 0x0112) {
      const value = u16(tiff, entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

// Orientation だけを持つ最小の TIFF(EXIF)本体。
const orientationTiff = (orientation) => new Uint8Array([
  0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8,
  0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0,
  0, 0, 0, 0,
]);
const exifPrefix = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]);
const tiffFromExifPayload = (payload) =>
  ascii(payload, 0, 6) === "Exif\0\0" ? payload.subarray(6) : payload;

function stripJpeg(b) {
  const parts = [b.subarray(0, 2)];
  let orientation = 1;
  let insertAt = 1;
  let pos = 2;
  for (;;) {
    if (pos + 2 > b.length || b[pos] !== 0xff) fail("JPEGの構造を読み取れませんでした");
    while (b[pos + 1] === 0xff) pos++;
    const marker = b[pos + 1];
    if (marker === 0xd9) { parts.push(b.subarray(pos, pos + 2)); break; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(b.subarray(pos, pos + 2)); pos += 2; continue; }
    const end = pos + 2 + u16(b, pos + 2);
    if (end > b.length) fail("JPEGの構造を読み取れませんでした");
    const payload = b.subarray(pos + 4, end);
    const isApp = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (marker === 0xe1 && ascii(payload, 0, 6) === "Exif\0\0") orientation = readOrientation(payload.subarray(6));
    const keep = !isApp ||
      (marker === 0xe0 && ascii(payload, 0, 5) === "JFIF\0") ||
      (marker === 0xe2 && ascii(payload, 0, 12) === "ICC_PROFILE\0") ||
      (marker === 0xee && ascii(payload, 0, 5) === "Adobe");
    if (keep) {
      parts.push(b.subarray(pos, end));
      if (marker === 0xe0 && parts.length === 2) insertAt = 2;
    }
    pos = end;
    if (marker === 0xda) {
      // 圧縮データは次のマーカーまでそのまま写す。
      let i = pos;
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
      if (i + 1 >= b.length) fail("JPEGの終端が見つかりませんでした");
      parts.push(b.subarray(pos, i));
      pos = i;
    }
  }
  // EOI 以降(埋め込みの副画像など)は捨てる。
  if (orientation !== 1) {
    const exif = concat([exifPrefix, orientationTiff(orientation)]);
    const header = new Uint8Array([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]);
    parts.splice(insertAt, 0, header, exif);
  }
  return concat(parts);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n) => new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

const pngKeep = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "acTL", "fcTL", "fdAT"]);
function stripPng(b) {
  const parts = [b.subarray(0, 8)];
  let orientation = 1;
  let pos = 8;
  let ended = false;
  while (!ended) {
    if (pos + 12 > b.length) fail("PNGの構造を読み取れませんでした");
    const length = u32(b, pos);
    const type = ascii(b, pos + 4, 4);
    const end = pos + 12 + length;
    if (end > b.length) fail("PNGの構造を読み取れませんでした");
    if (type === "eXIf") orientation = readOrientation(tiffFromExifPayload(b.subarray(pos + 8, pos + 8 + length)));
    if (pngKeep.has(type)) parts.push(b.subarray(pos, end));
    if (type === "IEND") ended = true;
    pos = end;
  }
  if (orientation !== 1) {
    const body = concat([new TextEncoder().encode("eXIf"), orientationTiff(orientation)]);
    parts.splice(2, 0, concat([be32(body.length - 4), body, be32(crc32(body))]));
  }
  return concat(parts);
}

const le32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24]);
function stripWebp(b) {
  const chunks = [];
  let orientation = 1;
  let pos = 12;
  const riffEnd = Math.min(b.length, 8 + u32(b, 4, true));
  while (pos + 8 <= riffEnd) {
    const type = ascii(b, pos, 4);
    const size = u32(b, pos + 4, true);
    const end = pos + 8 + size + (size & 1);
    if (pos + 8 + size > b.length) fail("WebPの構造を読み取れませんでした");
    if (type === "EXIF") orientation = readOrientation(tiffFromExifPayload(b.subarray(pos + 8, pos + 8 + size)));
    else if (type !== "XMP ") chunks.push(b.slice(pos, Math.min(end, b.length)));
    pos = end;
  }
  const vp8x = chunks.find((chunk) => ascii(chunk, 0, 4) === "VP8X");
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04);
  if (vp8x && orientation !== 1) {
    const tiff = orientationTiff(orientation);
    chunks.push(concat([new TextEncoder().encode("EXIF"), le32(tiff.length), tiff]));
    vp8x[8] |= 0x08;
  }
  const body = concat(chunks);
  return concat([new TextEncoder().encode("RIFF"), le32(body.length + 4), new TextEncoder().encode("WEBP"), body]);
}

function stripGif(b) {
  let pos = 13;
  if (b[10] & 0x80) pos += 3 * (1 << ((b[10] & 7) + 1));
  const parts = [b.subarray(0, pos)];
  const skipSubBlocks = (i) => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    if (i >= b.length) fail("GIFの構造を読み取れませんでした");
    return i + 1;
  };
  for (;;) {
    if (pos >= b.length) fail("GIFの終端が見つかりませんでした");
    const start = pos;
    const kind = b[pos];
    if (kind === 0x3b) { parts.push(b.subarray(pos, pos + 1)); break; }
    if (kind === 0x2c) {
      pos += 10;
      if (b[start + 9] & 0x80) pos += 3 * (1 << ((b[start + 9] & 7) + 1));
      pos = skipSubBlocks(pos + 1);
      parts.push(b.subarray(start, pos));
    } else if (kind === 0x21) {
      const label = b[pos + 1];
      pos = skipSubBlocks(pos + 2);
      const id = label === 0xff ? ascii(b, start + 3, 11) : "";
      const keep = label === 0xf9 || label === 0x01 || id === "NETSCAPE2.0" || id === "ANIMEXTS1.0";
      if (keep) parts.push(b.subarray(start, pos));
    } else fail("GIFの構造を読み取れませんでした");
  }
  return concat(parts);
}

// 動画: メタデータ箱を同じ大きさの free 箱へ置き換えて中身を 0 で埋める。
// 箱の大きさを変えないので、映像・音声データの位置(stco)は変わらない。
const mp4Containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf", "mfra"]);
const mp4Erase = new Set(["udta", "meta", "uuid", "free", "skip", "wide", "©xyz", "loci", "XMP_"]);
const allowedHandlers = new Set(["vide", "soun", "tmcd", "meta"]);
// 3文字の "gps" はバイナリの表に偶然現れやすいので、長い語だけで判定する。
const locationText = /location|iso6709|gpscoordinates|©xyz|latitude|longitude|geotag/i;
const latin1 = new TextDecoder("latin1");

function readBoxes(b, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32(b, pos);
    const type = ascii(b, pos + 4, 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) fail("動画の構造を読み取れませんでした");
      size = u32(b, pos + 8) * 2 ** 32 + u32(b, pos + 12);
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) fail("動画の構造を読み取れませんでした");
    boxes.push({ start: pos, header, end: pos + size, type });
    pos += size;
  }
  if (pos !== end) fail("動画の構造を読み取れませんでした");
  return boxes;
}

function stripMp4(input) {
  const b = input.slice();
  const erase = (box) => {
    b.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
    b.fill(0, box.start + box.header, box.end);
  };
  const find = (boxes, type) => boxes.find((box) => box.type === type);
  const checkTrack = (trak) => {
    const mdia = find(readBoxes(b, trak.start + trak.header, trak.end), "mdia");
    if (!mdia) return;
    const mdiaBoxes = readBoxes(b, mdia.start + mdia.header, mdia.end);
    const hdlr = find(mdiaBoxes, "hdlr");
    const handler = hdlr ? ascii(b, hdlr.start + hdlr.header + 8, 4) : "";
    if (!allowedHandlers.has(handler)) fail("位置情報を含む可能性のあるデータトラックがあるため、公開画面からは追加できません");
    if (handler !== "meta") return;
    // 時系列メタデータの種類(キー名)に位置情報が含まれていれば送らない。
    const minf = find(mdiaBoxes, "minf");
    const stbl = minf && find(readBoxes(b, minf.start + minf.header, minf.end), "stbl");
    const stsd = stbl && find(readBoxes(b, stbl.start + stbl.header, stbl.end), "stsd");
    if (!stsd || locationText.test(latin1.decode(b.subarray(stsd.start, stsd.end)))) {
      fail("動画に位置情報を記録するトラックがあるため、公開画面からは追加できません");
    }
  };
  const walk = (start, end, depth) => {
    for (const box of readBoxes(b, start, end)) {
      if (box.type === "mdat") continue;
      if (mp4Erase.has(box.type)) erase(box);
      else if (mp4Containers.has(box.type)) {
        if (box.type === "trak") checkTrack(box);
        walk(box.start + box.header, box.end, depth + 1);
      }
    }
  };
  const top = readBoxes(b, 0, b.length);
  if (!top.length || top[0].type !== "ftyp" || !find(top, "moov")) fail("対応していない動画形式です");
  walk(0, b.length, 0);
  // 最終確認: 映像・音声データ以外に位置情報らしき文字列が残っていないこと。
  for (const box of top) {
    if (box.type !== "mdat" && locationText.test(latin1.decode(b.subarray(box.start, box.end)))) {
      fail("動画の位置情報を除去できませんでした。公開を中止しました");
    }
  }
  return b;
}

export function detectMediaFormat(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "gif";
  if (ascii(b, 4, 4) === "ftyp") return "mp4";
  return null;
}

/** 位置情報を除いたバイト列を返す。判定できない形式は例外。 */
export function stripLocationMetadata(bytes) {
  switch (detectMediaFormat(bytes)) {
    case "jpeg": return stripJpeg(bytes);
    case "png": return stripPng(bytes);
    case "webp": return stripWebp(bytes);
    case "gif": return stripGif(bytes);
    case "mp4": return stripMp4(bytes);
    default: return fail("この形式は公開画面から位置情報を除去できません(WebM・HEICなどはローカル管理画面を使ってください)");
  }
}
