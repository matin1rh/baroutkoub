import React, { useState, useMemo } from 'react';
import {
  Link2,
  XCircle,
  Zap,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  Building,
  CreditCard,
  Hash,
  Clock,
  Layers,
  ArrowRightLeft,
  Calendar,
  FilterX,
  AlertOctagon
} from 'lucide-react';
import {
  SystemRecord,
  BankRecord,
  ReconciliationDataStore,
  TransactionDirection,
  ComparisonDirectionMode
} from '../types';
import { formatCurrency, parseJalaliDate, parseAmount } from '../utils/normalization';

interface ReviewTabProps {
  dataStore: ReconciliationDataStore | null;
  setDataStore: React.Dispatch<React.SetStateAction<ReconciliationDataStore | null>>;
  directionMode?: ComparisonDirectionMode;
  onRecordDecision?: (
    sysRec: SystemRecord,
    bankRec: BankRecord,
    decision: 'APPROVED' | 'REJECTED',
    reason: string
  ) => void;
}

interface GroupedBucket {
  key: string;
  amount: number;
  direction: TransactionDirection;
  indices: number[];
}

export const ReviewTab: React.FC<ReviewTabProps> = ({
  dataStore,
  setDataStore,
  directionMode = 'DIRECT',
  onRecordDecision
}) => {
  const [selectedSysGroupKey, setSelectedSysGroupKey] = useState<string | null>(null);
  const [selectedBankGroupKey, setSelectedBankGroupKey] = useState<string | null>(null);
  const [selectedSysRowIdx, setSelectedSysRowIdx] = useState<number | null>(null);
  const [selectedBankRowIdx, setSelectedBankRowIdx] = useState<number | null>(null);
  const [expandedSysGroups, setExpandedSysGroups] = useState<Record<string, boolean>>({});
  const [expandedBankGroups, setExpandedBankGroups] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [thresholdAmountInput, setThresholdAmountInput] = useState<string>('');
  const [rejectTargetScope, setRejectTargetScope] = useState<'BOTH' | 'SYS' | 'BANK'>('BOTH');

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  if (!dataStore || dataStore.sys_records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
        <Layers className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="font-bold text-slate-700 text-base">هنوز داده‌ای بارگذاری یا تطبیق داده نشده است</h3>
        <p className="text-xs text-slate-400 mt-1">
          لطفاً ابتدا از تب «پردازش و تطبیق خودکار» فایل‌های اکسل را بارگذاری و تطبیق دهید یا داده‌های آزمایشی را فعال کنید.
        </p>
      </div>
    );
  }

  const { sys_records, bank_records, matches, rejected_sys, rejected_bank } = dataStore;
  const sysMatches = matches.sys_matches || {};
  const bankMatches = matches.bank_matches || {};
  const rejectedSysSet = useMemo(() => new Set(rejected_sys), [rejected_sys]);
  const rejectedBankSet = useMemo(() => new Set(rejected_bank), [rejected_bank]);

  // 1. Group System Records (Only unmatched or YELLOW items)
  const sysGroups: GroupedBucket[] = useMemo(() => {
    const map = new Map<string, GroupedBucket>();
    sys_records.forEach((sRec, sIdx) => {
      if (rejectedSysSet.has(sIdx)) return;
      const m = sysMatches[sIdx];
      // Include if unmatched or YELLOW (requires review)
      if (!m || m.status === 'YELLOW') {
        const key = `${sRec.amount}_${sRec.direction}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            amount: sRec.amount,
            direction: sRec.direction,
            indices: []
          });
        }
        map.get(key)!.indices.push(sIdx);
      }
    });

    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [sys_records, sysMatches, rejectedSysSet]);

  // 2. Group Bank Records (Only unmatched or YELLOW items)
  const bankGroups: GroupedBucket[] = useMemo(() => {
    const map = new Map<string, GroupedBucket>();
    bank_records.forEach((bRec, bIdx) => {
      if (rejectedBankSet.has(bIdx)) return;
      const m = bankMatches[bIdx];
      // Include if unmatched or YELLOW (requires review)
      if (!m || m.status === 'YELLOW') {
        const key = `${bRec.amount}_${bRec.direction}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            amount: bRec.amount,
            direction: bRec.direction,
            indices: []
          });
        }
        map.get(key)!.indices.push(bIdx);
      }
    });

    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [bank_records, bankMatches, rejectedBankSet]);

  // Auto select / synchronize corresponding bank group when sys group clicked
  const handleSysGroupClick = (group: GroupedBucket) => {
    setSelectedSysGroupKey(group.key);
    setSelectedSysRowIdx(null);

    // Find target direction based on mode
    const targetBankDir = directionMode === 'DIRECT' 
      ? group.direction 
      : (group.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT');

    // Auto-find matching amount & direction group in bank
    const matchingBankGroup = 
      bankGroups.find((bg) => bg.amount === group.amount && bg.direction === targetBankDir) ||
      bankGroups.find((bg) => bg.amount === group.amount);

    if (matchingBankGroup) {
      setSelectedBankGroupKey(matchingBankGroup.key);
      setSelectedBankRowIdx(null);
      setExpandedBankGroups((prev) => ({ ...prev, [matchingBankGroup.key]: true }));
    }
  };

  const toggleSysGroupExpand = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSysGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleBankGroupExpand = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedBankGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 1. Auto Link Equal Groups (by Amount & Direction)
  const handleAutoLinkEqualGroups = () => {
    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newBankMatches = { ...dataStore.matches.bank_matches };

    let totalPairs = 0;
    let matchedGroupsCount = 0;
    const usedBankGroupKeys = new Set<string>();

    sysGroups.forEach((sg) => {
      if (sg.indices.length === 0) return;

      const targetBankDir = directionMode === 'DIRECT' 
        ? sg.direction 
        : (sg.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT');

      // 1. First search for strict direction match
      let candidateBankGroup = bankGroups.find(
        (bg) => !usedBankGroupKeys.has(bg.key) && bg.amount === sg.amount && bg.direction === targetBankDir
      );

      // 2. If not found, search for any bank group with the exact same amount that is not used yet
      if (!candidateBankGroup) {
        candidateBankGroup = bankGroups.find(
          (bg) => !usedBankGroupKeys.has(bg.key) && bg.amount === sg.amount
        );
      }

      if (candidateBankGroup && candidateBankGroup.indices.length === sg.indices.length && sg.indices.length > 0) {
        usedBankGroupKeys.add(candidateBankGroup.key);
        const count = sg.indices.length;

        for (let i = 0; i < count; i++) {
          const sIdx = sg.indices[i];
          const bIdx = candidateBankGroup.indices[i];
          const sRec = sys_records[sIdx];
          const bRec = bank_records[bIdx];

          newSysMatches[sIdx] = {
            matched_index: bIdx,
            status: 'GREEN',
            confidence: 1.0,
            reason: 'تطبیق خودکار گروه‌های هم‌تعداد و هم‌مبلغ (Auto-Link)'
          };

          newBankMatches[bIdx] = {
            matched_index: sIdx,
            status: 'GREEN',
            confidence: 1.0,
            reason: 'تطبیق خودکار گروه‌های هم‌تعداد و هم‌مبلغ (Auto-Link)'
          };

          if (onRecordDecision) {
            onRecordDecision(sRec, bRec, 'APPROVED', 'تطبیق خودکار گروه‌های هم‌تعداد');
          }
        }
        totalPairs += count;
        matchedGroupsCount += 1;
      }
    });

    if (totalPairs > 0) {
      setDataStore((prev) =>
        prev
          ? {
              ...prev,
              matches: {
                ...prev.matches,
                sys_matches: newSysMatches,
                bank_matches: newBankMatches
              }
            }
          : null
      );
      setSelectedSysGroupKey(null);
      setSelectedBankGroupKey(null);
      setSelectedSysRowIdx(null);
      setSelectedBankRowIdx(null);
      showToast(`تعداد ${matchedGroupsCount} گروه شامل ${totalPairs} فیش با موفقیت به صورت قطعی متصل شدند و از لیست بازبینی خارج گردیدند.`, 'success');
    } else {
      showToast('گروهی که تعداد فیش‌های سیستم و بانک در آن دقیقاً برابر باشد یافت نشد.', 'info');
    }
  };

  // 1.1 Auto Link Groups by EXACT MATCHING DATE (Handles unequal total groups like 13 vs 12 by matching items with identical dates)
  const handleAutoLinkByDateAndCount = () => {
    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newBankMatches = { ...dataStore.matches.bank_matches };

    let totalPairs = 0;
    let matchedDatesCount = 0;
    const usedBankIndices = new Set<number>();
    const usedSysIndices = new Set<number>();

    // For each system group in the review pool
    sysGroups.forEach((sg) => {
      if (sg.indices.length === 0) return;

      const targetBankDir = directionMode === 'DIRECT' 
        ? sg.direction 
        : (sg.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT');

      // Candidate bank groups matching amount and direction (prefer exact matching direction)
      const candidateBankGroups = [
        ...bankGroups.filter((bg) => bg.amount === sg.amount && bg.direction === targetBankDir),
        ...bankGroups.filter((bg) => bg.amount === sg.amount && bg.direction !== targetBankDir)
      ];

      // Collect available bank indices in this amount bucket
      const availableBankIndices: number[] = [];
      candidateBankGroups.forEach((bg) => {
        bg.indices.forEach((bIdx) => {
          if (!usedBankIndices.has(bIdx)) {
            availableBankIndices.push(bIdx);
          }
        });
      });

      if (availableBankIndices.length === 0) return;

      // Group system items of this amount by unified Normalized Jalali Date
      const sysByDate = new Map<string, number[]>();
      sg.indices.forEach((sIdx) => {
        if (usedSysIndices.has(sIdx)) return;
        const sRec = sys_records[sIdx];
        const normalizedDate = parseJalaliDate(sRec.date) || (sRec.date ? String(sRec.date).trim() : 'NO_DATE');
        if (!sysByDate.has(normalizedDate)) {
          sysByDate.set(normalizedDate, []);
        }
        sysByDate.get(normalizedDate)!.push(sIdx);
      });

      // Group bank items of this amount by unified Normalized Jalali Date
      const bankByDate = new Map<string, number[]>();
      availableBankIndices.forEach((bIdx) => {
        const bRec = bank_records[bIdx];
        const normalizedDate = parseJalaliDate(bRec.date) || (bRec.date ? String(bRec.date).trim() : 'NO_DATE');
        if (!bankByDate.has(normalizedDate)) {
          bankByDate.set(normalizedDate, []);
        }
        bankByDate.get(normalizedDate)!.push(bIdx);
      });

      // Now match subgroups where date and count are strictly identical (e.g. 1 on date X vs 1 on date X)
      sysByDate.forEach((sDateIndices, dateKey) => {
        if (dateKey === 'NO_DATE') return; // Skip unknown dates
        const bDateIndices = bankByDate.get(dateKey);

        // Only match if the number of items on this specific date is strictly equal (e.g. 1 vs 1, 2 vs 2).
        // If sys has 3 and bank has 4 on that date, neither will match and all stay in review list.
        if (bDateIndices && bDateIndices.length === sDateIndices.length && sDateIndices.length > 0) {
          const count = sDateIndices.length;

          for (let i = 0; i < count; i++) {
            const sIdx = sDateIndices[i];
            const bIdx = bDateIndices[i];
            const sRec = sys_records[sIdx];
            const bRec = bank_records[bIdx];

            usedSysIndices.add(sIdx);
            usedBankIndices.add(bIdx);

            newSysMatches[sIdx] = {
              matched_index: bIdx,
              status: 'GREEN',
              confidence: 1.0,
              reason: `تطبیق قطعی بر اساس تاریخ یکسان (${dateKey}) و تعداد برابر (${count} فیش)`
            };

            newBankMatches[bIdx] = {
              matched_index: sIdx,
              status: 'GREEN',
              confidence: 1.0,
              reason: `تطبیق قطعی بر اساس تاریخ یکسان (${dateKey}) و تعداد برابر (${count} فیش)`
            };

            if (onRecordDecision) {
              onRecordDecision(sRec, bRec, 'APPROVED', `تطبیق تاریخ و تعداد برابر (${dateKey})`);
            }
          }
          totalPairs += count;
          matchedDatesCount += 1;
        }
      });
    });

    if (totalPairs > 0) {
      setDataStore((prev) =>
        prev
          ? {
              ...prev,
              matches: {
                ...prev.matches,
                sys_matches: newSysMatches,
                bank_matches: newBankMatches
              }
            }
          : null
      );
      setSelectedSysGroupKey(null);
      setSelectedBankGroupKey(null);
      setSelectedSysRowIdx(null);
      setSelectedBankRowIdx(null);
      showToast(`تعداد ${totalPairs} فیش در ${matchedDatesCount} تاریخ (با تعداد دقیقاً برابر در سیستم و بانک) متصل شدند. مواردی که تعدادشان در یک تاریخ نابرابر بود در لیست بازبینی باقی ماندند.`, 'success');
    } else {
      showToast('هیچ گروهی با تاریخ یکسان و تعداد دقیقاً برابر بین سیستم و بانک برای اتصال خودکار یافت نشد.', 'info');
    }
  };

  // 2. Manual Connect Pair
  const handleManualMatch = () => {
    let sIndices: number[] = [];
    let bIndices: number[] = [];

    if (selectedSysRowIdx !== null) {
      sIndices = [selectedSysRowIdx];
    } else if (selectedSysGroupKey) {
      const g = sysGroups.find((sg) => sg.key === selectedSysGroupKey);
      if (g) sIndices = g.indices;
    }

    if (selectedBankRowIdx !== null) {
      bIndices = [selectedBankRowIdx];
    } else if (selectedBankGroupKey) {
      const g = bankGroups.find((bg) => bg.key === selectedBankGroupKey);
      if (g) bIndices = g.indices;
    }

    if (sIndices.length === 0 || bIndices.length === 0) {
      showToast('لطفاً از هر دو سمت (سیستم و بانک) حداقل یک سطر یا گروه را انتخاب نمایید.', 'error');
      return;
    }

    const count = Math.min(sIndices.length, bIndices.length);
    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newBankMatches = { ...dataStore.matches.bank_matches };

    for (let i = 0; i < count; i++) {
      const sIdx = sIndices[i];
      const bIdx = bIndices[i];
      const sRec = sys_records[sIdx];
      const bRec = bank_records[bIdx];

      newSysMatches[sIdx] = {
        matched_index: bIdx,
        status: 'GREEN',
        confidence: 1.0,
        reason: 'اتصال دستی کاربر در بخش بازبینی'
      };

      newBankMatches[bIdx] = {
        matched_index: sIdx,
        status: 'GREEN',
        confidence: 1.0,
        reason: 'اتصال دستی کاربر در بخش بازبینی'
      };

      if (onRecordDecision) {
        onRecordDecision(sRec, bRec, 'APPROVED', 'اتصال دستی کاربر');
      }
    }

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            matches: {
              ...prev.matches,
              sys_matches: newSysMatches,
              bank_matches: newBankMatches
            }
          }
        : null
    );

    setSelectedSysRowIdx(null);
    setSelectedBankRowIdx(null);
    showToast(`تعداد ${count} فیش با موفقیت به یکدیگر متصل شدند.`, 'success');
  };

  // 3. Reject Selected System Items
  const handleRejectSys = () => {
    let sIndices: number[] = [];
    if (selectedSysRowIdx !== null) {
      sIndices = [selectedSysRowIdx];
    } else if (selectedSysGroupKey) {
      const g = sysGroups.find((sg) => sg.key === selectedSysGroupKey);
      if (g) sIndices = g.indices;
    }

    if (sIndices.length === 0) {
      showToast('لطفاً یک سطر یا گروه از سیستم انتخاب نمایید.', 'error');
      return;
    }

    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newRejectedSys = new Set(dataStore.rejected_sys);

    sIndices.forEach((idx) => {
      newRejectedSys.add(idx);
      delete newSysMatches[idx];
    });

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            matches: {
              ...prev.matches,
              sys_matches: newSysMatches
            },
            rejected_sys: Array.from(newRejectedSys)
          }
        : null
    );

    setSelectedSysRowIdx(null);
    showToast(`تعداد ${sIndices.length} فیش سیستم رد شد و به عنوان مغایرت قرمز ثبت گردید.`, 'success');
  };

  // 4. Reject Selected Bank Items
  const handleRejectBank = () => {
    let bIndices: number[] = [];
    if (selectedBankRowIdx !== null) {
      bIndices = [selectedBankRowIdx];
    } else if (selectedBankGroupKey) {
      const g = bankGroups.find((bg) => bg.key === selectedBankGroupKey);
      if (g) bIndices = g.indices;
    }

    if (bIndices.length === 0) {
      showToast('لطفاً یک سطر یا گروه از بانک انتخاب نمایید.', 'error');
      return;
    }

    const newBankMatches = { ...dataStore.matches.bank_matches };
    const newRejectedBank = new Set(dataStore.rejected_bank);

    bIndices.forEach((idx) => {
      newRejectedBank.add(idx);
      delete newBankMatches[idx];
    });

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            matches: {
              ...prev.matches,
              bank_matches: newBankMatches
            },
            rejected_bank: Array.from(newRejectedBank)
          }
        : null
    );

    setSelectedBankRowIdx(null);
    showToast(`تعداد ${bIndices.length} فیش بانک رد شد و به عنوان مغایرت قرمز ثبت گردید.`, 'success');
  };

  // 5. Reject by Threshold Amount (Equal or Smaller)
  const handleRejectByThreshold = () => {
    const thresholdAmt = parseAmount(thresholdAmountInput);
    if (thresholdAmt === null || thresholdAmt <= 0) {
      showToast('لطفاً یک مبلغ معتبر و بزرگتر از صفر برای آستانه رد کردن وارد نمایید.', 'error');
      return;
    }

    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newBankMatches = { ...dataStore.matches.bank_matches };
    const newRejectedSys = new Set(dataStore.rejected_sys);
    const newRejectedBank = new Set(dataStore.rejected_bank);

    let rejectedSysCount = 0;
    let rejectedBankCount = 0;

    // Reject in System Groups
    if (rejectTargetScope === 'BOTH' || rejectTargetScope === 'SYS') {
      sysGroups.forEach((sg) => {
        if (sg.amount <= thresholdAmt) {
          sg.indices.forEach((sIdx) => {
            newRejectedSys.add(sIdx);
            delete newSysMatches[sIdx];
            rejectedSysCount++;
          });
        }
      });
    }

    // Reject in Bank Groups
    if (rejectTargetScope === 'BOTH' || rejectTargetScope === 'BANK') {
      bankGroups.forEach((bg) => {
        if (bg.amount <= thresholdAmt) {
          bg.indices.forEach((bIdx) => {
            newRejectedBank.add(bIdx);
            delete newBankMatches[bIdx];
            rejectedBankCount++;
          });
        }
      });
    }

    const totalRejected = rejectedSysCount + rejectedBankCount;
    if (totalRejected === 0) {
      showToast(`هیچ فیشی با مبلغ کمتر یا مساوی ${formatCurrency(thresholdAmt)} ریال در لیست بازبینی یافت نشد.`, 'info');
      return;
    }

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            matches: {
              ...prev.matches,
              sys_matches: newSysMatches,
              bank_matches: newBankMatches
            },
            rejected_sys: Array.from(newRejectedSys),
            rejected_bank: Array.from(newRejectedBank)
          }
        : null
    );

    setSelectedSysGroupKey(null);
    setSelectedBankGroupKey(null);
    setSelectedSysRowIdx(null);
    setSelectedBankRowIdx(null);
    showToast(
      `تعداد مجموع ${totalRejected} فیش با مبلغ کمتر یا مساوی ${formatCurrency(thresholdAmt)} ریال رد شدند (${rejectedSysCount} سیستم، ${rejectedBankCount} بانک).`,
      'success'
    );
  };

  return (
    <div className="space-y-4" id="review-tab-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border animate-fade-in max-w-md ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 border-emerald-500/50'
              : toastMessage.type === 'error'
              ? 'bg-rose-900 border-rose-500/50'
              : 'bg-slate-800 border-slate-600'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toastMessage.type === 'info' && <Layers className="w-5 h-5 text-blue-400 shrink-0" />}
          <span className="text-xs md:text-sm font-medium">{toastMessage.text}</span>
        </div>
      )}

      {/* Top Action Bar & Color Badges */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col xl:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
          <button
            onClick={handleAutoLinkEqualGroups}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
            id="btn-auto-link-equal-groups"
            title="تطبیق خودکار تمام مبالغی که تعداد کل آن‌ها در سیستم و بانک برابر است"
          >
            <Zap className="w-4 h-4 text-amber-300" />
            اتصال خودکار تمام گروه‌های هم‌تعداد و هم‌ماهیت
          </button>

          <button
            onClick={handleAutoLinkByDateAndCount}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
            id="btn-auto-link-date-and-count"
            title="تطبیق فیش‌هایی از یک مبلغ که در یک تاریخ معین، تعداد برابری در سیستم و بانک دارند"
          >
            <Calendar className="w-4 h-4 text-amber-300" />
            اتصال بر اساس تاریخ و تعداد یکسان (باقی‌ماندن مبالغ نامتعادل)
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs font-semibold shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-md">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
            بستانکار (واریز / طلب)
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 rounded-md">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
            بدهکار (برداشت / بدهی)
          </span>
        </div>
      </div>

      {/* Threshold Rejection Panel */}
      <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-3.5 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="p-2 bg-rose-100 text-rose-700 rounded-lg shrink-0">
            <FilterX className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-rose-950">رد دسته‌جمعی مبالغ خرد یا مشخص (مغایرت قطعی)</h4>
            <p className="text-[11px] text-rose-800/80">فیش‌های بازبینی با مبلغ برابر یا کوچکتر از مقدار زیر، مستقیماً به لیست مغایرت‌های قرمز منتقل می‌شوند.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <select
            value={rejectTargetScope}
            onChange={(e) => setRejectTargetScope(e.target.value as any)}
            className="text-xs font-medium bg-white border border-rose-300 rounded-lg px-2.5 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="BOTH">هم سیستم و هم بانک</option>
            <option value="SYS">فقط فیش‌های سیستم</option>
            <option value="BANK">فقط فیش‌های بانک</option>
          </select>

          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="مثال: 50,000,000 یا 50000000"
              value={thresholdAmountInput}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = parseAmount(raw);
                if (parsed !== null && !isNaN(parsed)) {
                  setThresholdAmountInput(parsed.toLocaleString('en-US'));
                } else {
                  setThresholdAmountInput(raw);
                }
              }}
              className="text-xs font-mono font-semibold bg-white border border-rose-300 rounded-lg pl-10 pr-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 w-44"
              id="input-reject-threshold-amount"
            />
            <span className="absolute left-2.5 text-[11px] font-bold text-slate-400 select-none">ریال</span>
          </div>

          <button
            onClick={handleRejectByThreshold}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
            id="btn-reject-threshold"
            title="رد کردن فیش‌های دارای مبلغ کمتر یا مساوی این مقدار"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            رد مبالغ ≤ سقف واردشده
          </button>
        </div>
      </div>

      {/* Two-Pane Grouped Tree View */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Right Pane: System Receipts */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-xs" id="pane-system-review">
          <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-blue-700" />
              <h3 className="font-bold text-slate-800 text-sm">فیش‌های سیستم (سیسست)</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {sysGroups.length} گروه مبلغی ({sysGroups.reduce((acc, g) => acc + g.indices.length, 0)} فیش)
            </span>
          </div>

          <div className="p-3 overflow-y-auto max-h-[500px] space-y-2">
            {sysGroups.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                همه فیش‌های سیستم تطبیق قطعی یافته‌اند یا رد شده‌اند.
              </div>
            ) : (
              sysGroups.map((group) => {
                const isSelectedGroup = selectedSysGroupKey === group.key;
                const isExpanded = expandedSysGroups[group.key];
                const isCredit = group.direction === 'CREDIT';

                return (
                  <div
                    key={group.key}
                    className={`border rounded-lg transition-all ${
                      isSelectedGroup
                        ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-400'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Group Header */}
                    <div
                      onClick={() => handleSysGroupClick(group)}
                      className="p-2.5 flex items-center justify-between cursor-pointer select-none bg-amber-50/50 hover:bg-amber-100/50 rounded-t-lg"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => toggleSysGroupExpand(group.key, e)}
                          className="p-1 hover:bg-amber-200/60 rounded text-slate-600 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronLeft className="w-4 h-4" />
                          )}
                        </button>
                        <span className="font-bold text-xs text-slate-800">
                          گروه مبلغ: {formatCurrency(group.amount)} ریال
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            isCredit ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {isCredit ? 'بستانکار' : 'بدهکار'}
                        </span>
                        <span className="text-xs font-mono font-bold bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full">
                          {group.indices.length} فیش
                        </span>
                      </div>
                    </div>

                    {/* Group Children (Rows) */}
                    {isExpanded && (
                      <div className="p-2 border-t border-slate-200 space-y-1.5 bg-slate-50/50">
                        {group.indices.map((idx) => {
                          const r = sys_records[idx];
                          const isRowSelected = selectedSysRowIdx === idx;
                          return (
                            <div
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSysRowIdx(idx);
                                setSelectedSysGroupKey(group.key);
                              }}
                              className={`p-2 rounded text-xs transition-all cursor-pointer border ${
                                isRowSelected
                                  ? 'bg-blue-100/80 border-blue-400 font-semibold'
                                  : isCredit
                                  ? 'bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100/60'
                                  : 'bg-blue-50/70 border-blue-100 hover:bg-blue-100/60'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-slate-800">
                                <span>ردیف اصلی: {r.original_row}</span>
                                <span>{formatCurrency(r.amount)} ریال</span>
                              </div>
                              <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                {r.date && <span>📅 {r.date}</span>}
                                {r.tracking_code && <span>🔢 رهگیری: {r.tracking_code}</span>}
                                {r.account_name && <span>👤 {r.account_name}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Left Pane: Bank Receipts */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-xs" id="pane-bank-review">
          <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-700" />
              <h3 className="font-bold text-slate-800 text-sm">فیش‌های صورتحساب بانک (ملت و ...)</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {bankGroups.length} گروه مبلغی ({bankGroups.reduce((acc, g) => acc + g.indices.length, 0)} فیش)
            </span>
          </div>

          <div className="p-3 overflow-y-auto max-h-[500px] space-y-2">
            {bankGroups.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                همه فیش‌های بانک تطبیق قطعی یافته‌اند یا رد شده‌اند.
              </div>
            ) : (
              bankGroups.map((group) => {
                const isSelectedGroup = selectedBankGroupKey === group.key;
                const isExpanded = expandedBankGroups[group.key];
                const isCredit = group.direction === 'CREDIT';

                return (
                  <div
                    key={group.key}
                    className={`border rounded-lg transition-all ${
                      isSelectedGroup
                        ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-400'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Group Header */}
                    <div
                      onClick={() => {
                        setSelectedBankGroupKey(group.key);
                        setSelectedBankRowIdx(null);
                      }}
                      className="p-2.5 flex items-center justify-between cursor-pointer select-none bg-amber-50/50 hover:bg-amber-100/50 rounded-t-lg"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => toggleBankGroupExpand(group.key, e)}
                          className="p-1 hover:bg-amber-200/60 rounded text-slate-600 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronLeft className="w-4 h-4" />
                          )}
                        </button>
                        <span className="font-bold text-xs text-slate-800">
                          گروه مبلغ: {formatCurrency(group.amount)} ریال
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            isCredit ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {isCredit ? 'بستانکار' : 'بدهکار'}
                        </span>
                        <span className="text-xs font-mono font-bold bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full">
                          {group.indices.length} فیش
                        </span>
                      </div>
                    </div>

                    {/* Group Children (Rows) */}
                    {isExpanded && (
                      <div className="p-2 border-t border-slate-200 space-y-1.5 bg-slate-50/50">
                        {group.indices.map((idx) => {
                          const r = bank_records[idx];
                          const isRowSelected = selectedBankRowIdx === idx;
                          return (
                            <div
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBankRowIdx(idx);
                                setSelectedBankGroupKey(group.key);
                              }}
                              className={`p-2 rounded text-xs transition-all cursor-pointer border ${
                                isRowSelected
                                  ? 'bg-indigo-100/80 border-indigo-400 font-semibold'
                                  : isCredit
                                  ? 'bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100/60'
                                  : 'bg-blue-50/70 border-blue-100 hover:bg-blue-100/60'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-slate-800">
                                <span>ردیف اصلی: {r.original_row}</span>
                                <span>{formatCurrency(r.amount)} ریال</span>
                              </div>
                              <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                {r.date && <span>📅 {r.date}</span>}
                                {r.serial_no && <span>🔢 سریال: {r.serial_no}</span>}
                                {r.deposit_id && <span>🆔 شناسه: {r.deposit_id}</span>}
                                {r.party_name && <span>👤 {r.party_name}</span>}
                                {r.description && <span className="truncate max-w-[200px]">📝 {r.description}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center gap-3">
        <button
          onClick={handleRejectSys}
          className="w-full md:flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          id="btn-reject-sys"
        >
          <XCircle className="w-4 h-4" />
          ❌ رد فیش/گروه سیستم
        </button>

        <button
          onClick={handleManualMatch}
          className="w-full md:flex-2 py-3 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
          id="btn-manual-match-pair"
        >
          <Link2 className="w-4 h-4" />
          🔗 اتصال و تطبیق موارد انتخابی (Match)
        </button>

        <button
          onClick={handleRejectBank}
          className="w-full md:flex-1 py-2.5 px-4 bg-slate-600 hover:bg-slate-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          id="btn-reject-bank"
        >
          <XCircle className="w-4 h-4" />
          ❌ رد فیش/گروه بانک
        </button>
      </div>
    </div>
  );
};
