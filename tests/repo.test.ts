// Data layer tests against fake-indexeddb (mirrors the real IndexedDB API).
// Covers: persistence across "reopens", delete+undo restore, outbox behaviour,
// export/import with skip-existing conflict rule.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCSV,
  buildExport,
  newId,
  previewImport,
  repo,
} from '../src/data/repo';
import type { Category, Person, Tx } from '../src/domain/types';

function person(name: string): Person {
  return {
    id: newId(),
    user_id: 'u',
    name,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
}

function cat(name: string): Category {
  return {
    id: newId(),
    user_id: 'u',
    name,
    emoji: null,
    is_builtin: true,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
}

async function mkTx(p: Partial<Tx> = {}): Promise<Tx> {
  const t: Tx = {
    id: newId(),
    user_id: 'u',
    person_id: null,
    category_id: null,
    amount: 500,
    currency: 'INR',
    direction: 'sent',
    note: null,
    source: 'manual',
    raw_speech: null,
    occurred_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: null,
    deleted_at: null,
    ...p,
  };
  return repo.saveTransaction(t);
}

beforeEach(async () => {
  repo.bindUser('u');
  await repo.clearAllForUser();
});

describe('persistence (save → reload, spec §42)', () => {
  it('transactions survive a "reopen" (fresh reads from the store)', async () => {
    await mkTx({ amount: 500 });
    await mkTx({ amount: 300, direction: 'received' });
    const all = await repo.listTransactions();
    expect(all).toHaveLength(2);
    // simulate a second load (like reopening the app)
    const again = await repo.listTransactions();
    expect(again).toHaveLength(2);
    const sent = again.filter((t) => t.direction === 'sent').reduce((a, t) => a + t.amount, 0);
    expect(sent).toBe(500);
  });
});

describe('delete + undo (spec §18)', () => {
  it('soft delete hides the row; restore preserves original fields', async () => {
    const original = await mkTx({ amount: 777, note: 'keep me' });
    await repo.softDeleteTransaction(original.id);
    const visible = await repo.listTransactions();
    expect(visible.find((t) => t.id === original.id)?.deleted_at).toBeTruthy();

    // undo: save the original row back (deleted_at null, original fields)
    const restored = await repo.saveTransaction({ ...original, deleted_at: null });
    expect(restored.amount).toBe(777);
    expect(restored.note).toBe('keep me');
    expect(restored.created_at).toBe(original.created_at);
    const t = (await repo.getTransaction(original.id))!;
    expect(t.deleted_at).toBeNull();
  });
});

describe('outbox (sync queue)', () => {
  it('each write queues an op; ack removes it', async () => {
    const t = await mkTx();
    const p = await repo.upsertPerson(person('Ravi'));
    const c = await repo.upsertCategory(cat('Food'));
    const ops = await repo.outboxList();
    expect(ops).toHaveLength(3);
    expect(ops.map((o) => o.kind).sort()).toEqual([
      'categories',
      'people',
      'transactions',
    ]);
    await repo.outboxAck([`transactions:${t.id}`, `people:${p.id}`, `categories:${c.id}`]);
    expect(await repo.outboxList()).toHaveLength(0);
  });
});

describe('people: rename + safe delete', () => {
  it('rename keeps transactions attached', async () => {
    const p = await repo.upsertPerson(person('Ravi'));
    const t = await mkTx({ person_id: p.id, amount: 100 });
    await repo.upsertPerson({ ...p, name: 'Ravindra' });
    const p2 = (await repo.listPeople()).find((x) => x.id === p.id)!;
    expect(p2.name).toBe('Ravindra');
    expect((await repo.getTransaction(t.id))!.person_id).toBe(p.id);
  });
  it('safe delete removes person, keeps transactions', async () => {
    const p = await repo.upsertPerson(person('Ravi'));
    const t = await mkTx({ person_id: p.id });
    await repo.softDeletePerson(p.id);
    const p2 = (await repo.listPeople()).find((x) => x.id === p.id)!;
    expect(p2.deleted_at).toBeTruthy();
    expect((await repo.getTransaction(t.id))!.deleted_at).toBeNull();
  });
});

describe('import/export (spec §17, skip-existing)', () => {
  it('export bundle contains live data only', async () => {
    const p = await repo.upsertPerson(person('Ravi'));
    await mkTx({ person_id: p.id, amount: 500 });
    await mkTx({ amount: 100, deleted_at: new Date().toISOString() });
    const bundle = buildExport(
      await repo.listTransactions(),
      await repo.listPeople(),
      await repo.listCategories(),
    );
    expect(bundle.app).toBe('engada-pochu');
    expect(bundle.transactions).toHaveLength(1);
    expect(bundle.people).toHaveLength(1);
  });

  it('CSV has a header and one row per live transaction', async () => {
    const p = await repo.upsertPerson(person('Ravi'));
    await mkTx({ person_id: p.id, amount: 500 });
    const csv = buildCSV(
      await repo.listTransactions(),
      await repo.listPeople(),
      await repo.listCategories(),
    );
    const lines = csv.split('\n');
    expect(lines[0]).toContain('occurred_at');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Ravi');
  });

  it('preview: existing skipped, new added, invalid counted', async () => {
    const existing = await mkTx({ amount: 500, occurred_at: '2026-09-01T10:00:00.000Z' });
    const bundle = {
      app: 'engada-pochu',
      version: 1,
      exported_at: 'x',
      people: [],
      categories: [],
      transactions: [
        // duplicate by id → skip
        { ...existing },
        // duplicate by signature → skip
        {
          ...existing,
          id: newId(),
          person_id: null,
          category_id: null,
          note: null,
          raw_speech: null,
        },
        // genuinely new → add
        {
          ...existing,
          id: newId(),
          amount: 250,
          occurred_at: '2026-09-02T10:00:00.000Z',
        },
        // invalid (no id)
        { amount: 10 } as Tx,
      ],
    };
    const res = previewImport(
      bundle,
      await repo.listTransactions(),
      await repo.listPeople(),
      await repo.listCategories(),
    );
    expect(res.ok).toBe(true);
    expect(res.preview.valid).toBe(3);
    expect(res.preview.invalid).toBe(1);
    expect(res.preview.willAdd).toBe(1);
    expect(res.preview.willSkip).toBe(2);
  });

  it('rejects non-backup JSON', async () => {
    const res = previewImport({ hello: 'world' }, [], [], []);
    expect(res.ok).toBe(false);
  });
});
