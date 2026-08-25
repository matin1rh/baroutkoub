import React from 'react';
import { Database, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { KnowledgeDecision } from '../types';
import { formatCurrency } from '../utils/normalization';

interface KnowledgeBaseTabProps {
  decisions: KnowledgeDecision[];
}

export const KnowledgeBaseTab: React.FC<KnowledgeBaseTabProps> = ({ decisions }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4" id="kb-tab-container">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-purple-700" />
          <h3 className="font-bold text-slate-800 text-sm">پایگاه دانش تصمیمات کاربر (Knowledge Base)</h3>
        </div>
        <span className="text-xs font-semibold text-slate-500">
          تعداد تصمیمات ثبت‌شده: {decisions.length} مورد
        </span>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        سیستم از تأییدها و ردهای دستی شما برای یادگیری و بهبود دقت تطبیق‌های بعدی استفاده می‌کند.
      </p>

      {decisions.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          هنوز تصمیمی در پایگاه دانش ثبت نشده است. با تأیید یا رد موارد در تب «بازبینی تجمیعی»، تصمیمات شما در اینجا ذخیره خواهند شد.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
          {decisions.map((d, i) => {
            const isApproved = d.decision === 'APPROVED';
            return (
              <div key={d.id || i} className="py-3 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        isApproved
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {isApproved ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          تطبیق تأیید شد
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3 h-3" />
                          رد شد
                        </>
                      )}
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {d.sys_name || 'سیستم'} ↔ {d.bank_name || 'بانک'}
                    </span>
                    {d.amount && (
                      <span className="text-xs font-mono font-bold text-slate-600">
                        ({formatCurrency(d.amount)} ریال)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">{d.reason}</p>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{d.created_at || 'امروز'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
