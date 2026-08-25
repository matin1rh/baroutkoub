import jalaali from 'jalaali-js';

const PERSIAN_ARABIC_DIGITS_MAP: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_TO_PERSIAN_CHARS_MAP: Record<string, string> = {
  'ي': 'ی',
  'ك': 'ک',
  'ة': 'ه',
  'ۀ': 'ه',
  'ؤ': 'و',
  'إ': 'ا',
  'أ': 'ا',
  'آ': 'ا',
  'ء': '',
  'ـ': '',
};

export function normalizeDigits(text: any): string {
  if (text === null || text === undefined) return '';
  let s = String(text).replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_ARABIC_DIGITS_MAP[ch] || ch).trim();
  if (s.endsWith('.0')) {
    s = s.slice(0, -2);
  }
  return s;
}

export function normalizePersianText(text: any): string {
  if (!text) return '';
  let str = String(text);
  str = normalizeDigits(str);
  str = str.replace(/[يكةۀؤإأآءـ]/g, (ch) => ARABIC_TO_PERSIAN_CHARS_MAP[ch] !== undefined ? ARABIC_TO_PERSIAN_CHARS_MAP[ch] : ch);
  // Remove zero-width non-joiners & special spaces
  str = str.replace(/[\u200c\u200b\u200e\u200f\ufeff]/g, ' ');
  // Replace non-alphanumeric/spaces with space
  str = str.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  str = str.replace(/\s+/g, ' ').trim().toLowerCase();
  return str;
}

export function parseAmount(val: any): number | null {
  if (val === null || val === undefined) return null;
  const valStr = normalizeDigits(val).replace(/[,_\s]/g, '');
  const f = parseFloat(valStr);
  if (isNaN(f)) return null;
  const amt = Math.round(Math.abs(f));
  return amt > 0 ? amt : null;
}

export interface JalaliDateObj {
  year: number;
  month: number;
  day: number;
  formatted: string;
}

export function parseJalaliDate(val: any): string | null {
  if (val === null || val === undefined) return null;

  if (val instanceof Date && !isNaN(val.getTime())) {
    try {
      const j = jalaali.toJalaali(val);
      return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
    } catch {
      // fallback
    }
  }

  let s = normalizeDigits(val).trim();
  if (!s || ['-', 'nan', 'none', '0', '0000/00/00', '00000000'].includes(s.toLowerCase())) {
    return null;
  }

  s = s.split(/\s+/)[0];
  const sClean = s.replace(/[-/.\s]/g, '');

  if (sClean.length >= 6) {
    let full = sClean;
    if (sClean.length === 6) {
      full = '14' + sClean;
    }
    if (full.length >= 8 && /^\d{8}/.test(full)) {
      const y = parseInt(full.slice(0, 4), 10);
      const m = parseInt(full.slice(4, 6), 10);
      const d = parseInt(full.slice(6, 8), 10);

      if (y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
      } else if (y >= 1900 && y <= 2100) {
        try {
          const j = jalaali.toJalaali(new Date(y, m - 1, d));
          return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
        } catch {
          // ignore
        }
      }
    }
  }

  const parts = s.split(/[-/.\s]+/).map((p) => parseInt(p, 10)).filter((p) => !isNaN(p));
  if (parts.length >= 3) {
    let [p1, p2, p3] = parts;
    if (p1 < 100) p1 += 1400;
    if (p1 >= 1300 && p1 <= 1500 && p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) {
      return `${p1}/${String(p2).padStart(2, '0')}/${String(p3).padStart(2, '0')}`;
    }
  }

  return null;
}

export function jalaliDaysDifference(d1Str: string | null, d2Str: string | null): number | null {
  if (!d1Str || !d2Str) return null;
  try {
    const p1 = d1Str.split('/').map(Number);
    const p2 = d2Str.split('/').map(Number);
    if (p1.length < 3 || p2.length < 3) return null;

    const g1 = jalaali.toGregorian(p1[0], p1[1], p1[2]);
    const g2 = jalaali.toGregorian(p2[0], p2[1], p2[2]);

    const date1 = new Date(g1.gy, g1.gm - 1, g1.gd).getTime();
    const date2 = new Date(g2.gy, g2.gm - 1, g2.gd).getTime();

    const diffDays = Math.round(Math.abs(date1 - date2) / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch {
    return null;
  }
}

export function extractNumericTokens(text: any, minLength: number = 4): Set<string> {
  if (!text) return new Set();
  const cleaned = normalizeDigits(String(text));
  const matches = cleaned.match(new RegExp(`\\d{${minLength},}`, 'g'));
  return new Set(matches || []);
}

export function computeTextSimilarity(s1: string, s2: string): number {
  const t1 = new Set(normalizePersianText(s1).split(' ').filter(Boolean));
  const t2 = new Set(normalizePersianText(s2).split(' ').filter(Boolean));
  if (t1.size === 0 || t2.size === 0) return 0.0;

  let intersectionCount = 0;
  t1.forEach((token) => {
    if (t2.has(token)) intersectionCount++;
  });

  const unionSize = new Set([...t1, ...t2]).size;
  const jaccard = unionSize > 0 ? intersectionCount / unionSize : 0;
  const minSize = Math.min(t1.size, t2.size);
  const overlap = minSize > 0 ? intersectionCount / minSize : 0;

  return jaccard * 0.3 + overlap * 0.7;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(amount);
}
