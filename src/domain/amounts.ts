// Money formatting + number normalisation (Indian conventions).

export const UNITS: Record<string, number> = {
  k: 1000,
  thousand: 1000,
  hundred: 100,
  lakh: 100000,
  crore: 10000000,
};

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** ₹ + Indian grouping: fmtINR(100000) -> "₹1,00,000" */
export function fmtINR(n: number): string {
  return '₹' + inr.format(n);
}

/** Parse "1,000", "1,00,000", "100000" -> 100000 | null */
export function digitsToInt(s: string): number | null {
  const d = s.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(d)) return null;
  const v = parseInt(d, 10);
  return Number.isSafeInteger(v) ? v : null;
}

/** Round to whole rupees (v1 rule: no decimals). */
export function toWholeRupees(v: number): number {
  return Math.round(v);
}

/** Short spoken-friendly amount: 500 -> "five hundred", 2000 -> "two thousand". */
const SMALL: Record<number, string> = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven',
  12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
  16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen',
  20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty',
  60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety',
};

export function amountInWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(wordPair(crore) + ' crore');
  if (lakh) parts.push(wordPair(lakh) + ' lakh');
  if (thousand) parts.push(wordPair(thousand) + ' thousand');
  if (hundred) parts.push(wordPair(hundred) + ' hundred');
  if (rest) {
    if (rest < 20) parts.push(SMALL[rest]);
    else parts.push(SMALL[Math.floor(rest / 10) * 10] + ' ' + SMALL[rest % 10]);
  }
  return parts.join(' ');
}

function wordPair(n: number): string {
  if (n < 20) return SMALL[n];
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  return ones ? SMALL[tens] + ' ' + SMALL[ones] : SMALL[tens];
}
