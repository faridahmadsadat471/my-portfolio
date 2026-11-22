import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const localAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1].slice(1));
await Promise.all(localAssets.map((asset) => stat(new URL(asset, root))));
await mkdir(new URL('dist/', root), { recursive: true });
await cp(new URL('index.html', root), new URL('dist/index.html', root));
await cp(new URL('dashboard.html', root), new URL('dist/dashboard.html', root));
await mkdir(new URL('dist/assets/', root), { recursive: true });
for (const asset of new Set([...localAssets.filter(asset => asset !== 'assets/styles.css'), 'assets/profile.json', 'assets/main.js', 'assets/dashboard.js'])) {
  await cp(new URL(asset, root), new URL(`dist/${asset}`, root));
}
const execute = promisify(execFile);
await execute(process.execPath, [
  path.join(fileURLToPath(new URL('../node_modules/@tailwindcss/cli/dist/index.mjs', root))),
  '-i', fileURLToPath(new URL('assets/styles.css', root)),
  '-o', fileURLToPath(new URL('dist/assets/styles.css', root)),
  '--minify',
  '--content', fileURLToPath(new URL('index.html', root)),
  '--content', fileURLToPath(new URL('dashboard.html', root))
]);
console.log(`Built portfolio frontend at ${fileURLToPath(new URL('dist/', root))}`);
