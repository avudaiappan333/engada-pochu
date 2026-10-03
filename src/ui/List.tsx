// Transactions tab: search, filters, full list, and detail/edit/delete.

import { useMemo, useState } from 'react';
import { useLedger } from './context';
import { catLabel, EmptyState, personName, Sheet, toLocalInput, TxRow } from './components';
import { fmtINR } from '../domain/amounts';
import { startOfDayISO, startOfMonthISO, startOfWeekISO } from '../domain/parser';
import { EMPTY_FILTER, type QueryFilter, type Tx } from '../domain/types';

const PERIODS: { id: string; label: string; apply: (f: QueryFilter) => Partial<QueryFilter> }[] = [
  { id: 'all', label: 'All', apply: () => ({ from: null, to: null }) },
  { id: 'today', label: 'Today', apply: () => ({ from: startOfDayISO(new Date()), to: null }) },
  { id: 'week', label: 'This week', apply: () => ({ from: startOfWeekISO(new Date()), to: null }) },
  { id: 'month', label: 'This month', apply: () => ({ from: startOfMonthISO(new Date()), to: null }) },
];

export function ListScreen({
  onOpenTx,
  onBack,
}: {
  onOpenTx: (id: string) => void;
  onBack: () => void;
}) {
  const { filtered, people, cats, filters, setFilters, clearFilters, hasActiveFilters } = useLedger();

  const periodActive = useMemo(() => {
    const now = new Date();
    if (filters.from === startOfDayISO(now)) return 'today';
    if (filters.from === startOfWeekISO(now)) return 'week';
    if (filters.from === startOfMonthISO(now)) return 'month';
    if (!filters.from && !filters.to) return 'all';
    return '';
  }, [filters]);

  return (
    <div className="content">
      <div className="card">
        <input
          placeholder="Search person, amount, note…"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <div className="chip-row" style={{ marginTop: 10 }}>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className={`chip ${periodActive === p.id ? 'on' : ''}`}
              onClick={() => setFilters({ ...filters, ...p.apply(filters) })}
            >
              {p.label}
            </button>
          ))}
          <button
            className={`chip ${filters.direction === 'sent' ? 'on' : ''}`}
            onClick={() => setFilters({ ...filters, direction: filters.direction === 'sent' ? null : 'sent' })}
          >
            Sent
          </button>
          <button
            className={`chip ${filters.direction === 'received' ? 'on' : ''}`}
            onClick={() => setFilters({ ...filters, direction: filters.direction === 'received' ? null : 'received' })}
          >
            Received
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <select
            value={filters.person_id ?? ''}
            onChange={(e) => setFilters({ ...filters, person_id: e.target.value || null })}
            style={{ flex: 1 }}
          >
            <option value="">All people</option>
            {people.filter((p) => !p.deleted_at).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filters.category_id ?? ''}
            onChange={(e) => setFilters({ ...filters, category_id: e.target.value || null })}
            style={{ flex: 1 }}
          >
            <option value="">All categories</option>
            {cats.filter((c) => !c.deleted_at).map((c) => (
              <option key={c.id} value={c.id}>{c.emoji ?? ''} {c.name}</option>
            ))}
          </select>
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <input
            type="number"
            min={0}
            placeholder="Min ₹"
            value={filters.amount_min ?? ''}
            onChange={(e) => setFilters({ ...filters, amount_min: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <input
            type="number"
            min={0}
            placeholder="Max ₹"
            value={filters.amount_max ?? ''}
            onChange={(e) => setFilters({ ...filters, amount_max: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        {hasActiveFilters && (
          <button className="btn small" style={{ marginTop: 10 }} onClick={clearFilters}>
            ✕ Clear all filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={hasActiveFilters ? '🔍' : '📭'}
          title={hasActiveFilters ? 'No transactions match these filters' : 'No transactions yet'}
          hint={hasActiveFilters ? 'Try clearing a filter.' : 'Your entries will appear here.'}
        />
      ) : (
        <div className="tx-list">
          {filtered.map((t) => (
            <TxRow key={t.id} t={t} people={people} cats={cats} onClick={() => onOpenTx(t.id)} />
          ))}
        </div>
      )}
      <button className="btn ghost" onClick={onBack}>← Back to Home</button>
    </div>
  );
}

export function DetailSheet({
  tx,
  onClose,
}: {
  tx: Tx;
  onClose: () => void;
}) {
  const { people, cats, updateTx, deleteWithUndo, pushToast, upsertPerson, addCategory } = useLedger();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(tx.amount));
  const [direction, setDirection] = useState(tx.direction);
  const [personText, setPersonText] = useState(
    tx.person_id ? personName(tx, people) : '',
  );
  const [categoryId, setCategoryId] = useState(tx.category_id ?? '');
  const [newCatName, setNewCatName] = useState('');
  const [note, setNote] = useState(tx.note ?? '');
  const [occurred, setOccurred] = useState(toLocalInput(new Date(tx.occurred_at)));

  const save = async () => {
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      pushToast('Enter a valid whole-rupee amount.');
      return;
    }
    let personId: string | null = null;
    const pt = personText.trim();
    if (pt && !pt.includes('(deleted)')) {
      const existing = people.find(
        (p) => !p.deleted_at && p.name.toLowerCase() === pt.toLowerCase(),
      );
      personId = existing?.id ?? (await upsertPerson(pt)).id;
    }
    let catId: string | null = null;
    if (categoryId === '__new__' && newCatName.trim()) {
      catId = (await addCategory(newCatName.trim())).id;
    } else if (categoryId) {
      catId = categoryId;
    }
    await updateTx(tx.id, {
      amount: amt,
      direction,
      person_id: personId,
      category_id: catId,
      note: note.trim() || null,
      occurred_at: new Date(occurred).toISOString(),
    });
    pushToast('Updated ✓');
    setEditing(false);
  };

  const del = async () => {
    await deleteWithUndo(tx.id);
    onClose();
  };

  if (!editing) {
    return (
      <Sheet title="Transaction" onClose={onClose}>
        <div className="total-card" style={{ textAlign: 'center' }}>
          <div className={`tx-amt ${tx.direction}`} style={{ fontSize: '1.6rem' }}>
            {tx.direction === 'sent' ? '−' : '+'}{fmtINR(tx.amount)}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {tx.direction === 'sent' ? 'Sent' : 'Received'} · {fmtWhenLocal(tx.occurred_at)}
          </div>
        </div>
        <div className="setting-row"><span className="muted">Person</span><b>{personName(tx, people)}</b></div>
        <div className="setting-row"><span className="muted">Category</span><b>{catLabel(tx, cats)}</b></div>
        {tx.note && <div className="setting-row"><span className="muted">Note</span><b>{tx.note}</b></div>}
        <div className="setting-row"><span className="muted">Source</span><b>{tx.source === 'voice' ? '🎙 voice' : 'manual'}</b></div>
        {tx.raw_speech && (
          <div className="setting-row"><span className="muted">Heard</span><b className="small">“{tx.raw_speech}”</b></div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={() => setEditing(true)}>✏️ Edit</button>
          <button className="btn danger" onClick={() => void del()}>🗑 Delete</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      <label className="field">
        <span>Amount (₹, whole rupees)</span>
        <input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="segment">
        <button className={`on sent ${direction === 'sent' ? '' : 'off'}`} onClick={() => setDirection('sent')}>Sent</button>
        <button className={`on received ${direction === 'received' ? '' : 'off'}`} onClick={() => setDirection('received')}>Received</button>
      </div>
      <label className="field">
        <span>Person (leave empty for none)</span>
        <input list="people-dl" value={personText} onChange={(e) => setPersonText(e.target.value)} />
        <datalist id="people-dl">
          {people.filter((p) => !p.deleted_at).map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {cats.filter((c) => !c.deleted_at).map((c) => (
            <option key={c.id} value={c.id}>{c.emoji ?? ''} {c.name}</option>
          ))}
          <option value="__new__">+ New category…</option>
        </select>
      </label>
      {categoryId === '__new__' && (
        <label className="field">
          <span>New category name</span>
          <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="e.g. Groceries" />
        </label>
      )}
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      <label className="field">
        <span>Date & time</span>
        <input type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
      </label>
      <div className="btn-row">
        <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn primary" onClick={() => void save()}>Save changes</button>
      </div>
    </Sheet>
  );
}

function fmtWhenLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
