import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Layers,
  History,
  Database,
  Landmark,
  LogOut
} from 'lucide-react';
import {
  ReconciliationDataStore,
  ReconciliationSummary,
  SystemRecord,
  BankRecord,
  KnowledgeDecision,
  ComparisonDirectionMode,
  AuthenticatedUser
} from './types';
import { ProcessingTab } from './components/ProcessingTab';
import { ReviewTab } from './components/ReviewTab';
import { HistoryTab } from './components/HistoryTab';
import { KnowledgeBaseTab } from './components/KnowledgeBaseTab';
import { AdminUsersTab } from './components/AdminUsersTab';
import { LoginPage } from './components/LoginPage';
import {
  ReconciliationEngine,
  getStoredAuthToken,
  setStoredAuthToken
} from './utils/matcher';
import { ExcelProcessor } from './utils/excelIo';

type ActiveTab = 'processing' | 'review' | 'history' | 'kb';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('processing');
  const [dataStore, setDataStore] = useState<ReconciliationDataStore | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('آماده');
  const [maxDays, setMaxDays] = useState<number>(3);
  const [useAi, setUseAi] = useState<boolean>(false);
  const [directionMode, setDirectionMode] = useState<ComparisonDirectionMode>('DIRECT');
  const [decisions, setDecisions] = useState<KnowledgeDecision[]>([]);

  const verifySession = useCallback(async (isInitial: boolean = false) => {
    const token = getStoredAuthToken();
    if (!token) {
      if (isInitial) setAuthChecking(false);
      setCurrentUser(null);
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStoredAuthToken(null);
        setCurrentUser(null);
        if (!isInitial && data.error) {
          setAuthError(data.error);
        }
      } else {
        const data = await res.json();
        setCurrentUser(data.user);
      }
    } catch {
      // ignore transient network glitch
    } finally {
      if (isInitial) setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    verifySession(true);
    const interval = setInterval(() => {
      verifySession(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [verifySession]);

  useEffect(() => {
    if (!currentUser || currentUser.role === 'ADMIN') return;
    const token = getStoredAuthToken();
    fetch('/api/kb/decisions', {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.decisions) {
          setDecisions(data.decisions);
        }
      })
      .catch(() => {});
  }, [currentUser]);

  const handleLogout = async () => {
    const token = getStoredAuthToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {}
    }
    setStoredAuthToken(null);
    setCurrentUser(null);
    setAuthError(null);
    setActiveTab('processing');
  };

  const summary: ReconciliationSummary | null = useMemo(() => {
    if (!dataStore || dataStore.sys_records.length === 0) return null;

    const { sys_records, bank_records, matches, rejected_sys } = dataStore;
    const sysMatches = matches.sys_matches || {};
    const rejectedSysSet = new Set(rejected_sys);

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

  const runReconciliation = async (customStore?: ReconciliationDataStore) => {
    const currentStore = customStore || dataStore;
    if (!currentStore || currentStore.sys_records.length === 0 || currentStore.bank_records.length === 0) {
      return;
    }

    setIsProcessing(true);
    setProgressPercent(25);
    setStatusMessage('در حال پردازش...');

    try {
      const engine = new ReconciliationEngine(maxDays);
      const matchResults = await engine.reconcile(
        currentStore.sys_records,
        currentStore.bank_records,
        maxDays,
        directionMode
      );

      setProgressPercent(100);
      setStatusMessage('انجام شد.');

      setDataStore({
        ...currentStore,
        matches: matchResults,
        rejected_sys: [],
        rejected_bank: []
      });
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setStoredAuthToken(null);
        setCurrentUser(null);
        setAuthError(err.message || 'نشست کاربری منقضی شده است.');
      } else {
        setStatusMessage(err.message || 'خطا در تطبیق');
      }
    } finally {
      setIsProcessing(false);
    }
  };

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
      const token = getStoredAuthToken();
      await fetch('/api/kb/decisions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(newDecision)
      });
    } catch {}
  };

  const handleDownloadSys = async () => {
    if (!dataStore) return;
    const buffer = await ExcelProcessor.generateMatchedSystemWorkbook(
      dataStore.sys_records,
      dataStore.bank_records,
      dataStore.matches
    );
    downloadBlob(buffer, 'سیستم_تطبیق_یافته.xlsx');
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

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="text-xs font-bold text-slate-600">در حال بارگذاری...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginPage
        initialError={authError}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setAuthError(null);
        }}
      />
    );
  }

  const isAdmin = currentUser.role === 'ADMIN';

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-white shadow-sm">
                <Landmark className="w-5 h-5" />
              </div>
              <h1 className="text-base font-extrabold text-slate-900">
                تطبیق هوشمند باروت کوب
              </h1>
            </div>

            <div className="flex items-center gap-4 text-xs">
              {!isAdmin && dataStore && (
                <div className="hidden lg:flex items-center gap-2 text-slate-600 font-semibold">
                  <span>سیستم: {dataStore.sys_records.length.toLocaleString('fa-IR')}</span>
                  <span aria-hidden="true">·</span>
                  <span>بانک: {dataStore.bank_records.length.toLocaleString('fa-IR')}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-slate-700">
                <span className="font-bold text-slate-900">{currentUser.displayName}</span>
                {!isAdmin && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      {currentUser.remainingDays !== null
                        ? `${currentUser.remainingDays.toLocaleString('fa-IR')} روز`
                        : 'دائمی'}
                    </span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                id="btn-logout"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs - Shown ONLY for non-admin users */}
          {!isAdmin && (
            <div className="flex space-x-reverse space-x-1 border-t border-slate-100 -mb-px overflow-x-auto">
              <button
                onClick={() => setActiveTab('processing')}
                className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'processing'
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
                id="tab-btn-processing"
              >
                <FileSpreadsheet className="w-4 h-4" />
                پردازش و تطبیق
              </button>

              <button
                onClick={() => setActiveTab('review')}
                className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'review'
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
                id="tab-btn-review"
              >
                <Layers className="w-4 h-4" />
                بازبینی
                {summary && summary.yellow_count > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-mono">
                    {summary.yellow_count}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'history'
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
                id="tab-btn-history"
              >
                <History className="w-4 h-4" />
                سوابق
                {dataStore && (Object.keys(dataStore.matches.sys_matches || {}).length > 0 || dataStore.rejected_sys.length > 0 || dataStore.rejected_bank.length > 0) && (
                  <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded-full text-[10px] font-mono">
                    {(Object.keys(dataStore.matches.sys_matches || {}).length + dataStore.rejected_sys.length + dataStore.rejected_bank.length).toLocaleString('fa-IR')}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('kb')}
                className={`py-3 px-4 font-bold text-xs sm:text-sm border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
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
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {isAdmin ? (
          <AdminUsersTab />
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
