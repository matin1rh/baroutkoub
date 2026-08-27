import React, { useState, useMemo, useEffect } from 'react';
import {
  FileSpreadsheet,
  Layers,
  History,
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  Landmark
} from 'lucide-react';
import {
  ReconciliationDataStore,
  ReconciliationSummary,
  SystemRecord,
  BankRecord,
  KnowledgeDecision,
  ComparisonDirectionMode
} from './types';
import { ProcessingTab } from './components/ProcessingTab';
import { ReviewTab } from './components/ReviewTab';
import { HistoryTab } from './components/HistoryTab';
import { KnowledgeBaseTab } from './components/KnowledgeBaseTab';
import { ReconciliationEngine } from './utils/matcher';
import { ExcelProcessor } from './utils/excelIo';
import { SAMPLE_SYSTEM_RECORDS, SAMPLE_BANK_RECORDS } from './utils/sampleData';

type ActiveTab = 'processing' | 'review' | 'history' | 'kb';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('processing');
  const [dataStore, setDataStore] = useState<ReconciliationDataStore | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('آماده به کار...');
  const [maxDays, setMaxDays] = useState<number>(3);
  const [useAi, setUseAi] = useState<boolean>(false);
  const [directionMode, setDirectionMode] = useState<ComparisonDirectionMode>('DIRECT');
  const [decisions, setDecisions] = useState<KnowledgeDecision[]>([]);

  // Load knowledge base on start
  useEffect(() => {
    fetch('/api/kb/decisions')
      .then((res) => res.json())
      .then((data) => {
        if (data.decisions) {
          setDecisions(data.decisions);
        }
      })
      .catch(() => {});
  }, []);

  // Compute summary statistics
  const summary: ReconciliationSummary | null = useMemo(() => {
    if (!dataStore || dataStore.sys_records.length === 0) return null;

    const { sys_records, bank_records, matches, rejected_sys, rejected_bank } = dataStore;
    const sysMatches = matches.sys_matches || {};
    const rejectedSysSet = new Set(rejected_sys);
    const rejectedBankSet = new Set(rejected_bank);

    let greenCount = 0;
    let yellowCount = 0;
    let matchedAmount = 0;

    Object.entries(sysMatches).forEach(([sIdxStr, m]) => {
      const sIdx = Number(sIdxStr);
      if (rejectedSysSet.has(sIdx)) return;
      if (m.status === 'GREEN') {
        greenCount++;
        matchedAmount += sys_records[sIdx]?.amount || 0;
      } else if (m.status === 'YELLOW') {
        yellowCount++;
      }
    });

    const activeSysCount = sys_records.filter((_, idx) => !rejectedSysSet.has(idx)).length;
    const activeBankCount = bank_records.filter((_, idx) => !rejectedBankSet.has(idx)).length;

    const redSysCount = Math.max(0, sys_records.length - greenCount - yellowCount);
    const redBankCount = Math.max(0, bank_records.length - greenCount - yellowCount);

    const successRate =
      sys_records.length > 0
        ? Number((((greenCount + yellowCount) / sys_records.length) * 100).toFixed(1))
        : 0;

    const totalSysAmount = sys_records.reduce((sum, r) => sum + r.amount, 0);
    const totalBankAmount = bank_records.reduce((sum, r) => sum + r.amount, 0);

    return {
      total_sys: sys_records.length,
      total_bank: bank_records.length,
      green_count: greenCount,
      yellow_count: yellowCount,
      red_sys_count: redSysCount,
      red_bank_count: redBankCount,
      success_rate: successRate,
      total_sys_amount: totalSysAmount,
      total_bank_amount: totalBankAmount,
      matched_amount: matchedAmount
    };
  }, [dataStore]);

  // Load sample dataset
  const handleLoadSampleData = () => {
    const store: ReconciliationDataStore = {
      sys_name: 'سیسست_نمونه_۱۴۰۳.xlsx',
      bank_name: 'صورتحساب_ملت_نمونه.xlsx',
      sys_records: SAMPLE_SYSTEM_RECORDS,
      bank_records: SAMPLE_BANK_RECORDS,
      matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
      rejected_sys: [],
      rejected_bank: []
    };
    setDataStore(store);

    // Auto trigger reconcile on sample data
    setTimeout(() => {
      runReconciliation(store);
    }, 100);
  };

  // Reconcile logic
  const runReconciliation = async (customStore?: ReconciliationDataStore) => {
    const currentStore = customStore || dataStore;
    if (!currentStore || currentStore.sys_records.length === 0 || currentStore.bank_records.length === 0) {
      return;
    }

    setIsProcessing(true);
    setProgressPercent(10);
    setStatusMessage('در حال خواندن و اعتبارسنجی تراکنش‌ها...');

    await new Promise((r) => setTimeout(r, 200));
    setProgressPercent(35);
    setStatusMessage(
      `استخراج ${currentStore.sys_records.length} سند سیستم و ${currentStore.bank_records.length} تراکنش بانک...`
    );

    await new Promise((r) => setTimeout(r, 250));
    setProgressPercent(65);
    setStatusMessage('اجرای الگوریتم چندلایه‌ای و انتساب بهینه مجارستانی...');

    const engine = new ReconciliationEngine(maxDays);
    const matchResults = engine.reconcile(
      currentStore.sys_records,
      currentStore.bank_records,
      maxDays,
      directionMode
    );

    await new Promise((r) => setTimeout(r, 200));
    setProgressPercent(90);
    setStatusMessage('مرتب‌سازی بر اساس مبالغ و تجمیع داده‌ها...');

    await new Promise((r) => setTimeout(r, 200));
    setProgressPercent(100);
    setStatusMessage('تطبیق با موفقیت انجام شد.');

    setDataStore({
      ...currentStore,
      matches: matchResults,
      rejected_sys: [],
      rejected_bank: []
    });

    setIsProcessing(false);
  };

  // Record manual decision to KB
  const handleRecordDecision = async (
    sysRec: SystemRecord,
    bankRec: BankRecord,
    decision: 'APPROVED' | 'REJECTED',
    reason: string
  ) => {
    const newDecision: KnowledgeDecision = {
      sys_name: sysRec.account_name,
      sys_desc: sysRec.raw_desc,
      bank_name: bankRec.party_name,
      bank_desc: bankRec.raw_desc,
      decision,
      reason,
      amount: sysRec.amount,
      tracking: sysRec.tracking_code,
      created_at: new Date().toLocaleDateString('fa-IR')
    };

    setDecisions((prev) => [newDecision, ...prev]);

    try {
      await fetch('/api/kb/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDecision)
      });
    } catch {}
  };

  // Export handlers
  const handleDownloadSys = async () => {
    if (!dataStore) return;
    const buffer = await ExcelProcessor.generateMatchedSystemWorkbook(
      dataStore.sys_records,
      dataStore.bank_records,
      dataStore.matches
    );
    downloadBlob(buffer, 'سیست_تطبیق_یافته.xlsx');
  };

  const handleDownloadBank = async () => {
    if (!dataStore) return;
    const buffer = await ExcelProcessor.generateMatchedBankWorkbook(
      dataStore.sys_records,
      dataStore.bank_records,
      dataStore.matches
    );
    downloadBlob(buffer, 'بانک_تطبیق_یافته.xlsx');
  };

  const handleDownloadReport = async () => {
    if (!dataStore) return;
    const buffer = await ExcelProcessor.generateComprehensiveReport(
      dataStore.sys_records,
      dataStore.bank_records,
      dataStore.matches
    );
    downloadBlob(buffer, 'گزارش_جامع_مغایرت.xlsx');
  };

  const downloadBlob = (buffer: Uint8Array, fileName: string) => {
    const blob = new Blob([buffer as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* App Title & Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-white shadow-sm">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  تطبیق هوشمند تراکنش‌های بانکی
                  <span className="text-[11px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                    باروت‌کوب
                  </span>
                </h1>
                <p className="text-xs text-slate-500">
                  مغایرت‌گیری چندلایه‌ای، پشتیبانی تقویم شمسی و انتساب هوشمند مجارستانی
                </p>
              </div>
            </div>

            {/* Quick Status / Loaded counts */}
            {dataStore && (
              <div className="hidden md:flex items-center gap-3 text-xs font-semibold">
                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
                  سیستم: {dataStore.sys_records.length} سند
                </span>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
                  بانک: {dataStore.bank_records.length} تراکنش
                </span>
              </div>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-reverse space-x-1 border-t border-slate-100 -mb-px">
            <button
              onClick={() => setActiveTab('processing')}
              className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'processing'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
              id="tab-btn-processing"
            >
              <FileSpreadsheet className="w-4 h-4" />
              پردازش و تطبیق خودکار
            </button>

            <button
              onClick={() => setActiveTab('review')}
              className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'review'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
              id="tab-btn-review"
            >
              <Layers className="w-4 h-4" />
              بازبینی تجمیعی و انتساب دستی
              {summary && summary.yellow_count > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-mono">
                  {summary.yellow_count}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
              id="tab-btn-history"
            >
              <History className="w-4 h-4" />
              تاریخچه تطبیق و رد (سوابق)
              {dataStore && (Object.keys(dataStore.matches.sys_matches || {}).length > 0 || dataStore.rejected_sys.length > 0 || dataStore.rejected_bank.length > 0) && (
                <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded-full text-[10px] font-mono">
                  {(Object.keys(dataStore.matches.sys_matches || {}).length + dataStore.rejected_sys.length + dataStore.rejected_bank.length).toLocaleString('fa-IR')}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('kb')}
              className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'kb'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
              id="tab-btn-kb"
            >
              <Database className="w-4 h-4" />
              پایگاه دانش ({decisions.length})
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'processing' && (
          <ProcessingTab
            dataStore={dataStore}
            setDataStore={setDataStore}
            onAutoReconcile={() => runReconciliation()}
            isProcessing={isProcessing}
            progressPercent={progressPercent}
            statusMessage={statusMessage}
            maxDays={maxDays}
            setMaxDays={setMaxDays}
            useAi={useAi}
            setUseAi={setUseAi}
            directionMode={directionMode}
            setDirectionMode={setDirectionMode}
            summary={summary}
            onDownloadSys={handleDownloadSys}
            onDownloadBank={handleDownloadBank}
            onDownloadReport={handleDownloadReport}
            onLoadSampleData={handleLoadSampleData}
          />
        )}

        {activeTab === 'review' && (
          <ReviewTab
            dataStore={dataStore}
            setDataStore={setDataStore}
            directionMode={directionMode}
            onRecordDecision={handleRecordDecision}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            dataStore={dataStore}
            setDataStore={setDataStore}
            onNavigateToReview={() => setActiveTab('review')}
          />
        )}

        {activeTab === 'kb' && <KnowledgeBaseTab decisions={decisions} />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        سیستم مغایرت‌گیری و تطبیق هوشمند اسناد حسابداری و بانکی (نسخه پیشرفته تجمیعی)
      </footer>
    </div>
  );
}
