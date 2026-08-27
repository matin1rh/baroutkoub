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

const PERSIAN_MONTH_NAMES: Record<string, number> = {
  'فروردین': 1, 'فروردين': 1,
  'اردیبهشت': 2, 'ارديبهشت': 2,
  'خرداد': 3,
  'تیر': 4, 'تير': 4,
  'مرداد': 5,
  'شهریور': 6, 'شهريور': 6,
  'مهر': 7,
  'آبان': 8, 'ابان': 8,
  'آذر': 9, 'اذر': 9,
  'دی': 10, 'دي': 10,
  'بهمن': 11,
  'اسفند': 12
};

const ENGLISH_MONTH_NAMES: Record<string, number> = {
  'jan': 1, 'january': 1,
  'feb': 2, 'february': 2,
  'mar': 3, 'march': 3,
  'apr': 4, 'april': 4,
  'may': 5,
  'jun': 6, 'june': 6,
  'jul': 7, 'july': 7,
  'aug': 8, 'august': 8,
  'sep': 9, 'september': 9,
  'oct': 10, 'october': 10,
  'nov': 11, 'november': 11,
  'dec': 12, 'december': 12
};

/**
 * Universal Date Parser & Converter to Unified Jalali (Solar Hijri) YYYY/MM/DD
 * Accurately parses:
 * - Gregorian Dates (e.g. 2024-05-15, 2024/05/15, 15/05/2024, May 15 2024, ISO timestamps)
 * - Jalali Dates (e.g. 1403/02/26, 1403-02-26, 03/02/26, 14030226, 26 اردیبهشت 1403)
 * - Excel Serial Numbers (e.g. 45427)
 * - JavaScript Date objects
 */
export function parseJalaliDate(val: any): string | null {
  if (val === null || val === undefined) return null;

  // 1. JavaScript Date object
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      try {
        const j = jalaali.toJalaali(val);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      } catch {
        return null;
      }
    }
    return null;
  }

  // 2. Excel Serial Numbers (e.g., numbers between 25000 and 75000 -> years ~1968 to 2105)
  if (typeof val === 'number' && val >= 25000 && val <= 75000) {
    try {
      const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (!isNaN(jsDate.getTime())) {
        const j = jalaali.toJalaali(jsDate);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      }
    } catch {
      // fallback
    }
  }

  let s = normalizeDigits(val).trim();
  if (!s || ['-', 'nan', 'none', 'null', 'undefined', '0', '0000/00/00', '0000-00-00', '00000000'].includes(s.toLowerCase())) {
    return null;
  }

  // If string is purely a number and matches an Excel serial date range
  if (/^\d{5}$/.test(s)) {
    const serialNum = parseInt(s, 10);
    if (serialNum >= 25000 && serialNum <= 75000) {
      try {
        const jsDate = new Date(Math.round((serialNum - 25569) * 86400 * 1000));
        if (!isNaN(jsDate.getTime())) {
          const j = jalaali.toJalaali(jsDate);
          return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
        }
      } catch {
        // fallback
      }
    }
  }

  // Check for Persian month names (e.g., "26 اردیبهشت 1403" or "ش 1403 اردیبهشت 26")
  for (const [mName, mNum] of Object.entries(PERSIAN_MONTH_NAMES)) {
    if (s.includes(mName)) {
      const numbers = s.match(/\d+/g);
      if (numbers && numbers.length >= 2) {
        let n1 = parseInt(numbers[0], 10);
        let n2 = parseInt(numbers[1], 10);
        let jy = n1 > 100 ? n1 : n2;
        let jd = n1 > 100 ? n2 : n1;
        if (jy < 100) jy += (jy >= 50 ? 1300 : 1400);
        if (jy >= 1300 && jy <= 1500 && jd >= 1 && jd <= 31) {
          return `${jy}/${String(mNum).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
        }
      }
    }
  }

  // Check for English month names (e.g., "15 May 2024", "May 15, 2024", "15-May-2024")
  const sLower = s.toLowerCase();
  for (const [mName, mNum] of Object.entries(ENGLISH_MONTH_NAMES)) {
    if (sLower.includes(mName)) {
      const numbers = s.match(/\d+/g);
      if (numbers && numbers.length >= 2) {
        let n1 = parseInt(numbers[0], 10);
        let n2 = parseInt(numbers[1], 10);
        let gy = n1 > 100 ? n1 : n2;
        let gd = n1 > 100 ? n2 : n1;
        if (gy >= 1900 && gy <= 2100 && gd >= 1 && gd <= 31) {
          try {
            const j = jalaali.toJalaali(gy, mNum, gd);
            return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
          } catch {
            // fallback
          }
        }
      }
    }
  }

  // 3. Regular Expressions matching delimited dates anywhere in the string
  // Handles prefixes like "ش 1405/03/09", "ش. 1405/03/09", "شمسی 1405/03/09", "م 2024/05/15", "1405/03/09 - 14:00"
  
  // Pattern A: 4-digit year first: YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
  const yFirstMatch = s.match(/(?:^|[^\d])(\d{4})[\/\-.\\_](\d{1,2})[\/\-.\\_](\d{1,2})(?:$|[^\d])/);
  if (yFirstMatch) {
    const y = parseInt(yFirstMatch[1], 10);
    const m = parseInt(yFirstMatch[2], 10);
    const d = parseInt(yFirstMatch[3], 10);

    // Jalali YYYY/MM/DD (e.g. 1405/03/09 or 1399/12/29)
    if (y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }

    // Gregorian YYYY/MM/DD (e.g. 2024-05-15 or 2024/05/15)
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      try {
        const j = jalaali.toJalaali(y, m, d);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      } catch {
        // fallback
      }
    }
  }

  // Pattern B: 4-digit year last: DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
  const yLastMatch = s.match(/(?:^|[^\d])(\d{1,2})[\/\-.\\_](\d{1,2})[\/\-.\\_](\d{4})(?:$|[^\d])/);
  if (yLastMatch) {
    const p1 = parseInt(yLastMatch[1], 10);
    const p2 = parseInt(yLastMatch[2], 10);
    const y = parseInt(yLastMatch[3], 10);

    let m = p2;
    let d = p1;
    if (p1 <= 12 && p2 > 12) {
      m = p1;
      d = p2;
    }

    // Jalali DD/MM/YYYY
    if (y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }

    // Gregorian DD/MM/YYYY
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      try {
        const j = jalaali.toJalaali(y, m, d);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      } catch {
        // fallback
      }
    }
  }

  // Pattern C: 2-digit year (e.g. "ش 05/03/09" or "99/12/28" or "03/02/26")
  const y2Match = s.match(/(?:^|[^\d])(\d{2})[\/\-.\\_](\d{1,2})[\/\-.\\_](\d{1,2})(?:$|[^\d])/);
  if (y2Match) {
    const p1 = parseInt(y2Match[1], 10);
    const p2 = parseInt(y2Match[2], 10);
    const p3 = parseInt(y2Match[3], 10);

    if (p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) {
      const jy = p1 >= 50 ? 1300 + p1 : 1400 + p1;
      return `${jy}/${String(p2).padStart(2, '0')}/${String(p3).padStart(2, '0')}`;
    }
  }

  // Pattern D: 8-digit continuous number (e.g., "14050309", "ش 14050309", "20240515")
  const digit8Match = s.match(/(?:^|[^\d])(\d{8})(?:$|[^\d])/);
  if (digit8Match) {
    const digits = digit8Match[1];
    const y = parseInt(digits.slice(0, 4), 10);
    const m = parseInt(digits.slice(4, 6), 10);
    const d = parseInt(digits.slice(6, 8), 10);

    if (y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      try {
        const j = jalaali.toJalaali(y, m, d);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      } catch {
        // fallback
      }
    }
  }

  // Pattern E: 6-digit continuous number (e.g., "050309")
  const digit6Match = s.match(/(?:^|[^\d])(\d{6})(?:$|[^\d])/);
  if (digit6Match) {
    const digits = digit6Match[1];
    const pYear2 = parseInt(digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(2, 4), 10);
    const d = parseInt(digits.slice(4, 6), 10);
    const jy = pYear2 >= 50 ? 1300 + pYear2 : 1400 + pYear2;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${jy}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }
  }

  // 4. Fallback generic JS Date parser (e.g. for RFC/ISO strings)
  try {
    const timestamp = Date.parse(s);
    if (!isNaN(timestamp)) {
      const parsedD = new Date(timestamp);
      const parsedYear = parsedD.getFullYear();
      if (parsedYear >= 1970 && parsedYear <= 2100) {
        const j = jalaali.toJalaali(parsedD);
        return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
      }
    }
  } catch {
    // ignore
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
