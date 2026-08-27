import React, { useState, useMemo } from 'react';
import {
  History,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRightLeft,
  Filter,
  CheckSquare,
  Square,
  Building,
  CreditCard,
  Calendar,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import {
  ReconciliationDataStore,
  SystemRecord,
  BankRecord,
  MatchInfo,
  MatchStatus
} from '../types';
import { formatCurrency } from '../utils/normalization';

export type HistoryItemType = 'MATCH_GREEN' | 'MATCH_YELLOW' | 'MATCH_MANUAL' | 'REJECT_SYS' | 'REJECT_BANK';

export interface HistoryEntry {
  id: string; // unique key for selection
  type: HistoryItemType;
  sIndex?: number;
  bIndex?: number;
  sRec?: SystemRecord;
  bRec?: BankRecord;
  amount: number;
  matchInfo?: MatchInfo;
  title: string;
  reason: string;
  statusBadge: {
    label: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  };
}

interface HistoryTabProps {
  dataStore: ReconciliationDataStore | null;
  setDataStore: React.Dispatch<React.SetStateAction<ReconciliationDataStore | null>>;
  onNavigateToReview?: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  dataStore,
  setDataStore,
  onNavigateToReview
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'MATCHES' | 'REJECTIONS' | 'GREEN' | 'YELLOW' | 'MANUAL' | 'REJECT_SYS' | 'REJECT_BANK'>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  if (!dataStore || dataStore.sys_records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 shadow-xs" id="history-empty-state">
        <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="font-bold text-slate-700 text-base">هنوز سابقه‌ای از تطبیق یا رد فیش‌ها وجود ندارد</h3>
        <p className="text-xs text-slate-400 mt-1">
          لطفاً ابتدا از تب «پردازش و تطبیق خودکار» فایل‌ها را بارگذاری و تطبیق دهید یا در تب «بازبینی تجمیعی» انتساب‌های دستی انجام دهید.
        </p>
      </div>
    );
  }

  const { sys_records, bank_records, matches, rejected_sys, rejected_bank } = dataStore;
  const sysMatches = matches.sys_matches || {};
  const bankMatches = matches.bank_matches || {};
  const rejectedSysSet = new Set(rejected_sys);
  const rejectedBankSet = new Set(rejected_bank);

  // Build list of all history entries
  const historyEntries: HistoryEntry[] = useMemo(() => {
    const entries: HistoryEntry[] = [];
    const processedPairs = new Set<string>();

    // 1. Process System Matches
    Object.entries(sysMatches).forEach(([sIdxStr, matchInfo]) => {
      const sIdx = Number(sIdxStr);
      const bIdx = matchInfo.matched_index;
      const pairKey = `pair_${sIdx}_${bIdx}`;
      if (processedPairs.has(pairKey)) return;
      processedPairs.add(pairKey);

      const sRec = sys_records[sIdx];
      const bRec = bank_records[bIdx];
      if (!sRec || !bRec) return;

      const isManual = matchInfo.reason.includes('دستی') || matchInfo.reason.includes('کاربر');
      let type: HistoryItemType = 'MATCH_GREEN';
      let statusBadge = {
        label: 'تطبیق قطعی (سبز)',
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-200'
      };

      if (isManual) {
        type = 'MATCH_MANUAL';
        statusBadge = {
          label: 'تطبیق دستی کاربر',
          bgClass: 'bg-blue-50',
          textClass: 'text-blue-700',
          borderClass: 'border-blue-200'
        };
      } else if (matchInfo.status === 'YELLOW') {
        type = 'MATCH_YELLOW';
        statusBadge = {
          label: 'تطبیق هوشمند (زرد)',
          bgClass: 'bg-amber-50',
          textClass: 'text-amber-700',
          borderClass: 'border-amber-200'
        };
      }

      entries.push({
        id: pairKey,
        type,
        sIndex: sIdx,
        bIndex: bIdx,
        sRec,
        bRec,
        amount: sRec.amount,
        matchInfo,
        title: `تطبیق ردیف سیستم ${sRec.original_row} ⟷ ردیف بانک ${bRec.original_row}`,
        reason: matchInfo.reason || 'تطبیق بر اساس قوانین حسابداری',
        statusBadge
      });
    });

    // 2. Process Rejected System Items
    rejected_sys.forEach((sIdx) => {
      const sRec = sys_records[sIdx];
      if (!sRec) return;

      entries.push({
        id: `reject_sys_${sIdx}`,
        type: 'REJECT_SYS',
        sIndex: sIdx,
        sRec,
        amount: sRec.amount,
        title: `سند رد شده سیستم (ردیف ${sRec.original_row})`,
        reason: 'رد دستی کاربر به عنوان مغایرت قطعی سیستم',
        statusBadge: {
          label: 'رد شده (سیستم)',
          bgClass: 'bg-rose-50',
          textClass: 'text-rose-700',
          borderClass: 'border-rose-200'
        }
      });
    });

    // 3. Process Rejected Bank Items
    rejected_bank.forEach((bIdx) => {
      const bRec = bank_records[bIdx];
      if (!bRec) return;

      entries.push({
        id: `reject_bank_${bIdx}`,
        type: 'REJECT_BANK',
        bIndex: bIdx,
        bRec,
        amount: bRec.amount,
        title: `تراکنش رد شده بانک (ردیف ${bRec.original_row})`,
        reason: 'رد دستی کاربر به عنوان مغایرت قطعی بانک',
        statusBadge: {
          label: 'رد شده (بانک)',
          bgClass: 'bg-purple-50',
          textClass: 'text-purple-700',
          borderClass: 'border-purple-200'
        }
      });
    });

    return entries;
  }, [sysMatches, sys_records, bank_records, rejected_sys, rejected_bank]);

  // Filter and Search entries
  const filteredEntries = useMemo(() => {
    return historyEntries.filter((entry) => {
      // Type Filter
      if (typeFilter === 'MATCHES') {
        if (entry.type === 'REJECT_SYS' || entry.type === 'REJECT_BANK') return false;
      } else if (typeFilter === 'REJECTIONS') {
        if (entry.type !== 'REJECT_SYS' && entry.type !== 'REJECT_BANK') return false;
      } else if (typeFilter === 'GREEN' && entry.type !== 'MATCH_GREEN') {
        return false;
      } else if (typeFilter === 'YELLOW' && entry.type !== 'MATCH_YELLOW') {
        return false;
      } else if (typeFilter === 'MANUAL' && entry.type !== 'MATCH_MANUAL') {
        return false;
      } else if (typeFilter === 'REJECT_SYS' && entry.type !== 'REJECT_SYS') {
        return false;
      } else if (typeFilter === 'REJECT_BANK' && entry.type !== 'REJECT_BANK') {
        return false;
      }

      // Search Query
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();

      const amountStr = String(entry.amount);
      const titleStr = entry.title.toLowerCase();
      const reasonStr = entry.reason.toLowerCase();

      let sStr = '';
      if (entry.sRec) {
        sStr = `${entry.sRec.original_row} ${entry.sRec.tracking_code} ${entry.sRec.account_name} ${entry.sRec.doc_type} ${entry.sRec.date}`.toLowerCase();
      }

      let bStr = '';
      if (entry.bRec) {
        bStr = `${entry.bRec.original_row} ${entry.bRec.serial_no} ${entry.bRec.party_name} ${entry.bRec.description} ${entry.bRec.date} ${entry.bRec.deposit_id}`.toLowerCase();
      }

      return (
        amountStr.includes(q) ||
        titleStr.includes(q) ||
        reasonStr.includes(q) ||
        sStr.includes(q) ||
        bStr.includes(q)
      );
    });
  }, [historyEntries, typeFilter, searchTerm]);

  // Revoke single match or rejection
  const handleRevokeSingle = (entry: HistoryEntry) => {
    setDataStore((prev) => {
      if (!prev) return null;
      const newSysMatches = { ...prev.matches.sys_matches };
      const newBankMatches = { ...prev.matches.bank_matches };
      let newRejectedSys = [...prev.rejected_sys];
      let newRejectedBank = [...prev.rejected_bank];

      if (entry.sIndex !== undefined && entry.bIndex !== undefined) {
        // Revoke Match
        delete newSysMatches[entry.sIndex];
        delete newBankMatches[entry.bIndex];
      } else if (entry.type === 'REJECT_SYS' && entry.sIndex !== undefined) {
        // Revoke System Rejection
        newRejectedSys = newRejectedSys.filter((idx) => idx !== entry.sIndex);
      } else if (entry.type === 'REJECT_BANK' && entry.bIndex !== undefined) {
        // Revoke Bank Rejection
        newRejectedBank = newRejectedBank.filter((idx) => idx !== entry.bIndex);
      }

      return {
        ...prev,
        matches: {
          ...prev.matches,
          sys_matches: newSysMatches,
          bank_matches: newBankMatches
        },
        rejected_sys: newRejectedSys,
        rejected_bank: newRejectedBank
      };
    });

    // Remove from selection if was selected
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });

    showToast(`عملیات «${entry.title}» با موفقیت منسوخ شد و فیش‌ها به لیست بازبینی بازگشتند.`);
  };

  // Revoke all selected items in batch
  const handleRevokeSelected = () => {
    if (selectedIds.size === 0) return;

    const entriesToRevoke = historyEntries.filter((e) => selectedIds.has(e.id));
    if (entriesToRevoke.length === 0) return;

    setDataStore((prev) => {
      if (!prev) return null;
      const newSysMatches = { ...prev.matches.sys_matches };
      const newBankMatches = { ...prev.matches.bank_matches };
      const rejectedSysSetToKeep = new Set(prev.rejected_sys);
      const rejectedBankSetToKeep = new Set(prev.rejected_bank);

      entriesToRevoke.forEach((entry) => {
        if (entry.sIndex !== undefined && entry.bIndex !== undefined) {
          delete newSysMatches[entry.sIndex];
          delete newBankMatches[entry.bIndex];
        } else if (entry.type === 'REJECT_SYS' && entry.sIndex !== undefined) {
          rejectedSysSetToKeep.delete(entry.sIndex);
        } else if (entry.type === 'REJECT_BANK' && entry.bIndex !== undefined) {
          rejectedBankSetToKeep.delete(entry.bIndex);
        }
      });

      return {
        ...prev,
        matches: {
          ...prev.matches,
          sys_matches: newSysMatches,
          bank_matches: newBankMatches
        },
        rejected_sys: Array.from(rejectedSysSetToKeep),
        rejected_bank: Array.from(rejectedBankSetToKeep)
      };
    });

    const count = entriesToRevoke.length;
    setSelectedIds(new Set());
    showToast(`تعداد ${count} عملیات با موفقیت منسوخ گردید و به لیست بازبینی بازگردانده شدند.`);
  };

  // Selection toggle
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEntries.length && filteredEntries.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
    }
  };

  // Stats
  const totalMatchesCount = Object.keys(sysMatches).length;
  const totalRejectionsCount = rejected_sys.length + rejected_bank.length;
  const totalAmountMatched = Object.entries(sysMatches).reduce((acc, [sIdx]) => {
    const s = sys_records[Number(sIdx)];
    return acc + (s ? s.amount : 0);
  }, 0);

  return (
    <div className="space-y-5" id="history-tab-root">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-fade-in max-w-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs md:text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Overview Statistics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500">زوج‌های تطبیق داده شده</div>
            <div className="text-lg font-black text-slate-800 font-mono">
              {totalMatchesCount.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">مورد</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-100 text-blue-700">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500">ارزش کل فیش‌های تطبیقی</div>
            <div className="text-sm md:text-base font-black text-slate-800 font-mono">
              {formatCurrency(totalAmountMatched)}
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-rose-100 text-rose-700">
            <XCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500">مغایرت‌های رد شده</div>
            <div className="text-lg font-black text-slate-800 font-mono">
              {totalRejectionsCount.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">مورد</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold text-slate-500">فهرست بازبینی</div>
            <div className="text-xs text-slate-600 mt-1">
              جهت انتساب دستی یا بررسی گروه‌ها
            </div>
          </div>
          {onNavigateToReview && (
            <button
              onClick={onNavigateToReview}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
            >
              مشاهده بازبینی
            </button>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Controls and Search Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-lg">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="جستجو در مبلغ، شماره ردیف، کد پیگیری، نام طرف حساب، شرح..."
                className="w-full pl-3 pr-9 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-500 shadow-2xs"
                id="input-history-search"
              />
            </div>

            {/* Batch Revoke Action */}
            <div className="flex items-center gap-2 shrink-0">
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  onClick={handleRevokeSelected}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-2 transition-all cursor-pointer animate-pulse"
                  id="btn-bulk-revoke"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  منسوخ کردن و بازگردانی ({selectedIds.size.toLocaleString('fa-IR')} مورد)
                </button>
              ) : (
                <div className="text-xs text-slate-500 flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  <span>برای منسوخ‌سازی گروهی، تیک ردیف‌ها را بزنید.</span>
                </div>
              )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-500 ml-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> فیلتر نمایش:
            </span>
            {[
              { id: 'ALL', label: 'همه سوابق' },
              { id: 'MATCHES', label: 'تمام تطبیق‌ها' },
              { id: 'GREEN', label: 'تطبیق‌های قطعی (سبز)' },
              { id: 'MANUAL', label: 'تطبیق‌های دستی' },
              { id: 'YELLOW', label: 'تطبیق‌های احتمالی (زرد)' },
              { id: 'REJECTIONS', label: 'تمام رد شده‌ها' },
              { id: 'REJECT_SYS', label: 'رد شده سیستم' },
              { id: 'REJECT_BANK', label: 'رد شده بانک' }
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id as any)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all border cursor-pointer ${
                  typeFilter === f.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table & List View */}
        {filteredEntries.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-xs">هیچ رکوردی مطابق با فیلتر یا جستجوی جاری یافت نشد.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 font-bold select-none">
                  <th className="p-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="cursor-pointer text-slate-500 hover:text-slate-800"
                      title="انتخاب همه"
                    >
                      {selectedIds.size === filteredEntries.length && filteredEntries.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 w-12 text-center">ردیف</th>
                  <th className="p-3 w-36">نوع عملیات</th>
                  <th className="p-3 w-32">مبلغ تراکنش</th>
                  <th className="p-3">اطلاعات طرف سیستم (دفاتر)</th>
                  <th className="p-3">اطلاعات طرف بانک (صورتحساب)</th>
                  <th className="p-3 w-52">علت و جزییات تطبیق / رد</th>
                  <th className="p-3 w-36 text-center">عملیات بازگشت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEntries.map((entry, idx) => {
                  const isSelected = selectedIds.has(entry.id);
                  const isMatch = entry.sRec && entry.bRec;

                  return (
                    <tr
                      key={entry.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-blue-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(entry.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                        />
                      </td>

                      {/* Index */}
                      <td className="p-3 text-center font-mono text-slate-400 text-[11px]">
                        {(idx + 1).toLocaleString('fa-IR')}
                      </td>

                      {/* Operation Type Badge */}
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${entry.statusBadge.bgClass} ${entry.statusBadge.textClass} ${entry.statusBadge.borderClass}`}
                        >
                          {entry.type.startsWith('MATCH') ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {entry.statusBadge.label}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="p-3 font-mono font-black text-slate-800 text-xs whitespace-nowrap">
                        {formatCurrency(entry.amount)}
                      </td>

                      {/* System Details */}
                      <td className="p-3">
                        {entry.sRec ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-mono font-bold">
                                ردیف {entry.sRec.original_row}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.sRec.direction === 'CREDIT' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                {entry.sRec.direction === 'CREDIT' ? 'بستانکار' : 'بدهکار'}
                              </span>
                              {entry.sRec.date && (
                                <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-slate-400" />
                                  {entry.sRec.date}
                                </span>
                              )}
                            </div>
                            <div className="font-medium text-slate-800 text-xs">
                              {entry.sRec.account_name || entry.sRec.doc_type || 'سند حسابداری'}
                            </div>
                            {entry.sRec.tracking_code && (
                              <div className="text-[11px] text-slate-500 font-mono">
                                پیگیری: {entry.sRec.tracking_code}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">بدون سند متناظر</span>
                        )}
                      </td>

                      {/* Bank Details */}
                      <td className="p-3">
                        {entry.bRec ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-mono font-bold">
                                ردیف {entry.bRec.original_row}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.bRec.direction === 'CREDIT' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                {entry.bRec.direction === 'CREDIT' ? 'بستانکار (واریز)' : 'بدهکار (برداشت)'}
                              </span>
                              {entry.bRec.date && (
                                <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-slate-400" />
                                  {entry.bRec.date}
                                </span>
                              )}
                            </div>
                            <div className="font-medium text-slate-800 text-xs truncate max-w-xs" title={entry.bRec.raw_desc}>
                              {entry.bRec.party_name || entry.bRec.description || 'تراکنش بانکی'}
                            </div>
                            {(entry.bRec.serial_no || entry.bRec.deposit_id) && (
                              <div className="text-[11px] text-slate-500 font-mono">
                                {entry.bRec.serial_no ? `سریال: ${entry.bRec.serial_no}` : ''}{' '}
                                {entry.bRec.deposit_id ? `| شناسه: ${entry.bRec.deposit_id}` : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">بدون تراکنش متناظر</span>
                        )}
                      </td>

                      {/* Reason & Confidence */}
                      <td className="p-3">
                        <div className="space-y-1 text-slate-600 text-[11px]">
                          <div className="font-medium">{entry.reason}</div>
                          {entry.matchInfo?.confidence !== undefined && (
                            <div className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                              <span>اطمینان:</span>
                              <span className="font-bold text-slate-600">
                                {Math.round(entry.matchInfo.confidence * 100)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Revoke Action Button */}
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRevokeSingle(entry)}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1.5 mx-auto transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
                          title="منسوخ کردن این عملیات و بازگرداندن فیش‌ها به لیست بازبینی"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>منسوخ کردن</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            نمایش <strong>{filteredEntries.length.toLocaleString('fa-IR')}</strong> رکورد از مجموع{' '}
            <strong>{historyEntries.length.toLocaleString('fa-IR')}</strong> عملیات ثبت شده
          </div>
          {selectedIds.size > 0 && (
            <div className="font-bold text-blue-700">
              {selectedIds.size.toLocaleString('fa-IR')} مورد انتخاب شده
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
