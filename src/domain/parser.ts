// Voice text parser (v1, English).
// Turns a transcript into either:
//   - transaction candidates (direction / amount / person / category)
//   - a filter query  ("show Ravi", "this month", "sent only")
// The parser never saves anything — output goes to the confirmation card first.

import { UNITS, toWholeRupees } from './amounts';
import { bestPersonMatch, normalizeName } from './fuzzy';
import { categoryWordInClause, resolveCategory } from './categories';
import type {
  Category,
  Direction,
  ParsedCandidate,
  Person,
  ParseResult,
  QueryFilter,
} from './types';
import { EMPTY_FILTER } from './types';

interface Ctx {
  people: Person[];
  categories: Category[];
}

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  half: 0.5, quarter: 0.25,
};

interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

function findAmounts(text: string): AmountMatch[] {
  const out: AmountMatch[] = [];
  const overlaps = (s: number, e: number) =>
    out.some((m) => s < m.end && e > m.start);

  // 1) digit forms: 500 | 1,000 | 1,00,000 | 2k | 5 thousand | ₹500
  const reDigit = /(\d[\d,]{0,12})(\s?(k|thousand|hundred|lakh|crore))?/g;
  for (const m of text.matchAll(reDigit)) {
    const idx = m.index ?? 0;
    const digits = m[1].replace(/,/g, '');
    if (!/^\d+$/.test(digits)) continue;
    let v = parseInt(digits, 10);
    if (v === 0) continue;
    const unit = m[3];
    if (unit) v = Math.round(v * UNITS[unit]);
    v = toWholeRupees(v);
    if (v > 0) out.push({ value: v, start: idx, end: idx + m[0].length });
  }

  // 2) word forms: five hundred | a thousand | half lakh | one and a half lakh
  const reWord =
    /\b(half|quarter|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+and\s+(?:a|an)?\s+half)?\s+(hundred|thousand|lakh|crore)\b/g;
  for (const m of text.matchAll(reWord)) {
    const idx = m.index ?? 0;
    if (overlaps(idx, idx + m[0].length)) continue;
    const mult = WORD_NUM[m[1]] ?? 1;
    const hasHalf = /\bhalf\b/.test(m[0]) && m[1] !== 'half' && m[1] !== 'quarter';
    // group 2 = unit (the middle "a|an" is non-capturing)
    const v = toWholeRupees((mult + (hasHalf ? 0.5 : 0)) * UNITS[m[2]]);
    if (v > 0) out.push({ value: v, start: idx, end: idx + m[0].length });
  }

  return out.sort((a, b) => a.start - b.start);
}

/**
 * Clause boundaries at "and"/"plus" — but NEVER inside an amount phrase,
 * so "one and a half lakh" stays one amount.
 */
function clauseBoundaries(text: string, amounts: AmountMatch[]): { start: number; end: number }[] {
  const bounds: number[] = [0];
  for (const m of text.matchAll(/\s+and\s+|\s+plus\s+/g)) {
    const cut = (m.index ?? 0) + m[0].length;
    const inside = amounts.some((a) => a.start < cut && cut <= a.end);
    if (!inside) bounds.push(cut);
  }
  bounds.push(text.length);
  return bounds.slice(0, -1).map((s, i) => ({ start: s, end: bounds[i + 1] }));
}

const SENT_RE = /\b(sent|paid|spent|gave)\b/;
const REC_RE = /\b(received|got)\b|\bgave\s+me\b/;

function detectDirection(clause: string, global: Direction | null): { dir: Direction; assumed: boolean } {
  let dir: Direction | null = null;
  if (REC_RE.test(clause)) dir = 'received';
  else if (SENT_RE.test(clause)) dir = 'sent';
  if (!dir && global) dir = global;
  if (!dir) return { dir: 'sent', assumed: true };
  return { dir, assumed: false };
}

function globalDirection(text: string): Direction | null {
  const sent = SENT_RE.test(text) && !REC_RE.test(text);
  const rec = REC_RE.test(text) && !SENT_RE.test(text);
  if (sent) return 'sent';
  if (rec) return 'received';
  return null;
}

const PERSON_STOP =
  /\b(today|yesterday|morning|evening|night|am|pm|ist|please|for|from|to|and|plus|with|on|at|in|the|a|an|i|my|me|is|was|were|have|has|had|did|do|will|about|because|since|last|this|that|now|sent|paid|spent|gave|received|got|show)\b/g;

function cleanPerson(raw: string): string {
  return raw
    .replace(PERSON_STOP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function extractPerson(
  clause: string,
  amountStart: number,
  amountEnd: number,
): string | null {
  // "to Ravi" / "from Ravi"
  const m1 = clause.match(/\b(?:to|from)\s+([a-z][a-z' ]{1,30}?)(?=\s+(?:and|plus|with|for|on|because|since|today|yesterday|,|\.|!)|\s*$)/i);
  if (m1) {
    const p = cleanPerson(m1[1]);
    if (p.length > 1) return p;
  }
  // "gave Ravi <amount>"  (person right before the amount, and no "gave me")
  if (!REC_RE.test(clause) && /\bgave\b/i.test(clause)) {
    const before = clause.slice(0, amountStart);
    const m2 = before.match(/([a-z][a-z' ]{1,30}?)\s*$/i);
    if (m2) {
      const p = cleanPerson(m2[1]);
      if (p.length > 1) return p;
    }
  }
  // "<Ravi> gave me <amount>"
  const m3 = clause.match(/\b([a-z][a-z' ]{1,30}?)\s+gave\s+me\b/i);
  if (m3) {
    const p = cleanPerson(m3[1]);
    if (p.length > 1) return p;
  }
  // "with Ravi" fallback
  const m4 = clause.match(/\bwith\s+([a-z][a-z' ]{1,30}?)(?=\s+(?:and|plus|,|\.|!)|\s*$)/i);
  if (m4) {
    const p = cleanPerson(m4[1]);
    if (p.length > 1) return p;
  }
  return null;
}

function extractCategory(clause: string, categories: Category[]): Category | null {
  // "spent 500 on food" / "500 for petrol"
  const m = clause.match(/\b(?:on|for)\s+([a-z]+)/i);
  if (m) {
    const hit = resolveCategory(m[1], categories);
    if (hit) return hit;
  }
  return categoryWordInClause(clause, categories);
}

function personRef(name: string | null, ctx: Ctx): ParsedCandidate['person'] {
  if (!name) return null;
  const live = ctx.people.filter((p) => !p.deleted_at);
  const match = bestPersonMatch(name, live);
  return {
    raw: capitalise(name),
    matched_id: match && match.distance === 0 ? match.id : null,
    suggestion_id: match && match.distance > 0 ? match.id : null,
  };
}

// ---------------- Queries ----------------

const PERIOD_RE =
  /\b(today|this\s+week|this\s+month|last\s+month|previous\s+month|week|month)\b/;

function looksLikeQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (/^(please\s+)?(show|see|check|filter|list)\b/.test(t)) return true;
  if (/how much/.test(t)) return true;
  if (/^(this\s+week|this\s+month|today|last\s+month|previous\s+month)\b/.test(t)) return true;
  if (/\b(only|filter)\s*$/.test(t)) return true;
  return false;
}

function parseQuery(text: string, ctx: Ctx): ParseResult {
  const t = text.toLowerCase();
  const f: QueryFilter = { ...EMPTY_FILTER };

  const pm = t.match(PERIOD_RE);
  if (pm) {
    const p = pm[1].replace(/\s+/g, ' ');
    if (p === 'today') f.from = startOfDayISO(new Date());
    else if (p === 'this week' || p === 'week') f.from = startOfWeekISO(new Date());
    else if (p === 'this month' || p === 'month') f.from = startOfMonthISO(new Date());
    else if (p === 'last month' || p === 'previous month') {
      const now = new Date();
      f.from = startOfMonthISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      f.to = startOfMonthISO(new Date());
    }
  }
  if (/\bsent\s+only\b/.test(t)) f.direction = 'sent';
  if (/\breceived\s+only\b/.test(t)) f.direction = 'received';

  // "show <person>" / "show <category>" (with optional period tacked on)
  const showM = t.match(/\bshow\s+(.{2,40})$/);
  if (showM) {
    const rest = showM[1]
      .replace(/\b(today|this week|this month|last month|previous month|week|month)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cat = resolveCategory(rest, ctx.categories);
    if (cat) {
      f.category_id = cat.id;
    } else {
      const live = ctx.people.filter((p) => !p.deleted_at);
      const m = bestPersonMatch(rest, live);
      if (m) f.person_id = m.id;
      else if (rest.length >= 2) f.search = rest;
    }
  } else if (/\bhow much\b/.test(t)) {
    // "how much did I spend this month" → direction sent (spend) or received (receive)
    if (/\bspend|spent|paid|sent\b/.test(t)) f.direction = 'sent';
    else if (/\breceive|received|got\b/.test(t)) f.direction = 'received';
  }

  const hasAny =
    f.direction || f.person_id || f.category_id || f.from || f.to || f.search;
  if (!hasAny) {
    return {
      type: 'error',
      message: 'I could not understand that. Try: "show Ravi", "this month", "sent only", or "show food".',
    };
  }
  return { type: 'query', filter: f };
}

// ---------------- Main entry ----------------

export function parseVoiceText(text: string, ctx: Ctx): ParseResult {
  const clean = text
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'₹,.\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!clean) return { type: 'error', message: 'I did not catch anything. Please try again.' };

  if (looksLikeQuery(clean)) {
    const q = parseQuery(clean, ctx);
    if (q.type === 'error' && /\bhow much\b/.test(clean)) return q;
    if (q.type === 'error') {
      // maybe it's actually a transaction ("show" not used) — fall through to tx parsing
    } else {
      return q;
    }
  }

  const amounts = findAmounts(clean);
  if (amounts.length === 0) {
    return {
      type: 'error',
      message: 'No amount found. Try: "sent 500 to Ravi" or "spent 200 on food".',
    };
  }

  const boundaries = clauseBoundaries(clean, amounts);
  const gdir = globalDirection(clean);
  const candidates: ParsedCandidate[] = [];

  for (const b of boundaries) {
    const clause = clean.slice(b.start, b.end).trim();
    if (!clause) continue;
    const { dir, assumed } = detectDirection(clause, gdir);
    const inClause = amounts.filter((a) => a.start >= b.start && a.end <= b.end);
    for (const a of inClause) {
      const personName = extractPerson(clause, a.start - b.start, a.end - b.start);
      const person = personRef(personName, ctx);
      const category = extractCategory(clause, ctx.categories);
      candidates.push({
        amount: a.value,
        direction: dir,
        direction_assumed: assumed,
        person,
        category: category
          ? { name: category.name, id: category.id }
          : null,
        raw: clause,
      });
    }
  }

  if (candidates.length === 0) {
    return { type: 'error', message: 'I heard numbers but could not build a transaction. Please try again.' };
  }
  return { type: 'tx', candidates };
}

// ---------------- Date helpers (shared with insights) ----------------

export function startOfDayISO(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
export function startOfWeekISO(d: Date): string {
  const x = startOfDayISO(d);
  const dt = new Date(x);
  const day = (dt.getDay() + 6) % 7; // Monday = 0
  dt.setDate(dt.getDate() - day);
  return dt.toISOString();
}
export function startOfMonthISO(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

// re-export for tests
export { bestPersonMatch, normalizeName };
