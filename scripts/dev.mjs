// Desenvolvimento: Vite (HMR) + build do main/preload + Electron apontando para o servidor do Vite.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);

await import('./build-main.mjs');

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`Renderer em ${url}`);

const electronPath = require('electron');
const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE; // alguns terminais (ex.: VS Code) definem isso e quebram o Electron
if (!env.BANCA_USER_DATA) env.BANCA_USER_DATA = new URL('../.dev-data', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
