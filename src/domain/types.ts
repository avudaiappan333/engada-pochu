// Core domain types. Field names match the Postgres schema (snake_case)
// so rows can be stored in IndexedDB and synced to Supabase without mapping.

export type Direction = 'sent' | 'received';
export type Source = 'voice' | 'manual';

export interface Person {
  id: string;
  user_id: string;
  name: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  emoji: string | null;
  is_builtin: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Tx {
  id: string;
  user_id: string;
  person_id: string | null;
  category_id: string | null;
  amount: number; // integer rupees in v1 (schema is numeric(14,2))
  currency: string; // 'INR' in v1
  direction: Direction;
  note: string | null;
  source: Source;
  raw_speech: string | null;
  occurred_at: string; // ISO — the real transaction time (editable)
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Profile {
  id: string;
  created_at: string;
  updated_at: string | null;
  settings: Record<string, unknown>;
}

export type Kind = 'transactions' | 'people' | 'categories';

export interface OutboxOp {
  key: string; // `${kind}:${id}`
  kind: Kind;
  id: string;
  updated_at: string;
  attempts?: number;
}

export interface QueryFilter {
  search: string;
  direction: Direction | null;
  person_id: string | null;
  category_id: string | null;
  from: string | null; // ISO date (inclusive)
  to: string | null; // ISO date (exclusive)
  amount_min: number | null;
  amount_max: number | null;
}

export const EMPTY_FILTER: QueryFilter = {
  search: '',
  direction: null,
  person_id: null,
  category_id: null,
  from: null,
  to: null,
  amount_min: null,
  amount_max: null,
};

export type Period = 'today' | 'week' | 'month' | 'prevMonth' | 'all';

// ---- Voice parser output ----

export interface ParsedPersonRef {
  raw: string; // as heard
  matched_id: string | null; // exact (case-insensitive) existing person
  suggestion_id: string | null; // fuzzy "did you mean"
}

export interface ParsedCategoryRef {
  name: string; // display name resolved from the phrase
  id: string | null; // null if category not found in user's list
}

export interface ParsedCandidate {
  amount: number;
  direction: Direction;
  direction_assumed: boolean; // true = no direction word heard; default applied
  person: ParsedPersonRef | null;
  category: ParsedCategoryRef | null;
  raw: string; // the clause this candidate came from
}

export type ParseResult =
  | { type: 'tx'; candidates: ParsedCandidate[] }
  | { type: 'query'; filter: QueryFilter }
  | { type: 'error'; message: string };

export interface SyncLogEntry {
  at: string;
  kind: string;
  id: string;
  note: string;
}

export interface ImportPreview {
  valid: number;
  invalid: number;
  willAdd: number;
  willSkip: number;
  peopleToAdd: number;
  categoriesToAdd: number;
}
