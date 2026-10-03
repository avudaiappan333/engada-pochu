// Fuzzy name matching (Levenshtein). Suggestions only — never silent changes.

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface NameMatch {
  id: string;
  name: string;
  distance: number;
}

/**
 * Best fuzzy match for `name` among people.
 * - exact (case-insensitive) match returns distance 0
 * - fuzzy allowed when distance <= max(1, floor(len/3))
 * - returns null when nothing is close enough
 */
export function bestPersonMatch(
  name: string,
  people: { id: string; name: string }[],
): NameMatch | null {
  const n = normalizeName(name);
  if (!n) return null;
  let exact: NameMatch | null = null;
  let best: NameMatch | null = null;
  for (const p of people) {
    const pn = normalizeName(p.name);
    if (!pn) continue;
    if (pn === n) {
      exact = { id: p.id, name: p.name, distance: 0 };
      continue;
    }
    const d = levenshtein(n, pn);
    if (!best || d < best.distance) best = { id: p.id, name: p.name, distance: d };
  }
  if (exact) return exact;
  if (best && n.length >= 3 && best.distance <= Math.max(1, Math.floor(n.length / 3))) {
    return best;
  }
  return null;
}
