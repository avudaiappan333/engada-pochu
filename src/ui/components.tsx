// Shared UI bits: icons, transaction rows, people lookup, date formatting.

import type { ReactNode } from 'react';
import type { Category, Person, Tx } from '../domain/types';
import { fmtINR } from '../domain/amounts';

export function MicIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"
        fill="#fff"
      />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M12 17.5V21" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Icon({ name }: { name: 'home' | 'list' | 'people' | 'insights' | 'gear' | 'plus' | 'back' | 'trash' | 'edit' | 'check' }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>;
    case 'list':
      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>;
    case 'people':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><circle cx="17.5" cy="9.5" r="2.5" /><path d="M16.5 15.2c2.6.3 4.5 1.9 5 4.3" /></svg>;
    case 'insights':
      return <svg {...common}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>;
    case 'gear':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'back':
      return <svg {...common}><path d="M15 5l-7 7 7 7" /></svg>;
    case 'trash':
      return <svg {...common}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 14h10l1-14" /></svg>;
    case 'edit':
      return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>;
    case 'check':
      return <svg {...common}><path d="M4 12.5 9.5 18 20 6" /></svg>;
  }
}

/** Local datetime → value for <input type="datetime-local"> (no timezone drift). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function personName(t: Tx, people: Person[]): string {
  if (!t.person_id) return '— no person —';
  const p = people.find((x) => x.id === t.person_id);
  if (!p) return 'Unknown';
  return p.deleted_at ? `${p.name} (deleted)` : p.name;
}

export function catLabel(t: Tx, cats: Category[]): string {
  if (!t.category_id) return 'No category';
  const c = cats.find((x) => x.id === t.category_id);
  if (!c) return 'Deleted category';
  return c.deleted_at ? `${c.name} (deleted)` : `${c.emoji ?? ''} ${c.name}`.trim();
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ` ${time}`;
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TxRow({
  t,
  people,
  cats,
  recurring,
  onClick,
}: {
  t: Tx;
  people: Person[];
  cats: Category[];
  recurring?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="tx-row" onClick={onClick} role="button" tabIndex={0}>
      <div className={`tx-dir ${t.direction}`}>{t.direction === 'sent' ? '↗' : '↙'}</div>
      <div className="tx-main">
        <div className="tx-person">
          {personName(t, people)}
          {t.source === 'voice' && <span className="tx-badge">🎙 voice</span>}
          {recurring && <span className="tx-badge recurring">recurring?</span>}
        </div>
        <div className="tx-sub">
          {fmtWhen(t.occurred_at)} · {catLabel(t, cats)}
        </div>
      </div>
      <div className={`tx-amt ${t.direction}`}>
        {t.direction === 'sent' ? '−' : '+'}
        {fmtINR(t.amount)}
      </div>
    </div>
  );
}

export function EmptyState({ icon = '🪙', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div>{title}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function SyncPill({ state, pending, cloud }: { state: string; pending: number; cloud: boolean }) {
  if (!cloud) return <span className="sync-pill">Local only</span>;
  if (state === 'synced') return <span className="sync-pill ok">Synced ✓</span>;
  if (state === 'offline') return <span className="sync-pill offline">Offline</span>;
  if (state === 'syncing') return <span className="sync-pill pending">Syncing…</span>;
  return <span className="sync-pill pending">{pending} pending</span>;
}
