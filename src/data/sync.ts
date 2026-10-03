// Sync engine: pushes the local outbox to Supabase and pulls newer rows.
// Single-user, deterministic: last write wins by updated_at.
// Conflicts (rare for one human) are recorded in a local sync log — never silent.

import { supabase } from './config';
import { getDB } from './db';
import { KINDS, repo } from './repo';
import type { SyncLogEntry } from '../domain/types';

export interface SyncStatus {
  state: 'disabled' | 'offline' | 'syncing' | 'pending' | 'synced';
  pending: number;
  last_sync_at: string | null;
  error: string | null;
}

type Listener = (s: SyncStatus) => void;

class SyncEngine {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private online = typeof navigator === 'undefined' ? true : navigator.onLine;
  private status: SyncStatus = {
    state: 'disabled',
    pending: 0,
    last_sync_at: null,
    error: null,
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online = true;
        void this.run();
      });
      window.addEventListener('offline', () => {
        this.online = false;
        this.setStatus({ ...this.status, state: 'offline', error: null });
      });
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): SyncStatus {
    return this.status;
  }

  private setStatus(s: SyncStatus): void {
    this.status = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  private async refreshPending(): Promise<number> {
    const ops = await repo.outboxList();
    return ops.length;
  }

  start(): void {
    if (!supabase) {
      this.setStatus({
        state: 'disabled',
        pending: 0,
        last_sync_at: null,
        error: null,
      });
      return;
    }
    void this.run();
    if (!this.timer) {
      this.timer = setInterval(() => void this.run(), 60_000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    const sb = supabase;
    if (!sb || this.running) return;
    if (!this.online) {
      this.setStatus({ ...this.status, state: 'offline', error: null });
      return;
    }
    this.running = true;
    try {
      const pending0 = await this.refreshPending();
      this.setStatus({ ...this.status, state: 'syncing', pending: pending0 });
      await this.push(sb);
      await this.pull(sb);
      const pending = await this.refreshPending();
      const last = (await repo.getMeta<string>('last_sync_at')) ?? null;
      this.setStatus({
        state: pending > 0 ? 'pending' : 'synced',
        pending,
        last_sync_at: last,
        error: null,
      });
    } catch (e) {
      this.setStatus({
        ...this.status,
        state: 'pending',
        error: e instanceof Error ? e.message : 'Sync failed',
      });
    } finally {
      this.running = false;
    }
  }

  private async push(sb: NonNullable<typeof supabase>): Promise<void> {
    const ops = await repo.outboxList();
    if (ops.length === 0) return;
    const ack: string[] = [];
    for (const op of ops) {
      const row = await repo.loadRow(op.kind, op.id);
      if (!row) {
        ack.push(op.key);
        continue;
      }
      const { error } = await sb
        .from(op.kind)
        .upsert(row as never, { onConflict: 'id' });
      if (!error) {
        ack.push(op.key);
      } else if ((op.attempts ?? 0) + 1 >= 10) {
        await this.logConflict(op.kind, op.id, 'gave up after 10 attempts: ' + error.message);
        ack.push(op.key);
      } else {
        await repo.outboxBump(op);
      }
    }
    if (ack.length) await repo.outboxAck(ack);
  }

  private async pull(sb: NonNullable<typeof supabase>): Promise<void> {
    const cursor = (await repo.getMeta<string>('last_sync_at')) ?? '1970-01-01T00:00:00.000Z';
    let newCursor = cursor;
    for (const kind of KINDS) {
      const { data, error } = await sb
        .from(kind)
        .select('*')
        .gt('updated_at', cursor)
        .limit(2000);
      if (error) throw new Error(`Pull ${kind}: ${error.message}`);
      if (!data || data.length === 0) continue;
      const db = await getDB();
      const toPut: object[] = [];
      for (const row of data) {
        const local = await repo.loadRow(kind, (row as { id: string }).id);
        const serverTs: string | null = (row as { updated_at: string | null }).updated_at ?? null;
        if (serverTs && serverTs > newCursor) newCursor = serverTs;
        if (!local) {
          toPut.push(row);
          continue;
        }
        const localTs: string | null =
          (local as { updated_at: string | null }).updated_at ?? null;
        const serverNewer =
          serverTs !== null && (localTs === null || serverTs > localTs);
        if (serverNewer) {
          const outboxHas = await db.get(
            'outbox',
            `${kind}:${(row as { id: string }).id}`,
          );
          if (outboxHas && localTs !== null && localTs >= (serverTs ?? '')) {
            await this.logConflict(
              kind,
              (row as { id: string }).id,
              'server copy newer than pending local edit — server kept',
            );
          }
          toPut.push(row);
        }
      }
      if (toPut.length) await repo.upsertManyLocal(kind, toPut);
    }
    if (newCursor !== cursor) {
      await repo.setMeta('last_sync_at', newCursor);
    }
  }

  private async logConflict(kind: string, id: string, note: string): Promise<void> {
    const log = (await repo.getMeta<SyncLogEntry[]>('sync_log')) ?? [];
    log.unshift({ at: new Date().toISOString(), kind, id, note });
    await repo.setMeta('sync_log', log.slice(0, 20));
  }

  async syncLog(): Promise<SyncLogEntry[]> {
    return (await repo.getMeta<SyncLogEntry[]>('sync_log')) ?? [];
  }
}

export const syncEngine = new SyncEngine();
