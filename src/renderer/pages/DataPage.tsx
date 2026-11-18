import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, AuditEntry } from '../../shared/types';
import { api, call, errorMessage } from '../api';
import { Button, EmptyState, PageHeader } from '../components/ui';
import { fmtDateTime } from '../dates';
import { useApp } from '../store';

const TYPE_LABEL: Record<AuditEntry['entityType'], string> = {
  bet: 'Aposta',
  house: 'Casa',
  transaction: 'Movimentação',
  system: 'Sistema',
};

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function DataPage() {
  const { refresh, notify, dataVersion } = useApp();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<'' | AuditEntry['entityType']>('');
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInfo = useCallback(() => {
    call(api().appInfo())
      .then(setInfo)
      .catch((e) => notify(errorMessage(e), { kind: 'error' }));
  }, [notify]);

  useEffect(loadInfo, [loadInfo, dataVersion]);

  useEffect(() => {
    let alive = true;
    call(api().listAudit({ limit: 50, offset: 0, entityType: type || undefined }))
      .then((r) => {
        if (!alive) return;
        setEntries(r.entries);
        setTotal(r.total);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [type, dataVersion]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await call(api().listAudit({ limit: 50, offset: entries.length, entityType: type || undefined }));
      setEntries((e) => [...e, ...r.entries]);
      setTotal(r.total);
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const doExport = async () => {
    setBusy('export');
    try {
      const r = await call(api().exportBackup());
      if (r) notify(`Backup salvo em ${r.path}`, { ms: 6000 });
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    try {
      const r = await call(api().restoreBackup());
      if (r.restored) {
        await refresh();
        loadInfo();
        notify(r.message ?? 'Backup restaurado.', { ms: 6000 });
      }
    } catch (e) {
      notify(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Dados e backup" subtitle="Seus dados ficam apenas neste computador e funcionam sem internet." />

      <section className="panel" aria-labelledby="h-bkp">
        <h2 id="h-bkp">Backup</h2>
        <div className="backup-grid">
          <div>
            <h3>Exportar</h3>
            <p className="muted">Salva uma cópia completa dos dados em um arquivo .db de sua escolha (por exemplo, em um pen drive ou na nuvem).</p>
            <Button icon="download" onClick={() => void doExport()} disabled={busy !== null}>
              {busy === 'export' ? 'Exportando…' : 'Exportar backup'}
            </Button>
          </div>
          <div>
            <h3>Restaurar</h3>
            <p className="muted">
              Substitui todos os dados atuais pelo conteúdo de um backup. Você confirmará antes, e uma cópia dos dados atuais é guardada automaticamente.
            </p>
            <Button icon="restore" onClick={() => void doRestore()} disabled={busy !== null}>
              {busy === 'restore' ? 'Restaurando…' : 'Restaurar backup…'}
            </Button>
          </div>
        </div>
      </section>

      {info && (
        <section className="panel" aria-labelledby="h-local">
          <h2 id="h-local">Onde os dados ficam</h2>
          <dl className="meta">
            <div>
              <dt>Arquivo do banco</dt>
              <dd className="mono">{info.dbPath}</dd>
            </div>
            <div>
              <dt>Tamanho</dt>
              <dd>{kb(info.dbSizeBytes)}</dd>
            </div>
            <div>
              <dt>Versão do aplicativo / esquema</dt>
              <dd>
                {info.version} / {info.schemaVersion}
              </dd>
            </div>
            <div>
              <dt>Backups automáticos</dt>
              <dd>
                {info.autoBackups.length === 0 ? (
                  'Nenhum ainda. Uma cópia diária é criada ao abrir o aplicativo (mantém as 10 mais recentes).'
                ) : (
                  <ul className="plain">
                    {info.autoBackups.slice(0, 5).map((b) => (
                      <li key={b.path}>
                        <span className="mono">{b.name}</span> · {kb(b.sizeBytes)} · {fmtDateTime(b.modifiedAt)}
                      </li>
                    ))}
                    {info.autoBackups.length > 5 && <li className="muted">… e mais {info.autoBackups.length - 5}</li>}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
          <Button size="sm" icon="folder" onClick={() => void call(api().openDataFolder())}>
            Abrir pasta de dados
          </Button>
        </section>
      )}

      <section aria-labelledby="h-hist">
        <div className="section-head">
          <h2 id="h-hist">Histórico de alterações</h2>
          <label className="inline-field">
            <span>Tipo</span>
            <select className="input input-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="">Todos</option>
              <option value="bet">Apostas</option>
              <option value="house">Casas</option>
              <option value="transaction">Depósitos e saques</option>
              <option value="system">Sistema</option>
            </select>
          </label>
        </div>
        {entries.length === 0 ? (
          <EmptyState title="Nada registrado ainda">Toda criação, edição, troca de status e exclusão é registrada aqui para conferência.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Alteração</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{fmtDateTime(e.at)}</td>
                      <td>
                        <span className="tag">{TYPE_LABEL[e.entityType]}</span>
                      </td>
                      <td>{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entries.length < total && (
              <div className="pager">
                <Button size="sm" onClick={() => void more()} disabled={loadingMore}>
                  Carregar mais ({total - entries.length} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
