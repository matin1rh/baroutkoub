import re
from typing import Optional, Set
from datetime import datetime, date
import jdatetime

PERSIAN_TO_ENGLISH_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

ARABIC_TO_PERSIAN_CHARS = str.maketrans({
    "ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "ؤ": "و", "إ": "ا", "أ": "ا", "آ": "ا", "ء": "", "ـ": "",
})

def normalize_digits(text: Optional[any]) -> str:
    if text is None:
        return ""
    s = str(text).translate(PERSIAN_TO_ENGLISH_DIGITS).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s

def normalize_persian_text(text: Optional[any]) -> str:
    if not text:
        return ""
    text = str(text)
    text = normalize_digits(text)
    text = text.translate(ARABIC_TO_PERSIAN_CHARS)
    text = re.sub(r'[\u200c\u200b\u200e\u200f\ufeff]', ' ', text)
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip().lower()
    return text

def parse_amount(val) -> Optional[int]:
    if val is None:
        return None
    val_str = normalize_digits(str(val))
    val_str = re.sub(r'[,_\s]', '', val_str)
    try:
        f = float(val_str)
        amt = int(round(abs(f)))
        return amt if amt > 0 else None
    except (ValueError, TypeError):
        return None

def parse_jalali_date(val) -> Optional[jdatetime.date]:
    if val is None:
        return None
    
    if isinstance(val, (datetime, date)):
        if isinstance(val, datetime):
            val = val.date()
        try:
            return jdatetime.date.fromgregorian(date=val)
        except Exception:
            pass

    s = normalize_digits(str(val)).strip()
    if not s or s in ("-", "nan", "none", "0", "0000/00/00", "00000000"):
        return None
        
    s = s.split()[0]
    s_clean = re.sub(r'[-/.\s]', '', s)
    
    if len(s_clean) >= 6:
        if len(s_clean) == 6:  # مثلاً 030520 (1403/05/20)
            s_clean = "14" + s_clean

        if len(s_clean) >= 8 and s_clean[:8].isdigit():
            y = int(s_clean[:4])
            m = int(s_clean[4:6])
            d = int(s_clean[6:8])
            if 1300 <= y <= 1500 and 1 <= m <= 12 and 1 <= d <= 31:
                try:
                    return jdatetime.date(y, m, d)
                except ValueError:
                    return jdatetime.date(y, m, min(d, 29))
            elif 1900 <= y <= 2100:
                try:
                    return jdatetime.date.fromgregorian(date=date(y, m, d))
                except ValueError:
                    pass
                
    parts = re.split(r'[-/.\s]+', s)
    if len(parts) >= 3:
        try:
            p1, p2, p3 = int(parts[0]), int(parts[1]), int(parts[2])
            if p1 < 100:
                p1 += 1400
            if 1300 <= p1 <= 1500 and 1 <= p2 <= 12 and 1 <= p3 <= 31:
                return jdatetime.date(p1, p2, p3)
        except (ValueError, TypeError):
            pass
            
    return None

def jalali_days_difference(d1: Optional[jdatetime.date], d2: Optional[jdatetime.date]) -> Optional[int]:
    if not d1 or not d2:
        return None
    try:
        g1 = d1.togregorian()
        g2 = d2.togregorian()
        return abs((g1 - g2).days)
    except Exception:
        return None

def extract_numeric_tokens(text: Optional[str], min_length: int = 4) -> Set[str]:
    if not text:
        return set()
    cleaned = normalize_digits(str(text))
    return set(re.findall(rf'\d{{{min_length},}}', cleaned))

def compute_text_similarity(s1: str, s2: str) -> float:
    t1 = set(normalize_persian_text(s1).split())
    t2 = set(normalize_persian_text(s2).split())
    if not t1 or not t2:
        return 0.0
    intersection = t1.intersection(t2)
    union = t1.union(t2)
    jaccard = len(intersection) / len(union) if union else 0.0
    overlap = len(intersection) / min(len(t1), len(t2)) if min(len(t1), len(t2)) > 0 else 0.0
    return (jaccard * 0.3) + (overlap * 0.7)