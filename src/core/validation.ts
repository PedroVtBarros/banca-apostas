/**
 * Validação de entradas vindas do renderer. O main NUNCA confia em dados do renderer:
 * tudo é revalidado aqui (tipos, faixas e formatos), independentemente da validação da interface.
 */
import {
  MAX_AMOUNT_CENTS,
  MAX_ODDS_MILLI,
  MAX_STAKE_CENTS,
  MIN_ODDS_MILLI,
  formatBRL,
} from '../shared/money';
import {
  BET_STATUSES,
  type BetInput,
  type BetStatus,
  type BetUpdateInput,
  type HouseInput,
  type TransactionInput,
  type TransactionKind,
} from '../shared/types';

export class ValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string> | string, message?: string) {
    const f = typeof fields === 'string' ? { _: fields } : fields;
    super(message ?? Object.values(f)[0] ?? 'Dados inválidos.');
    this.name = 'ValidationError';
    this.fields = f;
  }
}

type Fields = Record<string, string>;

const MIN_DATE = Date.parse('2000-01-01T00:00:00Z');
const MAX_DATE = Date.parse('2100-01-01T00:00:00Z');

function obj(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ValidationError('Dados inválidos.');
  return raw as Record<string, unknown>;
}

function isoDate(v: unknown, field: string, label: string, errors: Fields): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) {
    errors[field] = `${label} inválida.`;
    return '';
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < MIN_DATE || t > MAX_DATE) {
    errors[field] = `${label} fora do intervalo permitido.`;
    return '';
  }
  return new Date(t).toISOString();
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}

function text(v: unknown, field: string, label: string, max: number, errors: Fields, required = false): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') {
    errors[field] = `${label} inválido.`;
    return '';
  }
  const s = v.trim().replace(/\s+/g, ' ');
  if (required && s === '') errors[field] = `${label} é obrigatório.`;
  if (s.length > max) errors[field] = `${label} deve ter no máximo ${max} caracteres.`;
  return s;
}

/** Observações podem ter quebras de linha. */
function multiline(v: unknown, field: string, label: string, max: number, errors: Fields): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') {
    errors[field] = `${label} inválidas.`;
    return '';
  }
  const s = v.trim();
  if (s.length > max) errors[field] = `${label} devem ter no máximo ${max} caracteres.`;
  return s;
}

function done<T>(errors: Fields, value: T): T {
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return value;
}

export function validateId(v: unknown, label = 'Identificador'): number {
  const n = int(v);
  if (n === null || n <= 0) throw new ValidationError(`${label} inválido.`);
  return n;
}

export function validateHouseInput(raw: unknown): HouseInput {
  const o = obj(raw);
  const errors: Fields = {};
  const name = text(o.name, 'name', 'O nome', 60, errors, true);
  const initial = int(o.initialBalanceCents);
  if (initial === null || initial < 0) errors.initialBalanceCents = 'Informe um saldo inicial válido (zero ou mais).';
  else if (initial > MAX_AMOUNT_CENTS) errors.initialBalanceCents = 'Saldo inicial acima do limite permitido.';
  const initialBalanceAt = isoDate(o.initialBalanceAt, 'initialBalanceAt', 'A data do saldo inicial', errors);
  return done(errors, { name, initialBalanceCents: initial ?? 0, initialBalanceAt });
}

export function validateTransactionInput(raw: unknown): TransactionInput {
  const o = obj(raw);
  const errors: Fields = {};
  const houseId = int(o.houseId);
  if (houseId === null || houseId <= 0) errors.houseId = 'Selecione a casa de apostas.';
  const kind = o.kind;
  if (kind !== 'deposit' && kind !== 'withdrawal') errors.kind = 'Tipo de movimentação inválido.';
  const amount = int(o.amountCents);
  if (amount === null || amount <= 0) errors.amountCents = 'O valor deve ser maior que zero.';
  else if (amount > MAX_AMOUNT_CENTS) errors.amountCents = 'Valor acima do limite permitido.';
  const occurredAt = isoDate(o.occurredAt, 'occurredAt', 'A data', errors);
  const note = text(o.note, 'note', 'A observação', 200, errors);
  return done(errors, {
    houseId: houseId ?? 0,
    kind: kind as TransactionKind,
    amountCents: amount ?? 0,
    occurredAt,
    note,
  });
}

export function validateBetInput(raw: unknown): BetInput {
  const o = obj(raw);
  const errors: Fields = {};
  const houseId = int(o.houseId);
  if (houseId === null || houseId <= 0) errors.houseId = 'Selecione a casa de apostas.';
  const stake = int(o.stakeCents);
  if (stake === null) errors.stakeCents = 'Informe o valor da aposta.';
  else if (stake <= 0) errors.stakeCents = 'O valor da aposta deve ser maior que zero.';
  else if (stake > MAX_STAKE_CENTS) errors.stakeCents = `O valor máximo por aposta é ${formatBRL(MAX_STAKE_CENTS)}.`;
  const odds = int(o.oddsMilli);
  if (odds === null) errors.oddsMilli = 'Informe a odd.';
  else if (odds < MIN_ODDS_MILLI) errors.oddsMilli = 'A odd deve ser maior que 1,00.';
  else if (odds > MAX_ODDS_MILLI) errors.oddsMilli = 'Odd acima do limite permitido (1000).';
  const placedAt = isoDate(o.placedAt, 'placedAt', 'A data da aposta', errors);
  const description = text(o.description, 'description', 'A descrição', 200, errors);
  const notes = multiline(o.notes, 'notes', 'As observações', 2000, errors);
  return done(errors, {
    houseId: houseId ?? 0,
    stakeCents: stake ?? 0,
    oddsMilli: odds ?? 0,
    placedAt,
    description,
    notes,
  });
}

export function validateStatus(v: unknown): BetStatus {
  if (typeof v !== 'string' || !(BET_STATUSES as readonly string[]).includes(v)) {
    throw new ValidationError('Status inválido.');
  }
  return v as BetStatus;
}

export function validateBetUpdateInput(raw: unknown): BetUpdateInput {
  const base = validateBetInput(raw);
  const o = obj(raw);
  const status = validateStatus(o.status);
  const errors: Fields = {};
  let settledAt: string | null = null;
  if (status !== 'pending' && o.settledAt !== null && o.settledAt !== undefined) {
    settledAt = isoDate(o.settledAt, 'settledAt', 'A data da liquidação', errors);
  }
  done(errors, null);
  return { ...base, status, settledAt };
}

export function validateOptionalIso(v: unknown, label = 'Data'): string | null {
  if (v === null || v === undefined) return null;
  const errors: Fields = {};
  const iso = isoDate(v, 'date', label, errors);
  return done(errors, iso);
}
