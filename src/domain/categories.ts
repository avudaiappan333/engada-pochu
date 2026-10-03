// Built-in categories (seeded at signup) + category phrase matching.

import type { Category } from './types';

export const BUILTIN_CATEGORIES: { name: string; emoji: string }[] = [
  { name: 'Food', emoji: '🍔' },
  { name: 'Petrol', emoji: '⛽' },
  { name: 'Rent', emoji: '🏠' },
  { name: 'Shopping', emoji: '🛒' },
  { name: 'Bills', emoji: '💡' },
  { name: 'Travel', emoji: '🚕' },
  { name: 'Medical', emoji: '💊' },
  { name: 'Recharge', emoji: '📱' },
  { name: 'Education', emoji: '🎓' },
  { name: 'Salary', emoji: '💰' },
  { name: 'Other', emoji: '🎁' },
];

/** Aliases → builtin category name, so voice phrases resolve. */
const ALIASES: Record<string, string> = {
  food: 'Food', eat: 'Food', eating: 'Food', meal: 'Food', lunch: 'Food', dinner: 'Food',
  petrol: 'Petrol', fuel: 'Petrol', diesel: 'Petrol',
  rent: 'Rent',
  shopping: 'Shopping', shop: 'Shopping', purchase: 'Shopping',
  bills: 'Bills', bill: 'Bills', electricity: 'Bills', electric: 'Bills', light: 'Bills',
  travel: 'Travel', taxi: 'Travel', cab: 'Travel', bus: 'Travel', train: 'Travel', trip: 'Travel',
  medical: 'Medical', medicine: 'Medical', pharmacy: 'Medical', hospital: 'Medical', doctor: 'Medical',
  recharge: 'Recharge', topup: 'Recharge',
  education: 'Education', school: 'Education', college: 'Education', fees: 'Education', fee: 'Education',
  salary: 'Salary',
  other: 'Other',
};

/**
 * Resolve a spoken word to a category the user actually has.
 * Custom category names are matched first (case-insensitive), then aliases.
 */
export function resolveCategory(word: string, categories: Category[]): Category | null {
  const w = word.toLowerCase().trim();
  if (!w) return null;
  const live = categories.filter((c) => !c.deleted_at);
  const byName = live.find((c) => c.name.toLowerCase() === w);
  if (byName) return byName;
  const target = ALIASES[w];
  if (target) {
    const byTarget = live.find((c) => c.name.toLowerCase() === target.toLowerCase());
    if (byTarget) return byTarget;
  }
  return null;
}

/** Find a category alias word (if any) anywhere in a clause. */
export function categoryWordInClause(clause: string, categories: Category[]): Category | null {
  const live = categories.filter((c) => !c.deleted_at);
  const names = live
    .map((c) => c.name.toLowerCase())
    .filter((n) => n.length > 3)
    .sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(clause)) {
      return live.find((c) => c.name.toLowerCase() === n) ?? null;
    }
  }
  const words = clause.match(/[a-z]+/g) ?? [];
  for (const w of words) {
    const hit = resolveCategory(w, categories);
    if (hit) return hit;
  }
  return null;
}

/** Most frequent category for a person (learned suggestion; never auto-applied). */
export function suggestCategoryForPerson(
  personId: string | null,
  txs: { person_id: string | null; category_id: string | null; deleted_at: string | null }[],
  categories: Category[],
): Category | null {
  const counts = new Map<string, number>();
  for (const t of txs) {
    if (t.deleted_at) continue;
    if (personId && t.person_id !== personId) continue;
    if (!t.category_id) continue;
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestId = id;
      bestN = n;
    }
  }
  if (bestN < 2 || !bestId) return null;
  return categories.find((c) => c.id === bestId && !c.deleted_at) ?? null;
}
