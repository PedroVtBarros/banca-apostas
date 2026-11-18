import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/core/validation';
import { DbManager } from '../src/main/dbManager';
import { getSchemaVersion, openDatabase } from '../src/main/db/database';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from '../src/main/db/migrations';
import type { BancaService } from '../src/main/service';
import type { BetStatus } from '../src/shared/types';
import { iso, makeClock, memService, tmpDir } from './helpers';

const D = (day: string, time = '12:00') => iso(`2026-03-${day}T${time}:00`);

function setup(initial = 100000) {
  const ctx = memService();
  const house = ctx.svc.createHouse({
    name: 'Casa A',
    initialBalanceCents: initial,
    initialBalanceAt: D('01', '00:00'),
  });
  return { ...ctx, house };
}

function bal(svc: BancaService, houseId: number) {
  return svc.listHouses().find((h) => h.id === houseId)!;
}

function newBet(svc: BancaService, houseId: number, over: Record<string, unknown> = {}) {
  return svc.createBet({
    houseId,
    stakeCents: 10000,
    oddsMilli: 2500,
    placedAt: D('05'),
    description: 'Jogo X',
    notes: '',
    ...over,
  });
}

describe('exemplo do enunciado: saldo R$ 1.000, aposta R$ 100 @ 2,50', () => {
  it('Pendente → Green → Red → Anulada → Pendente, sempre com valores corretos', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id);
    expect(bet.status).toBe('pending');

    const expectState = (disp: number, res: number, pat: number, lucro: number) => {
      const b = bal(svc, house.id);
      expect([b.availableCents, b.reservedCents, b.equityCents, b.realizedCents]).toEqual([disp, res, pat, lucro]);
      const d = svc.getDashboard({});
      expect([d.availableCents, d.reservedCents, d.equityCents, d.realizedCents]).toEqual([disp, res, pat, lucro]);
      // o último ponto do gráfico precisa bater com o saldo
      const last = d.series[d.series.length - 1]!;
      expect(last.equityCents).toBe(pat);
      expect(last.cumulativeProfitCents).toBe(lucro);
      expect(last.availableCents).toBe(disp);
    };

    expectState(90000, 10000, 100000, 0); // Pendente
    svc.setBetStatus(bet.id, 'green');
    expectState(115000, 0, 115000, 15000);
    svc.setBetStatus(bet.id, 'red');
    expectState(90000, 0, 90000, -10000);
    svc.setBetStatus(bet.id, 'void');
    expectState(100000, 0, 100000, 0);
    svc.setBetStatus(bet.id, 'pending');
    expectState(90000, 10000, 100000, 0);
    svc.setBetStatus(bet.id, 'green');
    expectState(115000, 0, 115000, 15000);
    svc.setBetStatus(bet.id, 'pending');
    expectState(90000, 10000, 100000, 0);
  });

  it('todas as 16 transições possíveis de status terminam no estado correto', () => {
    const all: BetStatus[] = ['pending', 'green', 'red', 'void'];
    const expected: Record<BetStatus, [number, number, number]> = {
      pending: [90000, 10000, 0],
      green: [115000, 0, 15000],
      red: [90000, 0, -10000],
      void: [100000, 0, 0],
    };
    for (const from of all) {
      for (const to of all) {
        const { svc, house } = setup();
        const bet = newBet(svc, house.id);
        svc.setBetStatus(bet.id, from);
        svc.setBetStatus(bet.id, to);
        const b = bal(svc, house.id);
        expect([b.availableCents, b.reservedCents, b.realizedCents], `${from} -> ${to}`).toEqual(expected[to]);
      }
    }
  });

  it('repetir o mesmo status N vezes não duplica nada nem gera histórico extra', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id);
    svc.setBetStatus(bet.id, 'green');
    const historyBefore = svc.betHistory(bet.id).length;
    for (let i = 0; i < 5; i++) svc.setBetStatus(bet.id, 'green');
    expect(bal(svc, house.id).availableCents).toBe(115000);
    expect(svc.betHistory(bet.id).length).toBe(historyBefore);
    // alternar muitas vezes e voltar
    for (let i = 0; i < 10; i++) {
      svc.setBetStatus(bet.id, 'red');
      svc.setBetStatus(bet.id, 'green');
    }
    expect(bal(svc, house.id).availableCents).toBe(115000);
    expect(bal(svc, house.id).realizedCents).toBe(15000);
  });
});

describe('validações de aposta', () => {
  it('rejeita valor zero/negativo, odd <= 1 e valor acima do saldo', () => {
    const { svc, house } = setup(50000);
    const fieldOf = (over: Record<string, unknown>) => {
      try {
        newBet(svc, house.id, over);
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        return Object.keys((e as ValidationError).fields)[0];
      }
      return null;
    };
    expect(fieldOf({ stakeCents: 0 })).toBe('stakeCents');
    expect(fieldOf({ stakeCents: -100 })).toBe('stakeCents');
    expect(fieldOf({ stakeCents: 10.5 })).toBe('stakeCents');
    expect(fieldOf({ oddsMilli: 1000 })).toBe('oddsMilli');
    expect(fieldOf({ oddsMilli: 900 })).toBe('oddsMilli');
    expect(fieldOf({ oddsMilli: 1001 })).toBeNull(); // 1,001 é válida
    expect(fieldOf({ stakeCents: 50000 })).toBe('stakeCents'); // 1 aposta já em aberto (10000) + 50000 > saldo
    expect(fieldOf({ stakeCents: 40000 })).toBeNull(); // exatamente o saldo restante
    expect(fieldOf({ stakeCents: 1 })).toBe('stakeCents'); // saldo zerado
    expect(fieldOf({ houseId: 999 })).toBe('houseId');
    expect(fieldOf({ placedAt: 'ontem' })).toBe('placedAt');
  });

  it('nenhuma aposta inválida é gravada', () => {
    const { svc, house } = setup();
    expect(() => newBet(svc, house.id, { stakeCents: 0 })).toThrow();
    expect(svc.listBets({})).toHaveLength(0);
  });

  it('não permite apostar em casa arquivada', () => {
    const { svc, house } = setup();
    svc.setHouseArchived(house.id, true);
    expect(() => newBet(svc, house.id)).toThrow(/arquivada/);
  });
});

describe('edição, exclusão e histórico', () => {
  it('editar valor/odd de uma aposta Green recalcula o saldo sem duplicar', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id);
    svc.setBetStatus(bet.id, 'green');
    expect(bal(svc, house.id).availableCents).toBe(115000);
    svc.updateBet(bet.id, {
      houseId: house.id,
      stakeCents: 20000,
      oddsMilli: 1500,
      placedAt: D('05'),
      description: 'Jogo X',
      notes: '',
      status: 'green',
      settledAt: null,
    });
    // 1000 − 200 + 300 = 1100
    expect(bal(svc, house.id).availableCents).toBe(110000);
    expect(bal(svc, house.id).realizedCents).toBe(10000);
  });

  it('exclusão devolve o saldo ao estado sem a aposta, em qualquer status', () => {
    for (const status of ['pending', 'green', 'red', 'void'] as BetStatus[]) {
      const { svc, house } = setup();
      const bet = newBet(svc, house.id);
      svc.setBetStatus(bet.id, status);
      svc.deleteBet(bet.id);
      const b = bal(svc, house.id);
      expect([b.availableCents, b.reservedCents, b.realizedCents, b.betCount], status).toEqual([100000, 0, 0, 0]);
    }
  });

  it('registra o histórico de criação, mudança de status, edição e exclusão', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id);
    svc.setBetStatus(bet.id, 'green');
    svc.setBetStatus(bet.id, 'red');
    svc.updateBet(bet.id, {
      houseId: house.id,
      stakeCents: 5000,
      oddsMilli: 2500,
      placedAt: D('05'),
      description: 'Outro',
      notes: 'obs',
      status: 'red',
      settledAt: null,
    });
    const h = svc.betHistory(bet.id);
    expect(h.map((e) => e.action)).toEqual(['update', 'status', 'status', 'create']);
    expect(h[1]!.summary).toContain('Green → Red');
    expect((h[1]!.before as { status: string }).status).toBe('green');
    expect((h[1]!.after as { status: string }).status).toBe('red');
    svc.deleteBet(bet.id);
    const audit = svc.listAudit({ limit: 50, offset: 0, entityType: 'bet' });
    expect(audit.entries[0]!.action).toBe('delete');
    expect((audit.entries[0]!.before as { description: string }).description).toBe('Outro');
  });

  it('editar aposta pendente: o valor novo precisa caber no saldo (sem contar ela mesma)', () => {
    const { svc, house } = setup(50000);
    const bet = newBet(svc, house.id, { stakeCents: 40000 });
    const base = {
      houseId: house.id,
      oddsMilli: 2500,
      placedAt: D('05'),
      description: '',
      notes: '',
      status: 'pending' as const,
      settledAt: null,
    };
    expect(() => svc.updateBet(bet.id, { ...base, stakeCents: 60000 })).toThrow(ValidationError);
    svc.updateBet(bet.id, { ...base, stakeCents: 50000 });
    expect(bal(svc, house.id).availableCents).toBe(0);
  });

  it('data de liquidação: não pode ser anterior à aposta; pendente a limpa; volta ao Green mantendo data anterior', () => {
    const { svc, house, clock } = setup();
    const bet = newBet(svc, house.id, { placedAt: D('05') });
    expect(() => svc.setBetStatus(bet.id, 'green', D('04'))).toThrow(/anterior/);
    clock.set('2026-03-10T15:00:00.000Z');
    const g = svc.setBetStatus(bet.id, 'green');
    expect(g.settledAt).toBe('2026-03-10T15:00:00.000Z');
    clock.set('2026-03-12T15:00:00.000Z');
    const r = svc.setBetStatus(bet.id, 'red'); // mantém a data da liquidação anterior
    expect(r.settledAt).toBe('2026-03-10T15:00:00.000Z');
    expect(svc.setBetStatus(bet.id, 'pending').settledAt).toBeNull();
  });
});

describe('depósitos, saques e separação do lucro', () => {
  it('movimentam o saldo mas nunca viram lucro/prejuízo', () => {
    const { svc, house } = setup();
    svc.createTransaction({ houseId: house.id, kind: 'deposit', amountCents: 50000, occurredAt: D('03'), note: '' });
    svc.createTransaction({ houseId: house.id, kind: 'withdrawal', amountCents: 20000, occurredAt: D('04'), note: '' });
    const bet = newBet(svc, house.id);
    svc.setBetStatus(bet.id, 'green', D('06'));
    const b = bal(svc, house.id);
    expect(b.depositsCents).toBe(50000);
    expect(b.withdrawalsCents).toBe(20000);
    expect(b.availableCents).toBe(100000 + 50000 - 20000 + 15000);
    expect(b.realizedCents).toBe(15000);
    const d = svc.getDashboard({});
    expect(d.realizedCents).toBe(15000);
    expect(d.equityCents).toBe(145000);
    const last = d.series[d.series.length - 1]!;
    expect(last.contributedCents).toBe(130000);
    expect(last.cumulativeProfitCents).toBe(15000);
    expect(last.equityCents).toBe(last.contributedCents + last.cumulativeProfitCents);
  });

  it('saque acima do saldo disponível é recusado', () => {
    const { svc, house } = setup();
    expect(() =>
      svc.createTransaction({ houseId: house.id, kind: 'withdrawal', amountCents: 100001, occurredAt: D('03'), note: '' }),
    ).toThrow(/saldo disponível/);
    expect(() =>
      svc.createTransaction({ houseId: house.id, kind: 'deposit', amountCents: 0, occurredAt: D('03'), note: '' }),
    ).toThrow(ValidationError);
  });

  it('editar e excluir movimentações atualiza o saldo e o histórico', () => {
    const { svc, house } = setup();
    const tx = svc.createTransaction({ houseId: house.id, kind: 'deposit', amountCents: 50000, occurredAt: D('03'), note: 'a' });
    svc.updateTransaction(tx.id, { houseId: house.id, kind: 'deposit', amountCents: 30000, occurredAt: D('03'), note: 'b' });
    expect(bal(svc, house.id).availableCents).toBe(130000);
    svc.deleteTransaction(tx.id);
    expect(bal(svc, house.id).availableCents).toBe(100000);
    expect(svc.listAudit({ limit: 20, offset: 0, entityType: 'transaction' }).total).toBe(3);
  });
});

describe('casas', () => {
  it('nome único (sem diferenciar maiúsculas), editar e arquivar', () => {
    const { svc, house } = setup();
    expect(() => svc.createHouse({ name: 'casa a', initialBalanceCents: 0, initialBalanceAt: D('01') })).toThrow(/Já existe/);
    const upd = svc.updateHouse(house.id, { name: 'Casa A2', initialBalanceCents: 200000, initialBalanceAt: D('01', '00:00') });
    expect(upd.availableCents).toBe(200000);
    const arch = svc.setHouseArchived(house.id, true);
    expect(arch.archived).toBe(true);
  });

  it('impede excluir casa com movimentações; exclui casa sem movimentações; não arquiva com pendentes', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id);
    expect(() => svc.deleteHouse(house.id)).toThrow(/movimentações/);
    expect(() => svc.setHouseArchived(house.id, true)).toThrow(/pendente/);
    svc.setBetStatus(bet.id, 'red');
    svc.deleteBet(bet.id);
    expect(() => svc.deleteHouse(house.id)).not.toThrow(); // sem apostas/transações: pode excluir
    expect(svc.listHouses()).toHaveLength(0);

    const h2 = svc.createHouse({ name: 'B', initialBalanceCents: 1000, initialBalanceAt: D('01') });
    svc.createTransaction({ houseId: h2.id, kind: 'deposit', amountCents: 100, occurredAt: D('02'), note: '' });
    expect(() => svc.deleteHouse(h2.id)).toThrow(ValidationError);
    expect(svc.listHouses()).toHaveLength(1);
  });
});

describe('correções retroativas e saldo negativo', () => {
  it('Green→Red de aposta antiga, após saque posterior, deixa o saldo negativo, avisa e preserva os dados', () => {
    const { svc, house } = setup(100000);
    const bet = newBet(svc, house.id, { placedAt: D('02') });
    svc.setBetStatus(bet.id, 'green', D('03')); // disponível 1150
    svc.createTransaction({ houseId: house.id, kind: 'withdrawal', amountCents: 115000, occurredAt: D('04'), note: '' }); // zera
    expect(svc.listAlerts()).toHaveLength(0);

    svc.setBetStatus(bet.id, 'red'); // retroativo: o dinheiro do saque deixou de existir
    const alerts = svc.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('current');
    expect(alerts[0]!.currentCents).toBe(-25000);
    // nada foi apagado nem distorcido
    expect(svc.listTransactions()).toHaveLength(1);
    expect(bal(svc, house.id).availableCents).toBe(-25000);
    expect(svc.getDashboard({}).alerts).toHaveLength(1);
  });

  it('negativo apenas no passado (histórico) é sinalizado como "historical"', () => {
    const { svc, house } = setup(10000);
    svc.createTransaction({ houseId: house.id, kind: 'deposit', amountCents: 50000, occurredAt: D('10'), note: '' });
    const bet = newBet(svc, house.id, { stakeCents: 10000, placedAt: D('05') });
    svc.setBetStatus(bet.id, 'red', D('06'));
    // Retroagir a data da aposta para antes do saldo inicial deixa o passado negativo, mas o saldo atual positivo.
    svc.updateBet(bet.id, {
      houseId: house.id,
      stakeCents: 10000,
      oddsMilli: 2500,
      placedAt: iso('2026-02-20T10:00:00'),
      description: '',
      notes: '',
      status: 'red',
      settledAt: iso('2026-02-21T10:00:00'),
    });
    // aposta datada ANTES do saldo inicial (01/03): no passado o saldo ficou negativo; hoje está positivo
    const a1 = svc.listAlerts();
    expect(a1.map((a) => [a.houseName, a.kind, a.minCents])).toEqual([['Casa A', 'historical', -10000]]);
    expect(bal(svc, house.id).availableCents).toBeGreaterThan(0);
    const house2 = svc.createHouse({ name: 'B', initialBalanceCents: 20000, initialBalanceAt: D('08', '00:00') });
    const b2 = newBet(svc, house2.id, { stakeCents: 5000, placedAt: D('09') });
    svc.updateBet(b2.id, {
      houseId: house2.id,
      stakeCents: 5000,
      oddsMilli: 2000,
      placedAt: D('07'),
      description: '',
      notes: '',
      status: 'pending',
      settledAt: null,
    });
    const a2 = svc.listAlerts().filter((a) => a.houseName === 'B');
    expect(a2).toHaveLength(1);
    expect(a2[0]!.kind).toBe('historical');
    expect(a2[0]!.minCents).toBe(-5000);
    expect(bal(svc, house2.id).availableCents).toBe(15000);
  });

  it('o gráfico usa a data do evento financeiro: liquidar com data retroativa move o lucro no tempo', () => {
    const { svc, house } = setup();
    const bet = newBet(svc, house.id, { placedAt: D('02') });
    svc.setBetStatus(bet.id, 'green', D('09'));
    let d = svc.getDashboard({});
    const dayStart = (s: string) => new Date(iso(s)).setHours(0, 0, 0, 0);
    expect(d.series.find((p) => p.t === dayStart('2026-03-09T12:00:00'))!.cumulativeProfitCents).toBe(15000);
    expect(d.series.find((p) => p.t === dayStart('2026-03-08T12:00:00'))).toBeUndefined();
    // correção retroativa da data de liquidação
    svc.updateBet(bet.id, {
      houseId: house.id,
      stakeCents: 10000,
      oddsMilli: 2500,
      placedAt: D('02'),
      description: 'Jogo X',
      notes: '',
      status: 'green',
      settledAt: D('03'),
    });
    d = svc.getDashboard({});
    expect(d.series.find((p) => p.t === dayStart('2026-03-03T12:00:00'))!.cumulativeProfitCents).toBe(15000);
    expect(d.series.find((p) => p.t === dayStart('2026-03-09T12:00:00'))).toBeUndefined();
    // a aposta aparece como pendente (reservado) entre 02/03 e 03/03 no disponível
    expect(d.series.find((p) => p.t === dayStart('2026-03-02T12:00:00'))!.availableCents).toBe(90000);
  });
});

describe('painel: indicadores', () => {
  it('mostra "—" (null) quando não há base de cálculo, sem dividir por zero', () => {
    const { svc, house } = setup();
    let d = svc.getDashboard({});
    expect([d.hitRate, d.roi]).toEqual([null, null]);
    const bet = newBet(svc, house.id);
    svc.setBetStatus(bet.id, 'void');
    d = svc.getDashboard({});
    expect([d.hitRate, d.roi, d.realizedCents]).toEqual([null, null, 0]);
    expect(d.voidCount).toBe(1);
  });

  it('taxa de acerto e ROI usam apenas Green e Red', () => {
    const { svc, house } = setup(1000000);
    const mk = (stake: number, odds: number, st: BetStatus) => {
      const b = newBet(svc, house.id, { stakeCents: stake, oddsMilli: odds });
      svc.setBetStatus(b.id, st);
    };
    mk(10000, 2000, 'green'); // +100
    mk(10000, 2000, 'green'); // +100
    mk(10000, 2000, 'red'); // −100
    mk(5000, 3000, 'void'); // fora
    mk(7000, 2000, 'pending'); // fora
    const d = svc.getDashboard({});
    expect(d.greenCount).toBe(2);
    expect(d.redCount).toBe(1);
    expect(d.voidCount).toBe(1);
    expect(d.pendingCount).toBe(1);
    expect(d.betCount).toBe(5);
    expect(d.hitRate).toBeCloseTo(66.6667, 3);
    expect(d.settledStakeCents).toBe(30000);
    expect(d.roi).toBeCloseTo((10000 / 30000) * 100, 6);
    expect(d.realizedCents).toBe(10000);
    expect(d.equityCents).toBe(1000000 + 10000);
  });

  it('filtros por casa e por período', () => {
    const { svc, house } = setup();
    const h2 = svc.createHouse({ name: 'Casa B', initialBalanceCents: 100000, initialBalanceAt: D('01', '00:00') });
    const a = newBet(svc, house.id, { placedAt: D('05') });
    const b = newBet(svc, h2.id, { placedAt: D('15') });
    svc.setBetStatus(a.id, 'green', D('06'));
    svc.setBetStatus(b.id, 'red', D('16'));
    expect(svc.getDashboard({ houseId: house.id }).realizedCents).toBe(15000);
    expect(svc.getDashboard({ houseId: h2.id }).realizedCents).toBe(-10000);
    const period = svc.getDashboard({ from: D('10', '00:00'), to: D('20', '23:59') });
    expect(period.realizedCents).toBe(-10000);
    expect(period.betCount).toBe(1);
    // série do período começa do zero para o lucro, mas mantém o patrimônio acumulado
    expect(period.series[0]!.cumulativeProfitCents).toBe(0);
    expect(period.series[0]!.equityCents).toBe(215000);
    expect(period.series[period.series.length - 1]!.cumulativeProfitCents).toBe(-10000);
    expect(period.byHouse.map((h) => h.houseName)).toEqual(['Casa B']);
  });

  it('listBets filtra por período, casa, status e busca sem acento/caixa', () => {
    const { svc, house } = setup();
    const h2 = svc.createHouse({ name: 'Casa B', initialBalanceCents: 100000, initialBalanceAt: D('01', '00:00') });
    newBet(svc, house.id, { description: 'Flamengo x São Paulo', placedAt: D('05') });
    const b = newBet(svc, h2.id, { description: 'Over 2,5 gols', placedAt: D('15') });
    svc.setBetStatus(b.id, 'green');
    expect(svc.listBets({})).toHaveLength(2);
    expect(svc.listBets({ search: 'sao paulo' })).toHaveLength(1);
    expect(svc.listBets({ search: 'OVER' })).toHaveLength(1);
    expect(svc.listBets({ houseId: h2.id })).toHaveLength(1);
    expect(svc.listBets({ statuses: ['green'] })).toHaveLength(1);
    expect(svc.listBets({ from: D('10', '00:00'), to: D('20', '00:00') })).toHaveLength(1);
    expect(svc.listBets({ search: "%' OR 1=1 --" })).toHaveLength(0);
  });
});

describe('transações e atomicidade', () => {
  it('falha no meio da operação não deixa nada gravado (rollback, inclusive histórico)', () => {
    const { svc, db, house } = setup();
    // força falha ao gravar o histórico
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'bet' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`);
    expect(() => newBet(svc, house.id)).toThrow(/falha simulada/);
    expect(svc.listBets({})).toHaveLength(0);
    expect(bal(svc, house.id).availableCents).toBe(100000);
  });
});

describe('persistência em arquivo, migrations e backup', () => {
  it('os dados continuam disponíveis após fechar e reabrir o banco', () => {
    const dir = tmpDir();
    const m1 = new DbManager(dir, makeClock().now);
    m1.open();
    const house = m1.service.createHouse({ name: 'Persistente', initialBalanceCents: 100000, initialBalanceAt: D('01', '00:00') });
    const bet = m1.service.createBet({
      houseId: house.id, stakeCents: 10000, oddsMilli: 2500, placedAt: D('05'), description: 'x', notes: '',
    });
    m1.service.setBetStatus(bet.id, 'green', D('06'));
    m1.close();

    const m2 = new DbManager(dir, makeClock().now);
    m2.open();
    const h = m2.service.listHouses()[0]!;
    expect(h.name).toBe('Persistente');
    expect(h.availableCents).toBe(115000);
    expect(m2.service.listBets({})[0]!.status).toBe('green');
    expect(m2.service.betHistory(bet.id).length).toBeGreaterThanOrEqual(2);
    m2.close();
    expect(fs.existsSync(path.join(dir, 'banca.db'))).toBe(true);
  });

  it('migrations: banco novo vai para a versão mais recente; reaplicar é no-op; versão futura é preservada', () => {
    const db = openDatabase(':memory:');
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(db)).toEqual([]);
    // migration nova e válida: aplica sem perder dados
    db.exec("INSERT INTO houses (name, initial_balance_cents, initial_balance_at, created_at, updated_at) VALUES ('X',5,'2026-01-01T00:00:00.000Z','a','a')");
    const extra = [...MIGRATIONS, { version: LATEST_SCHEMA_VERSION + 1, description: 't', up: 'ALTER TABLE houses ADD COLUMN extra TEXT' }];
    expect(migrate(db, extra)).toEqual([LATEST_SCHEMA_VERSION + 1]);
    expect((db.prepare('SELECT COUNT(*) n FROM houses').get() as { n: number }).n).toBe(1);
    // migration quebrada faz rollback e preserva a versão anterior
    const broken = [...extra, { version: LATEST_SCHEMA_VERSION + 2, description: 'quebrada', up: 'CREATE TABLE ok(a); CREATE TABLE ok(a);' }];
    expect(() => migrate(db, broken)).toThrow(/quebrada/);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION + 1);
    expect(() => db.prepare('SELECT * FROM ok').get()).toThrow();
  });

  it('exporta e restaura backup, com validação e reversão segura', () => {
    const dir = tmpDir();
    const m = new DbManager(dir, makeClock().now);
    m.open();
    const house = m.service.createHouse({ name: 'Original', initialBalanceCents: 100000, initialBalanceAt: D('01', '00:00') });
    const file = path.join(tmpDir(), 'backup.db');
    m.exportTo(file);
    // muda os dados depois do backup
    m.service.createTransaction({ houseId: house.id, kind: 'deposit', amountCents: 50000, occurredAt: D('03'), note: '' });
    m.service.createHouse({ name: 'Nova', initialBalanceCents: 1, initialBalanceAt: D('01') });
    expect(m.service.listHouses()).toHaveLength(2);

    // arquivo inválido: recusado e nada muda
    const junk = path.join(tmpDir(), 'lixo.db');
    fs.writeFileSync(junk, 'isto não é um banco');
    expect(() => m.restoreFrom(junk)).toThrow(/backup válido/);
    expect(m.service.listHouses()).toHaveLength(2);

    m.restoreFrom(file);
    const houses = m.service.listHouses();
    expect(houses).toHaveLength(1);
    expect(houses[0]!.name).toBe('Original');
    expect(houses[0]!.availableCents).toBe(100000);
    // cópia de segurança dos dados anteriores foi guardada
    const safety = fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('antes-da-restauracao'));
    expect(safety).toHaveLength(1);
    expect(m.service.listAudit({ limit: 10, offset: 0, entityType: 'system' }).total).toBe(1);
    // continua funcionando após restaurar
    m.service.createTransaction({ houseId: houses[0]!.id, kind: 'deposit', amountCents: 100, occurredAt: D('04'), note: '' });
    m.close();
  });

  it('cria backup automático diário e mantém no máximo 10', () => {
    const dir = tmpDir();
    for (let day = 1; day <= 12; day++) {
      const clock = makeClock(`2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`);
      const m = new DbManager(dir, clock.now);
      m.open();
      if (day === 1) m.service.createHouse({ name: 'A', initialBalanceCents: 1, initialBalanceAt: D('01') });
      m.close();
    }
    const autos = fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('automatico-'));
    expect(autos).toHaveLength(10);
  });
});
