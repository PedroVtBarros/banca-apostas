// Gera build/icon.png e build/icon.ico (multi-resolução) a partir do SVG em icon-main.cjs.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pngToIco from 'png-to-ico';

const require = createRequire(import.meta.url);
const electron = require('electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banca-icon-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(electron, [path.resolve('scripts/icon-main.cjs'), tmp], { env, stdio: 'inherit' });
if (r.status !== 0) throw new Error('Falha ao renderizar o ícone');

fs.mkdirSync('build', { recursive: true });
fs.copyFileSync(path.join(tmp, 'icon-512.png'), 'build/icon.png');
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => path.join(tmp, `icon-${s}.png`)));
fs.writeFileSync('build/icon.ico', ico);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Ícone gerado: build/icon.ico e build/icon.png');
