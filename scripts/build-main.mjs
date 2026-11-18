// Empacota main e preload (TypeScript -> CommonJS) com esbuild. `node:sqlite` é embutido no runtime.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });
