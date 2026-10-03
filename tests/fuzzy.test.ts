import { describe, it, expect } from 'vitest';
import { bestPersonMatch, levenshtein, normalizeName } from '../src/domain/fuzzy';

const people = [
  { id: 'p1', name: 'Ravi' },
  { id: 'p2', name: 'Priya' },
  { id: 'p3', name: 'Arjun' },
];

describe('levenshtein', () => {
  it('distance 0 for equal', () => {
    expect(levenshtein('ravi', 'ravi')).toBe(0);
  });
  it('distance 1 for one char', () => {
    expect(levenshtein('rabi', 'ravi')).toBe(1);
  });
});

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  Ravi ')).toBe('ravi');
  });
  it('strips apostrophes', () => {
    expect(normalizeName("O'Neil")).toBe('oneil');
  });
});

describe('bestPersonMatch', () => {
  it('exact match (case-insensitive) has distance 0', () => {
    const m = bestPersonMatch('RAVI', people);
    expect(m).toEqual({ id: 'p1', name: 'Ravi', distance: 0 });
  });
  it('fuzzy: Rabi → Ravi', () => {
    const m = bestPersonMatch('Rabi', people);
    expect(m?.id).toBe('p1');
    expect(m?.distance).toBeGreaterThan(0);
  });
  it('fuzzy: Priya → Priya exact', () => {
    expect(bestPersonMatch('priya', people)?.distance).toBe(0);
  });
  it('no match when far away', () => {
    expect(bestPersonMatch('Zabdiel', people)).toBeNull();
  });
  it('short strings need exact', () => {
    expect(bestPersonMatch('a', people)).toBeNull();
  });
});
