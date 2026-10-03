// People tab: person-wise balances (direction-correct, no "owes you" claims),
// person detail with history, rename, safe delete (transactions are kept).

import { useMemo, useState } from 'react';
import { useLedger } from './context';
import { EmptyState, Sheet, TxRow } from './components';
import { fmtINR } from '../domain/amounts';
import { personWise } from '../domain/insights';
import type { Person } from '../domain/types';

export function PeopleScreen({ onOpenTx }: { onOpenTx: (id: string) => void }) {
  const { txs, people, cats, deletePerson, pushToast } = useLedger();
  const [open, setOpen] = useState<Person | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rows = useMemo(() => personWise(txs, people, { from: null, to: null }), [txs, people]);
  const personTxs = useMemo(
    () => (open ? txs.filter((t) => t.person_id === open.id) : []),
    [txs, open],
  );

  const doRename = async () => {
    if (!open) return;
    const nm = nameDraft.trim().replace(/\s+/g, ' ');
    if (!nm) return;
    const existing = people.find(
      (p) => p.id !== open.id && !p.deleted_at && p.name.toLowerCase() === nm.toLowerCase(),
    );
    if (existing) {
      pushToast(`${existing.name} already exists.`);
      return;
    }
    const { repo } = await import('../data/repo');
    await repo.upsertPerson({ ...open, name: nm.charAt(0).toUpperCase() + nm.slice(1) });
    pushToast('Renamed ✓');
    setRenaming(false);
    setOpen({ ...open, name: nm.charAt(0).toUpperCase() + nm.slice(1) });
  };

  return (
    <div className="content">
      <div className="card">
        <h3>People</h3>
        {rows.length === 0 ? (
          <EmptyState icon="👥" title="No people yet" hint="People appear when you log transactions with a name." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.person.id} className="person-row" onClick={() => { setOpen(r.person); setRenaming(false); setConfirmDelete(false); }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{r.person.name}</div>
                  <div className="muted small">
                    Sent {fmtINR(r.sent)} · Received {fmtINR(r.received)}
                  </div>
                </div>
                <div className={`net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`} style={{ fontWeight: 800 }}>
                  {r.net === 0 ? '₹0' : fmtINR(Math.abs(r.net))}
                  <div className="muted small">{r.net > 0 ? 'net sent' : r.net < 0 ? 'net received' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          {renaming ? (
            <>
              <label className="field">
                <span>Rename person</span>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
              </label>
              <div className="muted small">Their transactions keep the new name automatically.</div>
              <div className="btn-row">
                <button className="btn" onClick={() => setRenaming(false)}>Cancel</button>
                <button className="btn primary" onClick={() => void doRename()}>Rename</button>
              </div>
            </>
          ) : (
            <>
              {personTxs.length === 0 ? (
                <EmptyState icon="📭" title="No transactions for this person" />
              ) : (
                <div className="tx-list">
                  {personTxs.slice(0, 30).map((t) => (
                    <TxRow key={t.id} t={t} people={people} cats={cats} onClick={() => { setOpen(null); onOpenTx(t.id); }} />
                  ))}
                </div>
              )}
              <div className="btn-row">
                <button
                  className="btn"
                  onClick={() => { setNameDraft(open.name); setRenaming(true); setConfirmDelete(false); }}
                >
                  Rename
                </button>
                <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                  Remove person
                </button>
              </div>
              {confirmDelete && (
                <div className="card" style={{ borderColor: 'rgba(255,84,112,0.5)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Remove {open.name}?</div>
                  <div className="muted small" style={{ marginBottom: 10 }}>
                    Their {personTxs.length} transaction(s) are NOT deleted — they stay in your ledger,
                    shown as “(deleted)”. Only the person entry is removed.
                  </div>
                  <div className="btn-row">
                    <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    <button
                      className="btn danger"
                      onClick={() => { void deletePerson(open.id); setOpen(null); }}
                    >
                      Remove person
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
