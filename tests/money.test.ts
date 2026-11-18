import { describe, expect, it } from 'vitest';
import {
  calcProfitCents,
  calcReturnCents,
  formatBRL,
  formatOdds,
  formatPercent,
  parseMoneyToCents,
  parseOddsToMilli,
} from '../src/shared/money';

describe('parseMoneyToCents', () => {
  it.each([
    ['100', 10000],
    ['100,5', 10050],
    ['100,50', 10050],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['R$ 1.000', 100000],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['0,01', 1],
    ['0', 0],
  ])('%s -> %i', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234,567', '10,999', '1..2', '-5', '1e5', '12,3,4'])('rejeita "%s"', (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe('parseOddsToMilli', () => {
  it.each([
    ['2,5', 2500],
    ['2.50', 2500],
    ['1,01', 1010],
    ['1,875', 1875],
    ['10', 10000],
  ])('%s -> %i', (input, expected) => {
    expect(parseOddsToMilli(input)).toBe(expected);
  });
  it('rejeita mais de 3 casas e texto', () => {
    expect(parseOddsToMilli('2,5555')).toBeNull();
    expect(parseOddsToMilli('x')).toBeNull();
  });
});

describe('cálculo de retorno (meio para cima, em centavos)', () => {
  it('R$ 100 @ 2,50 = R$ 250 (lucro R$ 150)', () => {
    expect(calcReturnCents(10000, 2500)).toBe(25000);
    expect(calcProfitCents(10000, 2500)).toBe(15000);
  });
  it('arredonda 0,5 centavo para cima', () => {
    // 1 centavo × 1,5 = 1,5 -> 2
    expect(calcReturnCents(1, 1500)).toBe(2);
    // 33,33 × 1,505 = 50,16 (50,16465) -> 50,16
    expect(calcReturnCents(3333, 1505)).toBe(5016);
    // 10,01 × 1,5 = 15,015 -> 15,02
    expect(calcReturnCents(1001, 1500)).toBe(1502);
  });
  it('não perde precisão em valores grandes', () => {
    expect(calcReturnCents(1_000_000_000, 999_999)).toBe(999_999_000_000);
  });
});

describe('formatação', () => {
  it('formata em reais e odds', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatOdds(2500)).toBe('2,50');
    expect(formatOdds(1875)).toBe('1,875');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(66.666)).toBe('66,7%');
  });
});
