import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type Ref,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatBRL, formatBRLSigned } from '../../shared/money';
import { STATUS_LABEL, type BetStatus } from '../../shared/types';
import { PERIOD_LABEL, type Period, type PeriodPreset } from '../dates';

// ---------------------------------------------------------------------------------------------
// Ícones (traço simples, herdam a cor do texto)
// ---------------------------------------------------------------------------------------------
const ICONS: Record<string, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-2" />
      <path d="M16 14h.01" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  check: <path d="m5 12 5 5 9-10" />,
  alert: <path d="M12 4 2.5 20h19L12 4zM12 10v5M12 18h.01" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  archive: <path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4" />,
  restore: <path d="M3 12a9 9 0 1 1 3 6.7L3 16M3 21v-5h5" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
  folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  logo: <path d="M5 20V13M12 20V8M19 20V4" strokeWidth="2.6" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Status (sempre com texto, não só cor)
// ---------------------------------------------------------------------------------------------
const STATUS_MARK: Record<BetStatus, string> = { pending: '◔', green: '●', red: '●', void: '○' };

export function StatusBadge({ status }: { status: BetStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true" className="badge-mark">
        {STATUS_MARK[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Botões e campos
// ---------------------------------------------------------------------------------------------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: string;
};

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={17} />
    </button>
  );
}

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, optional, children, className = '' }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional"> (opcional)</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="error" id={errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement>; label: string; error?: string; hint?: ReactNode; optional?: boolean; prefix?: string };

export function TextField({ label, error, hint, optional, prefix, className = '', ...rest }: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className={`input-wrap ${prefix ? 'with-prefix' : ''}`}>
          {prefix && <span className="input-prefix">{prefix}</span>}
          <input id={id} className="input" aria-invalid={invalid} aria-describedby={describedBy} {...rest} />
        </div>
      )}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="input" aria-invalid={invalid} aria-describedby={describedBy} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: ReactNode; optional?: boolean }) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} className="input" aria-invalid={invalid} aria-describedby={describedBy} {...rest} />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Diálogo (elemento <dialog> nativo: foco preso, Esc fecha)
// ---------------------------------------------------------------------------------------------
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width }}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label="Fechar" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} autoFocus>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Menu de ações (popover acessível)
// ---------------------------------------------------------------------------------------------
export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function ActionMenu({ items, label = 'Mais ações' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrapRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          onKeyDown={(e) => {
            const els = Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
            const i = els.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              els[(i + 1) % els.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              els[(i - 1 + els.length) % els.length]?.focus();
            }
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Estruturas de página
// ---------------------------------------------------------------------------------------------
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Filtro de período
// ---------------------------------------------------------------------------------------------
const PRESETS: PeriodPreset[] = ['all', 'today', '7d', '30d', 'month', 'custom'];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="period">
      <div className="seg" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="seg-btn"
            aria-pressed={value.preset === p}
            onClick={() => onChange({ ...value, preset: p })}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="period-custom">
          <label>
            <span className="sr-only">Data inicial</span>
            <input
              type="date"
              className="input input-sm"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              aria-label="Data inicial"
            />
          </label>
          <span aria-hidden="true">até</span>
          <label>
            <span className="sr-only">Data final</span>
            <input
              type="date"
              className="input input-sm"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              aria-label="Data final"
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function Money({ cents, signed, className = '' }: { cents: number; signed?: boolean; className?: string }) {
  return <span className={`num ${className}`}>{fmt(cents, signed)}</span>;
}

const fmt = (c: number, signed?: boolean) => (signed ? formatBRLSigned(c) : formatBRL(c));

/** Classe de cor pelo sinal do resultado. */
export const toneOf = (cents: number | null) => (cents === null || cents === 0 ? '' : cents > 0 ? 'pos' : 'neg');
