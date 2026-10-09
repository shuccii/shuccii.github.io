import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ExifTool } from 'exiftool-vendored';
import { inspectMedia } from '../scripts/media-privacy.mjs';
import { stripLocationMetadata } from '../src/lib/media-strip.js';

const gps = { GPSLatitude: 1, GPSLongitude: 2, GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' };

// 公開画面のブラウザ内除去を、ビルド検査と同じ exiftool の判定で確かめる。
async function withTool(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mypage-strip-test-'));
  const tool = new ExifTool({ maxProcs: 1 });
  try { await fn(dir, tool); } finally { await tool.end(); await rm(dir, { recursive: true, force: true }); }
}

for (const format of ['jpeg', 'png', 'webp']) test(`${format}: browser strip removes EXIF/XMP location and keeps pixels and orientation`, () => withTool(async (dir, tool) => {
  const file = path.join(dir, `fixture.${format}`);
  await sharp({ create: { width: 16, height: 12, channels: 3, background: '#4682b4' } })[format]().toFile(file);
  await tool.write(file, { ...gps, Orientation: 6, 'XMP-exif:GPSLatitude': 1, 'XMP-exif:GPSLongitude': 2, ...(format === 'jpeg' ? { 'IPTC:City': 'X' } : {}) }, { writeArgs: ['-overwrite_original'] });
  assert.ok((await inspectMedia(tool, file)).keys.length);
  const pixels = await sharp(file).raw().toBuffer();
  const out = path.join(dir, `clean.${format}`);
  await writeFile(out, stripLocationMetadata(new Uint8Array(await readFile(file))));
  assert.deepEqual((await inspectMedia(tool, out)).keys, []);
  assert.deepEqual(await sharp(out).raw().toBuffer(), pixels);
  assert.equal((await tool.read(out)).Orientation, (await tool.read(file)).Orientation);
}));

test('jpeg: trailing embedded images after EOI are dropped', () => withTool(async (dir, tool) => {
  const file = path.join(dir, 'a.jpg');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toFile(file);
  const inner = path.join(dir, 'inner.jpg');
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toFile(inner);
  await tool.write(inner, gps, { writeArgs: ['-overwrite_original'] });
  const joined = Buffer.concat([await readFile(file), await readFile(inner)]);
  const out = Buffer.from(stripLocationMetadata(new Uint8Array(joined)));
  assert.equal(out.indexOf(Buffer.from('GPS')), -1);
  assert.deepEqual(out.subarray(-2), Buffer.from([0xff, 0xd9]));
}));

test('gif: XMP location is removed and frames are kept', () => withTool(async (dir, tool) => {
  const file = path.join(dir, 'a.gif');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).gif().toFile(file);
  await tool.write(file, { 'XMP-exif:GPSLatitude': 1, 'XMP-exif:GPSLongitude': 2 }, { writeArgs: ['-overwrite_original'] });
  assert.ok((await inspectMedia(tool, file)).keys.length);
  const out = path.join(dir, 'clean.gif');
  await writeFile(out, stripLocationMetadata(new Uint8Array(await readFile(file))));
  assert.deepEqual((await inspectMedia(tool, out)).keys, []);
  assert.deepEqual(await sharp(out).raw().toBuffer(), await sharp(file).raw().toBuffer());
}));

const mdat = (bytes) => {
  const start = bytes.indexOf(Buffer.from('mdat')) - 4;
  return bytes.subarray(start);
};

test('mp4/mov: QuickTime and UserData location is removed without touching media data', () => withTool(async (dir, tool) => {
  const sources = [new URL('./fixtures/blank.mp4', import.meta.url)];
  const videos = path.join(path.dirname(new URL(import.meta.url).pathname), '../src/assets/videos');
  for (const name of (await readdir(videos).catch(() => [])).filter((n) => /\.mov$/i.test(n)).slice(0, 2)) sources.push(path.join(videos, name));
  for (const [index, source] of sources.entries()) {
    const file = path.join(dir, `v${index}.mov`);
    await writeFile(file, await readFile(source));
    await tool.write(file, { GPSCoordinates: '1 2', 'UserData:GPSCoordinates': '1 2', 'XMP-exif:GPSLatitude': 1 }, { writeArgs: ['-overwrite_original'] });
    assert.ok((await inspectMedia(tool, file)).keys.length);
    const before = await readFile(file);
    const out = path.join(dir, `clean${index}.mov`);
    const cleaned = Buffer.from(stripLocationMetadata(new Uint8Array(before)));
    await writeFile(out, cleaned);
    assert.deepEqual((await inspectMedia(tool, out)).keys, [], String(source));
    assert.equal(cleaned.length, before.length);
    assert.ok(mdat(cleaned).equals(mdat(before)));
  }
}));

test('unsupported or malformed media is refused', () => {
  assert.throws(() => stripLocationMetadata(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), /位置情報を除去できません/);
  assert.throws(() => stripLocationMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), /JPEG/);
});
