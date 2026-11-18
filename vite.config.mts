import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// CSP restritiva apenas no build de produção (o dev server do Vite precisa de scripts inline para HMR).
const csp: Plugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
};

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome140',
  },
  server: { port: 5173, strictPort: true },
});
