import { mediaFiles, sanitizeMedia, checkMedia } from './media-privacy.mjs';

const roots = ['src/assets', 'public'];
if (process.argv.includes('--sanitize')) {
  let changed = 0;
  for (const root of roots) for (const file of await mediaFiles(root)) {
    if (await sanitizeMedia(file)) changed++;
  }
  console.log(`Sanitized ${changed} media files without re-encoding.`);
}
console.log(`Privacy check passed: ${await checkMedia(roots)} media files.`);
