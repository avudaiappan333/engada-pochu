// Insights: period totals, category breakdown, person-wise balances,
// 30-day trend, recurring-transaction detection. Pure functions.

import type { Category, Person, Period, Tx } from './types';
import { startOfDayISO, startOfMonthISO, startOfWeekISO } from './parser';

export interface Range {
  from: string | null; // inclusive ISO
  to: string | null; // exclusive ISO
}

export function periodRange(p: Period, now = new Date()): Range {
  switch (p) {
    case 'today':
      return { from: startOfDayISO(now), to: null };
    case 'week':
      return { from: startOfWeekISO(now), to: null };
    case 'month':
      return { from: startOfMonthISO(now), to: null };
    case 'prevMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        to: startOfMonthISO(now),
      };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

function inRange(t: Tx, r: Range): boolean {
  if (t.deleted_at) return false;
  const ts = t.occurred_at;
  if (r.from && ts < r.from) return false;
  if (r.to && ts >= r.to) return false;
  return true;
}

export interface Totals {
  sent: number;
  received: number;
  balance: number;
  count: number;
}

export function totalsFor(txs: Tx[], r: Range): Totals {
  let sent = 0;
  let received = 0;
  let count = 0;
  for (const t of txs) {
    if (!inRange(t, r)) continue;
    count++;
    if (t.direction === 'sent') sent += t.amount;
    else received += t.amount;
  }
  return { sent, received, balance: received - sent, count };
}

export interface CatRow {
  category_id: string | null;
  name: string;
  emoji: string | null;
  total: number;
}

/** Category breakdown of *sent* spending (categorised entries only). */
export function categoryBreakdown(txs: Tx[], cats: Category[], r: Range): CatRow[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (!inRange(t, r) || t.direction !== 'sent' || !t.category_id) continue;
    map.set(t.category_id, (map.get(t.category_id) ?? 0) + t.amount);
  }
  const rows: CatRow[] = [];
  for (const [id, total] of map) {
    const c = cats.find((x) => x.id === id);
    rows.push({
      category_id: id,
      name: c?.name ?? 'Deleted',
      emoji: c?.emoji ?? null,
      total,
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

export interface PersonRow {
  person: Person;
  sent: number;
  received: number;
  net: number; // sent - received  (positive = net paid to this person)
}

/** Person-wise balances. Direction-correct; no "owes you" claims. */
export function personWise(txs: Tx[], people: Person[], r: Range): PersonRow[] {
  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  for (const t of txs) {
    if (!inRange(t, r) || !t.person_id) continue;
    if (t.direction === 'sent') sent.set(t.person_id, (sent.get(t.person_id) ?? 0) + t.amount);
    else received.set(t.person_id, (received.get(t.person_id) ?? 0) + t.amount);
  }
  const rows: PersonRow[] = [];
  for (const p of people) {
    if (p.deleted_at) continue;
    const s = sent.get(p.id) ?? 0;
    const rc = received.get(p.id) ?? 0;
    if (s === 0 && rc === 0) continue;
    rows.push({ person: p, sent: s, received: rc, net: s - rc });
  }
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD (local)
  label: string; // e.g. "Aug 12"
  sent: number;
  received: number;
}

export function trend(txs: Tx[], days = 30, now = new Date()): TrendPoint[] {
  const out: TrendPoint[] = [];
  const start = startOfDayISO(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const fs = dayStart.toISOString();
    const fe = dayEnd.toISOString();
    let s = 0;
    let rc = 0;
    for (const t of txs) {
      if (t.deleted_at) continue;
      if (t.occurred_at >= fs && t.occurred_at < fe) {
        if (t.direction === 'sent') s += t.amount;
        else rc += t.amount;
      }
    }
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      date: key,
      label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      sent: s,
      received: rc,
    });
  }
  return out;
}

/**
 * Recurring detection: same person+category group, 3+ occurrences,
 * amounts within ±10% of the median, average gap 25–35 days.
 * Returns the set of transaction ids that are part of a detected pattern.
 * Detection ONLY — never auto-generates transactions.
 */
export function recurringTxIds(txs: Tx[]): Set<string> {
  const live = txs.filter((t) => !t.deleted_at);
  const groups = new Map<string, Tx[]>();
  for (const t of live) {
    const key = `${t.person_id ?? '∅'}|${t.category_id ?? '∅'}`;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const ids = new Set<string>();
  for (const arr of groups.values()) {
    if (arr.length < 3) continue;
    const sorted = [...arr].sort(
      (a, b) => a.occurred_at.localeCompare(b.occurred_at),
    );
    const amounts = sorted.map((t) => t.amount);
    const median = medianOf(amounts);
    if (median <= 0) continue;
    const within = amounts.every(
      (a) => Math.abs(a - median) <= median * 0.1,
    );
    if (!within) continue;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const g =
        (new Date(sorted[i].occurred_at).getTime() -
          new Date(sorted[i - 1].occurred_at).getTime()) /
        86400000;
      if (g <= 0) continue;
      gaps.push(g);
    }
    if (gaps.length === 0) continue;
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg >= 25 && avg <= 35) {
      for (const t of sorted) ids.add(t.id);
    }
  }
  return ids;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
