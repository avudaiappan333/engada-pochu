// Thin IndexedDB layer (via `idb`). This is the local source of truth while
// offline; Supabase is the durable source of truth when cloud mode is on.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface EngadaDB extends DBSchema {
  transactions: { key: string; value: import('../domain/types').Tx };
  people: { key: string; value: import('../domain/types').Person };
  categories: { key: string; value: import('../domain/types').Category };
  outbox: { key: string; value: import('../domain/types').OutboxOp };
  meta: { key: string; value: MetaRow };
}

const DB_NAME = 'engada-pochu';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<EngadaDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<EngadaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EngadaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('transactions', { keyPath: 'id' });
        db.createObjectStore('people', { keyPath: 'id' });
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

/** Test helper: reset the cached connection (fresh DB per test via fake-indexeddb). */
export function __resetDBForTests(): void {
  dbPromise = null;
}
