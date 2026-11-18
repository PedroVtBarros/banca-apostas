import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { ValidationError } from '../core/validation';
import { API_METHODS, IPC_PREFIX, type Api, type ApiMethodName, type Result } from '../shared/api';
import type { AppInfo } from '../shared/types';
import { timestamp, validateBackupFile } from './backup';
import type { DbManager } from './dbManager';

type Handlers = {
  [K in keyof Api]: (
    ...args: Parameters<Api[K]>
  ) => Awaited<ReturnType<Api[K]>> extends Result<infer T> ? T | Promise<T> : never;
};

function buildHandlers(manager: DbManager, getWindow: () => BrowserWindow | null): Handlers {
  const svc = () => manager.service;
  return {
    appInfo: (): AppInfo => ({ version: app.getVersion(), ...manager.info() }),

    listHouses: () => svc().listHouses(),
    createHouse: (input) => svc().createHouse(input),
    updateHouse: (id, input) => svc().updateHouse(id, input),
    setHouseArchived: (id, archived) => svc().setHouseArchived(id, archived),
    deleteHouse: (id) => svc().deleteHouse(id),

    listTransactions: (filter) => svc().listTransactions(filter),
    createTransaction: (input) => svc().createTransaction(input),
    updateTransaction: (id, input) => svc().updateTransaction(id, input),
    deleteTransaction: (id) => svc().deleteTransaction(id),

    listBets: (filter) => svc().listBets(filter),
    createBet: (input) => svc().createBet(input),
    updateBet: (id, input) => svc().updateBet(id, input),
    setBetStatus: (id, status, settledAt) => svc().setBetStatus(id, status, settledAt),
    deleteBet: (id) => svc().deleteBet(id),
    betHistory: (id) => svc().betHistory(id),

    listAudit: (q) => svc().listAudit(q),
    getDashboard: (filter) => svc().getDashboard(filter),
    listAlerts: () => svc().listAlerts(),

    exportBackup: async () => {
      const win = getWindow();
      const opts = {
        title: 'Exportar backup',
        defaultPath: path.join(app.getPath('documents'), `backup-banca-${timestamp()}.db`),
        filters: [{ name: 'Backup da banca (*.db)', extensions: ['db'] }],
      };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const target = r.filePath.toLowerCase().endsWith('.db') ? r.filePath : r.filePath + '.db';
      manager.exportTo(target);
      return { path: target };
    },

    restoreBackup: async () => {
      const win = getWindow();
      const openOpts = {
        title: 'Selecionar backup para restaurar',
        properties: ['openFile' as const],
        filters: [{ name: 'Backup da banca (*.db)', extensions: ['db'] }],
      };
      const r = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts);
      if (r.canceled || r.filePaths.length === 0) return { restored: false };
      const file = r.filePaths[0]!;
      validateBackupFile(file); // falha cedo, antes de pedir confirmação
      const confirmOpts = {
        type: 'warning' as const,
        title: 'Restaurar backup',
        message: 'Substituir TODOS os dados atuais pelo backup selecionado?',
        detail:
          `Arquivo: ${file}\n\n` +
          'Todas as casas, apostas, depósitos e saques atuais serão substituídos pelo conteúdo do backup. ' +
          'Antes disso, uma cópia dos dados atuais será guardada automaticamente na pasta de backups do aplicativo.',
        buttons: ['Cancelar', 'Substituir dados'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const c = win ? await dialog.showMessageBox(win, confirmOpts) : await dialog.showMessageBox(confirmOpts);
      if (c.response !== 1) return { restored: false };
      manager.restoreFrom(file);
      return { restored: true, message: 'Backup restaurado com sucesso.' };
    },

    openDataFolder: async () => {
      await shell.openPath(manager.dataDir);
      return null;
    },
  };
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  const dev = process.env.VITE_DEV_SERVER_URL;
  return url.startsWith('file://') || (!!dev && url.startsWith(dev));
}

export function registerIpc(manager: DbManager, getWindow: () => BrowserWindow | null): void {
  const handlers = buildHandlers(manager, getWindow) as unknown as Record<
    ApiMethodName,
    (...args: unknown[]) => unknown
  >;
  for (const name of API_METHODS) {
    ipcMain.handle(IPC_PREFIX + name, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      if (!isTrustedSender(event)) return { ok: false, error: { message: 'Origem não autorizada.' } };
      try {
        return { ok: true, data: await handlers[name]!(...args) };
      } catch (e) {
        if (e instanceof ValidationError) {
          return { ok: false, error: { message: e.message, fields: e.fields } };
        }
        console.error(`Erro em ${name}:`, e);
        return { ok: false, error: { message: `Erro inesperado: ${(e as Error).message}` } };
      }
    });
  }
}
