/** Tipos de domínio compartilhados entre main, core e renderer. Datas são strings ISO-8601 (UTC). */

export type BetStatus = 'pending' | 'green' | 'red' | 'void';

export const BET_STATUSES: readonly BetStatus[] = ['pending', 'green', 'red', 'void'];

export const STATUS_LABEL: Record<BetStatus, string> = {
  pending: 'Pendente',
  green: 'Green',
  red: 'Red',
  void: 'Anulada',
};

export type TransactionKind = 'deposit' | 'withdrawal';

export const KIND_LABEL: Record<TransactionKind, string> = {
  deposit: 'Depósito',
  withdrawal: 'Saque',
};

export interface House {
  id: number;
  name: string;
  initialBalanceCents: number;
  initialBalanceAt: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: number;
  houseId: number;
  kind: TransactionKind;
  amountCents: number;
  occurredAt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bet {
  id: number;
  houseId: number;
  stakeCents: number;
  oddsMilli: number;
  placedAt: string;
  /** Data da liquidação; null se pendente. */
  settledAt: string | null;
  status: BetStatus;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Aposta já com valores derivados (nunca armazenados). */
export interface BetView extends Bet {
  houseName: string;
  houseArchived: boolean;
  /** Retorno bruto: Green = valor×odd; Anulada = valor; Red = 0; Pendente = null. */
  returnCents: number | null;
  /** Lucro/prejuízo realizado; Pendente = null. */
  profitCents: number | null;
  /** Retorno potencial (valor×odd) e lucro potencial, sempre calculáveis. */
  potentialReturnCents: number;
  potentialProfitCents: number;
}

export interface HouseBalance {
  houseId: number;
  initialBalanceCents: number;
  depositsCents: number;
  withdrawalsCents: number;
  /** Saldo disponível para apostar. */
  availableCents: number;
  /** Soma dos valores de apostas pendentes. */
  reservedCents: number;
  /** Lucro/prejuízo realizado (Green, Red; Anulada = 0). Exclui depósitos e saques. */
  realizedCents: number;
  /** Patrimônio = disponível + reservado. */
  equityCents: number;
  pendingCount: number;
  betCount: number;
}

export interface HouseWithBalance extends House, HouseBalance {
  hasMovements: boolean;
}

export interface TransactionView extends Transaction {
  houseName: string;
}

/** Alerta de saldo negativo (atual ou histórico por correções retroativas). */
export interface BalanceAlert {
  houseId: number;
  houseName: string;
  kind: 'current' | 'historical';
  /** Quando o saldo disponível ficou negativo pela primeira vez. */
  firstAt: string;
  /** Menor saldo disponível atingido. */
  minCents: number;
  minAt: string;
  /** Saldo atual (disponível). */
  currentCents: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  entityType: 'bet' | 'house' | 'transaction' | 'system';
  entityId: number | null;
  action: string;
  summary: string;
  before: unknown;
  after: unknown;
}

// ---------- Filtros ----------

export interface BetFilter {
  /** Início/fim (inclusive) sobre a data da aposta. ISO. */
  from?: string;
  to?: string;
  houseId?: number | null;
  statuses?: BetStatus[];
  search?: string;
}

export interface DashboardFilter {
  from?: string;
  to?: string;
  houseId?: number | null;
}

// ---------- Entradas ----------

export interface HouseInput {
  name: string;
  initialBalanceCents: number;
  initialBalanceAt: string;
}

export interface TransactionInput {
  houseId: number;
  kind: TransactionKind;
  amountCents: number;
  occurredAt: string;
  note: string;
}

export interface BetInput {
  houseId: number;
  stakeCents: number;
  oddsMilli: number;
  placedAt: string;
  description: string;
  notes: string;
}

export interface BetUpdateInput extends BetInput {
  status: BetStatus;
  /** Obrigatória (ou assumida como agora) quando status != pending. */
  settledAt: string | null;
}

// ---------- Painel ----------

export interface SeriesPoint {
  /** epoch ms (início do dia local do último evento do dia, ou o limite do período) */
  t: number;
  /** Patrimônio da banca (disponível + reservado). */
  equityCents: number;
  /** Depósitos − saques acumulados (aportes líquidos, inclui saldo inicial). */
  contributedCents: number;
  /** Lucro/prejuízo realizado acumulado no período (exclui depósitos/saques). */
  cumulativeProfitCents: number;
  availableCents: number;
}

export interface HouseComparison {
  houseId: number;
  houseName: string;
  betCount: number;
  stakedCents: number; // somente Green+Red liquidadas no período
  profitCents: number;
  roi: number | null;
  hitRate: number | null;
}

export interface StatusDistribution {
  status: BetStatus;
  count: number;
  stakeCents: number;
}

export interface DashboardData {
  // Situação atual (filtrada por casa; não depende do período)
  availableCents: number;
  reservedCents: number;
  equityCents: number;
  // Desempenho no período
  realizedCents: number;
  betCount: number;
  pendingCount: number;
  greenCount: number;
  redCount: number;
  voidCount: number;
  hitRate: number | null;
  roi: number | null;
  settledStakeCents: number;
  series: SeriesPoint[];
  byHouse: HouseComparison[];
  distribution: StatusDistribution[];
  alerts: BalanceAlert[];
  /** Houve movimentações (casas) para mostrar os gráficos? */
  hasData: boolean;
}

// ---------- Backup ----------

export interface BackupFileInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface AppInfo {
  version: string;
  dbPath: string;
  dbSizeBytes: number;
  dataDir: string;
  backupsDir: string;
  autoBackups: BackupFileInfo[];
  schemaVersion: number;
}
