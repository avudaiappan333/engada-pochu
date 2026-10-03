// Auth: Supabase email OTP (cloud mode) + optional on-device 6-digit PIN.
// The PIN is hashed (salted SHA-256, WebCrypto with a plain fallback) and
// stored only in local IndexedDB. It is never uploaded anywhere.

import { CLOUD_ENABLED, supabase } from './config';
import { getDB } from './db';
import { newId, repo } from './repo';
import { BUILTIN_CATEGORIES } from '../domain/categories';
import type { Category, Profile } from '../domain/types';

export interface PinRecord {
  salt: string;
  hash: string;
}

// ---------- Supabase auth (cloud mode only) ----------

export async function sendEmailOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not configured.' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not configured.' };
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? 'Invalid code.' };
  }
  return { ok: true, userId: data.user.id };
}

export async function getSessionUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export function onAuthChange(cb: (userId: string | null) => void): () => void {
  if (!supabase) return () => {};
  const sub = supabase.auth.onAuthStateChange((event, session) => {
    cb(session?.user?.id ?? null);
    void event;
  });
  return () => sub.data.subscription.unsubscribe();
}

export async function signOutAll(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  await repo.clearAllForUser();
}

// ---------- Profile + builtin categories seeding (idempotent) ----------

export async function ensureProfile(userId: string): Promise<void> {
  repo.bindUser(userId);
  if (supabase) {
    const { error } = await supabase.from('profiles').upsert(
      {
        id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        settings: {},
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error('Could not create profile: ' + error.message);
  }
  await seedBuiltinCategories(userId);
}

async function seedBuiltinCategories(userId: string): Promise<void> {
  const existing = await repo.listCategories();
  const byName = new Map(
    existing.filter((c) => !c.deleted_at).map((c) => [c.name.toLowerCase(), c]),
  );
  for (const b of BUILTIN_CATEGORIES) {
    if (byName.has(b.name.toLowerCase())) continue;
    const cat: Category = {
      id: newId(),
      user_id: userId,
      name: b.name,
      emoji: b.emoji,
      is_builtin: true,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    };
    if (supabase) {
      const { error } = await supabase.from('categories').upsert(cat, {
        onConflict: 'id',
      });
      if (error) throw new Error('Could not seed categories: ' + error.message);
    }
    await repo.upsertCategory(cat);
  }
}

export async function getProfile(): Promise<Profile | null> {
  const meta = await repo.getMeta<Profile>('profile');
  return meta;
}

// ---------- PIN ----------

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return toHex(buf);
    }
  } catch {
    // fall through to fallback
  }
  // FNV-1a 32-bit fallback (non-secure contexts). Still deterministic.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'fnv-' + h.toString(16).padStart(8, '0');
}

async function randomSaltHex(): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return toHex(arr.buffer);
    }
  } catch {
    // ignore
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function pinLooksValid(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export async function setPin(pin: string): Promise<void> {
  if (!pinLooksValid(pin)) throw new Error('PIN must be 4–8 digits.');
  const salt = await randomSaltHex();
  const hash = await sha256Hex(salt + ':' + pin);
  await repo.setMeta('pin', { salt, hash } satisfies PinRecord);
}

export async function hasPin(): Promise<boolean> {
  const rec = await repo.getMeta<PinRecord>('pin');
  return Boolean(rec?.hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const rec = await repo.getMeta<PinRecord>('pin');
  if (!rec) return true;
  const hash = await sha256Hex(rec.salt + ':' + pin);
  return hash === rec.hash;
}

export async function clearPin(): Promise<void> {
  const db = await getDB();
  await db.delete('meta', `${repo.userId}:pin`);
}
