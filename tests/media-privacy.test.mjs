import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ExifTool } from 'exiftool-vendored';
import { sanitizeMedia, inspectMedia, checkMedia, locationKeys } from '../scripts/media-privacy.mjs';

test('location aliases and invalid GPS representations are not hidden by normalization', () => {
  assert.deepEqual(locationKeys({ 'GPS:GPSLatitude': 'invalid', 'XMP-exif:GPSLongitude': 2, 'Keys:GPSCoordinates': 'test', 'XMP-iptcExt:LocationCreated': {}, 'MacOS:MDItemLatitude': 1, 'IFD0:Orientation': 6 }).sort(),
    ['GPS:GPSLatitude', 'XMP-exif:GPSLongitude', 'Keys:GPSCoordinates', 'XMP-iptcExt:LocationCreated'].sort());
});

for (const format of ['jpeg', 'png', 'webp']) test(`${format}: publication rejects GPS and removes it without changing pixels or orientation`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mypage-privacy-test-'));
  const file = path.join(dir, `fixture.${format}`);
  const tool = new ExifTool({ maxProcs: 1 });
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#4682b4' } })[format]().toFile(file);
    await tool.write(file, { GPSLatitude: 1, GPSLongitude: 2, GPSLatitudeRef: 'N', GPSLongitudeRef: 'E', Orientation: 6 }, { writeArgs: ['-overwrite_original'] });
    const pixelsBefore = await sharp(file).raw().toBuffer();
    const orientationBefore = (await tool.read(file)).Orientation;
    await assert.rejects(checkMedia([dir]), /Location metadata found/);
    const disguised = path.join(dir, 'disguised.bin');
    await rename(file, disguised);
    await assert.rejects(checkMedia([dir]), /Location metadata found|Unsupported media container/);
    await rename(disguised, file);
    assert.equal(await sanitizeMedia(file), true);
    assert.deepEqual((await inspectMedia(tool, file)).keys, []);
    assert.deepEqual(await sharp(file).raw().toBuffer(), pixelsBefore);
    assert.equal((await tool.read(file)).Orientation, orientationBefore);
    const cleanBytes = await readFile(file);
    assert.equal(await sanitizeMedia(file), false);
    assert.deepEqual(await readFile(file), cleanBytes);
    assert.equal(await checkMedia([dir]), 1);
  } finally { await tool.end(); await rm(dir, { recursive: true, force: true }); }
});

// Fixture: one synthetic black frame, generated locally with FFmpeg; no personal data.
test('a renamed MP4 with a valid leading free atom cannot bypass publication checks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mypage-container-test-'));
  const file = path.join(dir, 'fixture.mp4');
  const tool = new ExifTool({ maxProcs: 1 });
  try {
    await writeFile(file, await readFile(new URL('./fixtures/blank.mp4', import.meta.url)));
    assert.equal(await checkMedia([dir]), 1);
    await tool.write(file, { GPSCoordinates: '1 2' }, { writeArgs: ['-overwrite_original'] });
    assert.ok((await inspectMedia(tool, file)).keys.length);
    const bytes = await readFile(file);
    await rm(file);
    const disguised = path.join(dir, 'download.bin');
    await writeFile(disguised, Buffer.concat([Buffer.from([0, 0, 0, 8, 102, 114, 101, 101]), bytes]));
    assert.ok((await inspectMedia(tool, disguised)).keys.length);
    await assert.rejects(checkMedia([dir]), /Location metadata found/);
  } finally { await tool.end(); await rm(dir, { recursive: true, force: true }); }
});
