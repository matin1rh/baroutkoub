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
  ArrowRightLeft
} from 'lucide-react';
import {
  SystemRecord,
  BankRecord,
  ReconciliationDataStore,
  TransactionDirection,
  ComparisonDirectionMode
} from '../types';
import { formatCurrency } from '../utils/normalization';

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

  // 1. Auto Link Equal Groups
  const handleAutoLinkEqualGroups = () => {
    const newSysMatches = { ...dataStore.matches.sys_matches };
    const newBankMatches = { ...dataStore.matches.bank_matches };

    let totalPairs = 0;
    let matchedGroupsCount = 0;

    const bankMap = new Map<string, GroupedBucket>();
    bankGroups.forEach((bg) => bankMap.set(bg.key, bg));

    sysGroups.forEach((sg) => {
      const targetBankDir = directionMode === 'DIRECT' 
        ? sg.direction 
        : (sg.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT');
      const targetKey = `${sg.amount}_${targetBankDir}`;
      const bg = bankMap.get(targetKey);

      if (bg && bg.indices.length === sg.indices.length && sg.indices.length > 0) {
        const count = sg.indices.length;
        for (let i = 0; i < count; i++) {
          const sIdx = sg.indices[i];
          const bIdx = bg.indices[i];
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
      alert(`تعداد ${matchedGroupsCount} گروه شامل ${totalPairs} فیش با موفقیت به صورت قطعی متصل شدند و از لیست بازبینی خارج گردیدند.`);
    } else {
      alert('گروهی که تعداد فیش‌های سیستم و بانک در آن دقیقاً برابر باشد یافت نشد.');
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
      alert('لطفاً از هر دو سمت (سیستم و بانک) حداقل یک سطر یا گروه را انتخاب نمایید.');
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
    alert(`تعداد ${count} فیش با موفقیت به یکدیگر متصل شدند.`);
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
      alert('لطفاً یک سطر یا گروه از سیستم انتخاب نمایید.');
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
    alert(`تعداد ${sIndices.length} فیش سیستم رد شد و به عنوان مغایرت قرمز ثبت گردید.`);
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
      alert('لطفاً یک سطر یا گروه از بانک انتخاب نمایید.');
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
    alert(`تعداد ${bIndices.length} فیش بانک رد شد و به عنوان مغایرت قرمز ثبت گردید.`);
  };

  return (
    <div className="space-y-4" id="review-tab-container">
      {/* Top Action Bar & Color Badges */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <button
          onClick={handleAutoLinkEqualGroups}
          className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
          id="btn-auto-link-equal-groups"
        >
          <Zap className="w-4 h-4 text-amber-300" />
          اتصال خودکار تمام گروه‌هایی که تعداد و ماهیت برابر دارند (Auto-Link)
        </button>

        <div className="flex items-center gap-3 text-xs font-semibold">
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
