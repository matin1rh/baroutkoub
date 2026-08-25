import sys
import os
from pathlib import Path
from typing import Dict, List, Any, Tuple
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QFileDialog, QLineEdit, QComboBox,
    QProgressBar, QTabWidget, QTreeWidget, QTreeWidgetItem,
    QMessageBox, QHeaderView, QGroupBox, QSpinBox, QSplitter
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QColor

from config.settings import config
from src.knowledge_base import KnowledgeBase
from src.ai_client import AIReconciliationClient
from src.matcher import ReconciliationEngine
from src.excel_io import ExcelProcessor

COLOR_CREDIT = QColor("#E8F5E9")  # سبز ملایم برای بستانکار
COLOR_DEBIT = QColor("#E3F2FD")   # آبی ملایم برای بدهکار
COLOR_GROUP = QColor("#FFF9C4")   # زرد ملایم برای سطرهای گروهی

class ReconciliationWorker(QThread):
    progress = pyqtSignal(int, str)
    finished_signal = pyqtSignal(dict)
    error_signal = pyqtSignal(str)

    def __init__(self, sys_path: str, bank_path: str, max_days: int, api_key: str, model: str):
        super().__init__()
        self.sys_path = sys_path
        self.bank_path = bank_path
        self.max_days = max_days
        self.api_key = api_key
        self.model = model

    def run(self):
        try:
            self.progress.emit(10, "در حال خواندن و استخراج فایل‌های اکسل...")
            sys_records = ExcelProcessor.read_system_file(self.sys_path)
            bank_records = ExcelProcessor.read_bank_file(self.bank_path)

            if not sys_records or not bank_records:
                self.error_signal.emit("سطر معتبری در یکی از فایل‌ها پیدا نشد.")
                return

            self.progress.emit(40, f"تراکنش‌ها استخراج شدند: سیستم ({len(sys_records)}) | بانک ({len(bank_records)})")
            kb = KnowledgeBase(config.kb_db_path)
            ai_client = AIReconciliationClient(api_key=self.api_key, model=self.model) if self.api_key else None
            
            engine = ReconciliationEngine(kb=kb, ai_client=ai_client, max_date_diff=self.max_days)
            self.progress.emit(70, "اجرای الگوریتم چندلایه و انتساب مجارستانی...")
            match_results = engine.reconcile(sys_records, bank_records)

            self.progress.emit(90, "مرتب‌سازی بر اساس مبلغ و تولید اکسل‌ها...")
            out_dir = Path(self.sys_path).parent / "Reconciliation_Results"
            out_dir.mkdir(exist_ok=True)

            out_sys = str(out_dir / "سیست_تطبیق_یافته.xlsx")
            out_bank = str(out_dir / "بانک_تطبیق_یافته.xlsx")
            out_rep = str(out_dir / "گزارش_جامع_مغایرت.xlsx")

            ExcelProcessor.write_reconciliation_results(
                self.sys_path, self.bank_path,
                sys_records, bank_records,
                match_results, out_sys, out_bank, out_rep
            )

            self.progress.emit(100, "تطبیق با موفقیت انجام شد.")
            self.finished_signal.emit({
                "sys_path": self.sys_path,
                "bank_path": self.bank_path,
                "sys_records": sys_records,
                "bank_records": bank_records,
                "matches": match_results,
                "rejected_sys": set(),
                "rejected_bank": set(),
                "out_sys": out_sys,
                "out_bank": out_bank,
                "out_rep": out_rep
            })
        except Exception as e:
            self.error_signal.emit(f"خطا: {str(e)}")

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("تطبیق هوشمند تراکنش‌های بانکی (نسخه تجمیعی پیشرفته)")
        self.resize(1350, 880)
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        
        self.kb = KnowledgeBase(config.kb_db_path)
        self.data_store = None

        self._init_ui()

    def _init_ui(self):
        main_widget = QWidget()
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(10, 10, 10, 10)
        
        self.tabs = QTabWidget()
        
        self.tab_main = QWidget()
        self._setup_main_tab()
        self.tabs.addTab(self.tab_main, "پردازش و تطبیق خودکار")

        self.tab_review = QWidget()
        self._setup_review_tab()
        self.tabs.addTab(self.tab_review, "بازبینی تجمیعی و انتساب دستی")

        main_layout.addWidget(self.tabs)
        self.setCentralWidget(main_widget)

    def _setup_main_tab(self):
        layout = QVBoxLayout(self.tab_main)

        file_group = QGroupBox("انتخاب فایل‌های اکسل")
        fg_layout = QVBoxLayout(file_group)

        h1 = QHBoxLayout()
        self.txt_sys = QLineEdit()
        self.txt_sys.setPlaceholderText("مسیر فایل سیسست.xlsx")
        btn_sys = QPushButton("انتخاب فایل سیست")
        btn_sys.clicked.connect(lambda: self._select_file(self.txt_sys))
        h1.addWidget(QLabel("فایل سیست:"))
        h1.addWidget(self.txt_sys)
        h1.addWidget(btn_sys)
        fg_layout.addLayout(h1)

        h2 = QHBoxLayout()
        self.txt_bank = QLineEdit()
        self.txt_bank.setPlaceholderText("مسیر فایل ملت.xlsx")
        btn_bank = QPushButton("انتخاب فایل بانک")
        btn_bank.clicked.connect(lambda: self._select_file(self.txt_bank))
        h2.addWidget(QLabel("فایل بانک:"))
        h2.addWidget(self.txt_bank)
        h2.addWidget(btn_bank)
        fg_layout.addLayout(h2)

        layout.addWidget(file_group)

        st_group = QGroupBox("تنظیمات")
        st_layout = QHBoxLayout(st_group)
        self.spn_days = QSpinBox()
        self.spn_days.setValue(3)
        self.spn_days.setRange(0, 30)
        st_layout.addWidget(QLabel("حداکثر اختلاف تاریخ (روز):"))
        st_layout.addWidget(self.spn_days)

        self.txt_api_key = QLineEdit(config.openai_api_key)
        self.txt_api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.txt_api_key.setPlaceholderText("اختیاری")
        st_layout.addWidget(QLabel("API Key:"))
        st_layout.addWidget(self.txt_api_key)
        layout.addWidget(st_group)

        self.btn_run = QPushButton("شروع مقایسه هوشمند")
        self.btn_run.setFixedHeight(48)
        self.btn_run.setStyleSheet("background-color: #007BFF; color: white; font-size: 15px; font-weight: bold; border-radius: 6px;")
        self.btn_run.clicked.connect(self._start_reconciliation)
        layout.addWidget(self.btn_run)

        self.progress_bar = QProgressBar()
        layout.addWidget(self.progress_bar)

        self.lbl_status = QLabel("آماده به کار...")
        layout.addWidget(self.lbl_status)

        res_group = QGroupBox("خلاصه نتایج")
        res_layout = QVBoxLayout(res_group)
        self.lbl_summary = QLabel("هنوز پردازشی انجام نشده است.")
        res_layout.addWidget(self.lbl_summary)

        btn_box = QHBoxLayout()
        self.btn_open_sys = QPushButton("باز کردن فایل سیست خروجی")
        self.btn_open_bank = QPushButton("باز کردن فایل بانک خروجی")
        self.btn_open_rep = QPushButton("باز کردن گزارش مغایرت")

        for b in (self.btn_open_sys, self.btn_open_bank, self.btn_open_rep):
            b.setEnabled(False)
            btn_box.addWidget(b)

        res_layout.addLayout(btn_box)
        layout.addWidget(res_group)
        layout.addStretch()

    def _setup_review_tab(self):
        layout = QVBoxLayout(self.tab_review)

        # نوار بالایی: راهنما و دکمه اتصال خودکار گروه‌های هم‌تعداد
        top_bar = QHBoxLayout()

        self.btn_auto_equal = QPushButton("⚡ اتصال خودکار تمام گروه‌هایی که تعداد و ماهیت برابر دارند (Auto-Link)")
        self.btn_auto_equal.setFixedHeight(40)
        self.btn_auto_equal.setStyleSheet("background-color: #6f42c1; color: white; font-weight: bold; font-size: 13px; border-radius: 5px; padding: 0 15px;")
        self.btn_auto_equal.clicked.connect(self._auto_match_equal_groups)

        lbl_cred = QLabel("🟩 بستانکار")
        lbl_cred.setStyleSheet("background-color: #E8F5E9; padding: 3px 8px; border-radius: 3px;")
        lbl_deb = QLabel("🟦 بدهکار")
        lbl_deb.setStyleSheet("background-color: #E3F2FD; padding: 3px 8px; border-radius: 3px;")

        top_bar.addWidget(self.btn_auto_equal)
        top_bar.addStretch()
        top_bar.addWidget(lbl_cred)
        top_bar.addWidget(lbl_deb)
        layout.addLayout(top_bar)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        # --- ۱. درخت سیستم (سمت راست) ---
        box_sys = QGroupBox("فیش‌های سیستم (سیسست) - تجمیعی بر اساس مبلغ و ماهیت")
        l_sys = QVBoxLayout(box_sys)
        
        self.tree_sys = QTreeWidget()
        self.tree_sys.setHeaderLabels(["عنوان / ردیف", "مبلغ", "ماهیت", "تعداد", "تاریخ / توضیحات"])
        self.tree_sys.header().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.tree_sys.setColumnWidth(0, 110)
        self.tree_sys.setColumnWidth(1, 130)
        self.tree_sys.setColumnWidth(2, 75)
        self.tree_sys.setColumnWidth(3, 60)
        self.tree_sys.setColumnWidth(4, 200)
        self.tree_sys.itemSelectionChanged.connect(self._on_sys_tree_selected)
        l_sys.addWidget(self.tree_sys)
        splitter.addWidget(box_sys)

        # --- ۲. درخت بانک (سمت چپ) ---
        box_bank = QGroupBox("فیش‌های بانک (ملت) - تجمیعی بر اساس مبلغ و ماهیت")
        l_bank = QVBoxLayout(box_bank)
        
        self.tree_bank = QTreeWidget()
        self.tree_bank.setHeaderLabels(["عنوان / ردیف", "مبلغ", "ماهیت", "تعداد", "تاریخ / شرح"])
        self.tree_bank.header().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.tree_bank.setColumnWidth(0, 110)
        self.tree_bank.setColumnWidth(1, 130)
        self.tree_bank.setColumnWidth(2, 75)
        self.tree_bank.setColumnWidth(3, 60)
        self.tree_bank.setColumnWidth(4, 200)
        l_bank.addWidget(self.tree_bank)
        splitter.addWidget(box_bank)

        layout.addWidget(splitter, 1)

        # نوار دکمه‌های پایینی
        btn_bar = QHBoxLayout()

        self.btn_reject_sys = QPushButton("❌ رد فیش/گروه سیستم")
        self.btn_reject_sys.setFixedHeight(44)
        self.btn_reject_sys.setStyleSheet("background-color: #dc3545; color: white; font-weight: bold; border-radius: 5px;")
        self.btn_reject_sys.clicked.connect(self._manual_reject_sys)

        self.btn_match_manual = QPushButton("🔗 اتصال و تطبیق موارد انتخابی (Match)")
        self.btn_match_manual.setFixedHeight(44)
        self.btn_match_manual.setStyleSheet("background-color: #28a745; color: white; font-weight: bold; font-size: 14px; border-radius: 5px; padding: 0 20px;")
        self.btn_match_manual.clicked.connect(self._manual_connect_pair)

        self.btn_reject_bank = QPushButton("❌ رد فیش/گروه بانک")
        self.btn_reject_bank.setFixedHeight(44)
        self.btn_reject_bank.setStyleSheet("background-color: #6c757d; color: white; font-weight: bold; border-radius: 5px;")
        self.btn_reject_bank.clicked.connect(self._manual_reject_bank)

        btn_bar.addWidget(self.btn_reject_sys, 1)
        btn_bar.addWidget(self.btn_match_manual, 2)
        btn_bar.addWidget(self.btn_reject_bank, 1)

        layout.addLayout(btn_bar)

    def _select_file(self, target: QLineEdit):
        path, _ = QFileDialog.getOpenFileName(self, "انتخاب فایل اکسل", "", "Excel Files (*.xlsx *.xls)")
        if path:
            target.setText(path)

    def _start_reconciliation(self):
        sys_p = self.txt_sys.text().strip()
        bank_p = self.txt_bank.text().strip()

        if not sys_p or not bank_p:
            QMessageBox.warning(self, "خطا", "لطفاً هر دو فایل را انتخاب کنید.")
            return

        self.btn_run.setEnabled(False)
        self.worker = ReconciliationWorker(
            sys_path=sys_p,
            bank_path=bank_p,
            max_days=self.spn_days.value(),
            api_key=self.txt_api_key.text().strip(),
            model="gpt-4o-mini"
        )
        self.worker.progress.connect(lambda v, m: (self.progress_bar.setValue(v), self.lbl_status.setText(m)))
        self.worker.finished_signal.connect(self._on_finished)
        self.worker.error_signal.connect(lambda e: (self.btn_run.setEnabled(True), QMessageBox.critical(self, "خطا", e)))
        self.worker.start()

    def _on_finished(self, data: dict):
        self.data_store = data
        self.btn_run.setEnabled(True)

        self._update_ui_summary()
        self._refresh_review_trees()

        self.btn_open_sys.setEnabled(True)
        self.btn_open_bank.setEnabled(True)
        self.btn_open_rep.setEnabled(True)

        self.btn_open_sys.clicked.connect(lambda: os.startfile(data["out_sys"]))
        self.btn_open_bank.clicked.connect(lambda: os.startfile(data["out_bank"]))
        self.btn_open_rep.clicked.connect(lambda: os.startfile(data["out_rep"]))

    def _update_ui_summary(self):
        if not self.data_store:
            return
        sys_matches = self.data_store["matches"]["sys_matches"]
        green = sum(1 for m in sys_matches.values() if m.get("status") == "GREEN")
        yellow = sum(1 for m in sys_matches.values() if m.get("status") == "YELLOW")
        red = len(self.data_store["sys_records"]) - len(sys_matches)

        self.lbl_summary.setText(
            f"<b>وضعیت کل:</b> "
            f"<span style='color: green; font-weight: bold;'>تطبیق قطعی (سبز): {green}</span> | "
            f"<span style='color: #b8860b; font-weight: bold;'>نیازمند بازبینی (زرد): {yellow}</span> | "
            f"<span style='color: red; font-weight: bold;'>اقلام باز و بدون تطبیق: {red}</span>"
        )

    def _refresh_review_trees(self):
        if not self.data_store:
            return

        sys_records = self.data_store["sys_records"]
        bank_records = self.data_store["bank_records"]
        sys_matches = self.data_store["matches"]["sys_matches"]
        bank_matches = self.data_store["matches"]["bank_matches"]
        rejected_sys = self.data_store["rejected_sys"]
        rejected_bank = self.data_store["rejected_bank"]

        # ۱. تجمیع و سورت سیستم
        self.tree_sys.clear()
        grouped_sys: Dict[Tuple[int, str], List[int]] = {}
        for s_idx, s_rec in enumerate(sys_records):
            if s_idx in rejected_sys:
                continue
            m = sys_matches.get(s_idx)
            if not m or m.get("status") == "YELLOW":
                key = (s_rec["amount"], s_rec["direction"])
                grouped_sys.setdefault(key, []).append(s_idx)

        sorted_sys_keys = sorted(grouped_sys.keys(), key=lambda k: (k[0], k[1]), reverse=True)

        for amt, dir_type in sorted_sys_keys:
            indices = grouped_sys[(amt, dir_type)]
            is_cred = (dir_type == "CREDIT")
            bg_color = COLOR_CREDIT if is_cred else COLOR_DEBIT
            type_str = "بستانکار" if is_cred else "بدهکار"

            group_item = QTreeWidgetItem([
                "گروه مبالغ",
                f"{amt:,}",
                type_str,
                f"{len(indices)} فیش",
                "جهت مشاهده کلیک کنید ⯆"
            ])
            group_item.setData(0, Qt.ItemDataRole.UserRole, {"type": "GROUP", "indices": indices, "amount": amt})
            group_item.setBackground(0, COLOR_GROUP)
            group_item.setBackground(1, COLOR_GROUP)

            for idx in indices:
                r = sys_records[idx]
                child = QTreeWidgetItem([
                    f"ردیف {r['original_row']}",
                    f"{r['amount']:,}",
                    type_str,
                    "۱",
                    f"{r['date'] or '-'} | {r['raw_desc']}"
                ])
                child.setData(0, Qt.ItemDataRole.UserRole, {"type": "SINGLE", "index": idx})
                for c in range(5):
                    child.setBackground(c, bg_color)
                group_item.addChild(child)

            self.tree_sys.addTopLevelItem(group_item)

        # ۲. تجمیع و سورت بانک
        self.tree_bank.clear()
        grouped_bank: Dict[Tuple[int, str], List[int]] = {}
        for b_idx, b_rec in enumerate(bank_records):
            if b_idx in rejected_bank:
                continue
            m = bank_matches.get(b_idx)
            if not m or m.get("status") == "YELLOW":
                key = (b_rec["amount"], b_rec["direction"])
                grouped_bank.setdefault(key, []).append(b_idx)

        sorted_bank_keys = sorted(grouped_bank.keys(), key=lambda k: (k[0], k[1]), reverse=True)

        for amt, dir_type in sorted_bank_keys:
            indices = grouped_bank[(amt, dir_type)]
            is_cred = (dir_type == "CREDIT")
            bg_color = COLOR_CREDIT if is_cred else COLOR_DEBIT
            type_str = "بستانکار" if is_cred else "بدهکار"

            group_item = QTreeWidgetItem([
                "گروه مبالغ",
                f"{amt:,}",
                type_str,
                f"{len(indices)} فیش",
                "جهت مشاهده کلیک کنید ⯆"
            ])
            group_item.setData(0, Qt.ItemDataRole.UserRole, {"type": "GROUP", "indices": indices, "amount": amt})
            group_item.setBackground(0, COLOR_GROUP)
            group_item.setBackground(1, COLOR_GROUP)

            for idx in indices:
                r = bank_records[idx]
                child = QTreeWidgetItem([
                    f"ردیف {r['original_row']}",
                    f"{r['amount']:,}",
                    type_str,
                    "۱",
                    f"{r['date'] or '-'} | {r['raw_desc']}"
                ])
                child.setData(0, Qt.ItemDataRole.UserRole, {"type": "SINGLE", "index": idx})
                for c in range(5):
                    child.setBackground(c, bg_color)
                group_item.addChild(child)

            self.tree_bank.addTopLevelItem(group_item)

    def _on_sys_tree_selected(self):
        sel = self.tree_sys.selectedItems()
        if not sel:
            return
        data = sel[0].data(0, Qt.ItemDataRole.UserRole)
        if not data:
            return
        target_amt = data.get("amount")
        if not target_amt:
            return

        for i in range(self.tree_bank.topLevelItemCount()):
            item = self.tree_bank.topLevelItem(i)
            b_data = item.data(0, Qt.ItemDataRole.UserRole)
            if b_data and b_data.get("amount") == target_amt:
                self.tree_bank.setCurrentItem(item)
                item.setExpanded(True)
                break

    def _auto_match_equal_groups(self):
        """تطبیق خودکار تمام گروه‌هایی که تعداد فیش و ماهیت دقیقاً برابر دارند"""
        if not self.data_store:
            QMessageBox.warning(self, "هشدار", "هنوز پردازشی انجام نشده است.")
            return

        sys_records = self.data_store["sys_records"]
        bank_records = self.data_store["bank_records"]
        sys_matches = self.data_store["matches"]["sys_matches"]
        bank_matches = self.data_store["matches"]["bank_matches"]
        rejected_sys = self.data_store["rejected_sys"]
        rejected_bank = self.data_store["rejected_bank"]

        # جمع‌آوری گروه‌های باقیمانده سیستم
        grouped_sys: Dict[Tuple[int, str], List[int]] = {}
        for s_idx, s_rec in enumerate(sys_records):
            if s_idx in rejected_sys:
                continue
            m = sys_matches.get(s_idx)
            if not m or m.get("status") == "YELLOW":
                key = (s_rec["amount"], s_rec["direction"])
                grouped_sys.setdefault(key, []).append(s_idx)

        # جمع‌آوری گروه‌های باقیمانده بانک
        grouped_bank: Dict[Tuple[int, str], List[int]] = {}
        for b_idx, b_rec in enumerate(bank_records):
            if b_idx in rejected_bank:
                continue
            m = bank_matches.get(b_idx)
            if not m or m.get("status") == "YELLOW":
                key = (b_rec["amount"], b_rec["direction"])
                grouped_bank.setdefault(key, []).append(b_idx)

        total_matched_pairs = 0
        matched_groups_count = 0

        for key, sys_indices in list(grouped_sys.items()):
            amt, dir_type = key
            bank_indices = grouped_bank.get(key)
            
            # در صورتی که ساختار معکوس حسابداری باشد
            if bank_indices is None:
                inv_dir = "DEBIT" if dir_type == "CREDIT" else "CREDIT"
                bank_indices = grouped_bank.get((amt, inv_dir))

            # اگر تعداد فیش‌ها دقیقاً برابر بود
            if bank_indices is not None and len(sys_indices) == len(bank_indices) and len(sys_indices) > 0:
                count = len(sys_indices)
                for i in range(count):
                    s_i = sys_indices[i]
                    b_i = bank_indices[i]
                    s_rec = sys_records[s_i]
                    b_rec = bank_records[b_i]

                    self.data_store["matches"]["sys_matches"][s_i] = {
                        "matched_index": b_i,
                        "status": "GREEN",
                        "confidence": 1.0,
                        "reason": "تطبیق خودکار گروه‌های هم‌تعداد و هم‌مبلغ"
                    }
                    self.data_store["matches"]["bank_matches"][b_i] = {
                        "matched_index": s_i,
                        "status": "GREEN",
                        "confidence": 1.0,
                        "reason": "تطبیق خودکار گروه‌های هم‌تعداد و هم‌مبلغ"
                    }
                    self.kb.record_decision(s_rec, b_rec, "APPROVED", "تطبیق خودکار گروه‌های هم‌تعداد")

                total_matched_pairs += count
                matched_groups_count += 1

        if total_matched_pairs > 0:
            self._save_changes_to_excel()
            QMessageBox.information(
                self,
                "تطبیق گروهی موفق",
                f"تعداد {matched_groups_count} گروه شامل {total_matched_pairs} فیش با تعداد و ماهیت کاملاً برابر، به صورت قطعی متصل شدند و از لیست بازبینی خارج گردیدند."
            )
        else:
            QMessageBox.information(
                self,
                "عدم وجود گروه هم‌تعداد",
                "گروهی که تعداد فیش‌های سیستم و بانک در آن دقیقاً برابر باشد یافت نشد."
            )

    def _save_changes_to_excel(self):
        ExcelProcessor.write_reconciliation_results(
            self.data_store["sys_path"],
            self.data_store["bank_path"],
            self.data_store["sys_records"],
            self.data_store["bank_records"],
            self.data_store["matches"],
            self.data_store["out_sys"],
            self.data_store["out_bank"],
            self.data_store["out_rep"]
        )
        self._update_ui_summary()
        self._refresh_review_trees()

    def _manual_connect_pair(self):
        sel_sys = self.tree_sys.selectedItems()
        sel_bank = self.tree_bank.selectedItems()

        if not sel_sys or not sel_bank:
            QMessageBox.warning(self, "انتخاب ناقص", "لطفاً از هر دو درخت (سیستم و بانک) آیتم مورد نظر را انتخاب نمایید.")
            return

        sys_data = sel_sys[0].data(0, Qt.ItemDataRole.UserRole)
        bank_data = sel_bank[0].data(0, Qt.ItemDataRole.UserRole)

        sys_indices = sys_data["indices"] if sys_data["type"] == "GROUP" else [sys_data["index"]]
        bank_indices = bank_data["indices"] if bank_data["type"] == "GROUP" else [bank_data["index"]]

        count = min(len(sys_indices), len(bank_indices))
        for i in range(count):
            s_idx = sys_indices[i]
            b_idx = bank_indices[i]
            
            s_rec = self.data_store["sys_records"][s_idx]
            b_rec = self.data_store["bank_records"][b_idx]

            self.data_store["matches"]["sys_matches"][s_idx] = {
                "matched_index": b_idx, "status": "GREEN", "confidence": 1.0, "reason": "اتصال دستی کاربر"
            }
            self.data_store["matches"]["bank_matches"][b_idx] = {
                "matched_index": s_idx, "status": "GREEN", "confidence": 1.0, "reason": "اتصال دستی کاربر"
            }
            self.kb.record_decision(s_rec, b_rec, "APPROVED", "اتصال دستی کاربر")

        self._save_changes_to_excel()
        QMessageBox.information(self, "موفق", f"تعداد {count} فیش با موفقیت به یکدیگر متصل شدند و از لیست بازبینی خارج گردیدند.")

    def _manual_reject_sys(self):
        sel = self.tree_sys.selectedItems()
        if not sel:
            QMessageBox.warning(self, "هشدار", "لطفاً یک سطر یا گروه از سیستم انتخاب کنید.")
            return
        data = sel[0].data(0, Qt.ItemDataRole.UserRole)
        indices = data["indices"] if data["type"] == "GROUP" else [data["index"]]

        for idx in indices:
            self.data_store["rejected_sys"].add(idx)
            self.data_store["matches"]["sys_matches"].pop(idx, None)

        self._save_changes_to_excel()
        QMessageBox.information(self, "ثبت شد", f"تعداد {len(indices)} فیش سیستم رد شد و به عنوان (قرمز) ثبت گردید.")

    def _manual_reject_bank(self):
        sel = self.tree_bank.selectedItems()
        if not sel:
            QMessageBox.warning(self, "هشدار", "لطفاً یک سطر یا گروه از بانک انتخاب کنید.")
            return
        data = sel[0].data(0, Qt.ItemDataRole.UserRole)
        indices = data["indices"] if data["type"] == "GROUP" else [data["index"]]

        for idx in indices:
            self.data_store["rejected_bank"].add(idx)
            self.data_store["matches"]["bank_matches"].pop(idx, None)

        self._save_changes_to_excel()
        QMessageBox.information(self, "ثبت شد", f"تعداد {len(indices)} فیش بانک رد شد و به عنوان (قرمز) ثبت گردید.")