// App state: local data (with live reload), filters, sync status, toasts,
// and the §22 rule — every save clears active filters first.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { repo, newId } from '../data/repo';
import { syncEngine, type SyncStatus } from '../data/sync';
import { CLOUD_ENABLED } from '../data/config';
import { haptic } from '../voice/feedback';
import {
  EMPTY_FILTER,
  type Category,
  type Person,
  type QueryFilter,
  type Source,
  type Tx,
} from '../domain/types';

export interface Toast {
  id: string;
  msg: string;
  action?: { label: string; fn: () => void };
}

export interface TxInput {
  id?: string;
  amount: number;
  direction: 'sent' | 'received';
  person_id: string | null;
  category_id: string | null;
  note?: string | null;
  source: Source;
  raw_speech?: string | null;
  occurred_at?: string;
}

interface LedgerCtx {
  ready: boolean;
  cloud: boolean;
  txs: Tx[];
  filtered: Tx[];
  people: Person[];
  cats: Category[];
  sync: SyncStatus;
  filters: QueryFilter;
  setFilters: (f: QueryFilter) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  saveTx: (input: TxInput) => Promise<Tx>;
  updateTx: (id: string, patch: Partial<Omit<Tx, 'id' | 'user_id'>>) => Promise<Tx>;
  deleteWithUndo: (id: string) => Promise<void>;
  upsertPerson: (name: string) => Promise<Person>;
  deletePerson: (id: string) => Promise<void>;
  addCategory: (name: string, emoji?: string) => Promise<Category>;
  pushToast: (msg: string, opts?: { action?: Toast['action']; duration?: number }) => void;
}

const Ctx = createContext<LedgerCtx | null>(null);

export function useLedger(): LedgerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger outside provider');
  return v;
}

export function applyFilters(
  txs: Tx[],
  f: QueryFilter,
  people: Person[],
  cats: Category[],
): Tx[] {
  const q = f.search.trim().toLowerCase();
  const pName = (id: string | null) =>
    id ? people.find((p) => p.id === id)?.name.toLowerCase() ?? '' : '';
  const cName = (id: string | null) =>
    id ? cats.find((c) => c.id === id)?.name.toLowerCase() ?? '' : '';
  return txs.filter((t) => {
    if (t.deleted_at) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.person_id && t.person_id !== f.person_id) return false;
    if (f.category_id && t.category_id !== f.category_id) return false;
    if (f.from && t.occurred_at < f.from) return false;
    if (f.to && t.occurred_at >= f.to) return false;
    if (f.amount_min != null && t.amount < f.amount_min) return false;
    if (f.amount_max != null && t.amount > f.amount_max) return false;
    if (q) {
      const hay = `${pName(t.person_id)} ${cName(t.category_id)} ${t.note ?? ''} ${t.amount} ${t.direction} ${t.raw_speech ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncStatus>(syncEngine.getSnapshot());
  const [filters, setFilters] = useState<QueryFilter>(EMPTY_FILTER);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let on = true;
    const load = async () => {
      const [t, p, c] = await Promise.all([
        repo.listTransactions(),
        repo.listPeople(),
        repo.listCategories(),
      ]);
      if (!on) return;
      setTxs(t);
      setPeople(p);
      setCats(c);
      setReady(true);
    };
    void load();
    const un1 = repo.subscribe(() => void load());
    const un2 = syncEngine.subscribe(setSync);
    syncEngine.start();
    return () => {
      on = false;
      un1();
      un2();
    };
  }, []);

  const pushToast = useCallback(
    (msg: string, opts?: { action?: Toast['action']; duration?: number }) => {
      const id = newId();
      setToasts((ts) => [...ts, { id, msg, action: opts?.action }]);
      window.setTimeout(
        () => setToasts((ts) => ts.filter((t) => t.id !== id)),
        opts?.duration ?? 6000,
      );
    },
    [],
  );

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTER), []);

  const saveTx = useCallback(
    async (input: TxInput): Promise<Tx> => {
      setFilters(EMPTY_FILTER); // §22: clear filters on every save
      const existing = input.id ? await repo.getTransaction(input.id) : undefined;
      const row: Tx = {
        id: input.id ?? newId(),
        user_id: repo.userId,
        person_id: input.person_id ?? null,
        category_id: input.category_id ?? null,
        amount: Math.round(input.amount),
        currency: 'INR',
        direction: input.direction,
        note: input.note?.trim() || null,
        source: input.source,
        raw_speech: input.raw_speech ?? null,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: null,
        deleted_at: null,
      };
      haptic('strong');
      return repo.saveTransaction(row);
    },
    [],
  );

  const updateTx = useCallback(
    async (id: string, patch: Partial<Omit<Tx, 'id' | 'user_id'>>): Promise<Tx> => {
      const cur = await repo.getTransaction(id);
      if (!cur) throw new Error('Transaction not found');
      return repo.saveTransaction({ ...cur, ...patch, id, user_id: repo.userId });
    },
    [],
  );

  const deleteWithUndo = useCallback(
    async (id: string) => {
      const t = await repo.getTransaction(id);
      if (!t || t.deleted_at) return;
      await repo.softDeleteTransaction(id);
      haptic('strong');
      pushToast('Entry deleted', {
        action: {
          label: 'Undo',
          fn: () => {
            // restore with all original fields
            void repo.saveTransaction({ ...t, deleted_at: null }).then(() =>
              pushToast('Restored'),
            );
          },
        },
        duration: 6000,
      });
    },
    [pushToast],
  );

  const upsertPerson = useCallback(async (name: string): Promise<Person> => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    const clean = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    const existing = (await repo.listPeople()).find(
      (p) => !p.deleted_at && p.name.toLowerCase() === clean.toLowerCase(),
    );
    if (existing) return existing;
    return repo.upsertPerson({
      id: newId(),
      user_id: repo.userId,
      name: clean,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    });
  }, []);

  const deletePerson = useCallback(async (id: string) => {
    await repo.softDeletePerson(id);
    pushToast('Person removed. Their transactions are kept.');
  }, [pushToast]);

  const addCategory = useCallback(
    async (name: string, emoji?: string) => {
      const clean = name.trim().replace(/\s+/g, ' ');
      const existing = (await repo.listCategories()).find(
        (c) => !c.deleted_at && c.name.toLowerCase() === clean.toLowerCase(),
      );
      if (existing) return existing;
      return repo.upsertCategory({
        id: newId(),
        user_id: repo.userId,
        name: clean,
        emoji: emoji ?? null,
        is_builtin: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      });
    },
    [],
  );

  const filtered = useMemo(
    () => applyFilters(txs, filters, people, cats),
    [txs, filters, people, cats],
  );

  const hasActiveFilters = useMemo(
    () =>
      filters.search.trim() !== '' ||
      filters.direction !== null ||
      filters.person_id !== null ||
      filters.category_id !== null ||
      filters.from !== null ||
      filters.to !== null ||
      filters.amount_min !== null ||
      filters.amount_max !== null,
    [filters],
  );

  const value: LedgerCtx = {
    ready,
    cloud: CLOUD_ENABLED,
    txs,
    filtered,
    people,
    cats,
    sync,
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    saveTx,
    updateTx,
    deleteWithUndo,
    upsertPerson,
    deletePerson,
    addCategory,
    pushToast,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                className="undo"
                onClick={() => {
                  t.action?.fn();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
