/**
 * Serviço de domínio: aplica as regras de negócio sobre o repositório, sempre dentro de transações,
 * e registra o histórico (audit_log) na MESMA transação da alteração.
 */
import {
  betAvailableEffect,
  buildDashboard,
  computeAlerts,
  computeBalances,
  toBetView,
  type LedgerInput,
} from '../core/ledger';
import {
  ValidationError,
  validateBetInput,
  validateBetUpdateInput,
  validateHouseInput,
  validateId,
  validateOptionalIso,
  validateStatus,
  validateTransactionInput,
} from '../core/validation';
import { formatBRL, formatOdds } from '../shared/money';
import type { AuditQuery } from '../shared/api';
import {
  KIND_LABEL,
  STATUS_LABEL,
  type AuditEntry,
  type BalanceAlert,
  type Bet,
  type BetFilter,
  type BetUpdateInput,
  type BetView,
  type DashboardData,
  type DashboardFilter,
  type House,
  type HouseWithBalance,
  type Transaction,
  type TransactionInput,
  type TransactionView,
} from '../shared/types';
import { inTransaction, type Db } from './db/database';
import { Repository } from './db/repository';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: undefined });

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export class BancaService {
  private readonly repo: Repository;

  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.repo = new Repository(db);
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private load(): LedgerInput {
    return {
      houses: this.repo.allHouses(),
      transactions: this.repo.allTransactions(),
      bets: this.repo.allBets(),
    };
  }

  private houseOrThrow(id: number, field = 'houseId'): House {
    const h = this.repo.getHouse(id);
    if (!h) throw new ValidationError({ [field]: 'Casa de apostas não encontrada.' });
    return h;
  }

  private availableOf(houseId: number): number {
    return computeBalances(this.load()).get(houseId)?.availableCents ?? 0;
  }

  private audit(
    entityType: AuditEntry['entityType'],
    entityId: number | null,
    action: string,
    summary: string,
    before: unknown,
    after: unknown,
  ): void {
    this.repo.insertAudit({ at: this.nowIso(), entityType, entityId, action, summary, before, after });
  }

  // =========================================================================================
  // Casas
  // =========================================================================================

  listHouses(): HouseWithBalance[] {
    const input = this.load();
    const balances = computeBalances(input);
    const withMov = this.repo.housesWithMovements();
    return input.houses.map((h) => ({ ...h, ...balances.get(h.id)!, hasMovements: withMov.has(h.id) }));
  }

  private houseWithBalance(id: number): HouseWithBalance {
    const h = this.listHouses().find((x) => x.id === id);
    if (!h) throw new ValidationError('Casa de apostas não encontrada.');
    return h;
  }

  createHouse(raw: unknown): HouseWithBalance {
    const input = validateHouseInput(raw);
    return inTransaction(this.db, () => {
      if (this.repo.houseNameTaken(input.name, null)) {
        throw new ValidationError({ name: 'Já existe uma casa com este nome.' });
      }
      const id = this.repo.insertHouse(input, this.nowIso());
      this.audit(
        'house',
        id,
        'create',
        `Casa "${input.name}" cadastrada com saldo inicial de ${formatBRL(input.initialBalanceCents)}.`,
        null,
        input,
      );
      return this.houseWithBalance(id);
    });
  }

  updateHouse(rawId: unknown, raw: unknown): HouseWithBalance {
    const id = validateId(rawId);
    const input = validateHouseInput(raw);
    return inTransaction(this.db, () => {
      const before = this.houseOrThrow(id, '_');
      if (this.repo.houseNameTaken(input.name, id)) {
        throw new ValidationError({ name: 'Já existe uma casa com este nome.' });
      }
      const changes: string[] = [];
      if (before.name !== input.name) changes.push(`nome "${before.name}" → "${input.name}"`);
      if (before.initialBalanceCents !== input.initialBalanceCents)
        changes.push(
          `saldo inicial ${formatBRL(before.initialBalanceCents)} → ${formatBRL(input.initialBalanceCents)}`,
        );
      if (before.initialBalanceAt !== input.initialBalanceAt)
        changes.push(`data do saldo inicial ${fmtDate(before.initialBalanceAt)} → ${fmtDate(input.initialBalanceAt)}`);
      if (changes.length > 0) {
        this.repo.updateHouse(id, input, this.nowIso());
        this.audit('house', id, 'update', `Casa "${input.name}" editada: ${changes.join('; ')}.`, before, input);
      }
      return this.houseWithBalance(id);
    });
  }

  setHouseArchived(rawId: unknown, archived: unknown): HouseWithBalance {
    const id = validateId(rawId);
    if (typeof archived !== 'boolean') throw new ValidationError('Valor inválido.');
    return inTransaction(this.db, () => {
      const before = this.houseOrThrow(id, '_');
      if (before.archived !== archived) {
        if (archived) {
          const pending = this.repo.allBets().filter((b) => b.houseId === id && b.status === 'pending').length;
          if (pending > 0) {
            throw new ValidationError(
              `Esta casa tem ${pending} aposta${pending > 1 ? 's' : ''} pendente${pending > 1 ? 's' : ''}. Defina o resultado antes de arquivar.`,
            );
          }
        }
        this.repo.setHouseArchived(id, archived, this.nowIso());
        this.audit(
          'house',
          id,
          archived ? 'archive' : 'unarchive',
          `Casa "${before.name}" ${archived ? 'arquivada' : 'reativada'}.`,
          { archived: before.archived },
          { archived },
        );
      }
      return this.houseWithBalance(id);
    });
  }

  deleteHouse(rawId: unknown): null {
    const id = validateId(rawId);
    inTransaction(this.db, () => {
      const house = this.houseOrThrow(id, '_');
      if (this.repo.houseMovementCount(id) > 0) {
        throw new ValidationError(
          'Esta casa possui movimentações (apostas, depósitos ou saques) e não pode ser excluída. Arquive-a para ocultá-la.',
        );
      }
      this.repo.deleteHouse(id);
      this.audit('house', id, 'delete', `Casa "${house.name}" excluída (não tinha movimentações).`, house, null);
    });
    return null;
  }

  // =========================================================================================
  // Depósitos e saques
  // =========================================================================================

  private txView(t: Transaction, names: Map<number, string>): TransactionView {
    return { ...t, houseName: names.get(t.houseId) ?? '—' };
  }

  listTransactions(filter?: { houseId?: number | null }): TransactionView[] {
    const houseId = filter?.houseId == null ? null : validateId(filter.houseId);
    const names = new Map(this.repo.allHouses().map((h) => [h.id, h.name]));
    return this.repo.allTransactions(houseId).map((t) => this.txView(t, names));
  }

  private checkWithdrawal(input: TransactionInput, ignoring: Transaction | null): void {
    if (input.kind !== 'withdrawal') return;
    let available = this.availableOf(input.houseId);
    if (ignoring && ignoring.houseId === input.houseId) {
      available -= ignoring.kind === 'deposit' ? ignoring.amountCents : -ignoring.amountCents;
    }
    if (input.amountCents > available) {
      throw new ValidationError({
        amountCents: `Saque maior que o saldo disponível da casa (${formatBRL(Math.max(available, 0))}).`,
      });
    }
  }

  createTransaction(raw: unknown): TransactionView {
    const input = validateTransactionInput(raw);
    return inTransaction(this.db, () => {
      const house = this.houseOrThrow(input.houseId);
      if (house.archived) throw new ValidationError({ houseId: 'Esta casa está arquivada. Reative-a para movimentar.' });
      this.checkWithdrawal(input, null);
      const id = this.repo.insertTransaction(input, this.nowIso());
      this.audit(
        'transaction',
        id,
        'create',
        `${KIND_LABEL[input.kind]} de ${formatBRL(input.amountCents)} em ${house.name} (${fmtDate(input.occurredAt)}).`,
        null,
        { ...input, houseName: house.name },
      );
      return this.txView(this.repo.getTransaction(id)!, new Map([[house.id, house.name]]));
    });
  }

  updateTransaction(rawId: unknown, raw: unknown): TransactionView {
    const id = validateId(rawId);
    const input = validateTransactionInput(raw);
    return inTransaction(this.db, () => {
      const before = this.repo.getTransaction(id);
      if (!before) throw new ValidationError('Movimentação não encontrada.');
      const house = this.houseOrThrow(input.houseId);
      if (house.archived && house.id !== before.houseId)
        throw new ValidationError({ houseId: 'Esta casa está arquivada. Reative-a para movimentar.' });
      this.checkWithdrawal(input, before);
      this.repo.updateTransaction(id, input, this.nowIso());
      this.audit(
        'transaction',
        id,
        'update',
        `${KIND_LABEL[before.kind]} de ${formatBRL(before.amountCents)} editado: agora ${KIND_LABEL[input.kind].toLowerCase()} de ${formatBRL(input.amountCents)} em ${house.name} (${fmtDate(input.occurredAt)}).`,
        before,
        { ...input, houseName: house.name },
      );
      return this.txView(this.repo.getTransaction(id)!, new Map([[house.id, house.name]]));
    });
  }

  deleteTransaction(rawId: unknown): null {
    const id = validateId(rawId);
    inTransaction(this.db, () => {
      const before = this.repo.getTransaction(id);
      if (!before) throw new ValidationError('Movimentação não encontrada.');
      const house = this.repo.getHouse(before.houseId);
      this.repo.deleteTransaction(id);
      this.audit(
        'transaction',
        id,
        'delete',
        `${KIND_LABEL[before.kind]} de ${formatBRL(before.amountCents)} excluído (${house?.name ?? '—'}, ${fmtDate(before.occurredAt)}).`,
        { ...before, houseName: house?.name },
        null,
      );
    });
    return null;
  }

  // =========================================================================================
  // Apostas
  // =========================================================================================

  private betView(bet: Bet): BetView {
    const house = this.repo.getHouse(bet.houseId)!;
    return toBetView(bet, house);
  }

  private snapshot(bet: Bet): Record<string, unknown> {
    const house = this.repo.getHouse(bet.houseId);
    return { ...bet, houseName: house?.name ?? '—' };
  }

  private describe(bet: Bet): string {
    const house = this.repo.getHouse(bet.houseId);
    const what = bet.description ? `"${bet.description}" — ` : '';
    return `${what}${formatBRL(bet.stakeCents)} @ ${formatOdds(bet.oddsMilli)} em ${house?.name ?? '—'}`;
  }

  listBets(rawFilter: BetFilter): BetView[] {
    const f = rawFilter ?? {};
    const filter: BetFilter = {
      from: validateOptionalIso(f.from, 'Data inicial') ?? undefined,
      to: validateOptionalIso(f.to, 'Data final') ?? undefined,
      houseId: f.houseId == null ? null : validateId(f.houseId),
      statuses: Array.isArray(f.statuses) ? f.statuses.map(validateStatus) : undefined,
    };
    const search = typeof f.search === 'string' ? stripAccents(f.search.trim()).slice(0, 100) : '';
    const names = new Map(this.repo.allHouses().map((h) => [h.id, h] as const));
    let bets = this.repo.queryBets(filter);
    if (search) bets = bets.filter((b) => stripAccents(b.description).includes(search));
    return bets.map((b) => toBetView(b, names.get(b.houseId)!));
  }

  createBet(raw: unknown): BetView {
    const input = validateBetInput(raw);
    return inTransaction(this.db, () => {
      const house = this.houseOrThrow(input.houseId);
      if (house.archived) throw new ValidationError({ houseId: 'Esta casa está arquivada. Reative-a para apostar.' });
      const available = this.availableOf(house.id);
      if (input.stakeCents > available) {
        throw new ValidationError({
          stakeCents: `O valor é maior que o saldo disponível da casa (${formatBRL(Math.max(available, 0))}).`,
        });
      }
      const id = this.repo.insertBet(
        { ...input, settledAt: null, status: 'pending' },
        this.nowIso(),
      );
      const bet = this.repo.getBet(id)!;
      this.audit('bet', id, 'create', `Aposta criada: ${this.describe(bet)}. Status: Pendente.`, null, this.snapshot(bet));
      return this.betView(bet);
    });
  }

  updateBet(rawId: unknown, raw: unknown): BetView {
    const id = validateId(rawId);
    const input = validateBetUpdateInput(raw);
    return inTransaction(this.db, () => this.applyBetUpdate(id, input));
  }

  setBetStatus(rawId: unknown, rawStatus: unknown, rawSettledAt?: unknown): BetView {
    const id = validateId(rawId);
    const status = validateStatus(rawStatus);
    const settledAt = validateOptionalIso(rawSettledAt, 'A data da liquidação');
    return inTransaction(this.db, () => {
      const bet = this.repo.getBet(id);
      if (!bet) throw new ValidationError('Aposta não encontrada.');
      return this.applyBetUpdate(id, {
        houseId: bet.houseId,
        stakeCents: bet.stakeCents,
        oddsMilli: bet.oddsMilli,
        placedAt: bet.placedAt,
        description: bet.description,
        notes: bet.notes,
        status,
        settledAt,
      });
    });
  }

  /** Deve ser chamado dentro de uma transação. */
  private applyBetUpdate(id: number, input: BetUpdateInput): BetView {
    const before = this.repo.getBet(id);
    if (!before) throw new ValidationError('Aposta não encontrada.');
    const house = this.houseOrThrow(input.houseId);
    if (house.archived && house.id !== before.houseId) {
      throw new ValidationError({ houseId: 'Esta casa está arquivada. Reative-a para usá-la.' });
    }

    // Data de liquidação: pendente -> nula; liquidada -> informada, ou a anterior, ou agora.
    let settledAt: string | null = null;
    if (input.status !== 'pending') {
      const explicit = input.settledAt;
      const fallback = before.status !== 'pending' && before.settledAt ? before.settledAt : this.nowIso();
      settledAt = explicit ?? fallback;
      if (Date.parse(settledAt) < Date.parse(input.placedAt)) {
        if (explicit) {
          throw new ValidationError({ settledAt: 'A data de liquidação não pode ser anterior à data da aposta.' });
        }
        settledAt = input.placedAt; // padrão automático: nunca antes da aposta
      }
    }

    // Reserva de uma aposta que JÁ era pendente: o valor precisa caber no saldo (sem contar esta aposta).
    // Mudanças de status nunca são bloqueadas; efeitos em saldo viram alertas (correções retroativas).
    if (input.status === 'pending' && before.status === 'pending') {
      const changedReserve = before.houseId !== input.houseId || input.stakeCents > before.stakeCents;
      if (changedReserve) {
        let available = this.availableOf(input.houseId);
        if (before.houseId === input.houseId) available -= betAvailableEffect(before);
        if (input.stakeCents > available) {
          throw new ValidationError({
            stakeCents: `O valor é maior que o saldo disponível da casa (${formatBRL(Math.max(available, 0))}).`,
          });
        }
      }
    }

    const next: Omit<Bet, 'id' | 'createdAt' | 'updatedAt'> = {
      houseId: input.houseId,
      stakeCents: input.stakeCents,
      oddsMilli: input.oddsMilli,
      placedAt: input.placedAt,
      settledAt,
      status: input.status,
      description: input.description,
      notes: input.notes,
    };

    const changes: string[] = [];
    if (before.status !== next.status) {
      changes.push(`status ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[next.status]}`);
    }
    if (before.houseId !== next.houseId) {
      changes.push(`casa "${this.repo.getHouse(before.houseId)?.name}" → "${house.name}"`);
    }
    if (before.stakeCents !== next.stakeCents)
      changes.push(`valor ${formatBRL(before.stakeCents)} → ${formatBRL(next.stakeCents)}`);
    if (before.oddsMilli !== next.oddsMilli)
      changes.push(`odd ${formatOdds(before.oddsMilli)} → ${formatOdds(next.oddsMilli)}`);
    if (before.placedAt !== next.placedAt)
      changes.push(`data da aposta ${fmtDate(before.placedAt)} → ${fmtDate(next.placedAt)}`);
    if (before.settledAt !== next.settledAt) {
      changes.push(
        next.settledAt === null
          ? 'liquidação removida'
          : before.settledAt === null
            ? `liquidada em ${fmtDate(next.settledAt)}`
            : `data de liquidação ${fmtDate(before.settledAt)} → ${fmtDate(next.settledAt)}`,
      );
    }
    if (before.description !== next.description) changes.push('descrição alterada');
    if (before.notes !== next.notes) changes.push('observações alteradas');

    if (changes.length === 0) return this.betView(before); // nada mudou: sem efeito e sem histórico

    this.repo.updateBet(id, next, this.nowIso());
    const after = this.repo.getBet(id)!;
    const onlyStatus = changes.length === 1 || (changes.length === 2 && before.status !== next.status && before.settledAt !== next.settledAt);
    let outcome = '';
    const v = toBetView(after, house);
    if (after.status === 'green') outcome = ` Retorno ${formatBRL(v.returnCents!)}, lucro ${formatBRL(v.profitCents!)}.`;
    else if (after.status === 'red') outcome = ` Retorno ${formatBRL(0)}, prejuízo ${formatBRL(after.stakeCents)}.`;
    else if (after.status === 'void') outcome = ` Valor devolvido (${formatBRL(after.stakeCents)}), sem lucro ou prejuízo.`;
    this.audit(
      'bet',
      id,
      before.status !== next.status && onlyStatus ? 'status' : 'update',
      `Aposta alterada — ${changes.join('; ')}.${outcome}`,
      this.snapshot(before),
      this.snapshot(after),
    );
    return v;
  }

  deleteBet(rawId: unknown): null {
    const id = validateId(rawId);
    inTransaction(this.db, () => {
      const before = this.repo.getBet(id);
      if (!before) throw new ValidationError('Aposta não encontrada.');
      this.repo.deleteBet(id);
      this.audit(
        'bet',
        id,
        'delete',
        `Aposta excluída: ${this.describe(before)}. Status na exclusão: ${STATUS_LABEL[before.status]}.`,
        this.snapshot(before),
        null,
      );
    });
    return null;
  }

  betHistory(rawId: unknown): AuditEntry[] {
    return this.repo.auditForEntity('bet', validateId(rawId));
  }

  // =========================================================================================
  // Histórico, painel e alertas
  // =========================================================================================

  listAudit(q: AuditQuery): { entries: AuditEntry[]; total: number } {
    const limit = Math.min(Math.max(Number.isSafeInteger(q?.limit) ? q.limit : 50, 1), 200);
    const offset = Math.max(Number.isSafeInteger(q?.offset) ? q.offset : 0, 0);
    const type = q?.entityType && ['bet', 'house', 'transaction', 'system'].includes(q.entityType) ? q.entityType : undefined;
    return this.repo.auditPage(limit, offset, type);
  }

  getDashboard(rawFilter: DashboardFilter): DashboardData {
    const f = rawFilter ?? {};
    const filter: DashboardFilter = {
      from: validateOptionalIso(f.from, 'Data inicial') ?? undefined,
      to: validateOptionalIso(f.to, 'Data final') ?? undefined,
      houseId: f.houseId == null ? null : validateId(f.houseId),
    };
    return buildDashboard(this.load(), filter, this.clock().getTime());
  }

  listAlerts(): BalanceAlert[] {
    return computeAlerts(this.load());
  }

  /** Registro de eventos de sistema (ex.: restauração de backup). */
  logSystem(action: string, summary: string): void {
    this.audit('system', null, action, summary, null, null);
  }
}

