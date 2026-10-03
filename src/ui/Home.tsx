// Home tab: dashboard totals (always visible), mic hero, recent transactions.

import { useMemo } from 'react';
import { useLedger } from './context';
import { EmptyState, Icon, MicIcon, TxRow } from './components';
import { fmtINR } from '../domain/amounts';
import { recurringTxIds } from '../domain/insights';
import type { MicState } from '../voice/useVoice';

export function HomeScreen({
  mic,
  onOpenMic,
  onOpenManual,
  onOpenTx,
  onGoList,
}: {
  mic: { state: MicState; partial: string; error: string | null; supported: boolean };
  onOpenMic: () => void;
  onOpenManual: () => void;
  onOpenTx: (id: string) => void;
  onGoList: () => void;
}) {
  const { txs, people, cats, filtered, clearFilters, hasActiveFilters } = useLedger();
  const totals = useMemo(() => {
    let sent = 0;
    let received = 0;
    for (const t of txs) {
      if (t.deleted_at) continue;
      if (t.direction === 'sent') sent += t.amount;
      else received += t.amount;
    }
    return { sent, received, balance: received - sent };
  }, [txs]);
  const recurring = useMemo(() => recurringTxIds(txs), [txs]);
  const recent = useMemo(() => (hasActiveFilters ? filtered : txs).slice(0, 10), [txs, filtered, hasActiveFilters]);

  const stateLabel: Record<MicState, string> = {
    idle: 'Tap the mic and speak, e.g. “sent 500 to Ravi”',
    listening: 'Listening… (tap again to stop)',
    processing: 'Understanding…',
    confirming: 'Review the confirmation card',
    saved: 'Saved ✓',
    error: mic.error ?? 'Something went wrong',
  };

  return (
    <div className="content">
      <div className="totals">
        <div className="total-card sent">
          <div className="label">Sent</div>
          <div className="value">{fmtINR(totals.sent)}</div>
        </div>
        <div className="total-card received">
          <div className="label">Received</div>
          <div className="value">{fmtINR(totals.received)}</div>
        </div>
        <div className={`total-card balance ${totals.balance < 0 ? 'negative' : ''}`}>
          <div className="label">Balance</div>
          <div className="value">{fmtINR(totals.balance)}</div>
        </div>
      </div>

      <div className="card mic-hero">
        <button
          className={`mic-btn ${mic.state === 'listening' ? 'listening' : ''} ${mic.state === 'saved' ? 'saved' : ''}`}
          onClick={onOpenMic}
          aria-label="Voice input"
        >
          {mic.state === 'saved' ? <Icon name="check" /> : <MicIcon />}
        </button>
        <div className={`mic-state ${mic.state === 'error' ? 'error' : ''}`}>{stateLabel[mic.state]}</div>
        {mic.state === 'listening' && (
          <div className="transcript">{mic.partial || '…'}</div>
        )}
        {mic.state === 'listening' && (
          <div className="mic-actions">
            <button className="btn small" onClick={onOpenMic}>Stop</button>
          </div>
        )}
        {mic.state === 'error' && (
          <div className="mic-actions">
            <button className="btn small primary" onClick={onOpenMic}>Retry</button>
            <button className="btn small" onClick={onOpenManual}>Enter manually</button>
          </div>
        )}
        {!mic.supported && (
          <div className="muted small">
            Voice isn’t supported in this browser — use manual entry or the Android app.
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>
            {hasActiveFilters ? 'Filtered (last 10)' : 'Recent'}
          </h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {hasActiveFilters && (
              <button className="btn small" onClick={clearFilters}>Clear filters</button>
            )}
            <button className="btn small primary" onClick={onGoList}>All →</button>
          </div>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon="🎙️"
            title="Nothing here yet"
            hint="Say “sent 500 to Ravi” or tap + to add your first entry."
          />
        ) : (
          <div className="tx-list">
            {recent.map((t) => (
              <TxRow key={t.id} t={t} people={people} cats={cats} recurring={recurring.has(t.id)} onClick={() => onOpenTx(t.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
