// Confirmation card — the gate before ANY voice-sourced save.
// Every field is editable; fuzzy "Did you mean?" suggestions are opt-in;
// multiple transactions are listed together and confirmed as a batch.

import { useState } from 'react';
import { useLedger } from './context';
import { Sheet } from './components';
import { amountInWords, fmtINR } from '../domain/amounts';
import { suggestCategoryForPerson } from '../domain/categories';
import { speak } from '../voice/feedback';
import type { ParsedCandidate } from '../domain/types';
import type { MicState } from '../voice/useVoice';

interface EditRow {
  amount: number;
  direction: 'sent' | 'received';
  direction_assumed: boolean;
  person_raw: string;
  suggestion_id: string | null;
  accept_suggestion: boolean;
  category_id: string | null;
  note: string;
}

function toRows(cands: ParsedCandidate[], people: { id: string; name: string }[]): EditRow[] {
  return cands.map((c) => {
    let raw = c.person?.raw ?? '';
    let suggestion = c.person?.suggestion_id ?? null;
    // exact match collapses into the raw name (already correct)
    if (c.person?.matched_id) {
      suggestion = null;
    }
    void people;
    return {
      amount: c.amount,
      direction: c.direction,
      direction_assumed: c.direction_assumed,
      person_raw: raw,
      suggestion_id: suggestion,
      accept_suggestion: false,
      category_id: c.category?.id ?? null,
      note: '',
    };
  });
}

export function ConfirmSheet({
  cands,
  raw,
  mic,
  onCancel,
  onRetry,
  onConfirmed,
}: {
  cands: ParsedCandidate[];
  raw: string;
  mic: { state: MicState; markSaved: (summary: string) => void };
  onCancel: () => void;
  onRetry: () => void;
  onConfirmed: () => void;
}) {
  const { people, cats, txs, saveTx, upsertPerson, pushToast } = useLedger();
  const [rows, setRows] = useState<EditRow[]>(() => toRows(cands, people));
  const [busy, setBusy] = useState(false);

  const suggestionName = (r: EditRow): string | null => {
    if (!r.suggestion_id) return null;
    return people.find((p) => p.id === r.suggestion_id)?.name ?? null;
  };

  const patch = (i: number, p: Partial<EditRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const resolvePersonId = async (r: EditRow): Promise<string | null> => {
    const rawName = r.person_raw.trim();
    if (!rawName) return null;
    const exact = people.find(
      (p) => !p.deleted_at && p.name.toLowerCase() === rawName.toLowerCase(),
    );
    if (exact) return exact.id;
    if (r.suggestion_id && r.accept_suggestion) return r.suggestion_id;
    return (await upsertPerson(rawName)).id; // new person, user saw it on the card
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const savedNames: string[] = [];
      for (const r of rows) {
        if (!(r.amount > 0)) throw new Error('Amount must be a positive whole number.');
        const personId = await resolvePersonId(r);
        const person = personId
          ? people.find((p) => p.id === personId)?.name ??
            (r.suggestion_id === personId
              ? suggestionName(r)
              : r.person_raw.trim())
          : null;
        await saveTx({
          amount: r.amount,
          direction: r.direction,
          person_id: personId,
          category_id: r.category_id,
          note: r.note,
          source: 'voice',
          raw_speech: raw,
        });
        savedNames.push(
          `${r.direction === 'sent' ? 'Sent' : 'Received'} ${amountInWords(r.amount)} rupees ${person ? (r.direction === 'sent' ? 'to ' : 'from ') + person : ''}`,
        );
      }
      pushToast(`Saved ✓ ${rows.length > 1 ? rows.length + ' entries' : ''}`);
      speak(savedNames.join('. ') + '.');
      mic.markSaved(savedNames.join('; '));
      onConfirmed();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Sheet title={`New transaction${rows.length > 1 ? ` ×${rows.length}` : ''}`} onClose={onCancel}>
      <div className="muted small">Heard: “{raw}”</div>
      {rows.map((r, i) => {
        const sug = suggestionName(r);
        const personSuggestion = rows.length === 1
          ? suggestCategoryForPerson(
              rows[0].suggestion_id && rows[0].accept_suggestion ? rows[0].suggestion_id : null,
              txs,
              cats,
            )
          : null;
        void i;
        return (
          <div key={i} className="card" style={{ border: '1px solid var(--line)' }}>
            {rows.length > 1 && (
              <div className="muted small" style={{ marginBottom: 8 }}>Entry {i + 1}</div>
            )}
            <div className="field-row">
              <label className="field">
                <span>Amount (₹)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={String(r.amount)}
                  onChange={(e) => patch(i, { amount: Math.round(Number(e.target.value) || 0) })}
                />
              </label>
              <div className="segment" style={{ alignSelf: 'flex-end' }}>
                <button className={`on sent ${r.direction === 'sent' ? '' : 'off'}`} onClick={() => patch(i, { direction: 'sent' })}>Sent</button>
                <button className={`on received ${r.direction === 'received' ? '' : 'off'}`} onClick={() => patch(i, { direction: 'received' })}>Received</button>
              </div>
            </div>
            {r.direction_assumed && (
              <div className="muted small" style={{ marginTop: 6 }}>
                Direction wasn’t clear — defaulted to {r.direction}. Tap to change if wrong.
              </div>
            )}
            <label className="field" style={{ marginTop: 10 }}>
              <span>Person {r.suggestion_id ? '' : '(leave empty for none)'}</span>
              <input
                list={`people-dl-${i}`}
                value={r.person_raw}
                onChange={(e) => patch(i, { person_raw: e.target.value })}
              />
              <datalist id={`people-dl-${i}`}>
                {people.filter((p) => !p.deleted_at).map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            {sug && (
              <button
                className="suggestion-chip"
                onClick={() => patch(i, { person_raw: sug, accept_suggestion: true, suggestion_id: null })}
              >
                Did you mean {sug}? ✓
              </button>
            )}
            <label className="field" style={{ marginTop: 10 }}>
              <span>Category</span>
              <select
                value={r.category_id ?? ''}
                onChange={(e) => patch(i, { category_id: e.target.value || null })}
              >
                <option value="">No category</option>
                {cats.filter((c) => !c.deleted_at).map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji ?? ''} {c.name}</option>
                ))}
              </select>
            </label>
            {personSuggestion && (
              <button
                className="suggestion-chip"
                style={{ alignSelf: 'flex-start', marginTop: 6 }}
                onClick={() => rows.length === 1 && patch(0, { category_id: personSuggestion.id })}
              >
                Suggest: {personSuggestion.emoji ?? ''} {personSuggestion.name} (from your history)
              </button>
            )}
            <label className="field" style={{ marginTop: 10 }}>
              <span>Note (optional)</span>
              <input value={r.note} onChange={(e) => patch(i, { note: e.target.value })} />
            </label>
          </div>
        );
      })}
      <div className="btn-row">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn" onClick={onRetry} disabled={busy}>Retry 🎙</button>
        <button className="btn primary" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Saving…' : `Confirm ${rows.length > 1 ? rows.length : ''}`}
        </button>
      </div>
      {rows.length === 1 && (
        <div className="muted small" style={{ textAlign: 'center' }}>
          Total: {fmtINR(rows.reduce((a, r) => a + (r.amount || 0), 0))}
        </div>
      )}
    </Sheet>
  );
}
