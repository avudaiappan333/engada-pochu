import { describe, it, expect } from 'vitest';
import { parseVoiceText, startOfMonthISO } from '../src/domain/parser';
import { BUILTIN_CATEGORIES } from '../src/domain/categories';
import type { Category, Person } from '../src/domain/types';

const people: Person[] = [
  { id: 'p1', user_id: 'u', name: 'Ravi', deleted_at: null, created_at: 'x', updated_at: null },
  { id: 'p2', user_id: 'u', name: 'Priya', deleted_at: null, created_at: 'x', updated_at: null },
];
const cats: Category[] = BUILTIN_CATEGORIES.map((b, i) => ({
  id: `c${i}`,
  user_id: 'u',
  name: b.name,
  emoji: b.emoji,
  is_builtin: true,
  deleted_at: null,
  created_at: 'x',
  updated_at: null,
}));
const ctx = { people, categories: cats };

function txResult(text: string) {
  const r = parseVoiceText(text, ctx);
  if (r.type !== 'tx') throw new Error(`expected tx, got ${JSON.stringify(r)}`);
  return r.candidates;
}

describe('direction + person (spec §8 examples)', () => {
  it('sent 500 to Ravi', () => {
    const [c] = txResult('sent 500 to Ravi');
    expect(c.direction).toBe('sent');
    expect(c.amount).toBe(500);
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
    expect(c.person?.matched_id).toBe('p1');
    expect(c.direction_assumed).toBe(false);
  });
  it('paid 500 to Ravi', () => {
    const [c] = txResult('paid 500 to Ravi');
    expect(c.direction).toBe('sent');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
  });
  it('gave Ravi 500', () => {
    const [c] = txResult('gave Ravi 500');
    expect(c.direction).toBe('sent');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
    expect(c.amount).toBe(500);
  });
  it('I gave Ravi 500', () => {
    const [c] = txResult('I gave Ravi 500');
    expect(c.direction).toBe('sent');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
  });
  it('spent 500 on food (no person, category set)', () => {
    const [c] = txResult('spent 500 on food');
    expect(c.direction).toBe('sent');
    expect(c.amount).toBe(500);
    expect(c.person).toBeNull();
    expect(c.category?.name).toBe('Food');
  });
  it('received 500 from Ravi', () => {
    const [c] = txResult('received 500 from Ravi');
    expect(c.direction).toBe('received');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
  });
  it('got 500 from Ravi', () => {
    const [c] = txResult('got 500 from Ravi');
    expect(c.direction).toBe('received');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
  });
  it('Ravi gave me 500', () => {
    const [c] = txResult('Ravi gave me 500');
    expect(c.direction).toBe('received');
    expect(c.person?.raw.toLowerCase()).toBe('ravi');
  });
});

describe('number understanding (spec §10)', () => {
  it('plain 500', () => expect(txResult('sent 500 to Ravi')[0].amount).toBe(500));
  it('500 rupees', () => expect(txResult('sent 500 rupees to Ravi')[0].amount).toBe(500));
  it('1,000', () => expect(txResult('sent 1,000 to Ravi')[0].amount).toBe(1000));
  it('2k', () => expect(txResult('sent 2k to Ravi')[0].amount).toBe(2000));
  it('2K uppercase', () => expect(txResult('sent 2K to Ravi')[0].amount).toBe(2000));
  it('5 hundred', () => expect(txResult('sent 5 hundred to Ravi')[0].amount).toBe(500));
  it('5 thousand', () => expect(txResult('sent 5 thousand to Ravi')[0].amount).toBe(5000));
  it('a thousand', () => expect(txResult('sent a thousand to Ravi')[0].amount).toBe(1000));
  it('1 lakh', () => expect(txResult('sent 1 lakh to Ravi')[0].amount).toBe(100000));
  it('half lakh', () => expect(txResult('sent half lakh to Ravi')[0].amount).toBe(50000));
  it('one and a half lakh', () =>
    expect(txResult('sent one and a half lakh to Ravi')[0].amount).toBe(150000),
  );
  it('Indian grouping 1,00,000', () =>
    expect(txResult('sent 1,00,000 to Ravi')[0].amount).toBe(100000),
  );
});

describe('multiple transactions (spec §11)', () => {
  it('sent 200 to Ravi and 100 to Priya → 2 candidates', () => {
    const cs = txResult('sent 200 to Ravi and 100 to Priya');
    expect(cs).toHaveLength(2);
    expect(cs[0].amount).toBe(200);
    expect(cs[0].person?.raw.toLowerCase()).toBe('ravi');
    expect(cs[1].amount).toBe(100);
    expect(cs[1].person?.raw.toLowerCase()).toBe('priya');
    expect(cs[0].direction).toBe('sent');
    expect(cs[1].direction).toBe('sent'); // inherited from global "sent"
  });
});

describe('fuzzy suggestion (spec §14)', () => {
  it('Rabi suggests Ravi, does not silently match', () => {
    const [c] = txResult('sent 500 to Rabi');
    expect(c.person?.matched_id).toBeNull();
    expect(c.person?.suggestion_id).toBe('p1');
  });
});

describe('unknown person (v1: create-on-confirm)', () => {
  it('unknown name has no match and no suggestion', () => {
    const [c] = txResult('sent 500 to Rahul');
    expect(c.person?.matched_id).toBeNull();
    expect(c.person?.suggestion_id).toBeNull();
    expect(c.person?.raw).toBe('Rahul');
  });
});

describe('direction assumption is flagged', () => {
  it('no direction word → assumed true', () => {
    const [c] = txResult('500 to Ravi');
    expect(c.direction).toBe('sent');
    expect(c.direction_assumed).toBe(true);
  });
});

describe('voice queries (v1 core set)', () => {
  it('show Ravi → person filter', () => {
    const r = parseVoiceText('show Ravi', ctx);
    expect(r.type).toBe('query');
    if (r.type === 'query') expect(r.filter.person_id).toBe('p1');
  });
  it('this month → date filter', () => {
    const r = parseVoiceText('this month', ctx);
    expect(r.type).toBe('query');
    if (r.type === 'query') expect(r.filter.from).toBe(startOfMonthISO(new Date()));
  });
  it('sent only → direction filter', () => {
    const r = parseVoiceText('sent only', ctx);
    expect(r.type).toBe('query');
    if (r.type === 'query') expect(r.filter.direction).toBe('sent');
  });
  it('show food → category filter', () => {
    const r = parseVoiceText('show food', ctx);
    expect(r.type).toBe('query');
    if (r.type === 'query') {
      const food = cats.find((c) => c.name === 'Food')!;
      expect(r.filter.category_id).toBe(food.id);
    }
  });
  it('combo: show food this month', () => {
    const r = parseVoiceText('show food this month', ctx);
    expect(r.type).toBe('query');
    if (r.type === 'query') {
      const food = cats.find((c) => c.name === 'Food')!;
      expect(r.filter.category_id).toBe(food.id);
      expect(r.filter.from).toBe(startOfMonthISO(new Date()));
    }
  });
});

describe('errors', () => {
  it('no amount', () => {
    const r = parseVoiceText('hello there', ctx);
    expect(r.type).toBe('error');
  });
  it('empty', () => {
    expect(parseVoiceText('   ', ctx).type).toBe('error');
  });
});
