const p2 = (n: number) => String(n).padStart(2, '0');

/** Date -> valor para <input type="datetime-local"> (hora local). */
export function toLocalInput(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}T${p2(x.getHours())}:${p2(x.getMinutes())}`;
}

export function nowLocalInput(): string {
  return toLocalInput(new Date());
}

/** Valor do datetime-local -> ISO UTC, ou null se vazio/inválido. */
export function fromLocalInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const dtf = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtDateTime = (iso: string) => dtf.format(new Date(iso)).replace(',', '');
export const fmtDate = (iso: string | number) => df.format(new Date(iso));

// ---- Períodos (filtros) ----
export type PeriodPreset = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom';

export interface Period {
  preset: PeriodPreset;
  /** YYYY-MM-DD (somente em "custom") */
  from: string;
  to: string;
}

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  all: 'Tudo',
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  month: 'Este mês',
  custom: 'Personalizado',
};

const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const startIso = (s: string) => new Date(`${s}T00:00:00`).toISOString();
const endIso = (s: string) => new Date(`${s}T23:59:59.999`).toISOString();

export function periodRange(p: Period, now = new Date()): { from?: string; to?: string } {
  const today = ymd(now);
  switch (p.preset) {
    case 'all':
      return {};
    case 'today':
      return { from: startIso(today), to: endIso(today) };
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: startIso(ymd(d)), to: endIso(today) };
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: startIso(ymd(d)), to: endIso(today) };
    }
    case 'month':
      return { from: startIso(`${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`), to: endIso(today) };
    case 'custom':
      return {
        from: p.from ? startIso(p.from) : undefined,
        to: p.to ? endIso(p.to) : undefined,
      };
  }
}
