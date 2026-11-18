import { useEffect, useState } from 'react';
import { centsToInput, formatBRL, formatBRLSigned, parseMoneyToCents } from '../../shared/money';
import { KIND_LABEL, type HouseWithBalance, type TransactionKind, type TransactionView } from '../../shared/types';
import { ApiFailure, api, call, errorMessage } from '../api';
import { ActionMenu, Button, ConfirmDialog, Dialog, EmptyState, PageHeader, SelectField, TextField, toneOf } from '../components/ui';
import { fmtDate, fmtDateTime, fromLocalInput, nowLocalInput, toLocalInput } from '../dates';
import { useApp } from '../store';

// =============================================================================================
// Casa: cadastrar / editar
// =============================================================================================
function HouseDialog({ house, onClose }: { house: HouseWithBalance | null; onClose: () => void }) {
  const { refresh, notify } = useApp();
  const [name, setName] = useState(house?.name ?? '');
  const [initial, setInitial] = useState(house ? centsToInput(house.initialBalanceCents) : '');
  const [initialAt, setInitialAt] = useState(house ? toLocalInput(house.initialBalanceAt) : nowLocalInput());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const e: Record<string, string> = {};
    const cents = initial.trim() === '' ? 0 : parseMoneyToCents(initial);
    if (name.trim() === '') e.name = 'O nome é obrigatório.';
    if (cents === null) e.initialBalanceCents = 'Valor inválido. Use o formato 1.000,00.';
    const at = fromLocalInput(initialAt);
    if (!at) e.initialBalanceAt = 'Informe a data do saldo inicial.';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      const input = { name, initialBalanceCents: cents!, initialBalanceAt: at! };
      if (house) await call(api().updateHouse(house.id, input));
      else await call(api().createHouse(input));
      await refresh();
      notify(house ? 'Casa atualizada.' : 'Casa cadastrada.');
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else notify(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={house ? 'Editar casa' : 'Nova casa de apostas'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Nome da casa" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={60} autoFocus autoComplete="off" />
        <div className="form-row two">
          <TextField
            label="Saldo inicial"
            prefix="R$"
            inputMode="decimal"
            placeholder="0,00"
            value={initial}
            onChange={(e) => setInitial(e.target.value)}
            error={errors.initialBalanceCents}
            autoComplete="off"
          />
          <TextField
            label="Data do saldo inicial"
            type="datetime-local"
            value={initialAt}
            onChange={(e) => setInitialAt(e.target.value)}
            error={errors.initialBalanceAt}
          />
        </div>
        <p className="hint">
          O saldo inicial é o ponto de partida desta casa. Depósitos e saques posteriores são registrados à parte e nunca entram como lucro ou prejuízo.
          {house && ' Alterar o saldo inicial recalcula todos os saldos e gráficos.'}
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// =============================================================================================
// Depósito / saque: cadastrar / editar
// =============================================================================================
function TransactionDialog({
  tx,
  initialKind,
  initialHouseId,
  onClose,
}: {
  tx: TransactionView | null;
  initialKind: TransactionKind;
  initialHouseId: number | null;
  onClose: () => void;
}) {
  const { houses, refresh, notify } = useApp();
  const selectable = houses.filter((h) => !h.archived || h.id === tx?.houseId);
  const [kind, setKind] = useState<TransactionKind>(tx?.kind ?? initialKind);
  const [houseId, setHouseId] = useState(String(tx?.houseId ?? initialHouseId ?? (selectable.length === 1 ? selectable[0]!.id : '')));
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amountCents) : '');
  const [at, setAt] = useState(tx ? toLocalInput(tx.occurredAt) : nowLocalInput());
  const [note, setNote] = useState(tx?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const house = houses.find((h) => String(h.id) === houseId);

  const save = async () => {
    const e: Record<string, string> = {};
    const cents = parseMoneyToCents(amount);
    if (!houseId) e.houseId = 'Selecione a casa.';
    if (amount.trim() === '' || cents === null) e.amountCents = 'Informe um valor válido.';
    else if (cents <= 0) e.amountCents = 'O valor deve ser maior que zero.';
    const iso = fromLocalInput(at);
    if (!iso) e.occurredAt = 'Informe a data.';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      const input = { houseId: Number(houseId), kind, amountCents: cents!, occurredAt: iso!, note };
      if (tx) await call(api().updateTransaction(tx.id, input));
      else await call(api().createTransaction(input));
      await refresh();
      notify(`${KIND_LABEL[kind]} ${tx ? 'atualizado' : 'registrado'}.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else notify(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={tx ? 'Editar movimentação' : kind === 'deposit' ? 'Registrar depósito' : 'Registrar saque'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <span className="field-static-label" id="kind-label">Tipo</span>
          <div className="seg" role="group" aria-labelledby="kind-label">
            {(['deposit', 'withdrawal'] as const).map((k) => (
              <button key={k} type="button" className="seg-btn" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <SelectField
          label="Casa de apostas"
          value={houseId}
          onChange={(e) => setHouseId(e.target.value)}
          error={errors.houseId}
          hint={house ? `Disponível: ${formatBRL(house.availableCents)}` : undefined}
        >
          <option value="">Selecione…</option>
          {selectable.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.archived ? ' (arquivada)' : ''}
            </option>
          ))}
        </SelectField>
        <div className="form-row two">
          <TextField
            label="Valor"
            prefix="R$"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amountCents}
            autoFocus
            autoComplete="off"
          />
          <TextField label="Data" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} error={errors.occurredAt} />
        </div>
        <TextField label="Observação" optional value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} error={errors.note} autoComplete="off" />
        <p className="hint">Depósitos e saques alteram o saldo, mas nunca são contados como lucro ou prejuízo.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// =============================================================================================
// Página
// =============================================================================================
export function BankrollPage() {
  const { houses, alerts, dataVersion, refresh, notify } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const [houseDialog, setHouseDialog] = useState<{ house: HouseWithBalance | null } | null>(null);
  const [txDialog, setTxDialog] = useState<{ tx: TransactionView | null; kind: TransactionKind; houseId: number | null } | null>(null);
  const [txs, setTxs] = useState<TransactionView[]>([]);
  const [txHouse, setTxHouse] = useState<number | null>(null);
  const [delHouse, setDelHouse] = useState<HouseWithBalance | null>(null);
  const [delTx, setDelTx] = useState<TransactionView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    call(api().listTransactions({ houseId: txHouse }))
      .then((l) => alive && setTxs(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [txHouse, dataVersion]);

  const visible = houses.filter((h) => showArchived || !h.archived);
  const archivedCount = houses.filter((h) => h.archived).length;
  const sum = (pick: (h: HouseWithBalance) => number) => houses.reduce((s, h) => s + pick(h), 0);
  const totals = {
    available: sum((h) => h.availableCents),
    reserved: sum((h) => h.reservedCents),
    equity: sum((h) => h.equityCents),
    realized: sum((h) => h.realizedCents),
  };

  const archive = async (h: HouseWithBalance, archived: boolean) => {
    try {
      await call(api().setHouseArchived(h.id, archived));
      await refresh();
      notify(archived ? `"${h.name}" arquivada.` : `"${h.name}" reativada.`);
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    }
  };

  const doDeleteHouse = async () => {
    if (!delHouse) return;
    setBusy(true);
    try {
      await call(api().deleteHouse(delHouse.id));
      await refresh();
      notify('Casa excluída.');
      setDelHouse(null);
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doDeleteTx = async () => {
    if (!delTx) return;
    setBusy(true);
    try {
      await call(api().deleteTransaction(delTx.id));
      await refresh();
      notify(`${KIND_LABEL[delTx.kind]} excluído.`);
      setDelTx(null);
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Banca e casas"
        subtitle="Saldos por casa, depósitos e saques."
        actions={
          <>
            <Button icon="download" onClick={() => setTxDialog({ tx: null, kind: 'deposit', houseId: null })} disabled={houses.filter((h) => !h.archived).length === 0}>
              Depósito / saque
            </Button>
            <Button variant="primary" icon="add" onClick={() => setHouseDialog({ house: null })}>
              Nova casa
            </Button>
          </>
        }
      />

      {houses.length === 0 ? (
        <EmptyState
          title="Nenhuma casa cadastrada"
          action={
            <Button variant="primary" onClick={() => setHouseDialog({ house: null })}>
              Cadastrar casa
            </Button>
          }
        >
          Cadastre as casas de apostas que você usa e o saldo inicial de cada uma. Nenhum dado fictício é criado automaticamente.
        </EmptyState>
      ) : (
        <>
          <dl className="kpi-strip" aria-label="Totais da banca">
            <div className="kpi">
              <dt>Saldo disponível</dt>
              <dd className="num">{formatBRL(totals.available)}</dd>
              <dd className="kpi-note">Livre para apostar</dd>
            </div>
            <div className="kpi">
              <dt>Em apostas pendentes</dt>
              <dd className="num">{formatBRL(totals.reserved)}</dd>
              <dd className="kpi-note">Valor reservado</dd>
            </div>
            <div className="kpi">
              <dt>Patrimônio da banca</dt>
              <dd className="num">{formatBRL(totals.equity)}</dd>
              <dd className="kpi-note">Disponível + reservado</dd>
            </div>
            <div className="kpi">
              <dt>Lucro / prejuízo realizado</dt>
              <dd className={`num ${toneOf(totals.realized)}`}>{formatBRLSigned(totals.realized)}</dd>
              <dd className="kpi-note">Sem depósitos e saques</dd>
            </div>
          </dl>

          {alerts.length > 0 && (
            <section className="panel panel-warn" aria-label="Saldos negativos">
              <h2>Saldos negativos detectados</h2>
              <ul className="plain">
                {alerts.map((a) => (
                  <li key={a.houseId}>
                    <strong>{a.houseName}</strong>:{' '}
                    {a.kind === 'current'
                      ? `saldo disponível atual de ${formatBRL(a.currentCents)} (negativo desde ${fmtDate(a.firstAt)}; menor valor ${formatBRL(a.minCents)} em ${fmtDate(a.minAt)}).`
                      : `o saldo ficou negativo em ${fmtDate(a.firstAt)} (mínimo ${formatBRL(a.minCents)} em ${fmtDate(a.minAt)}), mas hoje está em ${formatBRL(a.currentCents)}.`}
                  </li>
                ))}
              </ul>
              <p className="hint">
                Isso ocorre quando uma correção retroativa (resultado de uma aposta antiga, data ou saldo inicial) faz o dinheiro das movimentações posteriores não existir mais naquele momento.
                Nenhum dado foi alterado ou apagado: revise as datas e os resultados, ou registre um depósito para regularizar.
              </p>
            </section>
          )}

          <section aria-labelledby="h-casas">
            <div className="section-head">
              <h2 id="h-casas">Casas de apostas</h2>
              {archivedCount > 0 && (
                <label className="check">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                  Mostrar arquivadas ({archivedCount})
                </label>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Casa</th>
                    <th scope="col" className="right">Saldo inicial</th>
                    <th scope="col" className="right">Depósitos</th>
                    <th scope="col" className="right">Saques</th>
                    <th scope="col" className="right">Lucro / prejuízo</th>
                    <th scope="col" className="right">Pendentes</th>
                    <th scope="col" className="right">Disponível</th>
                    <th scope="col" className="right">Patrimônio</th>
                    <th scope="col" className="actions-col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((h) => (
                    <tr key={h.id} className={h.archived ? 'row-archived' : ''}>
                      <td>
                        <strong>{h.name}</strong>
                        {h.archived && <span className="tag">Arquivada</span>}
                      </td>
                      <td className="right num">{formatBRL(h.initialBalanceCents)}</td>
                      <td className="right num">{formatBRL(h.depositsCents)}</td>
                      <td className="right num">{formatBRL(h.withdrawalsCents)}</td>
                      <td className={`right num ${toneOf(h.realizedCents)}`}>{formatBRLSigned(h.realizedCents)}</td>
                      <td className="right num">{formatBRL(h.reservedCents)}</td>
                      <td className={`right num strong ${h.availableCents < 0 ? 'neg' : ''}`}>{formatBRL(h.availableCents)}</td>
                      <td className="right num">{formatBRL(h.equityCents)}</td>
                      <td className="actions-col">
                        <div className="row-actions">
                          {!h.archived && (
                            <>
                              <Button size="sm" onClick={() => setTxDialog({ tx: null, kind: 'deposit', houseId: h.id })}>
                                Depositar
                              </Button>
                              <Button size="sm" onClick={() => setTxDialog({ tx: null, kind: 'withdrawal', houseId: h.id })}>
                                Sacar
                              </Button>
                            </>
                          )}
                          <ActionMenu
                            label={`Mais ações de ${h.name}`}
                            items={[
                              { label: 'Editar', icon: 'edit', onSelect: () => setHouseDialog({ house: h }) },
                              h.archived
                                ? { label: 'Reativar', icon: 'restore', onSelect: () => void archive(h, false) }
                                : { label: 'Arquivar', icon: 'archive', onSelect: () => void archive(h, true) },
                              {
                                label: h.hasMovements ? 'Excluir (indisponível: possui movimentações)' : 'Excluir',
                                icon: 'trash',
                                danger: true,
                                disabled: h.hasMovements,
                                onSelect: () => setDelHouse(h),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Casas com apostas, depósitos ou saques não podem ser excluídas — arquive-as para ocultá-las sem perder o histórico.
            </p>
          </section>

          <section aria-labelledby="h-mov">
            <div className="section-head">
              <h2 id="h-mov">Depósitos e saques</h2>
              <label className="inline-field">
                <span>Casa</span>
                <select className="input input-sm" value={txHouse ?? ''} onChange={(e) => setTxHouse(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Todas as casas</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {txs.length === 0 ? (
              <EmptyState title="Nenhum depósito ou saque registrado">
                Use “Depositar” ou “Sacar” em uma casa para registrar. O saldo inicial não aparece aqui.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Casa</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Observação</th>
                      <th scope="col" className="right">Valor</th>
                      <th scope="col" className="actions-col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map((t) => (
                      <tr key={t.id}>
                        <td className="nowrap">{fmtDateTime(t.occurredAt)}</td>
                        <td>{t.houseName}</td>
                        <td>
                          <span className={`tag tag-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                        </td>
                        <td className="desc">{t.note || <span className="muted">—</span>}</td>
                        <td className="right num strong">
                          {t.kind === 'deposit' ? '+' : '−'}
                          {formatBRL(t.amountCents)}
                        </td>
                        <td className="actions-col">
                          <div className="row-actions">
                            <ActionMenu
                              label="Mais ações da movimentação"
                              items={[
                                { label: 'Editar', icon: 'edit', onSelect: () => setTxDialog({ tx: t, kind: t.kind, houseId: t.houseId }) },
                                { label: 'Excluir', icon: 'trash', danger: true, onSelect: () => setDelTx(t) },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {houseDialog && <HouseDialog house={houseDialog.house} onClose={() => setHouseDialog(null)} />}
      {txDialog && <TransactionDialog tx={txDialog.tx} initialKind={txDialog.kind} initialHouseId={txDialog.houseId} onClose={() => setTxDialog(null)} />}
      {delHouse && (
        <ConfirmDialog title="Excluir casa?" confirmLabel="Excluir casa" danger busy={busy} onConfirm={() => void doDeleteHouse()} onClose={() => setDelHouse(null)}>
          <p>
            A casa <strong>{delHouse.name}</strong> não tem movimentações e será excluída definitivamente.
          </p>
        </ConfirmDialog>
      )}
      {delTx && (
        <ConfirmDialog title={`Excluir ${KIND_LABEL[delTx.kind].toLowerCase()}?`} confirmLabel="Excluir" danger busy={busy} onConfirm={() => void doDeleteTx()} onClose={() => setDelTx(null)}>
          <p>
            {KIND_LABEL[delTx.kind]} de <strong className="num">{formatBRL(delTx.amountCents)}</strong> em <strong>{delTx.houseName}</strong> ({fmtDate(delTx.occurredAt)}).
          </p>
          <p>
            O saldo disponível da casa {delTx.kind === 'deposit' ? 'diminuirá' : 'aumentará'} {formatBRL(delTx.amountCents)}.
            {delTx.kind === 'deposit' && ' Se esse dinheiro já foi apostado, o saldo poderá ficar negativo e será sinalizado.'}
          </p>
          <p className="hint">A exclusão fica registrada no histórico de alterações.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
