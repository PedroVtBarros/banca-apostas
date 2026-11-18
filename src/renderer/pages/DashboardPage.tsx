import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL, formatBRLSigned, formatPercent } from '../../shared/money';
import { STATUS_LABEL, type BetStatus, type DashboardData } from '../../shared/types';
import { api, call, errorMessage } from '../api';
import { EmptyState, PageHeader, PeriodPicker, toneOf } from '../components/ui';
import { fmtDate, periodRange } from '../dates';
import { useApp } from '../store';

const compactBRL = (cents: number) => {
  const v = cents / 100;
  const abs = Math.abs(v);
  const f = (n: number, s: string) => `${v < 0 ? '−' : ''}R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n)}${s}`;
  if (abs >= 1_000_000) return f(abs / 1_000_000, ' mi');
  if (abs >= 1_000) return f(abs / 1_000, ' mil');
  return f(abs, '');
};

const STATUS_COLOR: Record<BetStatus, string> = {
  green: 'var(--green)',
  red: 'var(--red)',
  void: 'var(--void)',
  pending: 'var(--pending)',
};

function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd className={`num ${tone ?? ''}`}>{value}</dd>
      {note && <dd className="kpi-note">{note}</dd>}
    </div>
  );
}

interface TipRow {
  name: string;
  value: string;
  color: string;
}

function ChartTip({ active, label, rows }: { active?: boolean; label?: string; rows: TipRow[] }) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="chart-tip">
      {label && <div className="chart-tip-title">{label}</div>}
      {rows.map((r) => (
        <div key={r.name} className="chart-tip-row">
          <span className="swatch" style={{ background: r.color }} aria-hidden="true" />
          <span>{r.name}</span>
          <strong className="num">{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend" aria-label="Legenda">
      {items.map((i) => (
        <li key={i.name}>
          <span className={`legend-line ${i.dashed ? 'dashed' : ''}`} style={{ borderColor: i.color }} aria-hidden="true" />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { houses, dataVersion, setPage, dashboardFilters: f, setDashboardFilters: setF } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => periodRange(f.period), [f.period]);

  useEffect(() => {
    let alive = true;
    call(api().getDashboard({ ...range, houseId: f.houseId }))
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [range, f.houseId, dataVersion]);

  const series = data?.series ?? [];
  const singlePoint = series.length <= 2;
  const tMin = series.length ? series[0]!.t : 0;
  const tMax = series.length ? series[series.length - 1]!.t : 0;
  // Com um único dia, alarga o eixo para o gráfico não ficar reduzido a um ponto colado na borda.
  const xDomain: [number | string, number | string] = tMin === tMax ? [tMin - 43_200_000, tMax + 43_200_000] : ['dataMin', 'dataMax'];
  const total = data?.distribution.reduce((s, d) => s + d.count, 0) ?? 0;
  const tickDate = (t: number) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(t));

  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={xDomain}
      tickFormatter={tickDate}
      tick={{ fill: 'var(--muted)', fontSize: 12 }}
      tickLine={false}
      axisLine={{ stroke: 'var(--line-strong)' }}
      minTickGap={36}
    />
  );
  const yAxis = (auto = false) => (
    <YAxis
      domain={auto ? ['auto', 'auto'] : [0, 'auto']}
      tickFormatter={compactBRL}
      tick={{ fill: 'var(--muted)', fontSize: 12 }}
      tickLine={false}
      axisLine={false}
      width={78}
    />
  );
  const grid = <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />;

  return (
    <>
      <PageHeader title="Painel e gráficos" subtitle="Saldos atuais e desempenho no período selecionado." />

      <section className="filters" aria-label="Filtros do painel">
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
          <p className="hint inline-hint">
            Lucro, acerto e ROI consideram apostas <em>liquidadas</em> no período; quantidade e distribuição, apostas <em>feitas</em> no período.
          </p>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {houses.length === 0 ? (
        <EmptyState
          title="Sem dados para mostrar"
          action={
            <button type="button" className="btn btn-primary btn-md" onClick={() => setPage('bankroll')}>
              Cadastrar casa
            </button>
          }
        >
          Cadastre uma casa de apostas e registre apostas para ver indicadores e gráficos.
        </EmptyState>
      ) : (
        data && (
          <>
            <h2 className="group-title">Situação atual da banca</h2>
            <dl className="kpi-strip cols-3">
              <Kpi label="Saldo disponível" value={formatBRL(data.availableCents)} tone={data.availableCents < 0 ? 'neg' : ''} note="Livre para apostar" />
              <Kpi label="Em apostas pendentes" value={formatBRL(data.reservedCents)} note={`${data.pendingCount} pendente${data.pendingCount === 1 ? '' : 's'} no período`} />
              <Kpi label="Patrimônio da banca" value={formatBRL(data.equityCents)} note="Disponível + reservado" />
            </dl>

            <h2 className="group-title">Desempenho no período</h2>
            <dl className="kpi-strip cols-4">
              <Kpi label="Lucro / prejuízo realizado" value={formatBRLSigned(data.realizedCents)} tone={toneOf(data.realizedCents)} note="Sem depósitos e saques" />
              <Kpi label="Apostas" value={String(data.betCount)} note={`${data.greenCount} green · ${data.redCount} red · ${data.voidCount} anulada${data.voidCount === 1 ? '' : 's'}`} />
              <Kpi label="Taxa de acerto" value={formatPercent(data.hitRate)} note="Greens ÷ (Greens + Reds)" />
              <Kpi label="ROI" value={data.roi === null ? '—' : formatPercent(data.roi)} tone={data.roi === null ? '' : toneOf(Math.round(data.roi * 100))} note={`Sobre ${formatBRL(data.settledStakeCents)} em Green e Red`} />
            </dl>

            <div className="charts">
              <section className="chart-block wide" aria-labelledby="c1">
                <h2 id="c1">Evolução do patrimônio da banca</h2>
                <p className="chart-sub">Patrimônio (disponível + reservado) comparado ao que você aportou (saldo inicial + depósitos − saques). A diferença entre as linhas é o lucro ou prejuízo.</p>
                <Legend
                  items={[
                    { name: 'Patrimônio', color: 'var(--chart-1)' },
                    { name: 'Aportes líquidos', color: 'var(--chart-2)', dashed: true },
                  ]}
                />
                <div className="chart-box" role="img" aria-label="Gráfico de linhas: patrimônio da banca e aportes líquidos ao longo do tempo">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      {grid}
                      {xAxis}
                      {yAxis(true)}
                      <Tooltip
                        cursor={{ stroke: 'var(--line-strong)' }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as (typeof series)[number] | undefined;
                          return (
                            <ChartTip
                              active={active}
                              label={p ? `Ao fim de ${fmtDate(p.t)}` : ''}
                              rows={
                                p
                                  ? [
                                      { name: 'Patrimônio', value: formatBRL(p.equityCents), color: 'var(--chart-1)' },
                                      { name: 'Aportes líquidos', value: formatBRL(p.contributedCents), color: 'var(--chart-2)' },
                                      { name: 'Disponível', value: formatBRL(p.availableCents), color: 'var(--muted)' },
                                    ]
                                  : []
                              }
                            />
                          );
                        }}
                      />
                      <Line type="stepAfter" dataKey="contributedCents" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="equityCents" stroke="var(--chart-1)" strokeWidth={2.2} dot={singlePoint ? { r: 4 } : false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="chart-block wide" aria-labelledby="c2">
                <h2 id="c2">Lucro / prejuízo acumulado</h2>
                <p className="chart-sub">Somente resultado de apostas, na data em que foram liquidadas. Depósitos e saques não entram aqui. No período escolhido, a linha começa em zero.</p>
                <div className="chart-box" role="img" aria-label="Gráfico de linha: lucro ou prejuízo acumulado ao longo do tempo">
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      {grid}
                      {xAxis}
                      {yAxis()}
                      <ReferenceLine y={0} stroke="var(--ink-2)" strokeWidth={1} />
                      <Tooltip
                        cursor={{ stroke: 'var(--line-strong)' }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as (typeof series)[number] | undefined;
                          return (
                            <ChartTip
                              active={active}
                              label={p ? `Ao fim de ${fmtDate(p.t)}` : ''}
                              rows={p ? [{ name: 'Lucro acumulado', value: formatBRLSigned(p.cumulativeProfitCents), color: 'var(--chart-1)' }] : []}
                            />
                          );
                        }}
                      />
                      <Line type="stepAfter" dataKey="cumulativeProfitCents" stroke="var(--chart-1)" strokeWidth={2.2} dot={singlePoint ? { r: 4 } : false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="chart-block" aria-labelledby="c3">
                <h2 id="c3">Resultado por casa</h2>
                {data.byHouse.length === 0 ? (
                  <p className="muted">Nenhuma aposta no período.</p>
                ) : (
                  <>
                    <div className="chart-box" role="img" aria-label="Gráfico de barras: lucro ou prejuízo por casa de apostas">
                      <ResponsiveContainer width="100%" height={Math.max(150, data.byHouse.length * 44 + 30)}>
                        <BarChart data={data.byHouse} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={compactBRL} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="houseName" width={96} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} />
                          <ReferenceLine x={0} stroke="var(--ink-2)" />
                          <Tooltip
                            cursor={{ fill: 'var(--hover)' }}
                            content={({ active, payload }) => {
                              const p = payload?.[0]?.payload as DashboardData['byHouse'][number] | undefined;
                              return (
                                <ChartTip
                                  active={active}
                                  label={p?.houseName}
                                  rows={p ? [{ name: 'Resultado', value: formatBRLSigned(p.profitCents), color: p.profitCents >= 0 ? 'var(--green)' : 'var(--red)' }] : []}
                                />
                              );
                            }}
                          />
                          <Bar dataKey="profitCents" radius={3} maxBarSize={22} isAnimationActive={false}>
                            {data.byHouse.map((h) => (
                              <Cell key={h.houseId} fill={h.profitCents >= 0 ? 'var(--green)' : 'var(--red)'} />
                            ))}
                                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="table-wrap compact">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Casa</th>
                            <th scope="col" className="right">Apostas</th>
                            <th scope="col" className="right">Acerto</th>
                            <th scope="col" className="right">ROI</th>
                            <th scope="col" className="right">Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.byHouse.map((h) => (
                            <tr key={h.houseId}>
                              <td>{h.houseName}</td>
                              <td className="right num">{h.betCount}</td>
                              <td className="right num">{formatPercent(h.hitRate)}</td>
                              <td className="right num">{formatPercent(h.roi)}</td>
                              <td className={`right num strong ${toneOf(h.profitCents)}`}>{formatBRLSigned(h.profitCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>

              <section className="chart-block" aria-labelledby="c4">
                <h2 id="c4">Apostas por status</h2>
                {total === 0 ? (
                  <p className="muted">Nenhuma aposta no período.</p>
                ) : (
                  <div className="donut-wrap">
                    <div className="donut" role="img" aria-label={`Distribuição de ${total} apostas por status`}>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Tooltip
                            content={({ active, payload }) => {
                              const p = payload?.[0]?.payload as DashboardData['distribution'][number] | undefined;
                              return (
                                <ChartTip
                                  active={active}
                                  label={p ? STATUS_LABEL[p.status] : ''}
                                  rows={p ? [{ name: 'Apostas', value: `${p.count} (${formatBRL(p.stakeCents)})`, color: STATUS_COLOR[p.status] }] : []}
                                />
                              );
                            }}
                          />
                          <Pie
                            data={data.distribution.filter((d) => d.count > 0)}
                            dataKey="count"
                            nameKey="status"
                            innerRadius={56}
                            outerRadius={84}
                            paddingAngle={2}
                            stroke="var(--surface)"
                            strokeWidth={2}
                            isAnimationActive={false}
                          >
                            {data.distribution
                              .filter((d) => d.count > 0)
                              .map((d) => (
                                <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
                              ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="donut-center" aria-hidden="true">
                        <strong className="num">{total}</strong>
                        <span>apostas</span>
                      </div>
                    </div>
                    <table className="table legend-table">
                      <thead>
                        <tr>
                          <th scope="col">Status</th>
                          <th scope="col" className="right">Qtd.</th>
                          <th scope="col" className="right">%</th>
                          <th scope="col" className="right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.distribution.map((d) => (
                          <tr key={d.status}>
                            <td>
                              <span className="swatch" style={{ background: STATUS_COLOR[d.status] }} aria-hidden="true" /> {STATUS_LABEL[d.status]}
                            </td>
                            <td className="right num">{d.count}</td>
                            <td className="right num">{formatPercent((d.count / total) * 100, 0)}</td>
                            <td className="right num">{formatBRL(d.stakeCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <details className="data-table">
              <summary>Ver dados dos gráficos em tabela</summary>
              <div className="table-wrap compact">
                <table className="table">
                  <caption className="sr-only">Evolução da banca por dia</caption>
                  <thead>
                    <tr>
                      <th scope="col">Dia</th>
                      <th scope="col" className="right">Patrimônio</th>
                      <th scope="col" className="right">Aportes líquidos</th>
                      <th scope="col" className="right">Lucro acumulado</th>
                      <th scope="col" className="right">Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.slice().reverse().map((p) => (
                      <tr key={p.t}>
                        <td>{fmtDate(p.t)}</td>
                        <td className="right num">{formatBRL(p.equityCents)}</td>
                        <td className="right num">{formatBRL(p.contributedCents)}</td>
                        <td className={`right num ${toneOf(p.cumulativeProfitCents)}`}>{formatBRLSigned(p.cumulativeProfitCents)}</td>
                        <td className="right num">{formatBRL(p.availableCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )
      )}
    </>
  );
}
