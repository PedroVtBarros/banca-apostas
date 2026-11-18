// Executado pelo Electron (via make-icon.mjs): renderiza o SVG do ícone em PNGs de vários tamanhos.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = process.argv[2];
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%">
  <rect width="256" height="256" rx="58" fill="#1c1f24"/>
  <rect x="52" y="140" width="32" height="64" rx="8" fill="#f1efe9"/>
  <rect x="112" y="102" width="32" height="102" rx="8" fill="#f1efe9"/>
  <rect x="172" y="52" width="32" height="152" rx="8" fill="#43b383"/>
  <rect x="40" y="212" width="176" height="6" rx="3" fill="#5b616b"/>
</svg>`;

app.whenReady().then(async () => {
  // Renderiza uma vez em 512 px a partir de um arquivo HTML temporário e reduz para os demais tamanhos.
  const htmlFile = path.join(outDir, 'icon.html');
  fs.writeFileSync(htmlFile, `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`);
  const win = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, frame: false, transparent: true });
  await win.loadFile(htmlFile);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  for (const size of SIZES) {
    const out = img.getSize().width === size ? img : img.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), out.toPNG());
  }
  win.destroy();
  app.quit();
});
