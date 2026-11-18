import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  MAX_ODDS_MILLI,
  MAX_STAKE_CENTS,
  MIN_ODDS_MILLI,
  calcProfitCents,
  calcReturnCents,
  centsToInput,
  formatBRL,
  formatBRLSigned,
  formatOdds,
  parseMoneyToCents,
  parseOddsToMilli,
} from '../../shared/money';
import type { BetView } from '../../shared/types';
import { ApiFailure, api, call, errorMessage } from '../api';
import { Button, EmptyState, PageHeader, StatusBadge, TextAreaField, TextField, SelectField, toneOf } from '../components/ui';
import { fmtDateTime, fromLocalInput, nowLocalInput } from '../dates';
import { useApp } from '../store';

type Errors = Partial<Record<'houseId' | 'stake' | 'odds' | 'placedAt' | 'description' | 'notes', string>>;

export function AddBetPage() {
  const { houses, dataVersion, refresh, notify, setPage, lastHouseId, setLastHouseId } = useApp();
  const active = houses.filter((h) => !h.archived);

  const [houseId, setHouseId] = useState<string>(() => (lastHouseId ? String(lastHouseId) : ''));
  const [stake, setStake] = useState('');
  const [odds, setOdds] = useState('');
  const [placedAt, setPlacedAt] = useState(nowLocalInput());
  const [placedDirty, setPlacedDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<BetView[]>([]);
  const stakeRef = useRef<HTMLInputElement>(null);

  // Casa padrão: a última usada, ou a única ativa.
  useEffect(() => {
    if (houseId && active.some((h) => String(h.id) === houseId)) return;
    if (active.length === 1) setHouseId(String(active[0]!.id));
    else if (houseId) setHouseId('');
  }, [active, houseId]);

  // Data/hora acompanha o relógio enquanto o usuário não editar.
  useEffect(() => {
    if (placedDirty) return;
    const t = window.setInterval(() => setPlacedAt(nowLocalInput()), 15000);
    return () => window.clearInterval(t);
  }, [placedDirty]);

  useEffect(() => {
    let alive = true;
    call(api().listBets({}))
      .then((l) => alive && setRecent(l.slice().sort((a, b) => b.id - a.id).slice(0, 6)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  const house = active.find((h) => String(h.id) === houseId) ?? null;
  const stakeCents = parseMoneyToCents(stake);
  const oddsMilli = parseOddsToMilli(odds);
  const placedIso = fromLocalInput(placedAt);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!house) e.houseId = 'Selecione a casa de apostas.';
    if (stake.trim() === '') e.stake = 'Informe o valor da aposta.';
    else if (stakeCents === null) e.stake = 'Valor inválido. Use o formato 100,00.';
    else if (stakeCents <= 0) e.stake = 'O valor da aposta deve ser maior que zero.';
    else if (stakeCents > MAX_STAKE_CENTS) e.stake = `O valor máximo por aposta é ${formatBRL(MAX_STAKE_CENTS)}.`;
    else if (house && stakeCents > house.availableCents)
      e.stake = `O valor é maior que o saldo disponível da casa (${formatBRL(Math.max(house.availableCents, 0))}).`;
    if (odds.trim() === '') e.odds = 'Informe a odd.';
    else if (oddsMilli === null) e.odds = 'Odd inválida. Use o formato 2,50.';
    else if (oddsMilli < MIN_ODDS_MILLI) e.odds = 'A odd deve ser maior que 1,00.';
    else if (oddsMilli > MAX_ODDS_MILLI) e.odds = 'Odd acima do limite permitido (1000).';
    if (!placedIso) e.placedAt = 'Informe a data e o horário.';
    return e;
  };

  // Erros de validação só aparecem após a primeira tentativa de salvar (ou vindos do servidor).
  const live = validate();
  const shown: Errors = submitted ? { ...live, ...errors } : errors;

  const validPreview = stakeCents !== null && stakeCents > 0 && oddsMilli !== null && oddsMilli >= MIN_ODDS_MILLI;
  const potentialReturn = validPreview ? calcReturnCents(stakeCents, oddsMilli) : null;
  const potentialProfit = validPreview ? calcProfitCents(stakeCents, oddsMilli) : null;
  const balanceAfter = house && stakeCents !== null && stakeCents > 0 ? house.availableCents - stakeCents : null;
  const beforeInitial = !!(house && placedIso && placedIso < house.initialBalanceAt);

  const submit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setSubmitted(true);
    const v = validate();
    if (Object.values(v).some(Boolean)) {
      setErrors({});
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }
    setBusy(true);
    try {
      const bet = await call(
        api().createBet({
          houseId: Number(houseId),
          stakeCents: stakeCents!,
          oddsMilli: oddsMilli!,
          placedAt: placedIso!,
          description,
          notes,
        }),
      );
      notify(`Aposta salva: ${formatBRL(bet.stakeCents)} @ ${formatOdds(bet.oddsMilli)} — Pendente.`);
      setLastHouseId(bet.houseId);
      // Pronto para a próxima: mantém a casa, limpa o resto e volta o foco ao valor.
      setStake('');
      setOdds('');
      setDescription('');
      setNotes('');
      setPlacedAt(nowLocalInput());
      setPlacedDirty(false);
      setErrors({});
      setSubmitted(false);
      await refresh();
      stakeRef.current?.focus();
    } catch (e) {
      if (e instanceof ApiFailure && Object.keys(e.fields).length > 0) {
        const f = e.fields;
        setErrors({
          houseId: f.houseId,
          stake: f.stakeCents,
          odds: f.oddsMilli,
          placedAt: f.placedAt,
          description: f.description,
          notes: f.notes,
        });
        if (!f.houseId && !f.stakeCents && !f.oddsMilli && !f.placedAt && !f.description && !f.notes) {
          notify(e.message, { kind: 'error' });
        }
      } else {
        notify(errorMessage(e), { kind: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  if (houses.length === 0) {
    return (
      <>
        <PageHeader title="Adicionar apostas" subtitle="Registre uma nova aposta em poucos segundos." />
        <EmptyState
          title="Cadastre sua primeira casa de apostas"
          action={
            <Button variant="primary" onClick={() => setPage('bankroll')}>
              Cadastrar casa
            </Button>
          }
        >
          Para registrar apostas, informe antes em qual casa você aposta e o saldo inicial dela.
        </EmptyState>
      </>
    );
  }

  if (active.length === 0) {
    return (
      <>
        <PageHeader title="Adicionar apostas" />
        <EmptyState
          title="Todas as casas estão arquivadas"
          action={<Button onClick={() => setPage('bankroll')}>Ir para Banca e casas</Button>}
        >
          Reative uma casa ou cadastre uma nova para registrar apostas.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Adicionar apostas"
        subtitle="Toda aposta nova entra como Pendente e aparece em Resultados."
      />
      <div className="add-layout">
        <form className="form" onSubmit={submit} noValidate aria-label="Nova aposta">
          <div className="form-row two">
            <TextField
              label="Valor da aposta"
              prefix="R$"
              inputMode="decimal"
              placeholder="0,00"
              value={stake}
              onChange={(e) => {
                setStake(e.target.value);
                setErrors((x) => ({ ...x, stake: undefined }));
              }}
              onBlur={() => stakeCents !== null && stakeCents > 0 && setStake(centsToInput(stakeCents))}
              error={shown.stake}
              ref={stakeRef}
              autoFocus
              autoComplete="off"
            />
            <TextField
              label="Odd (decimal)"
              inputMode="decimal"
              placeholder="2,50"
              value={odds}
              onChange={(e) => {
                setOdds(e.target.value);
                setErrors((x) => ({ ...x, odds: undefined }));
              }}
              error={shown.odds}
              autoComplete="off"
            />
          </div>
          <div className="form-row two">
            <SelectField
              label="Casa de apostas"
              value={houseId}
              onChange={(e) => {
                setHouseId(e.target.value);
                setErrors((x) => ({ ...x, houseId: undefined, stake: undefined }));
              }}
              error={shown.houseId}
            >
              <option value="">Selecione…</option>
              {active.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} — disponível {formatBRL(h.availableCents)}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Data e horário"
              type="datetime-local"
              value={placedAt}
              onChange={(e) => {
                setPlacedAt(e.target.value);
                setPlacedDirty(true);
                setErrors((x) => ({ ...x, placedAt: undefined }));
              }}
              error={shown.placedAt}
              hint={
                beforeInitial
                  ? 'Atenção: esta data é anterior ao saldo inicial da casa; o histórico ficará com saldo negativo nesse período.'
                  : placedDirty
                    ? undefined
                    : 'Preenchido com o horário atual.'
              }
            />
          </div>
          <TextField
            label="Evento ou mercado"
            optional
            placeholder="Ex.: Flamengo x Palmeiras — mais de 2,5 gols"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={shown.description}
            autoComplete="off"
          />
          <TextAreaField
            label="Observações"
            optional
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) void submit();
            }}
            error={shown.notes}
          />
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar aposta'}
            </Button>
            <span className="kbd-hint">
              Enter em qualquer campo salva · Após salvar, o foco volta para o valor
            </span>
          </div>
        </form>

        <aside className="preview" aria-label="Prévia da aposta" aria-live="polite">
          <h2>Antes de salvar</h2>
          <dl className="dl">
            <div>
              <dt>Retorno potencial</dt>
              <dd className="num big">{potentialReturn === null ? '—' : formatBRL(potentialReturn)}</dd>
              <dd className="dl-note">valor × odd</dd>
            </div>
            <div>
              <dt>Lucro potencial</dt>
              <dd className={`num big ${toneOf(potentialProfit)}`}>
                {potentialProfit === null ? '—' : formatBRLSigned(potentialProfit)}
              </dd>
              <dd className="dl-note">retorno − valor apostado</dd>
            </div>
            <div>
              <dt>Saldo da casa após reservar</dt>
              <dd className={`num ${balanceAfter !== null && balanceAfter < 0 ? 'neg' : ''}`}>
                {house ? (
                  <>
                    {formatBRL(house.availableCents)}
                    {balanceAfter !== null && <> → {formatBRL(balanceAfter)}</>}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          <h2 className="recent-title">Últimas apostas</h2>
          {recent.length === 0 ? (
            <p className="muted">Nenhuma aposta registrada ainda.</p>
          ) : (
            <ul className="recent">
              {recent.map((b) => (
                <li key={b.id}>
                  <div className="recent-main">
                    <span className="recent-desc">{b.description || 'Sem descrição'}</span>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="recent-sub">
                    {b.houseName} · {formatBRL(b.stakeCents)} @ {formatOdds(b.oddsMilli)} · {fmtDateTime(b.placedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" onClick={() => setPage('results')}>
            Ver todos em Resultados
          </Button>
        </aside>
      </div>
    </>
  );
}
