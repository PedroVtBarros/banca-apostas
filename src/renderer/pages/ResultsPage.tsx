import { useEffect, useMemo, useState } from 'react';
import { formatBRL, formatBRLSigned, formatOdds } from '../../shared/money';
import { BET_STATUSES, STATUS_LABEL, type BetStatus, type BetView } from '../../shared/types';
import { api, call, errorMessage } from '../api';
import { BetDeleteDialog, BetEditDialog, BetHistoryDialog } from '../components/BetDialogs';
import { ActionMenu, Button, EmptyState, PageHeader, PeriodPicker, StatusBadge, toneOf } from '../components/ui';
import { fmtDateTime, periodRange } from '../dates';
import { useApp } from '../store';

type SortKey = 'placedAt' | 'stakeCents' | 'oddsMilli' | 'profit';
const PAGE_SIZE = 50;

const QUICK: { status: BetStatus; label: string }[] = [
  { status: 'green', label: 'Green' },
  { status: 'red', label: 'Red' },
  { status: 'void', label: 'Anulada' },
];

export function ResultsPage() {
  const { houses, dataVersion, refresh, notify, setPage, resultsFilters: f, setResultsFilters: setF } = useApp();
  const [bets, setBets] = useState<BetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalAll, setTotalAll] = useState<number | null>(null);
  const [searchText, setSearchText] = useState(f.search);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'placedAt', dir: 'desc' });
  const [pageNo, setPageNo] = useState(0);
  const [editing, setEditing] = useState<BetView | null>(null);
  const [deleting, setDeleting] = useState<BetView | null>(null);
  const [history, setHistory] = useState<BetView | null>(null);

  // Busca com pequeno atraso para não consultar a cada tecla.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchText !== f.search) setF({ ...f, search: searchText });
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo(() => periodRange(f.period), [f.period]);

  useEffect(() => {
    let alive = true;
    call(api().listBets({ ...range, houseId: f.houseId, statuses: f.statuses, search: f.search }))
      .then((l) => {
        if (!alive) return;
        setBets(l);
        setError(null);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [range, f.houseId, f.statuses, f.search, dataVersion]);

  // Total sem filtros (para diferenciar "nenhuma aposta" de "nenhum resultado").
  useEffect(() => {
    let alive = true;
    call(api().listBets({}))
      .then((l) => alive && setTotalAll(l.length))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  useEffect(() => setPageNo(0), [range, f.houseId, f.statuses, f.search, sort]);

  const sorted = useMemo(() => {
    const list = (bets ?? []).slice();
    const val = (b: BetView): number =>
      sort.key === 'placedAt'
        ? Date.parse(b.placedAt)
        : sort.key === 'profit'
          ? (b.profitCents ?? Number.NEGATIVE_INFINITY)
          : sort.key === 'stakeCents'
            ? b.stakeCents
            : b.oddsMilli;
    list.sort((a, b) => (val(a) - val(b)) * (sort.dir === 'asc' ? 1 : -1) || b.id - a.id);
    return list;
  }, [bets, sort]);

  const totals = useMemo(() => {
    let staked = 0;
    let pending = 0;
    let profit = 0;
    for (const b of bets ?? []) {
      staked += b.stakeCents;
      if (b.status === 'pending') pending += b.stakeCents;
      profit += b.profitCents ?? 0;
    }
    return { staked, pending, profit };
  }, [bets]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const view = sorted.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE);
  const filtered = f.period.preset !== 'all' || f.houseId !== null || f.statuses.length > 0 || f.search.trim() !== '';

  const clearFilters = () => {
    setSearchText('');
    setF({ period: { preset: 'all', from: '', to: '' }, houseId: null, statuses: [], search: '' });
  };

  const setStatus = async (bet: BetView, status: BetStatus) => {
    if (bet.status === status) return;
    const prev = { status: bet.status, settledAt: bet.settledAt };
    try {
      await call(api().setBetStatus(bet.id, status));
      await refresh();
      notify(`"${bet.description || 'Aposta'}" marcada como ${STATUS_LABEL[status]}.`, {
        action: {
          label: 'Desfazer',
          run: () => {
            call(api().setBetStatus(bet.id, prev.status, prev.settledAt))
              .then(() => refresh())
              .then(() => notify('Alteração desfeita.'))
              .catch((e) => notify(errorMessage(e), { kind: 'error' }));
          },
        },
      });
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  const sortHead = (key: SortKey, label: string, align?: 'right') => (
    <th scope="col" className={align === 'right' ? 'right' : ''} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-btn" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Resultados"
        subtitle="Confira as apostas e defina o resultado. Os saldos são recalculados a cada alteração."
        actions={
          <Button variant="primary" icon="add" onClick={() => setPage('add')}>
            Nova aposta
          </Button>
        }
      />

      <section className="filters" aria-label="Filtros">
        <PeriodPicker value={f.period} onChange={(period) => setF({ ...f, period })} />
        <div className="filters-row">
          <label className="inline-field">
            <span>Casa</span>
            <select
              className="input input-sm"
              value={f.houseId ?? ''}
              onChange={(e) => setF({ ...f, houseId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Todas as casas</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.archived ? ' (arquivada)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="chips" role="group" aria-label="Status">
            {BET_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`chip chip-${s}`}
                aria-pressed={f.statuses.includes(s)}
                onClick={() =>
                  setF({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })
                }
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <label className="inline-field grow">
            <span className="sr-only">Pesquisar pela descrição</span>
            <input
              type="search"
              className="input input-sm"
              placeholder="Pesquisar pela descrição…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </label>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Limpar filtros
            </Button>
          )}
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {bets && totalAll === 0 ? (
        <EmptyState
          title="Nenhuma aposta registrada"
          action={
            <Button variant="primary" onClick={() => setPage('add')}>
              Adicionar primeira aposta
            </Button>
          }
        >
          Quando você registrar apostas, elas aparecerão aqui como Pendentes, prontas para receber o resultado.
        </EmptyState>
      ) : bets && bets.length === 0 ? (
        <EmptyState
          title="Nenhuma aposta encontrada"
          action={
            <Button onClick={clearFilters}>Limpar filtros</Button>
          }
        >
          Nenhuma aposta corresponde aos filtros atuais.
        </EmptyState>
      ) : (
        bets && (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Apostas</caption>
                <thead>
                  <tr>
                    {sortHead('placedAt', 'Data')}
                    <th scope="col">Descrição</th>
                    <th scope="col">Casa</th>
                    {sortHead('stakeCents', 'Valor', 'right')}
                    {sortHead('oddsMilli', 'Odd', 'right')}
                    <th scope="col">Status</th>
                    <th scope="col" className="right">Retorno</th>
                    {sortHead('profit', 'Lucro / prejuízo', 'right')}
                    <th scope="col" className="actions-col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((b) => (
                    <tr key={b.id}>
                      <td className="nowrap">{fmtDateTime(b.placedAt)}</td>
                      <td className="desc" title={b.notes ? `${b.description}\n\nObs.: ${b.notes}` : b.description}>
                        {b.description || <span className="muted">—</span>}
                        {b.notes && <span className="note-dot" aria-label="Possui observações" title={b.notes}> ✎</span>}
                      </td>
                      <td className="nowrap">{b.houseName}</td>
                      <td className="right num">{formatBRL(b.stakeCents)}</td>
                      <td className="right num">{formatOdds(b.oddsMilli)}</td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="right num">
                        {b.returnCents === null ? (
                          <span className="muted" title={`Retorno potencial: ${formatBRL(b.potentialReturnCents)}`}>
                            —
                          </span>
                        ) : (
                          formatBRL(b.returnCents)
                        )}
                      </td>
                      <td className={`right num strong ${toneOf(b.profitCents)}`}>
                        {b.profitCents === null ? (
                          <span className="muted" title={`Lucro potencial: ${formatBRLSigned(b.potentialProfitCents)}`}>
                            —
                          </span>
                        ) : (
                          formatBRLSigned(b.profitCents)
                        )}
                      </td>
                      <td className="actions-col">
                        <div className="row-actions">
                          <div className="quick" role="group" aria-label={`Resultado de ${b.description || 'aposta'}`}>
                            {QUICK.map((q) => (
                              <button
                                key={q.status}
                                type="button"
                                className={`quick-btn quick-${q.status}`}
                                aria-pressed={b.status === q.status}
                                onClick={() => void setStatus(b, q.status)}
                              >
                                {q.label}
                              </button>
                            ))}
                          </div>
                          <ActionMenu
                            label={`Mais ações da aposta ${b.description || b.id}`}
                            items={[
                              { label: 'Voltar para Pendente', icon: 'restore', disabled: b.status === 'pending', onSelect: () => void setStatus(b, 'pending') },
                              { label: 'Editar', icon: 'edit', onSelect: () => setEditing(b) },
                              { label: 'Histórico', icon: 'history', onSelect: () => setHistory(b) },
                              { label: 'Excluir', icon: 'trash', danger: true, onSelect: () => setDeleting(b) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {sorted.length} {sorted.length === 1 ? 'aposta' : 'apostas'}
                      {filtered ? ' (filtradas)' : ''}
                    </td>
                    <td className="right num">{formatBRL(totals.staked)}</td>
                    <td colSpan={3} className="right muted">
                      Em pendentes: <span className="num">{formatBRL(totals.pending)}</span>
                    </td>
                    <td className={`right num strong ${toneOf(totals.profit)}`}>{formatBRLSigned(totals.profit)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {pages > 1 && (
              <nav className="pager" aria-label="Paginação">
                <Button size="sm" disabled={pageNo === 0} onClick={() => setPageNo((p) => p - 1)}>
                  Anterior
                </Button>
                <span>
                  Página {pageNo + 1} de {pages}
                </span>
                <Button size="sm" disabled={pageNo >= pages - 1} onClick={() => setPageNo((p) => p + 1)}>
                  Próxima
                </Button>
              </nav>
            )}
          </>
        )
      )}

      {editing && <BetEditDialog bet={editing} onClose={() => setEditing(null)} />}
      {deleting && <BetDeleteDialog bet={deleting} onClose={() => setDeleting(null)} />}
      {history && <BetHistoryDialog bet={history} onClose={() => setHistory(null)} />}
    </>
  );
}
