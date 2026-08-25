from typing import List, Dict, Any, Tuple, Optional
import numpy as np
from scipy.optimize import linear_sum_assignment
from src.normalization import (
    jalali_days_difference,
    extract_numeric_tokens,
    compute_text_similarity,
    normalize_persian_text,
    normalize_digits
)
from src.knowledge_base import KnowledgeBase
from src.ai_client import AIReconciliationClient
from config.settings import config

class ReconciliationEngine:
    def __init__(
        self,
        kb: KnowledgeBase,
        ai_client: Optional[AIReconciliationClient] = None,
        max_date_diff: int = 5,
        direction_mode: str = "AUTO"
    ):
        self.kb = kb
        self.ai_client = ai_client
        self.max_date_diff = max_date_diff
        self.direction_mode = direction_mode

    def _compute_pair_score(self, sys_row: Dict[str, Any], bank_row: Dict[str, Any], is_unique: bool, is_toman_match: bool) -> Tuple[float, str, bool]:
        sys_track = normalize_digits(str(sys_row.get("tracking_code", ""))).strip()
        bank_serial = normalize_digits(str(bank_row.get("serial_no", ""))).strip()
        bank_dep_id = normalize_digits(str(bank_row.get("deposit_id", ""))).strip()
        bank_desc = str(bank_row.get("description", ""))
        bank_party = str(bank_row.get("party_name", ""))
        sys_acc_name = str(sys_row.get("account_name", ""))

        # ۱. تطبیق با کد رهگیری یا سریال
        if sys_track and len(sys_track) >= 3:
            if sys_track == bank_serial or sys_track == bank_dep_id:
                return 0.99, f"تطبیق قطعی با شناسه/سریال بانک ({sys_track})", False
            
            if sys_track in normalize_digits(bank_desc):
                return 0.98, f"کد رهگیری ({sys_track}) در شرح بانک قرار دارد", False
            
            for tok in extract_numeric_tokens(bank_desc, min_length=len(sys_track)):
                if sys_track == tok or sys_track in tok or tok in sys_track:
                    return 0.96, f"تطبیق توکن رهگیری ({sys_track}) با شرح بانک", False

        # ۲. تطبیق نام و شرح
        name_sim = compute_text_similarity(sys_acc_name, bank_party)
        desc_sim = compute_text_similarity(sys_acc_name, bank_desc)
        best_sim = max(name_sim, desc_sim)

        if best_sim >= 0.35:
            return 0.94, f"تشابه نام و شرح تراکنش ({sys_acc_name})", False

        # ۳. تطبیق مبلغ
        if is_toman_match:
            return 0.88, "تطبیق مبلغ با ضریب ریال/تومان (نیازمند بررسی)", True

        if is_unique:
            return 0.92, "مبلغ یکتا و منطبق در هر دو فایل", False

        return 0.85, "مبلغ یکسان (دارای چند تراکنش هم‌مبلغ)", True

    def reconcile(self, sys_records: List[Dict[str, Any]], bank_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        matches_sys_to_bank: Dict[int, Dict[str, Any]] = {}
        matches_bank_to_sys: Dict[int, Dict[str, Any]] = {}

        matched_bank_indices = set()
        matched_sys_indices = set()

        # شاخص‌بندی مبالغ بانک: (مبلغ دقیق) و (مبلغ بر مبنای تومان / ضریب 10)
        bank_by_amt: Dict[int, List[int]] = {}
        for b_idx, b_rec in enumerate(bank_records):
            bank_by_amt.setdefault(b_rec["amount"], []).append(b_idx)

        # ساخت ماتریس تطبیق هوشمند
        n_sys = len(sys_records)
        n_bank = len(bank_records)

        # فاز اول: بررسی کاندیداهای مبالغ دقیق و ضریب ریال/تومان
        candidates = []
        for s_idx, s_rec in enumerate(sys_records):
            s_amt = s_rec["amount"]
            
            # کاندیداهای مستقیم
            if s_amt in bank_by_amt:
                for b_idx in bank_by_amt[s_amt]:
                    candidates.append((s_idx, b_idx, False))
            
            # کاندیداهای ریال/تومان (۱۰ برابر یا یک‌دهم)
            if (s_amt // 10) in bank_by_amt and s_amt % 10 == 0:
                for b_idx in bank_by_amt[s_amt // 10]:
                    candidates.append((s_idx, b_idx, True))
            if (s_amt * 10) in bank_by_amt:
                for b_idx in bank_by_amt[s_amt * 10]:
                    candidates.append((s_idx, b_idx, True))

        if not candidates:
            return {"sys_matches": {}, "bank_matches": {}, "detected_mode": "DIRECT"}

        # حل بهینه گراف دوطرفه
        unique_sys = list({c[0] for c in candidates})
        unique_bank = list({c[1] for c in candidates})
        sys_map = {idx: i for i, idx in enumerate(unique_sys)}
        bank_map = {idx: j for j, idx in enumerate(unique_bank)}

        score_matrix = np.zeros((len(unique_sys), len(unique_bank)), dtype=float)
        meta_matrix = [[None for _ in range(len(unique_bank))] for _ in range(len(unique_sys))]

        for s_idx, b_idx, is_toman in candidates:
            i = sys_map[s_idx]
            j = bank_map[b_idx]
            s_rec = sys_records[s_idx]
            b_rec = bank_records[b_idx]

            is_unique = (len(bank_by_amt.get(s_rec["amount"], [])) == 1)
            score, reason, _ = self._compute_pair_score(s_rec, b_rec, is_unique, is_toman)

            score_matrix[i, j] = score
            meta_matrix[i][j] = {"score": score, "reason": reason}

        # الگوریتم انتساب بهینه مجارستانی
        cost_matrix = 1.0 - score_matrix
        row_ind, col_ind = linear_sum_assignment(cost_matrix)

        for r, c in zip(row_ind, col_ind):
            assigned_score = score_matrix[r, c]
            if assigned_score >= 0.75:
                s_idx = unique_sys[r]
                b_idx = unique_bank[c]
                meta = meta_matrix[r][c]

                status = "GREEN" if assigned_score >= 0.90 else "YELLOW"
                matches_sys_to_bank[s_idx] = {
                    "matched_index": b_idx,
                    "status": status,
                    "confidence": assigned_score,
                    "reason": meta["reason"]
                }
                matches_bank_to_sys[b_idx] = {
                    "matched_index": s_idx,
                    "status": status,
                    "confidence": assigned_score,
                    "reason": meta["reason"]
                }

        return {
            "sys_matches": matches_sys_to_bank,
            "bank_matches": matches_bank_to_sys,
            "detected_mode": "SMART_MULTI_TIER"
        }