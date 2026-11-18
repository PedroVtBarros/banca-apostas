import { useEffect } from 'react';
import { formatBRL } from '../shared/money';
import { fmtDate } from './dates';
import { Button, Icon } from './components/ui';
import { AddBetPage } from './pages/AddBetPage';
import { BankrollPage } from './pages/BankrollPage';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { ResultsPage } from './pages/ResultsPage';
import { useApp, type PageId } from './store';

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'add', label: 'Adicionar apostas', icon: 'add' },
  { id: 'results', label: 'Resultados', icon: 'list' },
  { id: 'dashboard', label: 'Painel e gráficos', icon: 'chart' },
  { id: 'bankroll', label: 'Banca e casas', icon: 'wallet' },
  { id: 'data', label: 'Dados e backup', icon: 'data' },
];

function Sidebar() {
  const { page, setPage, houses } = useApp();
  const active = houses;
  const available = active.reduce((s, h) => s + h.availableCents, 0);
  const reserved = active.reduce((s, h) => s + h.reservedCents, 0);
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="logo" size={18} />
        </span>
        <span className="brand-name">Gestão de Banca</span>
      </div>
      <nav aria-label="Navegação principal">
        <ul>
          {NAV.map((n, i) => (
            <li key={n.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
                title={`${n.label} (Ctrl+${i + 1})`}
              >
                <Icon name={n.icon} />
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="side-balance" aria-label="Resumo da banca">
        <div>
          <span className="side-label">Disponível</span>
          <strong className="num">{formatBRL(available)}</strong>
        </div>
        <div>
          <span className="side-label">Em apostas pendentes</span>
          <span className="num">{formatBRL(reserved)}</span>
        </div>
      </div>
    </aside>
  );
}

function AlertsBanner() {
  const { alerts, setPage, page } = useApp();
  if (alerts.length === 0) return null;
  const current = alerts.filter((a) => a.kind === 'current');
  const historical = alerts.filter((a) => a.kind === 'historical');
  return (
    <div className="banner banner-warn" role="alert">
      <Icon name="alert" />
      <div className="banner-text">
        {current.length > 0 && (
          <p>
            <strong>Saldo negativo:</strong>{' '}
            {current.map((a) => `${a.houseName} (${formatBRL(a.currentCents)})`).join(', ')}. Isso acontece quando uma
            correção retroativa remove dinheiro que já foi sacado ou apostado depois. Nenhuma movimentação foi apagada.
          </p>
        )}
        {historical.length > 0 && (
          <p>
            <strong>Saldo negativo no histórico:</strong>{' '}
            {historical.map((a) => `${a.houseName} (desde ${fmtDate(a.firstAt)}, mínimo ${formatBRL(a.minCents)})`).join(', ')}
            . Hoje o saldo está positivo, mas as datas registradas deixam o passado negativo — confira as datas do saldo
            inicial, depósitos e apostas.
          </p>
        )}
      </div>
      {page !== 'bankroll' && (
        <Button size="sm" onClick={() => setPage('bankroll')}>
          Ver banca
        </Button>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { page, setPage, ready, loadError, refresh } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < NAV.length) {
        e.preventDefault();
        setPage(NAV[i]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPage]);

  if (!ready) return <div className="boot">Carregando…</div>;
  if (loadError) {
    return (
      <div className="boot">
        <p>Não foi possível carregar os dados: {loadError}</p>
        <Button onClick={() => void refresh()}>Tentar novamente</Button>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <Sidebar />
      <main id="conteudo" tabIndex={-1}>
        <div className="content">
          <AlertsBanner />
          {page === 'add' && <AddBetPage />}
          {page === 'results' && <ResultsPage />}
          {page === 'dashboard' && <DashboardPage />}
          {page === 'bankroll' && <BankrollPage />}
          {page === 'data' && <DataPage />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
