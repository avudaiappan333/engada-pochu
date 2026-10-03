// Insights tab: period totals, category breakdown, 30-day trend,
// recurring-transaction badges. Detection only — nothing auto-generated.

import { useMemo, useState } from 'react';
import { useLedger } from './context';
import { EmptyState, TxRow } from './components';
import { fmtINR } from '../domain/amounts';
import {
  categoryBreakdown,
  periodRange,
  recurringTxIds,
  totalsFor,
  trend,
} from '../domain/insights';
import type { Period } from '../domain/types';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'prevMonth', label: 'Last month' },
];

export function InsightsScreen({ onOpenTx }: { onOpenTx: (id: string) => void }) {
  const { txs, people, cats } = useLedger();
  const [period, setPeriod] = useState<Period>('month');

  const range = useMemo(() => periodRange(period), [period]);
  const totals = useMemo(() => totalsFor(txs, range), [txs, range]);
  const catsRows = useMemo(() => categoryBreakdown(txs, cats, range), [txs, cats, range]);
  const points = useMemo(() => trend(txs, 30), [txs]);
  const recurring = useMemo(() => recurringTxIds(txs), [txs]);
  const maxBar = useMemo(
    () => Math.max(1, ...points.map((p) => Math.max(p.sent, p.received))),
    [points],
  );
  const maxCat = catsRows.length ? catsRows[0].total : 1;
  const recurringTxs = useMemo(
    () => txs.filter((t) => recurring.has(t.id)).slice(0, 6),
    [txs, recurring],
  );

  return (
    <div className="content">
      <div className="chip-row">
        {PERIODS.map((p) => (
          <button key={p.id} className={`chip ${period === p.id ? 'on' : ''}`} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

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
          <div className="label">Net</div>
          <div className="value">{fmtINR(totals.balance)}</div>
        </div>
      </div>

      <div className="card">
        <h3>Spending by category {period === 'all' ? '' : `(sent only)`}</h3>
        {catsRows.length === 0 ? (
          <EmptyState icon="📊" title="No categorised spending in this period" />
        ) : (
          catsRows.map((r) => (
            <div className="bar-row" key={r.category_id ?? 'x'}>
              <span className="muted">{r.emoji ?? ''} {r.name}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.max(4, (r.total / maxCat) * 100)}%` }} />
              </div>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmtINR(r.total)}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>Last 30 days</h3>
        <div className="trend">
          {points.map((p) => (
            <div className="col" key={p.date} title={`${p.label}: sent ${fmtINR(p.sent)}, received ${fmtINR(p.received)}`}>
              <div className="bar" style={{ height: `${(p.sent / maxBar) * 100}%`, minHeight: p.sent ? 2 : 0 }} />
              <div className="bar recv" style={{ height: `${(p.received / maxBar) * 100}%`, minHeight: p.received ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="trend-labels">
          <span>{points[0]?.label}</span>
          <span>purple = sent · cyan = received</span>
          <span>{points[points.length - 1]?.label}</span>
        </div>
      </div>

      <div className="card">
        <h3>Possible recurring</h3>
        {recurringTxs.length === 0 ? (
          <div className="muted small">
            No repeating patterns detected yet (needs 3+ similar entries ~monthly).
            Detection only — the app never creates entries for you.
          </div>
        ) : (
          <div className="tx-list">
            {recurringTxs.map((t) => (
              <TxRow key={t.id} t={t} people={people} cats={cats} recurring onClick={() => onOpenTx(t.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
