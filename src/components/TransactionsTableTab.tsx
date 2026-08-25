import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Filter,
  ArrowRightLeft,
  Building,
  CreditCard
} from 'lucide-react';
import { ReconciliationDataStore, MatchStatus } from '../types';
import { formatCurrency } from '../utils/normalization';

interface TransactionsTableTabProps {
  dataStore: ReconciliationDataStore | null;
}

export const TransactionsTableTab: React.FC<TransactionsTableTabProps> = ({ dataStore }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MatchStatus>('ALL');

  if (!dataStore || dataStore.sys_records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
        <p className="text-sm">هنوز تراکنشی برای نمایش وجود ندارد.</p>
      </div>
    );
  }

  const { sys_records, bank_records, matches, rejected_sys, rejected_bank } = dataStore;
  const sysMatches = matches.sys_matches || {};
  const rejectedSysSet = new Set(rejected_sys);

  const tableRows = useMemo(() => {
    return sys_records.map((sRec) => {
      const isRejected = rejectedSysSet.has(sRec.sys_index);
      const match = !isRejected ? sysMatches[sRec.sys_index] : undefined;
      const bRec = match ? bank_records[match.matched_index] : undefined;

      let status: MatchStatus = 'RED';
      if (match) {
        status = match.status;
      }

      return {
        sRec,
        bRec,
        match,
        status,
        isRejected
      };
    });
  }, [sys_records, bank_records, sysMatches, rejectedSysSet]);

  const filteredRows = useMemo(() => {
    return tableRows.filter(({ sRec, bRec, status, match }) => {
      if (statusFilter !== 'ALL' && status !== statusFilter) {
        return false;
      }
      if (!searchTerm) return true;

      const q = searchTerm.toLowerCase();
      const sMatch =
        String(sRec.amount).includes(q) ||
        String(sRec.tracking_code).toLowerCase().includes(q) ||
        String(sRec.account_name).toLowerCase().includes(q) ||
        String(sRec.date).includes(q);

      const bMatch = bRec
        ? String(bRec.amount).includes(q) ||
          String(bRec.serial_no).toLowerCase().includes(q) ||
          String(bRec.party_name).toLowerCase().includes(q) ||
          String(bRec.description).toLowerCase().includes(q)
        : false;

      const reasonMatch = match ? match.reason.toLowerCase().includes(q) : false;

      return sMatch || bMatch || reasonMatch;
    });
  }, [tableRows, statusFilter, searchTerm]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="transactions-table-container">
      {/* Filters Toolbar */}
      <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-50">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جستجو در مبلغ، کد رهگیری، نام، تاریخ..."
            className="w-full pl-3 pr-9 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Status Filter Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            همه ({tableRows.length})
          </button>
          <button
            onClick={() => setStatusFilter('GREEN')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 ${
              statusFilter === 'GREEN'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            سبز (قطعی) ({tableRows.filter((r) => r.status === 'GREEN').length})
          </button>
          <button
            onClick={() => setStatusFilter('YELLOW')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 ${
              statusFilter === 'YELLOW'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            زرد (بازبینی) ({tableRows.filter((r) => r.status === 'YELLOW').length})
          </button>
          <button
            onClick={() => setStatusFilter('RED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 ${
              statusFilter === 'RED'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
            }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            قرمز (عدم تطبیق) ({tableRows.filter((r) => r.status === 'RED').length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[600px]">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 shadow-xs">
            <tr>
              <th className="p-3 w-12 text-center">ردیف</th>
              <th className="p-3">اطلاعات فیش سیستم</th>
              <th className="p-3">مبلغ و ماهیت</th>
              <th className="p-3">اطلاعات متناظر بانک</th>
              <th className="p-3">وضعیت و اطمینان</th>
              <th className="p-3">دلیل تحلیل تطبیق</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  موردی مطابق با فیلترها یافت نشد.
                </td>
              </tr>
            ) : (
              filteredRows.map(({ sRec, bRec, match, status, isRejected }) => {
                let rowBg = 'bg-rose-50/40 hover:bg-rose-50/70';
                if (status === 'GREEN') rowBg = 'bg-emerald-50/40 hover:bg-emerald-50/70';
                if (status === 'YELLOW') rowBg = 'bg-amber-50/40 hover:bg-amber-50/70';

                return (
                  <tr key={sRec.sys_index} className={`transition-colors ${rowBg}`}>
                    {/* Row Num */}
                    <td className="p-3 text-center font-mono font-bold text-slate-500">
                      {sRec.original_row}
                    </td>

                    {/* Sys Info */}
                    <td className="p-3">
                      <div className="font-bold text-slate-800">{sRec.account_name || 'بدون نام'}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                        {sRec.date && <span>📅 {sRec.date}</span>}
                        {sRec.tracking_code && <span>🔢 کد: {sRec.tracking_code}</span>}
                        {sRec.doc_type && <span>📝 {sRec.doc_type}</span>}
                      </div>
                    </td>

                    {/* Amount & Direction */}
                    <td className="p-3 font-mono font-bold">
                      <div className="text-slate-900">{formatCurrency(sRec.amount)} ریال</div>
                      <span
                        className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                          sRec.direction === 'CREDIT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {sRec.direction === 'CREDIT' ? 'بستانکار' : 'بدهکار'}
                      </span>
                    </td>

                    {/* Bank Info */}
                    <td className="p-3">
                      {bRec ? (
                        <div>
                          <div className="font-bold text-slate-800">
                            {bRec.party_name || 'واریز بانکی'}
                            <span className="text-[11px] text-slate-500 font-normal mr-1">
                              (ردیف بانک: {bRec.original_row})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                            {bRec.date && <span>📅 {bRec.date}</span>}
                            {bRec.serial_no && <span>🔢 سریال: {bRec.serial_no}</span>}
                            {bRec.deposit_id && <span>🆔 شناسه: {bRec.deposit_id}</span>}
                          </div>
                          {bRec.description && (
                            <p className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                              {bRec.description}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">فاقد رکورد متناظر</span>
                      )}
                    </td>

                    {/* Status & Confidence */}
                    <td className="p-3">
                      {status === 'GREEN' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تطبیق قطعی ({Math.round((match?.confidence || 1) * 100)}%)
                        </span>
                      )}
                      {status === 'YELLOW' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          نیازمند بررسی ({Math.round((match?.confidence || 0.8) * 100)}%)
                        </span>
                      )}
                      {status === 'RED' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3.5 h-3.5" />
                          {isRejected ? 'رد شده توسط کاربر' : 'فاقد تطبیق'}
                        </span>
                      )}
                    </td>

                    {/* Reason */}
                    <td className="p-3 text-[11px] text-slate-600 max-w-xs">
                      {match ? match.reason : isRejected ? 'توسط کاربر رد شد' : 'موردی با این مبلغ در بانک یافت نشد'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
