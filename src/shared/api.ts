/**
 * Contrato IPC tipado e restrito entre renderer e main.
 * O preload expõe SOMENTE os métodos listados em API_METHODS (lista fechada).
 */
import type {
  AppInfo,
  AuditEntry,
  BalanceAlert,
  BetFilter,
  BetInput,
  BetStatus,
  BetUpdateInput,
  BetView,
  DashboardData,
  DashboardFilter,
  HouseInput,
  HouseWithBalance,
  TransactionInput,
  TransactionView,
} from './types';

export interface ApiError {
  message: string;
  /** Erros por campo (validação), ex.: { stakeCents: "Valor maior que o saldo disponível." } */
  fields?: Record<string, string>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface AuditQuery {
  limit: number;
  offset: number;
  entityType?: 'bet' | 'house' | 'transaction' | 'system';
}

export interface BackupExportResult {
  path: string;
}

export interface BackupRestoreResult {
  /** false quando o usuário cancelou. */
  restored: boolean;
  message?: string;
}

export interface Api {
  appInfo(): Promise<Result<AppInfo>>;

  listHouses(): Promise<Result<HouseWithBalance[]>>;
  createHouse(input: HouseInput): Promise<Result<HouseWithBalance>>;
  updateHouse(id: number, input: HouseInput): Promise<Result<HouseWithBalance>>;
  setHouseArchived(id: number, archived: boolean): Promise<Result<HouseWithBalance>>;
  deleteHouse(id: number): Promise<Result<null>>;

  listTransactions(filter?: { houseId?: number | null }): Promise<Result<TransactionView[]>>;
  createTransaction(input: TransactionInput): Promise<Result<TransactionView>>;
  updateTransaction(id: number, input: TransactionInput): Promise<Result<TransactionView>>;
  deleteTransaction(id: number): Promise<Result<null>>;

  listBets(filter: BetFilter): Promise<Result<BetView[]>>;
  createBet(input: BetInput): Promise<Result<BetView>>;
  updateBet(id: number, input: BetUpdateInput): Promise<Result<BetView>>;
  setBetStatus(id: number, status: BetStatus, settledAt?: string | null): Promise<Result<BetView>>;
  deleteBet(id: number): Promise<Result<null>>;
  betHistory(id: number): Promise<Result<AuditEntry[]>>;

  listAudit(query: AuditQuery): Promise<Result<{ entries: AuditEntry[]; total: number }>>;
  getDashboard(filter: DashboardFilter): Promise<Result<DashboardData>>;
  listAlerts(): Promise<Result<BalanceAlert[]>>;

  exportBackup(): Promise<Result<BackupExportResult | null>>;
  restoreBackup(): Promise<Result<BackupRestoreResult>>;
  openDataFolder(): Promise<Result<null>>;
}

export const API_METHODS = [
  'appInfo',
  'listHouses',
  'createHouse',
  'updateHouse',
  'setHouseArchived',
  'deleteHouse',
  'listTransactions',
  'createTransaction',
  'updateTransaction',
  'deleteTransaction',
  'listBets',
  'createBet',
  'updateBet',
  'setBetStatus',
  'deleteBet',
  'betHistory',
  'listAudit',
  'getDashboard',
  'listAlerts',
  'exportBackup',
  'restoreBackup',
  'openDataFolder',
] as const satisfies readonly (keyof Api)[];

export type ApiMethodName = (typeof API_METHODS)[number];

export const IPC_PREFIX = 'api:';
