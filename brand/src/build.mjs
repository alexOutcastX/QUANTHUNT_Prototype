// Bundles the hero bull scene to brand/img/bull.js.
//
//   npm run build:bull
//
// The output is committed, because the server has no build step — Flask serves
// brand/img straight off disk. A committed artefact can drift from its source
// without anyone noticing, so the bundle carries a hash of the files it was
// built from and tests/test_brandsite.py recomputes it. Editing bull.ts without
// rebuilding then fails the suite instead of silently shipping the old scene.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SOURCES = ['brand/src/bull.ts', 'brand/src/bullhead.obj'];
const OUT = join(ROOT, 'brand', 'img', 'bull.js');

export function sourceHash() {
  const h = createHash('sha256');
  for (const rel of SOURCES) h.update(readFileSync(join(ROOT, rel)));
  return h.digest('hex').slice(0, 16);
}

const result = await esbuild.build({
  entryPoints: [join(ROOT, 'brand/src/bull.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  loader: { '.obj': 'text' },
  write: false,
  logLevel: 'warning',
});

const code = result.outputFiles[0].text;
writeFileSync(OUT, `/* built-from: ${sourceHash()} */\n${code}`);
console.log(`brand/img/bull.js  ${(code.length / 1024).toFixed(0)} KB  built-from ${sourceHash()}`);
