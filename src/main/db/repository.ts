/**
 * Acesso ao SQLite. Somente SQL parametrizado + mapeamento linha <-> objeto de domínio.
 * Nenhuma regra de negócio aqui.
 */
import type { Db } from './database';
import type {
  AuditEntry,
  Bet,
  BetFilter,
  BetStatus,
  House,
  HouseInput,
  Transaction,
  TransactionInput,
} from '../../shared/types';

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v);
const str = (v: unknown) => String(v ?? '');

const toHouse = (r: Row): House => ({
  id: num(r.id),
  name: str(r.name),
  initialBalanceCents: num(r.initial_balance_cents),
  initialBalanceAt: str(r.initial_balance_at),
  archived: num(r.archived) === 1,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toTx = (r: Row): Transaction => ({
  id: num(r.id),
  houseId: num(r.house_id),
  kind: str(r.kind) as Transaction['kind'],
  amountCents: num(r.amount_cents),
  occurredAt: str(r.occurred_at),
  note: str(r.note),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toBet = (r: Row): Bet => ({
  id: num(r.id),
  houseId: num(r.house_id),
  stakeCents: num(r.stake_cents),
  oddsMilli: num(r.odds_milli),
  placedAt: str(r.placed_at),
  settledAt: r.settled_at === null || r.settled_at === undefined ? null : str(r.settled_at),
  status: str(r.status) as BetStatus,
  description: str(r.description),
  notes: str(r.notes),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toAudit = (r: Row): AuditEntry => ({
  id: num(r.id),
  at: str(r.at),
  entityType: str(r.entity_type) as AuditEntry['entityType'],
  entityId: r.entity_id === null ? null : num(r.entity_id),
  action: str(r.action),
  summary: str(r.summary),
  before: r.before_json ? JSON.parse(str(r.before_json)) : null,
  after: r.after_json ? JSON.parse(str(r.after_json)) : null,
});

export class Repository {
  constructor(private readonly db: Db) {}

  // ---------------- Casas ----------------
  allHouses(): House[] {
    return (this.db.prepare('SELECT * FROM houses ORDER BY archived, name COLLATE NOCASE').all() as Row[]).map(toHouse);
  }
  getHouse(id: number): House | null {
    const r = this.db.prepare('SELECT * FROM houses WHERE id = ?').get(id) as Row | undefined;
    return r ? toHouse(r) : null;
  }
  houseNameTaken(name: string, exceptId: number | null): boolean {
    const r = this.db
      .prepare('SELECT 1 AS x FROM houses WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, exceptId ?? -1);
    return r !== undefined;
  }
  insertHouse(input: HouseInput, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO houses (name, initial_balance_cents, initial_balance_at, archived, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(input.name, input.initialBalanceCents, input.initialBalanceAt, now, now);
    return Number(r.lastInsertRowid);
  }
  updateHouse(id: number, input: HouseInput, now: string): void {
    this.db
      .prepare('UPDATE houses SET name = ?, initial_balance_cents = ?, initial_balance_at = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.initialBalanceCents, input.initialBalanceAt, now, id);
  }
  setHouseArchived(id: number, archived: boolean, now: string): void {
    this.db.prepare('UPDATE houses SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  }
  deleteHouse(id: number): void {
    this.db.prepare('DELETE FROM houses WHERE id = ?').run(id);
  }
  houseMovementCount(id: number): number {
    const r = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM transactions WHERE house_id = ?) +
                (SELECT COUNT(*) FROM bets WHERE house_id = ?) AS n`,
      )
      .get(id, id) as Row;
    return num(r.n);
  }
  housesWithMovements(): Set<number> {
    const rows = this.db
      .prepare('SELECT house_id AS h FROM transactions UNION SELECT house_id FROM bets')
      .all() as Row[];
    return new Set(rows.map((r) => num(r.h)));
  }

  // ---------------- Movimentações ----------------
  allTransactions(houseId?: number | null): Transaction[] {
    const rows =
      houseId == null
        ? this.db.prepare('SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC').all()
        : this.db
            .prepare('SELECT * FROM transactions WHERE house_id = ? ORDER BY occurred_at DESC, id DESC')
            .all(houseId);
    return (rows as Row[]).map(toTx);
  }
  getTransaction(id: number): Transaction | null {
    const r = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;
    return r ? toTx(r) : null;
  }
  insertTransaction(input: TransactionInput, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO transactions (house_id, kind, amount_cents, occurred_at, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.houseId, input.kind, input.amountCents, input.occurredAt, input.note, now, now);
    return Number(r.lastInsertRowid);
  }
  updateTransaction(id: number, input: TransactionInput, now: string): void {
    this.db
      .prepare(
        `UPDATE transactions SET house_id = ?, kind = ?, amount_cents = ?, occurred_at = ?, note = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.houseId, input.kind, input.amountCents, input.occurredAt, input.note, now, id);
  }
  deleteTransaction(id: number): void {
    this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  }

  // ---------------- Apostas ----------------
  allBets(): Bet[] {
    return (this.db.prepare('SELECT * FROM bets').all() as Row[]).map(toBet);
  }
  getBet(id: number): Bet | null {
    const r = this.db.prepare('SELECT * FROM bets WHERE id = ?').get(id) as Row | undefined;
    return r ? toBet(r) : null;
  }
  /** Filtros de período/casa/status em SQL (parametrizado); a busca por texto é feita no serviço. */
  queryBets(filter: BetFilter): Bet[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.from) {
      where.push('placed_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('placed_at <= ?');
      params.push(filter.to);
    }
    if (filter.houseId != null) {
      where.push('house_id = ?');
      params.push(filter.houseId);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      params.push(...filter.statuses);
    }
    const sql = `SELECT * FROM bets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY placed_at DESC, id DESC`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toBet);
  }
  insertBet(b: Omit<Bet, 'id' | 'createdAt' | 'updatedAt'>, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO bets (house_id, stake_cents, odds_milli, placed_at, settled_at, status, description, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.houseId, b.stakeCents, b.oddsMilli, b.placedAt, b.settledAt, b.status, b.description, b.notes, now, now);
    return Number(r.lastInsertRowid);
  }
  updateBet(id: number, b: Omit<Bet, 'id' | 'createdAt' | 'updatedAt'>, now: string): void {
    this.db
      .prepare(
        `UPDATE bets SET house_id = ?, stake_cents = ?, odds_milli = ?, placed_at = ?, settled_at = ?, status = ?,
                description = ?, notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(b.houseId, b.stakeCents, b.oddsMilli, b.placedAt, b.settledAt, b.status, b.description, b.notes, now, id);
  }
  deleteBet(id: number): void {
    this.db.prepare('DELETE FROM bets WHERE id = ?').run(id);
  }

  // ---------------- Histórico ----------------
  insertAudit(e: Omit<AuditEntry, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (at, entity_type, entity_id, action, summary, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.at,
        e.entityType,
        e.entityId,
        e.action,
        e.summary,
        e.before === null || e.before === undefined ? null : JSON.stringify(e.before),
        e.after === null || e.after === undefined ? null : JSON.stringify(e.after),
      );
  }
  auditForEntity(type: string, id: number): AuditEntry[] {
    return (
      this.db
        .prepare('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC')
        .all(type, id) as Row[]
    ).map(toAudit);
  }
  auditPage(limit: number, offset: number, entityType?: string): { entries: AuditEntry[]; total: number } {
    const where = entityType ? 'WHERE entity_type = ?' : '';
    const p = entityType ? [entityType] : [];
    const total = num((this.db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...p) as Row).n);
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...p, limit, offset) as Row[];
    return { entries: rows.map(toAudit), total };
  }
}
