import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BalanceAlert, BetStatus, HouseWithBalance } from '../shared/types';
import { api, call, errorMessage } from './api';
import type { Period } from './dates';

export type PageId = 'add' | 'results' | 'dashboard' | 'bankroll' | 'data';

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface ResultsFilters {
  period: Period;
  houseId: number | null;
  statuses: BetStatus[];
  search: string;
}

export interface DashboardFilters {
  period: Period;
  houseId: number | null;
}

const defaultPeriod: Period = { preset: 'all', from: '', to: '' };

interface AppState {
  ready: boolean;
  loadError: string | null;
  houses: HouseWithBalance[];
  alerts: BalanceAlert[];
  /** Incrementa a cada alteração de dados; páginas recarregam suas listas quando muda. */
  dataVersion: number;
  refresh: () => Promise<void>;
  page: PageId;
  setPage: (p: PageId) => void;
  toasts: Toast[];
  notify: (message: string, opts?: { kind?: 'success' | 'error'; action?: Toast['action']; ms?: number }) => void;
  dismissToast: (id: number) => void;
  resultsFilters: ResultsFilters;
  setResultsFilters: (f: ResultsFilters) => void;
  dashboardFilters: DashboardFilters;
  setDashboardFilters: (f: DashboardFilters) => void;
  /** Última casa usada no formulário de apostas. */
  lastHouseId: number | null;
  setLastHouseId: (id: number | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do provider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [houses, setHouses] = useState<HouseWithBalance[]>([]);
  const [alerts, setAlerts] = useState<BalanceAlert[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [page, setPage] = useState<PageId>('add');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [resultsFilters, setResultsFilters] = useState<ResultsFilters>({
    period: defaultPeriod,
    houseId: null,
    statuses: [],
    search: '',
  });
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>({ period: defaultPeriod, houseId: null });
  const [lastHouseId, setLastHouseId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, a] = await Promise.all([call(api().listHouses()), call(api().listAlerts())]);
      setHouses(h);
      setAlerts(a);
      setLoadError(null);
      setDataVersion((v) => v + 1);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback<AppState['notify']>(
    (message, opts) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, kind: opts?.kind ?? 'success', action: opts?.action }]);
      window.setTimeout(() => dismissToast(id), opts?.ms ?? (opts?.action ? 7000 : 3500));
    },
    [dismissToast],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      loadError,
      houses,
      alerts,
      dataVersion,
      refresh,
      page,
      setPage,
      toasts,
      notify,
      dismissToast,
      resultsFilters,
      setResultsFilters,
      dashboardFilters,
      setDashboardFilters,
      lastHouseId,
      setLastHouseId,
    }),
    [ready, loadError, houses, alerts, dataVersion, refresh, page, toasts, notify, dismissToast, resultsFilters, dashboardFilters, lastHouseId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
