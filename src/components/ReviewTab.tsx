import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  AlertOctagon,
  Search,
  X,
  RotateCcw
} from 'lucide-react';
import {
  SystemRecord,
  BankRecord,
  ReconciliationDataStore,
  TransactionDirection,
  ComparisonDirectionMode
} from '../types';
import { formatCurrency, parseJalaliDate, parseAmount, normalizeDigits } from '../utils/normalization';

function matchesSearch(val: any, query: string): boolean {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  if (!str || !query) return false;
  const cleanQ = query.trim().toLowerCase();
  const lowerStr = str.toLowerCase();
  if (lowerStr.includes(cleanQ)) return true;

  // Normalized digit matching (e.g. Persian/Arabic numbers vs English numbers)
  const normVal = normalizeDigits(lowerStr);
  const normQ = normalizeDigits(cleanQ);
  if (normQ && normVal.includes(normQ)) return true;

  // Persian character variations
  const pNormVal = normVal.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const pNormQ = normQ.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (pNormQ && pNormVal.includes(pNormQ)) return true;

  return false;
}

function matchSystemRecord(rec: SystemRecord, query: string): boolean {
  if (!query || !query.trim()) return true;
  const q = query.trim();

  if (matchesSearch(rec.tracking_code, q)) return true;
  if (matchesSearch(rec.raw_desc, q)) return true;
  if (matchesSearch(rec.account_name, q)) return true;
  if (matchesSearch(rec.doc_type, q)) return true;
  if (matchesSearch(rec.date, q)) return true;
  if (matchesSearch(rec.original_row, q)) return true;
  if (matchesSearch(rec.amount, q)) return true;
  if (matchesSearch(formatCurrency(rec.amount), q)) return true;

  if (Array.isArray(rec.raw_data)) {
    for (const cell of rec.raw_data) {
      if (cell !== null && cell !== undefined && matchesSearch(cell, q)) {
        return true;
      }
    }
  }

  return false;
}

function matchBankRecord(rec: BankRecord, query: string): boolean {
  if (!query || !query.trim()) return true;
  const q = query.trim();

  if (matchesSearch(rec.description, q)) return true;
  if (matchesSearch(rec.serial_no, q)) return true;
  if (matchesSearch(rec.deposit_id, q)) return true;
  if (matchesSearch(rec.party_name, q)) return true;
  if (matchesSearch(rec.raw_desc, q)) return true;
  if (matchesSearch(rec.date, q)) return true;
  if (matchesSearch(rec.original_row, q)) return true;
  if (matchesSearch(rec.amount, q)) return true;
  if (matchesSearch(formatCurrency(rec.amount), q)) return true;

  if (Array.isArray(rec.raw_data)) {
    for (const cell of rec.raw_data) {
      if (cell !== null && cell !== undefined && matchesSearch(cell, q)) {
        return true;
      }
    }
  }

  return false;
}

function highlightText(val: any, query: string): React.ReactNode {
  if (val === null || val === undefined) return null;
  const text = String(val);
  if (!query || !query.trim()) return text;

  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);

  if (idx !== -1) {
    return (
      <span>
        {text.slice(0, idx)}
        <mark className="bg-amber-300 text-slate-950 font-bold px-1 py-0.2 rounded shadow-xs">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </span>
    );
  }

  // Check normalized digits
  const normDigitsQ = normalizeDigits(q);
  const normDigitsText = normalizeDigits(text);
  const digitIdx = normDigitsText.indexOf(normDigitsQ);
  if (digitIdx !== -1 && normDigitsQ.length > 0) {
    return (
      <span>
        {text.slice(0, digitIdx)}
        <mark className="bg-amber-300 text-slate-950 font-bold px-1 py-0.2 rounded shadow-xs">
          {text.slice(digitIdx, digitIdx + normDigitsQ.length)}
        </mark>
        {text.slice(digitIdx + normDigitsQ.length)}
      </span>
    );
  }

  return text;
}

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
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
    undoAction?: () => void;
  } | null>(null);
  const [toastCountdown, setToastCountdown] = useState<number>(6);
  const toastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [thresholdAmountInput, setThresholdAmountInput] = useState<string>('');
  const [rejectTargetScope, setRejectTargetScope] = useState<'BOTH' | 'SYS' | 'BANK'>('BOTH');
  const [sysSearchInput, setSysSearchInput] = useState<string>('');
  const [sysActiveSearch, setSysActiveSearch] = useState<string>('');
  const [bankSearchInput, setBankSearchInput] = useState<string>('');
  const [bankActiveSearch, setBankActiveSearch] = useState<string>('');

  const clearToastTimer = () => {
    if (toastTimerRef.current) {
      clearInterval(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearToastTimer();
  }, []);

  const showToast = (
    text: string,
    type: 'success' | 'error' | 'info' = 'success',
    undoAction?: () => void
  ) => {
    clearToastTimer();
    setToastMessage({ text, type, undoAction });
    setToastCountdown(6);

    let remaining = 6;
    toastTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearToastTimer();
        setToastMessage(null);
      } else {
        setToastCountdown(remaining);
      }
    }, 1000);
  };

  const createUndoSnapshot = () => {
    if (!dataStore) return undefined;
    const prevSysMatches = { ...dataStore.matches.sys_matches };
    const prevBankMatches = { ...dataStore.matches.bank_matches };
    const prevRejectedSys = [...dataStore.rejected_sys];
    const prevRejectedBank = [...dataStore.rejected_bank];
    const prevSysGroup = selectedSysGroupKey;
    const prevBankGroup = selectedBankGroupKey;
    const prevSysRow = selectedSysRowIdx;
    const prevBankRow = selectedBankRowIdx;

    return () => {
      setDataStore((prev) =>
        prev
          ? {
              ...prev,
              matches: {
                ...prev.matches,
                sys_matches: prevSysMatches,
                bank_matches: prevBankMatches
              },
              rejected_sys: prevRejectedSys,
              rejected_bank: prevRejectedBank
            }
          : null
      );
      setSelectedSysGroupKey(prevSysGroup);
      setSelectedBankGroupKey(prevBankGroup);
      setSelectedSysRowIdx(prevSysRow);
      setSelectedBankRowIdx(prevBankRow);
      showToast('عملیات منسوخ شد و فیش‌ها به وضعیت قبل بازگشتند.', 'info');
    };
  };

  if (!dataStore || dataStore.sys_records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
        <Layers className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="font-bold text-slate-700 text-base">هنوز داده‌ای بارگذاری یا تطبیق داده نشده است</h3>
        <p className="text-xs text-slate-400 mt-1">
          لطفاً ابتدا از تب «پردازش و تطبیق خودکار» فایل‌های اکسل را بارگذاری و تطبیق دهید.
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

  // Search in System Records (Filtered to selected category or global if none selected)
  const handleSysSearch = () => {
    const q = sysSearchInput.trim();
    if (!q) {
      setSysActiveSearch('');
      showToast('لطفاً متن یا عدد مورد نظر برای جستجو در سیستم را وارد کنید.', 'info');
      return;
    }

    setSysActiveSearch(q);

    // If a group/category is selected, search within that selected category
    if (selectedSysGroupKey) {
      const g = sysGroups.find((sg) => sg.key === selectedSysGroupKey);
      if (g) {
        const matchesCount = g.indices.filter((i) => matchSystemRecord(sys_records[i], q)).length;
        setExpandedSysGroups((prev) => ({ ...prev, [selectedSysGroupKey]: true }));

        if (matchesCount > 0) {
          showToast(`تعداد ${matchesCount} فیش منطبق با «${q}» در دسته انتخابی سیستم یافت شد.`, 'success');
        } else {
          // Check if other groups have matches
          const totalInOtherGroups = sysGroups.reduce((acc, og) => {
            if (og.key === selectedSysGroupKey) return acc;
            return acc + og.indices.filter((i) => matchSystemRecord(sys_records[i], q)).length;
          }, 0);

          if (totalInOtherGroups > 0) {
            showToast(
              `در این دسته انتخابی موردی یافت نشد؛ اما در سایر دسته‌ها ${totalInOtherGroups} فیش منطبق وجود دارد.`,
              'info'
            );
          } else {
            showToast(`هیچ فیشی با مشخصات «${q}» در سیستم یافت نشد.`, 'error');
          }
        }
        return;
      }
    }

    // If no group was selected yet, find matching groups and auto-select/expand the first
    let firstMatchingGroupKey: string | null = null;
    let totalFound = 0;
    const newExpanded: Record<string, boolean> = { ...expandedSysGroups };

    sysGroups.forEach((sg) => {
      const cnt = sg.indices.filter((i) => matchSystemRecord(sys_records[i], q)).length;
      if (cnt > 0) {
        totalFound += cnt;
        newExpanded[sg.key] = true;
        if (!firstMatchingGroupKey) {
          firstMatchingGroupKey = sg.key;
        }
      }
    });

    if (firstMatchingGroupKey) {
      setSelectedSysGroupKey(firstMatchingGroupKey);
      setExpandedSysGroups(newExpanded);
      showToast(`تعداد ${totalFound} فیش منطبق در دسته‌های سیستم یافت شد.`, 'success');
    } else {
      showToast(`هیچ فیشی با مشخصات «${q}» در فیش‌های سیستم یافت نشد.`, 'error');
    }
  };

  const handleClearSysSearch = () => {
    setSysSearchInput('');
    setSysActiveSearch('');
  };

  // Search in Bank Records (Filtered to selected category or global if none selected)
  const handleBankSearch = () => {
    const q = bankSearchInput.trim();
    if (!q) {
      setBankActiveSearch('');
      showToast('لطفاً متن یا عدد مورد نظر برای جستجو در بانک را وارد کنید.', 'info');
      return;
    }

    setBankActiveSearch(q);

    // If a group/category is selected, search within that selected category
    if (selectedBankGroupKey) {
      const g = bankGroups.find((bg) => bg.key === selectedBankGroupKey);
      if (g) {
        const matchesCount = g.indices.filter((i) => matchBankRecord(bank_records[i], q)).length;
        setExpandedBankGroups((prev) => ({ ...prev, [selectedBankGroupKey]: true }));

        if (matchesCount > 0) {
          showToast(`تعداد ${matchesCount} فیش منطبق با «${q}» در دسته انتخابی بانک یافت شد.`, 'success');
        } else {
          // Check if other groups have matches
          const totalInOtherGroups = bankGroups.reduce((acc, og) => {
            if (og.key === selectedBankGroupKey) return acc;
            return acc + og.indices.filter((i) => matchBankRecord(bank_records[i], q)).length;
          }, 0);

          if (totalInOtherGroups > 0) {
            showToast(
              `در این دسته انتخابی موردی یافت نشد؛ اما در سایر دسته‌ها ${totalInOtherGroups} فیش منطبق وجود دارد.`,
              'info'
            );
          } else {
            showToast(`هیچ فیشی با مشخصات «${q}» در صورتحساب بانک یافت نشد.`, 'error');
          }
        }
        return;
      }
    }

    // If no group was selected yet, find matching groups and auto-select/expand the first
    let firstMatchingGroupKey: string | null = null;
    let totalFound = 0;
    const newExpanded: Record<string, boolean> = { ...expandedBankGroups };

    bankGroups.forEach((bg) => {
      const cnt = bg.indices.filter((i) => matchBankRecord(bank_records[i], q)).length;
      if (cnt > 0) {
        totalFound += cnt;
        newExpanded[bg.key] = true;
        if (!firstMatchingGroupKey) {
          firstMatchingGroupKey = bg.key;
        }
      }
    });

    if (firstMatchingGroupKey) {
      setSelectedBankGroupKey(firstMatchingGroupKey);
      setExpandedBankGroups(newExpanded);
      showToast(`تعداد ${totalFound} فیش منطبق در دسته‌های بانک یافت شد.`, 'success');
    } else {
      showToast(`هیچ فیشی با مشخصات «${q}» در صورتحساب بانک یافت نشد.`, 'error');
    }
  };

  const handleClearBankSearch = () => {
    setBankSearchInput('');
    setBankActiveSearch('');
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
      const undoFn = createUndoSnapshot();
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
      showToast(
        `تعداد ${matchedGroupsCount} گروه شامل ${totalPairs} فیش با موفقیت به صورت قطعی متصل شدند و از لیست بازبینی خارج گردیدند.`,
        'success',
        undoFn
      );
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
      const undoFn = createUndoSnapshot();
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
      showToast(
        `تعداد ${totalPairs} فیش در ${matchedDatesCount} تاریخ (با تعداد دقیقاً برابر در سیستم و بانک) متصل شدند. مواردی که تعدادشان در یک تاریخ نابرابر بود در لیست بازبینی باقی ماندند.`,
        'success',
        undoFn
      );
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

    const undoFn = createUndoSnapshot();
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
    showToast(`تعداد ${count} فیش با موفقیت به یکدیگر متصل شدند.`, 'success', undoFn);
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

    const undoFn = createUndoSnapshot();
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
    showToast(`تعداد ${sIndices.length} فیش سیستم رد شد و به عنوان مغایرت قرمز ثبت گردید.`, 'success', undoFn);
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

    const undoFn = createUndoSnapshot();
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
    showToast(`تعداد ${bIndices.length} فیش بانک رد شد و به عنوان مغایرت قرمز ثبت گردید.`, 'success', undoFn);
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

    const undoFn = createUndoSnapshot();
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
      'success',
      undoFn
    );
  };

  return (
    <div className="space-y-4" id="review-tab-container">
      {/* Toast Notification with 6-second countdown & Undo option */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center justify-between gap-4 border animate-fade-in max-w-xl ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 border-emerald-500/60'
              : toastMessage.type === 'error'
              ? 'bg-rose-950 border-rose-500/60'
              : 'bg-slate-800 border-slate-600'
          }`}
        >
          <div className="flex items-center gap-3">
            {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
            {toastMessage.type === 'info' && <Layers className="w-5 h-5 text-blue-400 shrink-0" />}
            <span className="text-xs md:text-sm font-medium leading-relaxed">{toastMessage.text}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {toastMessage.undoAction ? (
              <button
                type="button"
                onClick={() => {
                  if (toastMessage.undoAction) {
                    toastMessage.undoAction();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs rounded-lg shadow-sm transition-colors cursor-pointer"
                id="btn-undo-review-action"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>منسوخ کردن</span>
                <span className="font-mono bg-slate-950/15 px-1.5 py-0.5 rounded text-[11px]">
                  {toastCountdown.toLocaleString('fa-IR')} ثانیه
                </span>
              </button>
            ) : (
              <span className="text-[11px] font-mono bg-white/10 text-slate-200 px-2 py-1 rounded-md">
                {toastCountdown.toLocaleString('fa-IR')} ثانیه
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                clearToastTimer();
                setToastMessage(null);
              }}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              title="بستن پیام"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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
            <h4 className="text-xs font-bold text-rose-950">رد دسته‌جمعی مبالغ خرد</h4>
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
              <h3 className="font-bold text-slate-800 text-sm">فیش‌های سیستم</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {sysGroups.length} گروه مبلغی ({sysGroups.reduce((acc, g) => acc + g.indices.length, 0)} فیش)
            </span>
          </div>

          {/* Search Box in System Pane */}
          <div className="p-2.5 bg-slate-50 border-b border-slate-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSysSearch();
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={sysSearchInput}
                  onChange={(e) => setSysSearchInput(e.target.value)}
                  placeholder={
                    selectedSysGroupKey
                      ? 'جستجو در شرح، کد پیگیری و فیش‌های دسته انتخابی...'
                      : 'جستجو در شرح، کد پیگیری و فیش‌های سیستم...'
                  }
                  className="w-full pl-7 pr-8 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-800 placeholder-slate-400"
                  id="input-search-sys"
                />
                {sysSearchInput && (
                  <button
                    type="button"
                    onClick={handleClearSysSearch}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
                    title="پاک کردن جستجو"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
                id="btn-search-sys"
              >
                <Search className="w-3.5 h-3.5" />
                جستجو
              </button>
            </form>

            {/* Active search filter badge */}
            {sysActiveSearch && (
              <div className="mt-2 flex items-center justify-between bg-blue-50 text-blue-900 px-2.5 py-1 rounded text-xs border border-blue-200">
                <span className="flex items-center gap-1 truncate">
                  <span className="font-semibold">فیلتر جستجو:</span> «{sysActiveSearch}»
                  {selectedSysGroupKey && <span className="text-slate-500 text-[11px] mr-1">(در دسته انتخابی)</span>}
                </span>
                <button
                  type="button"
                  onClick={handleClearSysSearch}
                  className="text-blue-700 hover:text-blue-900 font-bold text-[11px] underline flex items-center gap-0.5 mr-2 shrink-0 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  نمایش همه
                </button>
              </div>
            )}
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

                const matchingIndices = sysActiveSearch
                  ? group.indices.filter((idx) => matchSystemRecord(sys_records[idx], sysActiveSearch))
                  : group.indices;

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
                        {sysActiveSearch && (
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              matchingIndices.length > 0
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {matchingIndices.length} از {group.indices.length} منطبق
                          </span>
                        )}
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
                        {matchingIndices.length === 0 ? (
                          <div className="p-3 text-center text-xs text-amber-800 bg-amber-50 rounded-lg border border-amber-200">
                            هیچ فیشی در این دسته با عبارت «{sysActiveSearch}» همخوانی ندارد.
                            <button
                              type="button"
                              onClick={handleClearSysSearch}
                              className="mr-2 text-blue-600 hover:text-blue-800 font-bold underline cursor-pointer"
                            >
                              نمایش همه فیش‌های این دسته
                            </button>
                          </div>
                        ) : (
                          matchingIndices.map((idx) => {
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
                                className={`p-2.5 rounded-lg text-xs transition-all cursor-pointer border ${
                                  isRowSelected
                                    ? 'bg-blue-100/90 border-blue-500 ring-2 ring-blue-300 font-semibold shadow-xs'
                                    : isCredit
                                    ? 'bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/60'
                                    : 'bg-blue-50/70 border-blue-200 hover:bg-blue-100/60'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold text-slate-800">
                                  <span>ردیف اصلی: {highlightText(r.original_row, sysActiveSearch)}</span>
                                  <span className="font-mono">{formatCurrency(r.amount)} ریال</span>
                                </div>
                                <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                  {r.date && <span>📅 {highlightText(r.date, sysActiveSearch)}</span>}
                                  {r.tracking_code && <span>🔢 رهگیری: {highlightText(r.tracking_code, sysActiveSearch)}</span>}
                                  {r.account_name && <span>👤 طرف حساب: {highlightText(r.account_name, sysActiveSearch)}</span>}
                                  {r.doc_type && <span>📄 {highlightText(r.doc_type, sysActiveSearch)}</span>}
                                </div>
                                {r.raw_desc && (
                                  <div className="text-[11px] text-slate-700 bg-white/90 rounded px-2 py-1 mt-1.5 border border-slate-200/80 break-words">
                                    <span className="font-semibold text-slate-500">📝 شرح: </span>
                                    {highlightText(r.raw_desc, sysActiveSearch)}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
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
              <h3 className="font-bold text-slate-800 text-sm">فیش‌های صورتحساب بانک</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {bankGroups.length} گروه مبلغی ({bankGroups.reduce((acc, g) => acc + g.indices.length, 0)} فیش)
            </span>
          </div>

          {/* Search Box in Bank Pane */}
          <div className="p-2.5 bg-slate-50 border-b border-slate-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleBankSearch();
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={bankSearchInput}
                  onChange={(e) => setBankSearchInput(e.target.value)}
                  placeholder={
                    selectedBankGroupKey
                      ? 'جستجو در شرح، سریال، شناسه و فیش‌های دسته انتخابی...'
                      : 'جستجو در شرح، سریال، شناسه و فیش‌های بانک...'
                  }
                  className="w-full pl-7 pr-8 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 placeholder-slate-400"
                  id="input-search-bank"
                />
                {bankSearchInput && (
                  <button
                    type="button"
                    onClick={handleClearBankSearch}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
                    title="پاک کردن جستجو"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
                id="btn-search-bank"
              >
                <Search className="w-3.5 h-3.5" />
                جستجو
              </button>
            </form>

            {/* Active search filter badge */}
            {bankActiveSearch && (
              <div className="mt-2 flex items-center justify-between bg-indigo-50 text-indigo-900 px-2.5 py-1 rounded text-xs border border-indigo-200">
                <span className="flex items-center gap-1 truncate">
                  <span className="font-semibold">فیلتر جستجو:</span> «{bankActiveSearch}»
                  {selectedBankGroupKey && <span className="text-slate-500 text-[11px] mr-1">(در دسته انتخابی)</span>}
                </span>
                <button
                  type="button"
                  onClick={handleClearBankSearch}
                  className="text-indigo-700 hover:text-indigo-900 font-bold text-[11px] underline flex items-center gap-0.5 mr-2 shrink-0 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  نمایش همه
                </button>
              </div>
            )}
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

                const matchingIndices = bankActiveSearch
                  ? group.indices.filter((idx) => matchBankRecord(bank_records[idx], bankActiveSearch))
                  : group.indices;

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
                        {bankActiveSearch && (
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              matchingIndices.length > 0
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {matchingIndices.length} از {group.indices.length} منطبق
                          </span>
                        )}
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
                        {matchingIndices.length === 0 ? (
                          <div className="p-3 text-center text-xs text-amber-800 bg-amber-50 rounded-lg border border-amber-200">
                            هیچ فیشی در این دسته با عبارت «{bankActiveSearch}» همخوانی ندارد.
                            <button
                              type="button"
                              onClick={handleClearBankSearch}
                              className="mr-2 text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                            >
                              نمایش همه فیش‌های این دسته
                            </button>
                          </div>
                        ) : (
                          matchingIndices.map((idx) => {
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
                                className={`p-2.5 rounded-lg text-xs transition-all cursor-pointer border ${
                                  isRowSelected
                                    ? 'bg-indigo-100/90 border-indigo-500 ring-2 ring-indigo-300 font-semibold shadow-xs'
                                    : isCredit
                                    ? 'bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/60'
                                    : 'bg-blue-50/70 border-blue-200 hover:bg-blue-100/60'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold text-slate-800">
                                  <span>ردیف اصلی: {highlightText(r.original_row, bankActiveSearch)}</span>
                                  <span className="font-mono">{formatCurrency(r.amount)} ریال</span>
                                </div>
                                <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                  {r.date && <span>📅 {highlightText(r.date, bankActiveSearch)}</span>}
                                  {r.serial_no && <span>🔢 سریال: {highlightText(r.serial_no, bankActiveSearch)}</span>}
                                  {r.deposit_id && <span>🆔 شناسه: {highlightText(r.deposit_id, bankActiveSearch)}</span>}
                                  {r.party_name && <span>👤 طرف حساب: {highlightText(r.party_name, bankActiveSearch)}</span>}
                                </div>
                                {(r.description || r.raw_desc) && (
                                  <div className="text-[11px] text-slate-700 bg-white/90 rounded px-2 py-1 mt-1.5 border border-slate-200/80 break-words">
                                    <span className="font-semibold text-slate-500">📝 شرح: </span>
                                    {highlightText(r.description || r.raw_desc, bankActiveSearch)}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
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
