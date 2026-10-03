// Local-first repository. Every write lands in IndexedDB immediately and is
// queued in the outbox for the sync engine. Pure-local; no network here.

import { getDB } from './db';
import type {
  Category,
  ImportPreview,
  Kind,
  OutboxOp,
  Person,
  Profile,
  Tx,
} from '../domain/types';

type Listener = () => void;

const KINDS: Kind[] = ['transactions', 'people', 'categories'];

function nowISO(): string {
  return new Date().toISOString();
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

class Repo {
  private listeners = new Set<Listener>();
  private boundUser: string | null = null;

  /** The id that goes into user_id on new rows ('local' in offline mode). */
  bindUser(userId: string): void {
    this.boundUser = userId;
  }

  get userId(): string {
    if (!this.boundUser) {
      this.boundUser = 'local';
    }
    return this.boundUser;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  // ---------- reads ----------

  async listTransactions(): Promise<Tx[]> {
    const db = await getDB();
    const rows = await db.getAll('transactions');
    return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  async getTransaction(id: string): Promise<Tx | undefined> {
    const db = await getDB();
    return db.get('transactions', id);
  }

  async listPeople(): Promise<Person[]> {
    const db = await getDB();
    const rows = await db.getAll('people');
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listCategories(): Promise<Category[]> {
    const db = await getDB();
    const rows = await db.getAll('categories');
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- writes (local + outbox) ----------

  private async putWithOutbox(kind: Kind, row: object, updatedAt: string): Promise<void> {
    const db = await getDB();
    await db.put(kind, row as never);
    const op: OutboxOp = {
      key: `${kind}:${(row as { id: string }).id}`,
      kind,
      id: (row as { id: string }).id,
      updated_at: updatedAt,
    };
    await db.put('outbox', op);
  }

  async saveTransaction(t: Tx): Promise<Tx> {
    const ts = nowISO();
    const row: Tx = { ...t, updated_at: ts };
    if (!row.created_at) row.created_at = ts;
    if (!row.user_id) row.user_id = this.userId;
    await this.putWithOutbox('transactions', row, ts);
    this.emit();
    return row;
  }

  async softDeleteTransaction(id: string): Promise<void> {
    const t = await this.getTransaction(id);
    if (!t || t.deleted_at) return;
    await this.saveTransaction({ ...t, deleted_at: nowISO() });
  }

  async upsertPerson(p: Person): Promise<Person> {
    const ts = nowISO();
    const row: Person = { ...p, updated_at: ts };
    if (!row.created_at) row.created_at = ts;
    if (!row.user_id) row.user_id = this.userId;
    await this.putWithOutbox('people', row, ts);
    this.emit();
    return row;
  }

  async softDeletePerson(id: string): Promise<void> {
    const p = await (await getDB()).get('people', id);
    if (!p || p.deleted_at) return;
    // Safe delete: the PERSON goes away, transactions are kept (marker only).
    await this.upsertPerson({ ...p, deleted_at: nowISO() });
  }

  async upsertCategory(c: Category): Promise<Category> {
    const ts = nowISO();
    const row: Category = { ...c, updated_at: ts };
    if (!row.created_at) row.created_at = ts;
    if (!row.user_id) row.user_id = this.userId;
    await this.putWithOutbox('categories', row, ts);
    this.emit();
    return row;
  }

  async softDeleteCategory(id: string): Promise<void> {
    const c = await (await getDB()).get('categories', id);
    if (!c || c.deleted_at) return;
    await this.upsertCategory({ ...c, deleted_at: nowISO() });
  }

  // ---------- sync support (no outbox on server rows) ----------

  async upsertManyLocal(kind: Kind, rows: object[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await getDB();
    for (const r of rows) {
      if (kind === 'transactions') await db.put('transactions', r as Tx);
      else if (kind === 'people') await db.put('people', r as Person);
      else await db.put('categories', r as Category);
    }
  }

  async loadRow(kind: Kind, id: string): Promise<Tx | Person | Category | undefined> {
    const db = await getDB();
    if (kind === 'transactions') return db.get('transactions', id);
    if (kind === 'people') return db.get('people', id);
    return db.get('categories', id);
  }

  async outboxList(): Promise<OutboxOp[]> {
    const db = await getDB();
    return db.getAll('outbox');
  }

  async outboxAck(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const db = await getDB();
    for (const k of keys) await db.delete('outbox', k);
  }

  async outboxBump(op: OutboxOp): Promise<void> {
    const db = await getDB();
    await db.put('outbox', { ...op, attempts: (op.attempts ?? 0) + 1 });
  }

  // ---------- meta ----------

  async getMeta<T>(key: string): Promise<T | null> {
    const db = await getDB();
    const row = await db.get('meta', `${this.userId}:${key}`);
    return (row?.value as T) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    await db.put('meta', { key: `${this.userId}:${key}`, value });
  }

  async clearAllForUser(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(
      ['transactions', 'people', 'categories', 'outbox', 'meta'],
      'readwrite',
    );
    await Promise.all(
      (['transactions', 'people', 'categories', 'outbox'] as const).map(
        (s) => tx.objectStore(s).clear(),
      ),
    );
    const metaStore = tx.objectStore('meta');
    const all = await metaStore.getAllKeys();
    for (const k of all) await metaStore.delete(k as string);
    await tx.done;
    this.emit();
  }
}

export const repo = new Repo();

// ---------------- Import / Export ----------------

export interface ExportBundle {
  app: 'engada-pochu';
  version: 1;
  exported_at: string;
  people: Person[];
  categories: Category[];
  transactions: Tx[];
}

export function buildExport(
  txs: Tx[],
  people: Person[],
  cats: Category[],
): ExportBundle {
  return {
    app: 'engada-pochu',
    version: 1,
    exported_at: nowISO(),
    people: people.filter((p) => !p.deleted_at),
    categories: cats.filter((c) => !c.deleted_at),
    transactions: txs.filter((t) => !t.deleted_at),
  };
}

export function buildCSV(txs: Tx[], people: Person[], cats: Category[]): string {
  const pName = (id: string | null) =>
    id ? people.find((p) => p.id === id)?.name ?? '' : '';
  const cName = (id: string | null) =>
    id ? cats.find((c) => c.id === id)?.name ?? '' : '';
  const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const lines = [
    'id,occurred_at,direction,amount,currency,person,category,note,source,raw_speech',
  ];
  for (const t of txs) {
    lines.push(
      [
        t.id,
        t.occurred_at,
        t.direction,
        String(t.amount),
        t.currency,
        esc(pName(t.person_id)),
        esc(cName(t.category_id)),
        esc(t.note ?? ''),
        t.source,
        esc(t.raw_speech ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/**
 * Validate an imported JSON bundle and compute the skip-existing preview.
 * Match: same id, or same occurred_at+amount+person_id+direction.
 */
export function previewImport(
  bundle: unknown,
  existingTxs: Tx[],
  existingPeople: Person[],
  existingCats: Category[],
): { ok: boolean; error?: string; preview: ImportPreview; bundle?: ExportBundle } {
  const empty: ImportPreview = {
    valid: 0,
    invalid: 0,
    willAdd: 0,
    willSkip: 0,
    peopleToAdd: 0,
    categoriesToAdd: 0,
  };
  if (typeof bundle !== 'object' || bundle === null) {
    return { ok: false, error: 'File is not valid JSON.', preview: empty };
  }
  const b = bundle as Partial<ExportBundle>;
  if (b.app !== 'engada-pochu' || !Array.isArray(b.transactions)) {
    return { ok: false, error: 'Not an Engada Pochu backup file.', preview: empty };
  }
  const people = Array.isArray(b.people) ? b.people : [];
  const cats = Array.isArray(b.categories) ? b.categories : [];

  const txOk = (t: unknown): t is Tx => {
    if (typeof t !== 'object' || t === null) return false;
    const x = t as Tx;
    return (
      typeof x.id === 'string' &&
      typeof x.occurred_at === 'string' &&
      typeof x.amount === 'number' &&
      x.amount > 0 &&
      (x.direction === 'sent' || x.direction === 'received')
    );
  };

  const existingKeys = new Set<string>();
  for (const t of existingTxs) {
    if (t.deleted_at) continue;
    existingKeys.add(t.id);
    existingKeys.add(sig(t.occurred_at, t.amount, t.person_id, t.direction));
  }

  let valid = 0;
  let invalid = 0;
  let willAdd = 0;
  let willSkip = 0;
  for (const t of b.transactions) {
    if (!txOk(t)) {
      invalid++;
      continue;
    }
    valid++;
    if (existingKeys.has(t.id) || existingKeys.has(sig(t.occurred_at, t.amount, t.person_id, t.direction))) {
      willSkip++;
    } else {
      willAdd++;
    }
  }
  const existingPeopleIds = new Set(existingPeople.map((p) => p.id));
  const existingPeopleNames = new Set(
    existingPeople.map((p) => p.name.toLowerCase()),
  );
  const existingCatIds = new Set(existingCats.map((c) => c.id));
  const existingCatNames = new Set(existingCats.map((c) => c.name.toLowerCase()));
  const peopleToAdd = people.filter(
    (p) =>
      p &&
      !p.deleted_at &&
      !existingPeopleIds.has(p.id) &&
      !existingPeopleNames.has(String(p.name).toLowerCase()),
  ).length;
  const categoriesToAdd = cats.filter(
    (c) =>
      c &&
      !c.deleted_at &&
      !existingCatIds.has(c.id) &&
      !existingCatNames.has(String(c.name).toLowerCase()),
  ).length;

  return {
    ok: true,
    preview: {
      valid,
      invalid,
      willAdd,
      willSkip,
      peopleToAdd,
      categoriesToAdd,
    },
    bundle: {
      app: 'engada-pochu',
      version: 1,
      exported_at: b.exported_at ?? nowISO(),
      people,
      categories: cats,
      transactions: b.transactions,
    },
  };
}

function sig(
  occurredAt: string,
  amount: number,
  personId: string | null,
  direction: string,
): string {
  return `${occurredAt}|${amount}|${personId ?? ''}|${direction}`;
}

export { KINDS };
export type { Profile };
