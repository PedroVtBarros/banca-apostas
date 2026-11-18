import { app, BrowserWindow, Menu, session, shell } from 'electron';
import path from 'node:path';
import { DbManager } from './dbManager';
import { registerIpc } from './ipc';

// Pasta de dados FORA da instalação e do código-fonte: %APPDATA%\GestaoBanca (preservada em atualizações).
// BANCA_USER_DATA permite isolar os dados em testes automatizados.
const userData = process.env.BANCA_USER_DATA || path.join(app.getPath('appData'), 'GestaoBanca');
app.setPath('userData', userData);
app.commandLine.appendSwitch('lang', 'pt-BR');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = !!DEV_URL;
let mainWindow: BrowserWindow | null = null;
let manager: DbManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: 'Gestão de Banca',
    backgroundColor: '#f6f5f2',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Nunca navegar para fora do app nem abrir novas janelas.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL!) : url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });

  if (isDev) void mainWindow.loadURL(DEV_URL!);
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // Sem permissões especiais (câmera, localização etc.).
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    if (!isDev) Menu.setApplicationMenu(null);

    manager = new DbManager(userData);
    manager.open();
    registerIpc(manager, () => mainWindow);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => manager?.close());
}
