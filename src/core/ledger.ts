/**
 * Regras de negócio puras (sem banco, sem Electron).
 *
 * Princípio central: NADA de saldo é armazenado. Saldos, reservas, lucro e séries dos gráficos são
 * SEMPRE derivados do estado atual de casas, movimentações e apostas. Por isso, trocar o status de
 * uma aposta N vezes jamais duplica créditos/débitos: existe apenas "o estado atual" da aposta,
 * e o efeito dele é recalculado do zero.
 *
 * Efeito de uma aposta (valor S, retorno R = round(S×odd)):
 *   Pendente: disponível −S (em t=aposta); reservado +S
 *   Green:    disponível −S (em t=aposta) e +R (em t=liquidação); lucro realizado +(R−S)
 *   Red:      disponível −S (em t=aposta); lucro realizado −S
 *   Anulada:  disponível −S (em t=aposta) e +S (em t=liquidação); lucro 0
 */

import { calcReturnCents } from '../shared/money';
import type {
  Bet,
  BetStatus,
  BetView,
  BalanceAlert,
  DashboardData,
  DashboardFilter,
  House,
  HouseBalance,
  HouseComparison,
  SeriesPoint,
  StatusDistribution,
  Transaction,
} from '../shared/types';

export interface LedgerInput {
  houses: House[];
  transactions: Transaction[];
  bets: Bet[];
}

// ---------------------------------------------------------------------------------------------
// Derivados de uma aposta
// ---------------------------------------------------------------------------------------------

export function betReturnCents(bet: Pick<Bet, 'status' | 'stakeCents' | 'oddsMilli'>): number | null {
  switch (bet.status) {
    case 'pending':
      return null;
    case 'green':
      return calcReturnCents(bet.stakeCents, bet.oddsMilli);
    case 'red':
      return 0;
    case 'void':
      return bet.stakeCents;
  }
}

export function betProfitCents(bet: Pick<Bet, 'status' | 'stakeCents' | 'oddsMilli'>): number | null {
  const r = betReturnCents(bet);
  return r === null ? null : r - bet.stakeCents;
}

export function toBetView(bet: Bet, house: Pick<House, 'name' | 'archived'>): BetView {
  const potentialReturnCents = calcReturnCents(bet.stakeCents, bet.oddsMilli);
  return {
    ...bet,
    houseName: house.name,
    houseArchived: house.archived,
    returnCents: betReturnCents(bet),
    profitCents: betProfitCents(bet),
    potentialReturnCents,
    potentialProfitCents: potentialReturnCents - bet.stakeCents,
  };
}

/** Instante efetivo de liquidação: nunca anterior à data da aposta. */
export function effectiveSettledAt(bet: Pick<Bet, 'placedAt' | 'settledAt'>): number {
  const placed = Date.parse(bet.placedAt);
  const settled = bet.settledAt ? Date.parse(bet.settledAt) : placed;
  return Math.max(placed, settled);
}

// ---------------------------------------------------------------------------------------------
// Eventos financeiros
// ---------------------------------------------------------------------------------------------

export type EventKind = 'initial' | 'deposit' | 'withdrawal' | 'bet_settled' | 'bet_placed';

/** Ordem de processamento quando dois eventos têm o mesmo instante (créditos antes de débitos). */
const KIND_ORDER: Record<EventKind, number> = {
  initial: 0,
  deposit: 1,
  bet_settled: 2,
  bet_placed: 3,
  withdrawal: 4,
};

export interface LedgerEvent {
  t: number;
  kind: EventKind;
  houseId: number;
  /** Desempate estável (id da entidade de origem). */
  refId: number;
  availableDelta: number;
  reservedDelta: number;
  /** Lucro/prejuízo realizado (nunca inclui depósitos/saques). */
  realizedDelta: number;
  /** Aporte líquido: saldo inicial + depósitos − saques. */
  contributedDelta: number;
}

export function buildEvents(input: LedgerInput): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const h of input.houses) {
    events.push({
      t: Date.parse(h.initialBalanceAt),
      kind: 'initial',
      houseId: h.id,
      refId: h.id,
      availableDelta: h.initialBalanceCents,
      reservedDelta: 0,
      realizedDelta: 0,
      contributedDelta: h.initialBalanceCents,
    });
  }
  for (const tx of input.transactions) {
    const sign = tx.kind === 'deposit' ? 1 : -1;
    events.push({
      t: Date.parse(tx.occurredAt),
      kind: tx.kind,
      houseId: tx.houseId,
      refId: tx.id,
      availableDelta: sign * tx.amountCents,
      reservedDelta: 0,
      realizedDelta: 0,
      contributedDelta: sign * tx.amountCents,
    });
  }
  for (const b of input.bets) {
    // Colocação da aposta: o valor sai do disponível e fica reservado.
    events.push({
      t: Date.parse(b.placedAt),
      kind: 'bet_placed',
      houseId: b.houseId,
      refId: b.id,
      availableDelta: -b.stakeCents,
      reservedDelta: b.stakeCents,
      realizedDelta: 0,
      contributedDelta: 0,
    });
    if (b.status !== 'pending') {
      const ret = betReturnCents(b) as number;
      events.push({
        t: effectiveSettledAt(b),
        kind: 'bet_settled',
        houseId: b.houseId,
        refId: b.id,
        availableDelta: ret,
        reservedDelta: -b.stakeCents,
        realizedDelta: ret - b.stakeCents,
        contributedDelta: 0,
      });
    }
  }
  events.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.refId - b.refId);
  return events;
}

// ---------------------------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------------------------

export function computeBalances(input: LedgerInput): Map<number, HouseBalance> {
  const map = new Map<number, HouseBalance>();
  for (const h of input.houses) {
    map.set(h.id, {
      houseId: h.id,
      initialBalanceCents: h.initialBalanceCents,
      depositsCents: 0,
      withdrawalsCents: 0,
      availableCents: 0,
      reservedCents: 0,
      realizedCents: 0,
      equityCents: 0,
      pendingCount: 0,
      betCount: 0,
    });
  }
  for (const ev of buildEvents(input)) {
    const b = map.get(ev.houseId);
    if (!b) continue;
    b.availableCents += ev.availableDelta;
    b.reservedCents += ev.reservedDelta;
    b.realizedCents += ev.realizedDelta;
    if (ev.kind === 'deposit') b.depositsCents += ev.contributedDelta;
    if (ev.kind === 'withdrawal') b.withdrawalsCents -= ev.contributedDelta;
  }
  for (const bet of input.bets) {
    const b = map.get(bet.houseId);
    if (!b) continue;
    b.betCount += 1;
    if (bet.status === 'pending') b.pendingCount += 1;
  }
  for (const b of map.values()) b.equityCents = b.availableCents + b.reservedCents;
  return map;
}

/**
 * Efeito (no saldo disponível ATUAL) que uma aposta provoca no estado em que está. Usado para saber
 * "quanto a casa teria sem esta aposta" ao editar/excluir.
 */
export function betAvailableEffect(bet: Pick<Bet, 'status' | 'stakeCents' | 'oddsMilli'>): number {
  const ret = betReturnCents(bet);
  return -bet.stakeCents + (ret ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Saldo negativo (atual ou histórico)
// ---------------------------------------------------------------------------------------------

export function computeAlerts(input: LedgerInput): BalanceAlert[] {
  const names = new Map(input.houses.map((h) => [h.id, h.name]));
  const running = new Map<number, { cur: number; min: number; minAt: number; firstNeg: number | null }>();
  for (const h of input.houses) running.set(h.id, { cur: 0, min: 0, minAt: 0, firstNeg: null });
  for (const ev of buildEvents(input)) {
    const r = running.get(ev.houseId);
    if (!r) continue;
    r.cur += ev.availableDelta;
    if (r.cur < 0) {
      if (r.firstNeg === null) r.firstNeg = ev.t;
      if (r.cur < r.min) {
        r.min = r.cur;
        r.minAt = ev.t;
      }
    }
  }
  const alerts: BalanceAlert[] = [];
  for (const [houseId, r] of running) {
    if (r.firstNeg === null) continue;
    alerts.push({
      houseId,
      houseName: names.get(houseId) ?? `Casa ${houseId}`,
      kind: r.cur < 0 ? 'current' : 'historical',
      firstAt: new Date(r.firstNeg).toISOString(),
      minCents: r.min,
      minAt: new Date(r.minAt).toISOString(),
      currentCents: r.cur,
    });
  }
  return alerts.sort((a, b) => (a.kind === b.kind ? a.houseName.localeCompare(b.houseName) : a.kind === 'current' ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------------------------

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function buildSeries(
  events: LedgerEvent[],
  opts: { fromT?: number; toT?: number; nowT: number },
): SeriesPoint[] {
  const { fromT, toT, nowT } = opts;
  let equity = 0;
  let contributed = 0;
  let cum = 0;
  let available = 0;
  const snapshot = (t: number, cumBase: number): SeriesPoint => ({
    t,
    equityCents: equity,
    contributedCents: contributed,
    cumulativeProfitCents: cum - cumBase,
    availableCents: available,
  });

  // Estado antes do período (baseline).
  let i = 0;
  const sorted = events;
  if (fromT !== undefined) {
    for (; i < sorted.length && sorted[i]!.t < fromT; i++) {
      const e = sorted[i]!;
      equity += e.contributedDelta + e.realizedDelta;
      contributed += e.contributedDelta;
      cum += e.realizedDelta;
      available += e.availableDelta;
    }
  }
  const cumBase = fromT !== undefined ? cum : 0;
  const points: SeriesPoint[] = [];
  if (fromT !== undefined) points.push(snapshot(startOfLocalDay(fromT), cumBase));

  while (i < sorted.length) {
    const e = sorted[i]!;
    if (toT !== undefined && e.t > toT) break;
    const day = startOfLocalDay(e.t);
    while (i < sorted.length) {
      const ev = sorted[i]!;
      if (startOfLocalDay(ev.t) !== day || (toT !== undefined && ev.t > toT)) break;
      equity += ev.contributedDelta + ev.realizedDelta;
      contributed += ev.contributedDelta;
      cum += ev.realizedDelta;
      available += ev.availableDelta;
      i++;
    }
    const pt = snapshot(day, cumBase);
    const last = points[points.length - 1];
    if (last && last.t === day) points[points.length - 1] = pt;
    else points.push(pt);
  }
  // Ponto final para a linha chegar até o fim do período (ou hoje).
  const endT = startOfLocalDay(toT !== undefined ? Math.min(toT, nowT) : nowT);
  const last = points[points.length - 1];
  if (last && last.t < endT) points.push({ ...last, t: endT });
  return points;
}

export interface BetStats {
  count: number;
  pending: number;
  green: number;
  red: number;
  void: number;
  realizedCents: number;
  settledStakeCents: number; // Green + Red
  hitRate: number | null;
  roi: number | null;
}

export function statsFor(placedInPeriod: Bet[], settledInPeriod: Bet[]): BetStats {
  let pending = 0;
  for (const b of placedInPeriod) if (b.status === 'pending') pending++;
  let green = 0;
  let red = 0;
  let voided = 0;
  let realized = 0;
  let staked = 0;
  let netGR = 0;
  for (const b of settledInPeriod) {
    const p = betProfitCents(b) ?? 0;
    realized += p;
    if (b.status === 'green') {
      green++;
      staked += b.stakeCents;
      netGR += p;
    } else if (b.status === 'red') {
      red++;
      staked += b.stakeCents;
      netGR += p;
    } else if (b.status === 'void') voided++;
  }
  return {
    count: placedInPeriod.length,
    pending,
    green,
    red,
    void: voided,
    realizedCents: realized,
    settledStakeCents: staked,
    hitRate: green + red > 0 ? (green / (green + red)) * 100 : null,
    roi: staked > 0 ? (netGR / staked) * 100 : null,
  };
}

export function buildDashboard(input: LedgerInput, filter: DashboardFilter, nowT = Date.now()): DashboardData {
  const houseId = filter.houseId ?? null;
  const fromT = filter.from ? Date.parse(filter.from) : undefined;
  const toT = filter.to ? Date.parse(filter.to) : undefined;
  const houses = houseId === null ? input.houses : input.houses.filter((h) => h.id === houseId);
  const houseIds = new Set(houses.map((h) => h.id));
  const scoped: LedgerInput = {
    houses,
    transactions: input.transactions.filter((t) => houseIds.has(t.houseId)),
    bets: input.bets.filter((b) => houseIds.has(b.houseId)),
  };

  const balances = computeBalances(scoped);
  let available = 0;
  let reserved = 0;
  for (const b of balances.values()) {
    available += b.availableCents;
    reserved += b.reservedCents;
  }

  const inRange = (t: number) => (fromT === undefined || t >= fromT) && (toT === undefined || t <= toT);
  const placed = scoped.bets.filter((b) => inRange(Date.parse(b.placedAt)));
  const settled = scoped.bets.filter((b) => b.status !== 'pending' && inRange(effectiveSettledAt(b)));
  const stats = statsFor(placed, settled);

  const series = buildSeries(buildEvents(scoped), { fromT, toT, nowT });

  const byHouse: HouseComparison[] = [];
  for (const h of houses) {
    const hp = placed.filter((b) => b.houseId === h.id);
    const hs = settled.filter((b) => b.houseId === h.id);
    if (hp.length === 0 && hs.length === 0) continue;
    const s = statsFor(hp, hs);
    byHouse.push({
      houseId: h.id,
      houseName: h.name,
      betCount: s.count,
      stakedCents: s.settledStakeCents,
      profitCents: s.realizedCents,
      roi: s.roi,
      hitRate: s.hitRate,
    });
  }
  byHouse.sort((a, b) => b.profitCents - a.profitCents);

  const distribution: StatusDistribution[] = (['green', 'red', 'void', 'pending'] as BetStatus[]).map((status) => {
    const list = placed.filter((b) => b.status === status);
    return { status, count: list.length, stakeCents: list.reduce((s, b) => s + b.stakeCents, 0) };
  });

  return {
    availableCents: available,
    reservedCents: reserved,
    equityCents: available + reserved,
    realizedCents: stats.realizedCents,
    betCount: stats.count,
    pendingCount: stats.pending,
    greenCount: stats.green,
    redCount: stats.red,
    voidCount: stats.void,
    hitRate: stats.hitRate,
    roi: stats.roi,
    settledStakeCents: stats.settledStakeCents,
    series,
    byHouse,
    distribution,
    alerts: computeAlerts(scoped),
    hasData: houses.length > 0,
  };
}
