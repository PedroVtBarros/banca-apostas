/**
 * Dinheiro e odds.
 *
 * Regras de precisão (únicas em todo o app):
 *  - Valores monetários são inteiros em CENTAVOS.
 *  - Odds decimais são inteiros em MILÉSIMOS (2,5 -> 2500); até 3 casas decimais.
 *  - Retorno = round_half_up(valor × odd) ao centavo, calculado com inteiros,
 *    uma única vez por aposta. Lucro = retorno − valor.
 */

export const MAX_STAKE_CENTS = 1_000_000_000; // R$ 10.000.000,00
export const MAX_AMOUNT_CENTS = 100_000_000_000; // R$ 1.000.000.000,00 (saldos/movimentações)
export const MIN_ODDS_MILLI = 1_001; // odd precisa ser > 1,000
export const MAX_ODDS_MILLI = 1_000_000; // 1000,000

/** Retorno bruto (o que volta se for Green), arredondado meio-para-cima ao centavo. */
export function calcReturnCents(stakeCents: number, oddsMilli: number): number {
  // stake ≤ 1e9 e odds ≤ 1e6 => produto ≤ 1e15 < 2^53: seguro em inteiros.
  return Math.floor((stakeCents * oddsMilli + 500) / 1000);
}

export function calcProfitCents(stakeCents: number, oddsMilli: number): number {
  return calcReturnCents(stakeCents, oddsMilli) - stakeCents;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number): string {
  // Intl usa U+00A0 entre "R$" e o número; mantemos (não quebra linha).
  return brl.format(cents / 100);
}

/** Formata com sinal explícito: +R$ 10,00 / −R$ 10,00 / R$ 0,00 */
export function formatBRLSigned(cents: number): string {
  if (cents === 0) return formatBRL(0);
  const abs = formatBRL(Math.abs(cents));
  return (cents > 0 ? '+' : '−') + abs;
}

export function formatOdds(oddsMilli: number): string {
  let s = (oddsMilli / 1000).toFixed(3);
  if (s.endsWith('0')) s = s.slice(0, -1); // 2,500 -> 2,50
  return s.replace('.', ',');
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return (
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value).replace('-', '−') + '%'
  );
}

/**
 * Converte texto numérico em número decimal em formato canônico "123.45".
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 10", " 10 ". Retorna null se inválido.
 */
function normalizeDecimal(input: string, maxDecimals: number): { int: string; frac: string } | null {
  let s = input.replace(/R\$/gi, '').replace(/\s| /g, '');
  if (s === '' || /[^0-9.,]/.test(s)) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // O último separador é o decimal; o outro é de milhar.
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const dec = lastComma > lastDot ? ',' : '.';
    const thousands = dec === ',' ? '.' : ',';
    const parts = s.split(dec);
    if (parts.length !== 2) return null;
    const intPart = parts[0]!;
    if (!/^\d{1,3}(\.\d{3})*$|^\d{1,3}(,\d{3})*$/.test(intPart) || intPart.includes(dec)) return null;
    s = intPart.split(thousands).join('') + '.' + parts[1];
  } else if (hasComma) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(',', '.');
  } else if (hasDot) {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      // vários pontos: só é válido como separador de milhar (1.234.567)
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
      s = s.split('.').join('');
    } else if (/^\d{1,3}\.\d{3}$/.test(s) && maxDecimals < 3) {
      // "1.234" em campo monetário é milhar (mil duzentos e trinta e quatro)
      s = s.replace('.', '');
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.') as [string, string | undefined];
  if ((frac ?? '').length > maxDecimals) return null;
  if (int!.length > 12) return null;
  return { int: int!, frac: frac ?? '' };
}

/** "1.234,56" -> 123456. Retorna null se inválido (inclui mais de 2 casas decimais). */
export function parseMoneyToCents(input: string): number | null {
  const n = normalizeDecimal(input, 2);
  if (!n) return null;
  const cents = Number(n.int) * 100 + Number((n.frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "2,50" -> 2500. Aceita até 3 casas decimais. */
export function parseOddsToMilli(input: string): number | null {
  const n = normalizeDecimal(input, 3);
  if (!n) return null;
  const milli = Number(n.int) * 1000 + Number((n.frac + '000').slice(0, 3));
  return Number.isSafeInteger(milli) ? milli : null;
}

/** Valor em centavos -> texto editável "1234,56" (sem símbolo). */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function oddsToInput(oddsMilli: number): string {
  return formatOdds(oddsMilli);
}
