import { ExifTool } from 'exiftool-vendored';
import { readdir, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mediaExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.webm', '.tif', '.tiff', '.heic', '.avif']);
const mediaTypes = new Set(['JPEG', 'PNG', 'WEBP', 'Extended WEBP', 'GIF', 'MP4', 'MOV', 'WEBM', 'MKV', 'TIFF', 'HEIC', 'AVIF']);
const fileType = (tags) => String(Object.entries(tags).find(([key]) => /(^|:)FileType$/.test(key))?.[1]);
const locationTag = /GPS|Latitude|Longitude|Location|Geotag|^(City|Country|Province|Sub-location)$/i;

export function locationKeys(tags) {
  return Object.keys(tags).filter((key) => {
    const parts = key.split(':');
    // Finder/Spotlight attributes are local caches, not published file metadata.
    return parts[0] !== 'MacOS' && locationTag.test(parts.at(-1));
  });
}

export async function inspectMedia(tool, file) {
  // readRaw avoids GPS normalization dropping malformed coordinates. Embedded
  // metadata is included, and values are never logged or included in errors.
  const tags = await tool.readRaw(file, { readArgs: ['-G1', '-a', '-s', '-ee'], ignoreMinorErrors: false });
  if (Object.keys(tags).some((key) => /(^|:)Error$/.test(key))) throw new Error('Media metadata could not be read safely');
  if (!mediaTypes.has(fileType(tags))) {
    throw new Error('Unsupported media container; publication refused');
  }
  return { keys: locationKeys(tags), tags };
}

export async function sanitizeMedia(file) {
  const tool = new ExifTool({ maxProcs: 1 });
  try {
    const before = await inspectMedia(tool, file);
    if (!before.keys.length) return false;
    // Metadata-only rewriting preserves encoded image/audio/video payloads.
    // Keep image display direction and color profiles; QuickTime structural
    // track data (including rotation) is protected by ExifTool.
    await tool.write(file, {}, { writeArgs: ['-overwrite_original', '-all=', '-tagsFromFile', '@', '-Orientation', '-ICC_Profile'], ignoreMinorErrors: false });
    const after = await inspectMedia(tool, file);
    if (after.keys.length) throw new Error('Location metadata remains; publication refused');
    return true;
  } finally { await tool.end(); }
}

async function hasMediaSignature(file) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, head.length, 0);
    return head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
      head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      head.subarray(0, 3).toString() === 'GIF' ||
      (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') ||
      head.subarray(4, 8).toString() === 'ftyp' ||
      head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
      ['49492a00', '4d4d002a'].includes(head.subarray(0, 4).toString('hex'));
  } finally { await handle.close(); }
}

export async function mediaFiles(root) {
  const files = [];
  const identifier = new ExifTool({ maxProcs: 1 });
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      const file = path.join(dir, entry.name);
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`Symlink is not allowed in publication media: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (mediaExtensions.has(path.extname(file).toLowerCase()) || await hasMediaSignature(file)) files.push(file);
      else {
        // A valid container may have leading padding/other atoms, regardless
        // of its extension. Use the full parser for all remaining files.
        const tags = await identifier.readRaw(file, { readArgs: ['-G1', '-s', '-FileType'] });
        if (mediaTypes.has(fileType(tags))) files.push(file);
      }
    }
  }
  try { await walk(root); return files; }
  finally { await identifier.end(); }
}

export async function checkMedia(roots) {
  const tool = new ExifTool({ maxProcs: 2 });
  const unsafe = [];
  let checked = 0;
  try {
    for (const root of roots) for (const file of await mediaFiles(root)) {
      if ((await inspectMedia(tool, file)).keys.length) unsafe.push(file);
      checked++;
    }
  } finally { await tool.end(); }
  if (unsafe.length) throw new Error(`Location metadata found in ${unsafe.length} media files. Run npm run privacy:sanitize before publishing.\n${unsafe.join('\n')}`);
  return checked;
}

export function publicationPrivacy() {
  return {
    name: 'publication-privacy',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command === 'dev') injectRoute({ pattern: '/admin/', entrypoint: './src/admin/index.astro' });
      },
      'astro:build:start': async () => { await checkMedia(['src/assets', 'public']); },
      'astro:build:done': async ({ dir }) => { await checkMedia([fileURLToPath(dir)]); },
    },
  };
}
