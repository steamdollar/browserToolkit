import { copyFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'libs');

await mkdir(dest, { recursive: true });

for (const [source, target] of [
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['node_modules/epubjs/dist/epub.min.js', 'epub.min.js'],
]) {
  const input = path.join(root, source);
  try {
    await stat(input);
  } catch {
    throw new Error(`Missing ${source}. Run "npm install" first.`);
  }
  await copyFile(input, path.join(dest, target));
  console.log(`Bundled ${target}`);
}

console.log('EPUB assets are ready for chrome://extensions.');
