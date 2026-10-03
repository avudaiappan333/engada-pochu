import { describe, it, expect } from 'vitest';
import {
  categoryBreakdown,
  periodRange,
  personWise,
  recurringTxIds,
  totalsFor,
  trend,
} from '../src/domain/insights';
import type { Category, Person, Tx } from '../src/domain/types';

const now = new Date();
function day(offset: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

function tx(p: Partial<Tx> & { id: string }): Tx {
  return {
    user_id: 'u',
    person_id: null,
    category_id: null,
    amount: 100,
    currency: 'INR',
    direction: 'sent',
    note: null,
    source: 'manual',
    raw_speech: null,
    occurred_at: day(0),
    created_at: day(0),
    updated_at: null,
    deleted_at: null,
    ...p,
  };
}

const cats: Category[] = [
  { id: 'c1', user_id: 'u', name: 'Food', emoji: '🍔', is_builtin: true, deleted_at: null, created_at: 'x', updated_at: null },
  { id: 'c2', user_id: 'u', name: 'Rent', emoji: '🏠', is_builtin: true, deleted_at: null, created_at: 'x', updated_at: null },
];
const people: Person[] = [
  { id: 'p1', user_id: 'u', name: 'Ravi', deleted_at: null, created_at: 'x', updated_at: null },
  { id: 'p2', user_id: 'u', name: 'Priya', deleted_at: null, created_at: 'x', updated_at: null },
];

describe('totalsFor', () => {
  it('sends/receives/balance', () => {
    const txs = [
      tx({ id: 'a', amount: 500, direction: 'sent', occurred_at: day(0) }),
      tx({ id: 'b', amount: 200, direction: 'received', occurred_at: day(-1) }),
      tx({ id: 'c', amount: 100, direction: 'sent', deleted_at: day(0) }), // deleted → ignored
    ];
    const all = totalsFor(txs, periodRange('all'));
    expect(all.sent).toBe(500);
    expect(all.received).toBe(200);
    expect(all.balance).toBe(-300);
  });
  it('prevMonth excludes current month', () => {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
    const txs = [
      tx({ id: 'a', amount: 500, occurred_at: lastMonth }),
      tx({ id: 'b', amount: 700, occurred_at: day(0) }),
    ];
    const pm = totalsFor(txs, periodRange('prevMonth'));
    expect(pm.sent).toBe(500);
  });
});

describe('categoryBreakdown (sent only)', () => {
  it('sums per category and ignores received', () => {
    const txs = [
      tx({ id: 'a', amount: 300, category_id: 'c1', direction: 'sent' }),
      tx({ id: 'b', amount: 500, category_id: 'c1', direction: 'received' }),
      tx({ id: 'c', amount: 200, category_id: 'c2', direction: 'sent' }),
      tx({ id: 'd', amount: 100, direction: 'sent' }), // no category
    ];
    const rows = categoryBreakdown(txs, cats, periodRange('all'));
    expect(rows[0].name).toBe('Food');
    expect(rows[0].total).toBe(300);
    expect(rows[1].name).toBe('Rent');
    expect(rows[1].total).toBe(200);
  });
});

describe('personWise', () => {
  it('direction-correct net (spec §25)', () => {
    const txs = [
      tx({ id: 'a', person_id: 'p1', amount: 1000, direction: 'sent' }),
      tx({ id: 'b', person_id: 'p1', amount: 300, direction: 'received' }),
    ];
    const rows = personWise(txs, people, periodRange('all'));
    const ravi = rows.find((r) => r.person.id === 'p1')!;
    expect(ravi.sent).toBe(1000);
    expect(ravi.received).toBe(300);
    expect(ravi.net).toBe(700);
  });
});

describe('trend', () => {
  it('30 points ending today', () => {
    const txs = [tx({ id: 'a', amount: 100, direction: 'sent' })];
    const pts = trend(txs, 30);
    expect(pts).toHaveLength(30);
    expect(pts[29].sent).toBe(100);
    expect(pts[0].sent).toBe(0);
  });
});

describe('recurringTxIds', () => {
  it('detects ~monthly same person+category pattern', () => {
    const m1 = new Date(now); m1.setMonth(m1.getMonth() - 2);
    const m2 = new Date(now); m2.setMonth(m2.getMonth() - 1);
    const m3 = new Date(now);
    const fmt = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 5, 9).toISOString();
    const txs = [
      tx({ id: 'a', person_id: 'p1', category_id: 'c2', amount: 8000, direction: 'sent', occurred_at: fmt(m1) }),
      tx({ id: 'b', person_id: 'p1', category_id: 'c2', amount: 8000, direction: 'sent', occurred_at: fmt(m2) }),
      tx({ id: 'c', person_id: 'p1', category_id: 'c2', amount: 8000, direction: 'sent', occurred_at: fmt(m3) }),
    ];
    const ids = recurringTxIds(txs);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(true);
  });
  it('does not flag weekly patterns (not ~monthly)', () => {
    const txs = [
      tx({ id: 'a', person_id: 'p1', category_id: 'c1', amount: 500, occurred_at: day(-14) }),
      tx({ id: 'b', person_id: 'p1', category_id: 'c1', amount: 500, occurred_at: day(-7) }),
      tx({ id: 'c', person_id: 'p1', category_id: 'c1', amount: 500, occurred_at: day(0) }),
    ];
    const ids = recurringTxIds(txs);
    expect(ids.has('a')).toBe(false);
  });
  it('does not flag wildly varying amounts', () => {
    const m2 = new Date(now); m2.setMonth(m2.getMonth() - 1);
    const m3 = new Date(now);
    const fmt = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 5, 9).toISOString();
    const txs = [
      tx({ id: 'a', person_id: 'p1', category_id: 'c1', amount: 500, occurred_at: fmt(m2) }),
      tx({ id: 'b', person_id: 'p1', category_id: 'c1', amount: 500, occurred_at: fmt(m3) }),
      tx({ id: 'c', person_id: 'p1', category_id: 'c1', amount: 9000, occurred_at: day(0) }),
    ];
    const ids = recurringTxIds(txs);
    expect(ids.size).toBe(0);
  });
});
