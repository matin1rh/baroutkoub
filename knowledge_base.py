import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from src.normalization import normalize_persian_text

class KnowledgeBase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sys_desc TEXT,
                    sys_name TEXT,
                    bank_desc TEXT,
                    bank_name TEXT,
                    decision TEXT, -- 'APPROVED' or 'REJECTED'
                    reason TEXT,
                    features TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_decisions 
                ON user_decisions(sys_name, bank_name, decision)
            """)
            conn.commit()

    def record_decision(self, sys_row: Dict[str, Any], bank_row: Dict[str, Any], decision: str, reason: str):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT INTO user_decisions (sys_desc, sys_name, bank_desc, bank_name, decision, reason, features)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                normalize_persian_text(str(sys_row.get("raw_desc", ""))),
                normalize_persian_text(str(sys_row.get("account_name", ""))),
                normalize_persian_text(str(bank_row.get("description", ""))),
                normalize_persian_text(str(bank_row.get("party_name", ""))),
                decision,
                reason,
                json.dumps({"amount": sys_row.get("amount"), "tracking": sys_row.get("tracking_code")})
            ))
            conn.commit()

    def find_similar_cases(self, sys_name: str, sys_desc: str, bank_name: str, bank_desc: str, limit: int = 3) -> List[Dict[str, Any]]:
        norm_sys_name = normalize_persian_text(sys_name)
        norm_bank_name = normalize_persian_text(bank_name)
        
        results = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT sys_desc, sys_name, bank_desc, bank_name, decision, reason 
                FROM user_decisions
                WHERE (sys_name != '' AND sys_name = ?) 
                   OR (bank_name != '' AND bank_name = ?)
                ORDER BY id DESC LIMIT ?
            """, (norm_sys_name, norm_bank_name, limit))
            for row in cursor.fetchall():
                results.append(dict(row))
        return results