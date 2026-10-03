import { describe, it, expect } from 'vitest';
import { amountInWords, digitsToInt, fmtINR, toWholeRupees } from '../src/domain/amounts';

describe('fmtINR (Indian grouping)', () => {
  it('formats small amounts', () => {
    expect(fmtINR(500)).toBe('₹500');
  });
  it('groups thousands', () => {
    expect(fmtINR(1000)).toBe('₹1,000');
  });
  it('groups lakh in Indian style', () => {
    expect(fmtINR(100000)).toBe('₹1,00,000');
  });
  it('groups large values', () => {
    expect(fmtINR(1234567)).toBe('₹12,34,567');
  });
});

describe('digitsToInt', () => {
  it('parses plain digits', () => {
    expect(digitsToInt('500')).toBe(500);
  });
  it('parses western grouping', () => {
    expect(digitsToInt('1,000')).toBe(1000);
  });
  it('parses Indian grouping', () => {
    expect(digitsToInt('1,00,000')).toBe(100000);
  });
  it('rejects junk', () => {
    expect(digitsToInt('abc')).toBeNull();
    expect(digitsToInt('')).toBeNull();
  });
});

describe('toWholeRupees (v1: integers only)', () => {
  it('rounds', () => {
    expect(toWholeRupees(99.4)).toBe(99);
    expect(toWholeRupees(99.6)).toBe(100);
  });
});

describe('amountInWords (spoken feedback)', () => {
  it('small', () => {
    expect(amountInWords(500)).toBe('five hundred');
  });
  it('thousands', () => {
    expect(amountInWords(2000)).toBe('two thousand');
  });
  it('lakh', () => {
    expect(amountInWords(100000)).toBe('one lakh');
  });
  it('lakh + thousand', () => {
    expect(amountInWords(150000)).toBe('one lakh fifty thousand');
  });
  it('twenty five', () => {
    expect(amountInWords(25)).toBe('twenty five');
  });
});
