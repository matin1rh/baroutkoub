import hashlib
import json
import sqlite3
from typing import Dict, Any, Optional, List
from openai import OpenAI
from pydantic import BaseModel, Field
from config.settings import config

class AIResponseSchema(BaseModel):
    is_match: bool = Field(description="آیا این دو تراکنش با توجه به شواهد متناظر یکدیگر هستند؟")
    confidence: float = Field(description="امتیاز اطمینان بین 0.0 تا 1.0", ge=0.0, le=1.0)
    reasoning: str = Field(description="دلیل فارسی، خلاصه و دقیق برای تطبیق یا عدم تطبیق")

class AIReconciliationClient:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or config.openai_api_key
        self.model = model or config.openai_model
        self.cache_db = config.cache_db_path
        self._init_cache()
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def _init_cache(self):
        with sqlite3.connect(self.cache_db) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ai_cache (
                    prompt_hash TEXT PRIMARY KEY,
                    response_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

    def _get_cache(self, prompt_hash: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.cache_db) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT response_json FROM ai_cache WHERE prompt_hash = ?", (prompt_hash,))
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
        return None

    def _set_cache(self, prompt_hash: str, data: Dict[str, Any]):
        with sqlite3.connect(self.cache_db) as conn:
            conn.execute("INSERT OR REPLACE INTO ai_cache (prompt_hash, response_json) VALUES (?, ?)", 
                         (prompt_hash, json.dumps(data, ensure_ascii=False)))
            conn.commit()

    def evaluate_match(self, sys_tx: Dict[str, Any], bank_tx: Dict[str, Any], few_shots: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not self.client or not config.ai_enabled:
            return {
                "is_match": False,
                "confidence": 0.50,
                "reasoning": "موتور هوش مصنوعی غیرفعال است یا کلید API تعریف نشده است."
            }

        prompt_payload = {
            "system_record": {
                "account_name": sys_tx.get("account_name"),
                "tracking_code": sys_tx.get("tracking_code"),
                "document_type": sys_tx.get("doc_type"),
                "date": str(sys_tx.get("date")),
                "amount": sys_tx.get("amount")
            },
            "bank_record": {
                "party_name": bank_tx.get("party_name"),
                "description": bank_tx.get("description"),
                "deposit_id": bank_tx.get("deposit_id"),
                "serial_no": bank_tx.get("serial_no"),
                "date": str(bank_tx.get("date")),
                "amount": bank_tx.get("amount")
            },
            "historical_similar_decisions": few_shots
        }

        prompt_str = json.dumps(prompt_payload, ensure_ascii=False, sort_keys=True)
        prompt_hash = hashlib.sha256(prompt_str.encode("utf-8")).hexdigest()

        cached = self._get_cache(prompt_hash)
        if cached:
            return cached

        system_instruction = (
            "شما یک کارشناس ارشد حسابداری و تطبیق بانکی در سیستم مالی ایران هستید. "
            "وظیفه شما ارزیابی معنایی توضیحات، اسامی طرف‌حساب و کدهای رهگیری داخل شرح بانک و سیستم است. "
            "قوانین سخت (مبلغ یکسان و جهت تراکنش) قبلاً در پایتون تأیید شده‌اند. "
            "فقط تشابه اسمی، تناظر کدهای داخل شرح و قرائن معنایی را بررسی کرده و پاسخ ساختاریافته تحویل دهید."
        )

        try:
            completion = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt_str}
                ],
                response_format=AIResponseSchema,
                timeout=12.0
            )
            parsed_msg = completion.choices[0].message.parsed
            result = {
                "is_match": parsed_msg.is_match,
                "confidence": float(parsed_msg.confidence),
                "reasoning": parsed_msg.reasoning
            }
            self._set_cache(prompt_hash, result)
            return result
        except Exception as e:
            return {
                "is_match": False,
                "confidence": 0.50,
                "reasoning": f"خطا در ارتباط با هوش مصنوعی: {str(e)}"
            }