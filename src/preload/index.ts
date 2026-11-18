import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS, IPC_PREFIX } from '../shared/api';

// Superfície mínima: apenas os métodos da lista fechada API_METHODS, sem expor ipcRenderer.
const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const name of API_METHODS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(IPC_PREFIX + name, ...args);
}

contextBridge.exposeInMainWorld('banca', Object.freeze(api));
