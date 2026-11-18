import { useEffect, useState } from 'react';
import { betAvailableEffect } from '../../core/ledger';
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
  oddsToInput,
  parseMoneyToCents,
  parseOddsToMilli,
} from '../../shared/money';
import { BET_STATUSES, STATUS_LABEL, type AuditEntry, type BetStatus, type BetView } from '../../shared/types';
import { ApiFailure, api, call, errorMessage } from '../api';
import { fmtDateTime, fromLocalInput, nowLocalInput, toLocalInput } from '../dates';
import { useApp } from '../store';
import { Button, ConfirmDialog, Dialog, SelectField, StatusBadge, TextAreaField, TextField, toneOf } from './ui';

// =============================================================================================
// Editar aposta
// =============================================================================================
export function BetEditDialog({ bet, onClose }: { bet: BetView; onClose: () => void }) {
  const { houses, refresh, notify } = useApp();
  const [houseId, setHouseId] = useState(String(bet.houseId));
  const [stake, setStake] = useState(centsToInput(bet.stakeCents));
  const [odds, setOdds] = useState(oddsToInput(bet.oddsMilli));
  const [placedAt, setPlacedAt] = useState(toLocalInput(bet.placedAt));
  const [status, setStatus] = useState<BetStatus>(bet.status);
  const [settledAt, setSettledAt] = useState(bet.settledAt ? toLocalInput(bet.settledAt) : nowLocalInput());
  const [description, setDescription] = useState(bet.description);
  const [notes, setNotes] = useState(bet.notes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const stakeCents = parseMoneyToCents(stake);
  const oddsMilli = parseOddsToMilli(odds);
  const ok = stakeCents !== null && stakeCents > 0 && oddsMilli !== null && oddsMilli >= MIN_ODDS_MILLI;
  const ret = ok ? calcReturnCents(stakeCents, oddsMilli) : null;
  const profitIfGreen = ok ? calcProfitCents(stakeCents, oddsMilli) : null;
  const outcome =
    !ok || ret === null
      ? null
      : status === 'green'
        ? { ret, profit: ret - stakeCents }
        : status === 'red'
          ? { ret: 0, profit: -stakeCents }
          : status === 'void'
            ? { ret: stakeCents, profit: 0 }
            : null;

  const save = async () => {
    const e: Record<string, string> = {};
    if (stake.trim() === '' || stakeCents === null) e.stakeCents = 'Informe um valor válido.';
    else if (stakeCents <= 0) e.stakeCents = 'O valor da aposta deve ser maior que zero.';
    else if (stakeCents > MAX_STAKE_CENTS) e.stakeCents = `O valor máximo por aposta é ${formatBRL(MAX_STAKE_CENTS)}.`;
    if (odds.trim() === '' || oddsMilli === null) e.oddsMilli = 'Informe uma odd válida.';
    else if (oddsMilli < MIN_ODDS_MILLI) e.oddsMilli = 'A odd deve ser maior que 1,00.';
    else if (oddsMilli > MAX_ODDS_MILLI) e.oddsMilli = 'Odd acima do limite permitido (1000).';
    const placedIso = fromLocalInput(placedAt);
    if (!placedIso) e.placedAt = 'Informe a data e o horário.';
    let settledIso: string | null = null;
    if (status !== 'pending') {
      settledIso = fromLocalInput(settledAt);
      if (!settledIso) e.settledAt = 'Informe a data da liquidação.';
      else if (placedIso && settledIso < placedIso) e.settledAt = 'A data de liquidação não pode ser anterior à data da aposta.';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      await call(
        api().updateBet(bet.id, {
          houseId: Number(houseId),
          stakeCents: stakeCents!,
          oddsMilli: oddsMilli!,
          placedAt: placedIso!,
          description,
          notes,
          status,
          settledAt: settledIso,
        }),
      );
      await refresh();
      notify('Aposta atualizada.');
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else notify(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const selectable = houses.filter((h) => !h.archived || h.id === bet.houseId);

  return (
    <Dialog
      title="Editar aposta"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className="form-row two">
          <TextField
            label="Valor da aposta"
            prefix="R$"
            inputMode="decimal"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            error={errors.stakeCents}
            autoFocus
          />
          <TextField
            label="Odd (decimal)"
            inputMode="decimal"
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            error={errors.oddsMilli}
          />
        </div>
        <div className="form-row two">
          <SelectField label="Casa de apostas" value={houseId} onChange={(e) => setHouseId(e.target.value)} error={errors.houseId}>
            {selectable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.archived ? ' (arquivada)' : ''}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Data e horário da aposta"
            type="datetime-local"
            value={placedAt}
            onChange={(e) => setPlacedAt(e.target.value)}
            error={errors.placedAt}
          />
        </div>
        <div className="form-row two">
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as BetStatus)}>
            {BET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
          {status !== 'pending' ? (
            <TextField
              label="Data e horário da liquidação"
              type="datetime-local"
              value={settledAt}
              onChange={(e) => setSettledAt(e.target.value)}
              error={errors.settledAt}
            />
          ) : (
            <div className="field">
              <span className="field-static-label">Liquidação</span>
              <p className="muted field-static">Pendente: o valor fica reservado, sem resultado realizado.</p>
            </div>
          )}
        </div>
        <TextField label="Evento ou mercado" optional value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        <TextAreaField label="Observações" optional rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        <p className="calc-line" aria-live="polite">
          {ok ? (
            outcome ? (
              <>
                Com este status: retorno <strong className="num">{formatBRL(outcome.ret)}</strong>, resultado{' '}
                <strong className={`num ${toneOf(outcome.profit)}`}>{formatBRLSigned(outcome.profit)}</strong>.
              </>
            ) : (
              <>
                Retorno potencial <strong className="num">{formatBRL(ret!)}</strong> (lucro potencial{' '}
                <strong className="num">{formatBRLSigned(profitIfGreen!)}</strong>).
              </>
            )
          ) : (
            'Preencha valor e odd para ver o retorno.'
          )}
        </p>
        <p className="hint">As alterações são registradas no histórico da aposta e os saldos são recalculados automaticamente.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// =============================================================================================
// Excluir aposta
// =============================================================================================
export function BetDeleteDialog({ bet, onClose }: { bet: BetView; onClose: () => void }) {
  const { houses, refresh, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const house = houses.find((h) => h.id === bet.houseId);
  const effect = betAvailableEffect(bet);
  const before = house?.availableCents ?? 0;

  const run = async () => {
    setBusy(true);
    try {
      await call(api().deleteBet(bet.id));
      await refresh();
      notify('Aposta excluída. O registro permanece no histórico de alterações.');
      onClose();
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog title="Excluir aposta?" confirmLabel="Excluir aposta" danger busy={busy} onConfirm={() => void run()} onClose={onClose}>
      <p>
        <strong>{bet.description || 'Aposta sem descrição'}</strong>
        <br />
        {bet.houseName} · {formatBRL(bet.stakeCents)} @ {formatOdds(bet.oddsMilli)} · <StatusBadge status={bet.status} />
      </p>
      <p>
        {effect === 0 ? (
          <>O saldo disponível de {bet.houseName} não será alterado.</>
        ) : (
          <>
            O saldo disponível de <strong>{bet.houseName}</strong> passará de{' '}
            <strong className="num">{formatBRL(before)}</strong> para <strong className="num">{formatBRL(before - effect)}</strong>.
          </>
        )}{' '}
        {bet.status === 'pending' && 'O valor reservado será liberado de volta ao saldo.'}
      </p>
      <p className="hint">Esta ação não pode ser desfeita, mas ficará registrada no histórico de alterações.</p>
    </ConfirmDialog>
  );
}

// =============================================================================================
// Histórico da aposta
// =============================================================================================
export function BetHistoryDialog({ bet, onClose }: { bet: BetView; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    call(api().betHistory(bet.id))
      .then((e) => alive && setEntries(e))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [bet.id]);

  return (
    <Dialog title="Histórico da aposta" onClose={onClose} width={640} footer={<Button onClick={onClose} autoFocus>Fechar</Button>}>
      <p className="muted">
        {bet.description || 'Aposta sem descrição'} · {bet.houseName} · {formatBRL(bet.stakeCents)} @ {formatOdds(bet.oddsMilli)}
      </p>
      {error && <p className="error">{error}</p>}
      {!entries && !error && <p className="muted">Carregando…</p>}
      {entries && (
        <ol className="timeline">
          {entries.map((e) => (
            <li key={e.id}>
              <time dateTime={e.at}>{fmtDateTime(e.at)}</time>
              <span>{e.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
