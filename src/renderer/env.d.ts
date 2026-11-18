import type { Api } from '../shared/api';

declare global {
  interface Window {
    banca: Api;
  }
}
export {};
