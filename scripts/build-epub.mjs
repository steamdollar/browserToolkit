import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'libs');
const pdfjsDest = path.join(dest, 'pdfjs');

async function requireSource(source) {
  const input = path.join(root, source);
  try {
    await stat(input);
  } catch {
    throw new Error(`Missing ${source}. Run "npm install" first.`);
  }
  return input;
}

await mkdir(dest, { recursive: true });

for (const [source, target] of [
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['node_modules/epubjs/dist/epub.min.js', 'epub.min.js'],
]) {
  await copyFile(await requireSource(source), path.join(dest, target));
  console.log(`Bundled ${target}`);
}

// pdf.js loads the worker, CMaps (CJK text), standard fonts and image-decoder wasm by URL at runtime.
// quickjs-eval (PDF JavaScript) is left out: the reader never runs scripts embedded in a PDF.
await rm(pdfjsDest, { recursive: true, force: true });
await mkdir(pdfjsDest, { recursive: true });
for (const [source, target] of [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/pdfjs-dist/LICENSE', 'LICENSE'],
  ['node_modules/pdfjs-dist/cmaps', 'cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'standard_fonts'],
  ['node_modules/pdfjs-dist/iccs', 'iccs'],
  ['node_modules/pdfjs-dist/wasm', 'wasm'],
]) {
  await cp(await requireSource(source), path.join(pdfjsDest, target), {
    recursive: true,
    filter: (file) => !path.basename(file).startsWith('quickjs-eval'),
  });
  console.log(`Bundled pdfjs/${target}`);
}

console.log('EPUB/PDF assets are ready for chrome://extensions.');
