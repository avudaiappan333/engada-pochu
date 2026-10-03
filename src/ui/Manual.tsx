// Manual entry — the always-available fallback (no mic, noisy place,
// unsupported browser).

import { useState } from 'react';
import { useLedger } from './context';
import { Sheet, toLocalInput } from './components';

export function ManualSheet({ onClose }: { onClose: () => void }) {
  const { people, cats, saveTx, upsertPerson, addCategory, pushToast } = useLedger();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'sent' | 'received'>('sent');
  const [personText, setPersonText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [note, setNote] = useState('');
  const [occurred, setOccurred] = useState(toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      pushToast('Enter a valid whole-rupee amount.');
      return;
    }
    setBusy(true);
    try {
      let personId: string | null = null;
      const pt = personText.trim();
      if (pt) {
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
      await saveTx({
        amount: amt,
        direction,
        person_id: personId,
        category_id: catId,
        note: note.trim() || null,
        source: 'manual',
        occurred_at: new Date(occurred).toISOString(),
      });
      pushToast('Saved ✓');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add manually" onClose={onClose}>
      <div className="field-row">
        <label className="field">
          <span>Amount (₹, whole rupees)</span>
          <input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
        </label>
        <div className="segment" style={{ alignSelf: 'flex-end' }}>
          <button className={`on sent ${direction === 'sent' ? '' : 'off'}`} onClick={() => setDirection('sent')}>Sent</button>
          <button className={`on received ${direction === 'received' ? '' : 'off'}`} onClick={() => setDirection('received')}>Received</button>
        </div>
      </div>
      <label className="field">
        <span>Person (leave empty for none)</span>
        <input list="manual-people" value={personText} onChange={(e) => setPersonText(e.target.value)} placeholder="e.g. Ravi" />
        <datalist id="manual-people">
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
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span>Date & time</span>
        <input type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
      </label>
      <div className="btn-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Sheet>
  );
}
