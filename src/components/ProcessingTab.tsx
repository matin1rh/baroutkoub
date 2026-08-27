import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Play,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck2,
  Calendar,
  Sparkles,
  RefreshCw,
  Database,
  ArrowRightLeft,
  SlidersHorizontal,
  FileText,
  Hash,
  Clock
} from 'lucide-react';
import {
  SystemRecord,
  BankRecord,
  ReconciliationDataStore,
  ReconciliationSummary,
  ComparisonDirectionMode
} from '../types';
import { ExcelProcessor } from '../utils/excelIo';
import { ReconciliationEngine } from '../utils/matcher';
import { formatCurrency } from '../utils/normalization';
import { SAMPLE_SYSTEM_RECORDS, SAMPLE_BANK_RECORDS } from '../utils/sampleData';

interface ProcessingTabProps {
  dataStore: ReconciliationDataStore | null;
  setDataStore: React.Dispatch<React.SetStateAction<ReconciliationDataStore | null>>;
  onAutoReconcile: () => void;
  isProcessing: boolean;
  progressPercent: number;
  statusMessage: string;
  maxDays: number;
  setMaxDays: (days: number) => void;
  useAi: boolean;
  setUseAi: (use: boolean) => void;
  directionMode: ComparisonDirectionMode;
  setDirectionMode: (mode: ComparisonDirectionMode) => void;
  summary: ReconciliationSummary | null;
  onDownloadSys: () => void;
  onDownloadBank: () => void;
  onDownloadReport: () => void;
  onLoadSampleData: () => void;
}

export const ProcessingTab: React.FC<ProcessingTabProps> = ({
  dataStore,
  setDataStore,
  onAutoReconcile,
  isProcessing,
  progressPercent,
  statusMessage,
  maxDays,
  setMaxDays,
  useAi,
  setUseAi,
  directionMode,
  setDirectionMode,
  summary,
  onDownloadSys,
  onDownloadBank,
  onDownloadReport,
  onLoadSampleData
}) => {
  const [sysFileName, setSysFileName] = useState<string>('');
  const [bankFileName, setBankFileName] = useState<string>('');
  const [sysIsToman, setSysIsToman] = useState<boolean>(false);
  const [bankIsToman, setBankIsToman] = useState<boolean>(false);

  // Stored ArrayBuffers for live re-parsing upon column selection change
  const [sysBuffer, setSysBuffer] = useState<ArrayBuffer | null>(null);
  const [bankBuffer, setBankBuffer] = useState<ArrayBuffer | null>(null);

  // Column header lists for dropdown selectors
  const [sysHeaders, setSysHeaders] = useState<{ index: number; label: string }[]>([]);
  const [bankHeaders, setBankHeaders] = useState<{ index: number; label: string }[]>([]);

  // Selected column mapping states (-1 means auto-detect / none)
  const [sysDateCol, setSysDateCol] = useState<number>(-1);
  const [sysTrackingCol, setSysTrackingCol] = useState<number>(-1);
  const [sysDescCol, setSysDescCol] = useState<number>(-1);

  const [bankDateCol, setBankDateCol] = useState<number>(-1);
  const [bankTrackingCol, setBankTrackingCol] = useState<number>(-1);
  const [bankDescCol, setBankDescCol] = useState<number>(-1);

  const sysInputRef = useRef<HTMLInputElement | null>(null);
  const bankInputRef = useRef<HTMLInputElement | null>(null);

  const handleSysFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSysFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      setSysBuffer(buffer);
      const parsed = ExcelProcessor.readSystemFile(buffer);
      if (parsed.records.length === 0) {
        alert('هیچ رکورد معتبری در فایل سیستم یافت نشد.');
        return;
      }
      setSysHeaders(parsed.headers);
      
      // Auto detected initial mappings
      const detectedDate = parsed.detectedMapping.op_date ?? parsed.detectedMapping.doc_date ?? -1;
      const detectedTrack = parsed.detectedMapping.tracking ?? -1;
      const detectedDesc = parsed.detectedMapping.doc_type ?? -1;

      setSysDateCol(detectedDate);
      setSysTrackingCol(detectedTrack);
      setSysDescCol(detectedDesc);

      const finalRecords = parsed.records;
      if (sysIsToman) {
        finalRecords.forEach((r) => {
          r.amount = Math.round(r.amount * 10);
        });
      }

      setDataStore((prev) => ({
        sys_name: file.name,
        bank_name: prev?.bank_name,
        sys_records: finalRecords,
        bank_records: prev?.bank_records || [],
        matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
        rejected_sys: [],
        rejected_bank: []
      }));
    } catch (err: any) {
      alert(`خطا در خواندن فایل سیستم: ${err.message || err}`);
    }
  };

  const handleBankFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      setBankBuffer(buffer);
      const parsed = ExcelProcessor.readBankFile(buffer);
      if (parsed.records.length === 0) {
        alert('هیچ رکورد معتبری در فایل بانک یافت نشد.');
        return;
      }
      setBankHeaders(parsed.headers);

      const detectedDate = parsed.detectedMapping.date ?? -1;
      const detectedTrack = parsed.detectedMapping.serial ?? -1;
      const detectedDesc = parsed.detectedMapping.desc ?? -1;

      setBankDateCol(detectedDate);
      setBankTrackingCol(detectedTrack);
      setBankDescCol(detectedDesc);

      const finalRecords = parsed.records;
      if (bankIsToman) {
        finalRecords.forEach((r) => {
          r.amount = Math.round(r.amount * 10);
        });
      }

      setDataStore((prev) => ({
        sys_name: prev?.sys_name,
        bank_name: file.name,
        sys_records: prev?.sys_records || [],
        bank_records: finalRecords,
        matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
        rejected_sys: [],
        rejected_bank: []
      }));
    } catch (err: any) {
      alert(`خطا در خواندن فایل بانک: ${err.message || err}`);
    }
  };

  // Re-parse System file when user manually selects columns
  const reparseSystemFile = (
    newDateCol: number,
    newTrackingCol: number,
    newDescCol: number,
    isToman: boolean = sysIsToman
  ) => {
    if (!sysBuffer) return;
    const parsed = ExcelProcessor.readSystemFile(sysBuffer, {
      dateCol: newDateCol >= 0 ? newDateCol : undefined,
      trackingCol: newTrackingCol >= 0 ? newTrackingCol : undefined,
      descCol: newDescCol >= 0 ? newDescCol : undefined
    });

    if (isToman) {
      parsed.records.forEach((r) => {
        r.amount = Math.round(r.amount * 10);
      });
    }

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            sys_records: parsed.records,
            matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
            rejected_sys: [],
            rejected_bank: []
          }
        : null
    );
  };

  // Re-parse Bank file when user manually selects columns
  const reparseBankFile = (
    newDateCol: number,
    newTrackingCol: number,
    newDescCol: number,
    isToman: boolean = bankIsToman
  ) => {
    if (!bankBuffer) return;
    const parsed = ExcelProcessor.readBankFile(bankBuffer, {
      dateCol: newDateCol >= 0 ? newDateCol : undefined,
      trackingCol: newTrackingCol >= 0 ? newTrackingCol : undefined,
      descCol: newDescCol >= 0 ? newDescCol : undefined
    });

    if (isToman) {
      parsed.records.forEach((r) => {
        r.amount = Math.round(r.amount * 10);
      });
    }

    setDataStore((prev) =>
      prev
        ? {
            ...prev,
            bank_records: parsed.records,
            matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
            rejected_sys: [],
            rejected_bank: []
          }
        : null
    );
  };

  const handleSysTomanToggle = (isToman: boolean) => {
    setSysIsToman(isToman);
    if (sysBuffer) {
      reparseSystemFile(sysDateCol, sysTrackingCol, sysDescCol, isToman);
    } else if (dataStore && dataStore.sys_records.length > 0) {
      const factor = isToman ? 10 : 0.1;
      const updated = dataStore.sys_records.map((r) => ({
        ...r,
        amount: Math.round(r.amount * factor)
      }));
      setDataStore((prev) =>
        prev
          ? {
              ...prev,
              sys_records: updated,
              matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
              rejected_sys: [],
              rejected_bank: []
            }
          : null
      );
    }
  };

  const handleBankTomanToggle = (isToman: boolean) => {
    setBankIsToman(isToman);
    if (bankBuffer) {
      reparseBankFile(bankDateCol, bankTrackingCol, bankDescCol, isToman);
    } else if (dataStore && dataStore.bank_records.length > 0) {
      const factor = isToman ? 10 : 0.1;
      const updated = dataStore.bank_records.map((r) => ({
        ...r,
        amount: Math.round(r.amount * factor)
      }));
      setDataStore((prev) =>
        prev
          ? {
              ...prev,
              bank_records: updated,
              matches: { sys_matches: {}, bank_matches: {}, detected_mode: 'NONE' },
              rejected_sys: [],
              rejected_bank: []
            }
          : null
      );
    }
  };

  const hasSys = Boolean(dataStore?.sys_records && dataStore.sys_records.length > 0);
  const hasBank = Boolean(dataStore?.bank_records && dataStore.bank_records.length > 0);
  const canRun = hasSys && hasBank && !isProcessing;
  const hasMatches = Boolean(dataStore && Object.keys(dataStore.matches.sys_matches).length > 0);

  return (
    <div className="space-y-6" id="processing-tab-container">
      {/* Top Banner / Sample Data Quick Loader */}
      <div className="bg-gradient-to-l from-blue-900 to-indigo-800 text-white rounded-xl p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 border border-blue-700">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-300" />
            تطبیق هوشمند و چندلایه‌ای اسناد حسابداری و صورتحساب بانک
          </h2>
          <p className="text-blue-100 text-sm mt-1 leading-relaxed">
            فایل‌های اکسل نرم‌افزار حسابداری (سیست) و پرینت گردش حساب بانکی (ملت، ملی، سامان و ...) را بارگذاری نمایید و ستون‌های مربوط به کدپیگیری، توضیحات و تاریخ را در صورت تمایل تنظیم نمایید.
          </p>
        </div>
        <button
          onClick={onLoadSampleData}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm rounded-lg shadow-sm transition-colors whitespace-nowrap cursor-pointer"
          id="btn-load-sample-data"
        >
          <Database className="w-4 h-4" />
          بارگذاری داده‌های آزمایشی
        </button>
      </div>

      {/* File Upload Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* System File Box */}
        <div
          className={`border-2 rounded-xl p-5 bg-white transition-all ${
            hasSys ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200 hover:border-blue-300'
          }`}
          id="box-system-upload"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                ۱
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-base">فایل اکسل سیستم مالی (سیست)</h3>
                <p className="text-xs text-slate-500">حاوی ستون‌های بدهکار، بستانکار، کد رهگیری، نام حساب</p>
              </div>
            </div>
            {hasSys && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {dataStore?.sys_records.length} تراکنش
              </span>
            )}
          </div>

          <div
            onClick={() => sysInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg p-5 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-blue-50/50"
          >
            <input
              ref={sysInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleSysFileUpload}
            />
            <FileSpreadsheet className="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">
              {sysFileName || dataStore?.sys_name || 'انتخاب یا رها کردن فایل اکسل سیستم (xlsx)'}
            </p>
            <p className="text-xs text-slate-400 mt-1">کلیک کنید تا فایل سیستم را انتخاب کنید</p>
          </div>

          {/* System Column Mapping Dropdowns */}
          {sysHeaders.length > 0 && (
            <div className="mt-3.5 p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-xl space-y-2.5" id="sys-column-mapping-panel">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
                  انتخاب و تطبیق ستون‌های فایل سیستم:
                </span>
                <span className="text-[10px] text-blue-600 font-medium">تشخیص خودکار فعال است</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {/* Tracking Code Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-slate-500" />
                    ستون کد رهگیری:
                  </label>
                  <select
                    value={sysTrackingCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSysTrackingCol(val);
                      reparseSystemFile(sysDateCol, val, sysDescCol);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {sysHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Description Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-slate-500" />
                    ستون توضیحات / شرح:
                  </label>
                  <select
                    value={sysDescCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSysDescCol(val);
                      reparseSystemFile(sysDateCol, sysTrackingCol, val);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {sysHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    ستون تاریخ:
                  </label>
                  <select
                    value={sysDateCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSysDateCol(val);
                      reparseSystemFile(val, sysTrackingCol, sysDescCol);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {sysHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* System Toman Checkbox */}
          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between bg-slate-50/80 px-3 py-2 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={sysIsToman}
                onChange={(e) => handleSysTomanToggle(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                id="checkbox-sys-toman"
              />
              <span className="flex items-center gap-1.5">
                <span>واحد مبالغ این فایل به <strong>تومان</strong> است</span>
                <span className="text-[11px] font-normal text-slate-500">(ضرب در ۱۰ جهت تبدیل به ریال)</span>
              </span>
            </label>
            {sysIsToman && (
              <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200 font-mono">
                ×۱۰ ریال فعال
              </span>
            )}
          </div>
        </div>

        {/* Bank File Box */}
        <div
          className={`border-2 rounded-xl p-5 bg-white transition-all ${
            hasBank ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200 hover:border-blue-300'
          }`}
          id="box-bank-upload"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                ۲
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-base">فایل اکسل صورتحساب بانک (ملت و ...)</h3>
                <p className="text-xs text-slate-500">حاوی ستون‌های گردش بدهکار/بستانکار، شرح، شناسه، سریال</p>
              </div>
            </div>
            {hasBank && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {dataStore?.bank_records.length} تراکنش
              </span>
            )}
          </div>

          <div
            onClick={() => bankInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-5 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-indigo-50/50"
          >
            <input
              ref={bankInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleBankFileUpload}
            />
            <FileSpreadsheet className="w-8 h-8 text-indigo-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">
              {bankFileName || dataStore?.bank_name || 'انتخاب یا رها کردن فایل صورتحساب بانک (xlsx)'}
            </p>
            <p className="text-xs text-slate-400 mt-1">کلیک کنید تا فایل صورتحساب بانک را انتخاب کنید</p>
          </div>

          {/* Bank Column Mapping Dropdowns */}
          {bankHeaders.length > 0 && (
            <div className="mt-3.5 p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl space-y-2.5" id="bank-column-mapping-panel">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-700" />
                  انتخاب و تطبیق ستون‌های فایل بانک:
                </span>
                <span className="text-[10px] text-indigo-600 font-medium">تشخیص خودکار فعال است</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {/* Tracking / Serial Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-slate-500" />
                    ستون کد رهگیری / سریال:
                  </label>
                  <select
                    value={bankTrackingCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBankTrackingCol(val);
                      reparseBankFile(bankDateCol, val, bankDescCol);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {bankHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Description Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-slate-500" />
                    ستون شرح / توضیحات:
                  </label>
                  <select
                    value={bankDescCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBankDescCol(val);
                      reparseBankFile(bankDateCol, bankTrackingCol, val);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {bankHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Column */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    ستون تاریخ:
                  </label>
                  <select
                    value={bankDateCol}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBankDateCol(val);
                      reparseBankFile(val, bankTrackingCol, bankDescCol);
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium"
                  >
                    <option value={-1}>تشخیص خودکار</option>
                    {bankHeaders.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.label} (ستون {h.index + 1})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Bank Toman Checkbox */}
          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between bg-slate-50/80 px-3 py-2 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={bankIsToman}
                onChange={(e) => handleBankTomanToggle(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                id="checkbox-bank-toman"
              />
              <span className="flex items-center gap-1.5">
                <span>واحد مبالغ این فایل به <strong>تومان</strong> است</span>
                <span className="text-[11px] font-normal text-slate-500">(ضرب در ۱۰ جهت تبدیل به ریال)</span>
              </span>
            </label>
            {bankIsToman && (
              <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200 font-mono">
                ×۱۰ ریال فعال
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Settings & Execution Control */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs" id="panel-settings">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
          {/* Max Days Slider */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-500" />
                حداکثر اختلاف مجاز تاریخ شمسی:
              </span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-mono text-sm font-bold">
                {maxDays} روز
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={30}
              value={maxDays}
              onChange={(e) => setMaxDays(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>همان روز (۰ روز)</span>
              <span>۱۵ روز</span>
              <span>۳۰ روز</span>
            </div>
          </div>

          {/* AI Helper Toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              ارزیابی معنایی هوشمند با Gemini:
            </label>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useAi}
                  onChange={(e) => setUseAi(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                <span className="mr-3 text-xs font-semibold text-slate-600">
                  {useAi ? 'فعال (تطبیق شرح و نام با هوش مصنوعی)' : 'غیرفعال (الگوریتم سریع)'}
                </span>
              </label>
            </div>
          </div>

          {/* Run Reconciliation Button */}
          <div>
            <button
              onClick={onAutoReconcile}
              disabled={!canRun}
              className={`w-full py-3 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
                canRun
                  ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-[0.99]'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
              id="btn-run-reconciliation"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  در حال پردازش و تطبیق...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  شروع مقایسه هوشمند
                </>
              )}
            </button>
          </div>
        </div>

        {/* Direction Mode Comparison Checkbox & Banner */}
        <div className="mt-4 pt-4 border-t border-slate-200" id="panel-direction-mode">
          <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start md:items-center gap-3">
              <div className={`p-2 rounded-lg shrink-0 mt-0.5 md:mt-0 ${directionMode === 'INVERSE' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                <ArrowRightLeft className="w-4 h-4" />
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none font-bold text-xs md:text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={directionMode === 'INVERSE'}
                    onChange={(e) => setDirectionMode(e.target.checked ? 'INVERSE' : 'DIRECT')}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    id="checkbox-comparison-direction"
                  />
                  <span>مقایسه ستون‌ها به صورت معکوس (بستانکار ⟷ بدهکار)</span>
                </label>
                <p className="text-[11px] text-slate-500 mt-1">
                  {directionMode === 'INVERSE' ? (
                    <span className="text-indigo-700 font-medium">
                      ✓ حالت معکوس: ستون <strong>بستانکار سیستم</strong> با <strong>بدهکار بانک</strong> و ستون <strong>بدهکار سیستم</strong> با <strong>بستانکار بانک</strong> مقایسه می‌شود.
                    </span>
                  ) : (
                    <span className="text-blue-700 font-medium">
                      ✓ حالت مستقیم: ستون <strong>بدهکار سیستم</strong> با <strong>بدهکار بانک</strong> و ستون <strong>بستانکار سیستم</strong> با <strong>بستانکار بانک</strong> مقایسه می‌شود.
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Quick Mode Toggle Pills */}
            <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
              <button
                type="button"
                onClick={() => setDirectionMode('DIRECT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                  directionMode === 'DIRECT'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                id="btn-mode-direct"
              >
                مستقیم (بدهکار=بدهکار)
              </button>
              <button
                type="button"
                onClick={() => setDirectionMode('INVERSE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                  directionMode === 'INVERSE'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                id="btn-mode-inverse"
              >
                معکوس (بدهکار=بستانکار)
              </button>
            </div>
          </div>
        </div>

        {/* Progress & Status indicator */}
        {isProcessing && (
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
              <span>{statusMessage}</span>
              <span className="font-mono text-blue-600">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Metrics Cards (if processed) */}
      {summary && (
        <div className="space-y-4" id="section-summary-cards">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Green Matches */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800">تطبیق قطعی (سبز)</span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="mt-3">
                <span className="text-2xl font-extrabold text-emerald-700 font-mono">
                  {summary.green_count}
                </span>
                <span className="text-xs text-emerald-600 mr-1.5">فیش متصل</span>
              </div>
              <p className="text-[11px] text-emerald-700/80 mt-1">تطبیق کامل مبلغ، کد رهگیری و نام</p>
            </div>

            {/* Yellow Matches */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-800">نیازمند بازبینی (زرد)</span>
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="mt-3">
                <span className="text-2xl font-extrabold text-amber-700 font-mono">
                  {summary.yellow_count}
                </span>
                <span className="text-xs text-amber-600 mr-1.5">فیش محتمل</span>
              </div>
              <p className="text-[11px] text-amber-700/80 mt-1">مبالغ مشابه چندگانه یا ریال/تومان</p>
            </div>

            {/* Red Unmatched */}
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-800">اقلام باز سیستم (قرمز)</span>
                <XCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div className="mt-3">
                <span className="text-2xl font-extrabold text-rose-700 font-mono">
                  {summary.red_sys_count}
                </span>
                <span className="text-xs text-rose-600 mr-1.5">فیش بدون تطبیق</span>
              </div>
              <p className="text-[11px] text-rose-700/80 mt-1">فاقد رکورد متناظر در بانک</p>
            </div>

            {/* Success Rate */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-800">درصد موفقیت تطبیق</span>
                <FileCheck2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="mt-3">
                <span className="text-2xl font-extrabold text-blue-700 font-mono">
                  {summary.success_rate}%
                </span>
              </div>
              <p className="text-[11px] text-blue-700/80 mt-1">نسبت اسناد متصل به کل اسناد</p>
            </div>
          </div>

          {/* Export / Download Action Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-700">
              <Download className="w-5 h-5 text-blue-600" />
              <span className="font-bold text-sm">دانلود فایل‌های اکسل خروجی با رنگ‌بندی و تفکیک ستون‌ها:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={onDownloadSys}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                id="btn-download-sys-excel"
              >
                <Download className="w-4 h-4" />
                اکسل سیست تطبیق‌یافته
              </button>

              <button
                onClick={onDownloadBank}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                id="btn-download-bank-excel"
              >
                <Download className="w-4 h-4" />
                اکسل بانک تطبیق‌یافته
              </button>

              <button
                onClick={onDownloadReport}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                id="btn-download-report-excel"
              >
                <Download className="w-4 h-4" />
                گزارش جامع مغایرت‌گیری
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
