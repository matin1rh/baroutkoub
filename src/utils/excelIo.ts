import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  SystemRecord,
  BankRecord,
  ReconciliationResults,
  TransactionDirection
} from '../types';
import {
  parseAmount,
  parseJalaliDate,
  normalizeDigits,
  normalizePersianText
} from './normalization';

export class ExcelProcessor {
  /**
   * Find the best header row based on keyword matches
   */
  static findHeaderRow(rows: any[][], keywords: string[]): { headerIdx: number; header: string[] } {
    for (let rIdx = 0; rIdx < Math.min(10, rows.length); rIdx++) {
      const row = rows[rIdx];
      if (!Array.isArray(row)) continue;
      const rowStr = row.map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : '')).join(' ');
      const matchCount = keywords.filter((kw) => rowStr.includes(normalizePersianText(kw))).length;
      if (matchCount >= 2) {
        return {
          headerIdx: rIdx,
          header: row.map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : ''))
        };
      }
    }
    return {
      headerIdx: 0,
      header: (rows[0] || []).map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : ''))
    };
  }

  /**
   * Parse System Excel file from ArrayBuffer
   */
  static readSystemFile(buffer: ArrayBuffer): SystemRecord[] {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];

    if (!rows || rows.length === 0) return [];

    const { headerIdx, header } = this.findHeaderRow(rows, [
      'بستانکار',
      'بدهکار',
      'نام حساب',
      'تاریخ',
      'کد رهگیری',
      'سند'
    ]);

    const colKeywords: Record<string, string[]> = {
      credit: ['بستانکار مالی', 'بستانکار', 'مبلغ بستانکار', 'گردش بستانکار'],
      debit: ['بدهکار مالی', 'بدهکار', 'مبلغ بدهکار', 'گردش بدهکار'],
      op_date: ['تاریخ عملیات', 'تاريخ عمليات', 'تاریخ ثبت'],
      doc_date: ['تاریخ سند', 'تاريخ سند', 'تاریخ صدور'],
      check_date: ['تاریخ چک', 'تاريخ چک', 'تاریخ سررسید'],
      account_name: ['نام حساب', 'طرف حساب', 'حساب', 'نام شخص', 'طرف حساب تفصیلی'],
      doc_type: ['نوع سند', 'شرح سند', 'نوع عملیات', 'شرح'],
      tracking: ['شماره چک / کد رهگیری', 'کد رهگیری', 'شماره چک', 'رهگیری', 'شماره سند', 'کد پیگیری', 'سند']
    };

    const idxMap: Record<string, number> = {};
    for (const [key, kws] of Object.entries(colKeywords)) {
      for (const kw of kws) {
        const nKw = normalizePersianText(kw);
        const foundIndex = header.findIndex((h) => h.includes(nKw));
        if (foundIndex !== -1) {
          idxMap[key] = foundIndex;
          break;
        }
      }
    }

    const records: SystemRecord[] = [];
    const dataRows = rows.slice(headerIdx + 1);

    dataRows.forEach((row, rowRelIdx) => {
      if (!row || !row.some((c) => c !== null && c !== '')) return;

      const origRowNumber = headerIdx + 2 + rowRelIdx;
      const creditVal = idxMap.credit !== undefined ? row[idxMap.credit] : null;
      const debitVal = idxMap.debit !== undefined ? row[idxMap.debit] : null;

      const credit = parseAmount(creditVal) || 0;
      const debit = parseAmount(debitVal) || 0;

      let amount = 0;
      let direction: TransactionDirection = 'CREDIT';

      if (credit > 0) {
        amount = credit;
        direction = 'CREDIT';
      } else if (debit > 0) {
        amount = debit;
        direction = 'DEBIT';
      } else {
        return;
      }

      let rawDate: any = null;
      for (const dCol of ['op_date', 'doc_date', 'check_date']) {
        if (idxMap[dCol] !== undefined && row[idxMap[dCol]]) {
          rawDate = row[idxMap[dCol]];
          break;
        }
      }

      const jDate = parseJalaliDate(rawDate);
      const tracking = idxMap.tracking !== undefined ? normalizeDigits(row[idxMap.tracking] || '').trim() : '';
      const accName = idxMap.account_name !== undefined ? String(row[idxMap.account_name] || '').trim() : '';
      const docType = idxMap.doc_type !== undefined ? String(row[idxMap.doc_type] || '').trim() : '';

      records.push({
        sys_index: records.length,
        original_row: origRowNumber,
        amount,
        direction,
        date: jDate,
        tracking_code: tracking,
        account_name: accName,
        doc_type: docType,
        raw_desc: `${accName} ${docType} ${tracking}`.trim(),
        raw_data: row
      });
    });

    return records;
  }

  /**
   * Parse Bank Excel file from ArrayBuffer
   */
  static readBankFile(buffer: ArrayBuffer): BankRecord[] {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];

    if (!rows || rows.length === 0) return [];

    const { headerIdx, header } = this.findHeaderRow(rows, [
      'مبلغ گردش بستانکار',
      'مبلغ گردش بدهکار',
      'شرح',
      'واریز کننده',
      'سریال',
      'شناسه واریز'
    ]);

    const colKeywords: Record<string, string[]> = {
      credit: ['مبلغ گردش بستانکار', 'گردش بستانکار', 'بستانکار', 'واریز', 'مبلغ واریز'],
      debit: ['مبلغ گردش بدهکار', 'گردش بدهکار', 'بدهکار', 'برداشت', 'مبلغ برداشت'],
      desc: ['شرح', 'شرح تراکنش', 'توضیحات'],
      party: ['واریز کننده/ ذیتفع', 'واریز کننده', 'ذینفع', 'طرف تراکنش', 'صاحب حساب', 'نام واریز کننده'],
      serial: ['شماره سریال', 'سریال', 'شماره پیگیری', 'کد رهگیری', 'شماره سند'],
      deposit_id: ['شناسه واریز', 'شناسه', 'کد شناسه'],
      date: ['تاریخ', 'تاریخ تراکنش', 'تاریخ سند', 'زمان']
    };

    const idxMap: Record<string, number> = {};
    for (const [key, kws] of Object.entries(colKeywords)) {
      for (const kw of kws) {
        const nKw = normalizePersianText(kw);
        const foundIndex = header.findIndex((h) => h.includes(nKw));
        if (foundIndex !== -1) {
          idxMap[key] = foundIndex;
          break;
        }
      }
    }

    const records: BankRecord[] = [];
    const dataRows = rows.slice(headerIdx + 1);

    dataRows.forEach((row, rowRelIdx) => {
      if (!row || !row.some((c) => c !== null && c !== '')) return;

      const origRowNumber = headerIdx + 2 + rowRelIdx;
      const creditVal = idxMap.credit !== undefined ? row[idxMap.credit] : null;
      const debitVal = idxMap.debit !== undefined ? row[idxMap.debit] : null;

      const credit = parseAmount(creditVal) || 0;
      const debit = parseAmount(debitVal) || 0;

      let amount = 0;
      let direction: TransactionDirection = 'CREDIT';

      if (credit > 0) {
        amount = credit;
        direction = 'CREDIT';
      } else if (debit > 0) {
        amount = debit;
        direction = 'DEBIT';
      } else {
        return;
      }

      const rawDate = idxMap.date !== undefined ? row[idxMap.date] : null;
      const jDate = parseJalaliDate(rawDate);

      const desc = idxMap.desc !== undefined ? String(row[idxMap.desc] || '').trim() : '';
      const party = idxMap.party !== undefined ? String(row[idxMap.party] || '').trim() : '';
      const serial = idxMap.serial !== undefined ? normalizeDigits(row[idxMap.serial] || '').trim() : '';
      const depId = idxMap.deposit_id !== undefined ? normalizeDigits(row[idxMap.deposit_id] || '').trim() : '';

      records.push({
        bank_index: records.length,
        original_row: origRowNumber,
        amount,
        direction,
        date: jDate,
        description: desc,
        party_name: party,
        serial_no: serial,
        deposit_id: depId,
        raw_desc: `${party} ${desc}`.trim(),
        raw_data: row
      });
    });

    return records;
  }

  /**
   * Export Matched System Excel with styled colors and RTL sheet
   */
  static async generateMatchedSystemWorkbook(
    sysRecords: SystemRecord[],
    bankRecords: BankRecord[],
    matchResults: ReconciliationResults
  ): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('تطبیق سیستم', {
      views: [{ rightToLeft: true }]
    });

    const sysMatches = matchResults.sys_matches || {};

    const headers = [
      'ردیف اصلی',
      'مبلغ (ریال)',
      'ماهیت',
      'تاریخ',
      'کد رهگیری',
      'طرف حساب',
      'نوع سند',
      'وضعیت تطبیق',
      'دلیل تطبیق',
      'ردیف متناظر بانک'
    ];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD6D8DB' }
      };
      cell.font = { bold: true, name: 'Tahoma', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const sortedSys = [...sysRecords].sort((a, b) => b.amount - a.amount);

    sortedSys.forEach((sRec) => {
      const match = sysMatches[sRec.sys_index];
      let statusText = 'عدم تطبیق';
      let reasonText = 'فاقد رکورد متناظر در بانک';
      let matchedBankRow = '-';
      let fillArgb = 'FFF8D7DA'; // Red

      if (match) {
        if (match.status === 'GREEN') {
          statusText = 'تطبیق قطعی';
          fillArgb = 'FFD4EDDA'; // Green
        } else {
          statusText = 'تطبیق احتمالی (بازبینی)';
          fillArgb = 'FFFFF3CD'; // Yellow
        }
        reasonText = match.reason;
        const bRec = bankRecords[match.matched_index];
        matchedBankRow = bRec ? String(bRec.original_row) : '-';
      }

      const rowValues = [
        sRec.original_row,
        sRec.amount,
        sRec.direction === 'CREDIT' ? 'بستانکار' : 'بدهکار',
        sRec.date || '-',
        sRec.tracking_code || '-',
        sRec.account_name || '-',
        sRec.doc_type || '-',
        statusText,
        reasonText,
        matchedBankRow
      ];

      const row = ws.addRow(rowValues);
      row.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillArgb }
        };
        cell.font = { name: 'Tahoma', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          left: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          bottom: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          right: { style: 'thin', color: { argb: 'FFC0C0C0' } }
        };
        if (colNumber === 2) {
          cell.numFmt = '#,##0';
        }
      });
    });

    ws.columns.forEach((col) => {
      col.width = 18;
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Export Matched Bank Excel with styled colors and RTL sheet
   */
  static async generateMatchedBankWorkbook(
    sysRecords: SystemRecord[],
    bankRecords: BankRecord[],
    matchResults: ReconciliationResults
  ): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('تطبیق بانک', {
      views: [{ rightToLeft: true }]
    });

    const bankMatches = matchResults.bank_matches || {};

    const headers = [
      'ردیف اصلی',
      'مبلغ (ریال)',
      'ماهیت',
      'تاریخ',
      'شماره سریال / رهگیری',
      'شناسه واریز',
      'واریز کننده / ذینفع',
      'شرح تراکنش',
      'وضعیت تطبیق',
      'دلیل تطبیق',
      'ردیف متناظر سیستم'
    ];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD6D8DB' }
      };
      cell.font = { bold: true, name: 'Tahoma', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const sortedBank = [...bankRecords].sort((a, b) => b.amount - a.amount);

    sortedBank.forEach((bRec) => {
      const match = bankMatches[bRec.bank_index];
      let statusText = 'عدم تطبیق';
      let reasonText = 'فاقد رکورد متناظر در سیستم';
      let matchedSysRow = '-';
      let fillArgb = 'FFF8D7DA'; // Red

      if (match) {
        if (match.status === 'GREEN') {
          statusText = 'تطبیق قطعی';
          fillArgb = 'FFD4EDDA'; // Green
        } else {
          statusText = 'تطبیق احتمالی (بازبینی)';
          fillArgb = 'FFFFF3CD'; // Yellow
        }
        reasonText = match.reason;
        const sRec = sysRecords[match.matched_index];
        matchedSysRow = sRec ? String(sRec.original_row) : '-';
      }

      const rowValues = [
        bRec.original_row,
        bRec.amount,
        bRec.direction === 'CREDIT' ? 'بستانکار' : 'بدهکار',
        bRec.date || '-',
        bRec.serial_no || '-',
        bRec.deposit_id || '-',
        bRec.party_name || '-',
        bRec.description || '-',
        statusText,
        reasonText,
        matchedSysRow
      ];

      const row = ws.addRow(rowValues);
      row.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillArgb }
        };
        cell.font = { name: 'Tahoma', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          left: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          bottom: { style: 'thin', color: { argb: 'FFC0C0C0' } },
          right: { style: 'thin', color: { argb: 'FFC0C0C0' } }
        };
        if (colNumber === 2) {
          cell.numFmt = '#,##0';
        }
      });
    });

    ws.columns.forEach((col) => {
      col.width = 18;
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Export Comprehensive Reconciliation Discrepancy Report
   */
  static async generateComprehensiveReport(
    sysRecords: SystemRecord[],
    bankRecords: BankRecord[],
    matchResults: ReconciliationResults
  ): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();

    // 1. Summary Sheet
    const wsSum = wb.addWorksheet('خلاصه مغایرت‌گیری', {
      views: [{ rightToLeft: true }]
    });

    const sysMatches = matchResults.sys_matches || {};
    const greenCount = Object.values(sysMatches).filter((m) => m.status === 'GREEN').length;
    const yellowCount = Object.values(sysMatches).filter((m) => m.status === 'YELLOW').length;
    const redCount = Math.max(0, sysRecords.length - Object.keys(sysMatches).length);
    const successRate = sysRecords.length > 0 ? (((greenCount + yellowCount) / sysRecords.length) * 100).toFixed(2) : '0';

    wsSum.addRow(['شاخص آماری مغایرت‌گیری', 'مقدار']).eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Tahoma', size: 11 };
    });

    const summaryData = [
      ['کل تراکنش‌های فایل سیستم', sysRecords.length],
      ['کل تراکنش‌های فایل بانک', bankRecords.length],
      ['تطبیق‌های قطعی و معتبر (سبز)', greenCount],
      ['تطبیق‌های نیازمند بازبینی (زرد)', yellowCount],
      ['اقلام باز و بدون تطبیق سیستم (قرمز)', redCount],
      ['درصد موفقیت تطبیق', `${successRate}%`]
    ];

    summaryData.forEach(([label, val]) => {
      const r = wsSum.addRow([label, val]);
      r.font = { name: 'Tahoma', size: 10 };
      r.eachCell((c) => {
        c.border = {
          top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
        };
      });
    });

    wsSum.columns[0].width = 35;
    wsSum.columns[1].width = 20;

    // 2. Details Sheet
    const wsDet = wb.addWorksheet('جزئیات تمام تطبیق‌ها', {
      views: [{ rightToLeft: true }]
    });

    const detHeaders = [
      'ردیف سیستم',
      'ردیف بانک',
      'مبلغ (ریال)',
      'تاریخ سیستم',
      'تاریخ بانک',
      'درصد اطمینان',
      'وضعیت',
      'دلیل تطبیق'
    ];

    const detHeaderRow = wsDet.addRow(detHeaders);
    detHeaderRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6D8DB' } };
      c.font = { bold: true, name: 'Tahoma', size: 10 };
    });

    const matchedPairs: { sRec: SystemRecord; bRec: BankRecord; match: any }[] = [];
    Object.entries(sysMatches).forEach(([sIdxStr, match]) => {
      const sIdx = Number(sIdxStr);
      const sRec = sysRecords[sIdx];
      const bRec = bankRecords[match.matched_index];
      if (sRec && bRec) {
        matchedPairs.push({ sRec, bRec, match });
      }
    });

    matchedPairs.sort((a, b) => b.sRec.amount - a.sRec.amount);

    matchedPairs.forEach(({ sRec, bRec, match }) => {
      const row = wsDet.addRow([
        sRec.original_row,
        bRec.original_row,
        sRec.amount,
        sRec.date || '-',
        bRec.date || '-',
        `${Math.round(match.confidence * 100)}%`,
        match.status === 'GREEN' ? 'سبز' : 'زرد',
        match.reason
      ]);

      const fillArgb = match.status === 'GREEN' ? 'FFD4EDDA' : 'FFFFF3CD';
      row.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
        cell.font = { name: 'Tahoma', size: 9 };
        if (colNumber === 3) {
          cell.numFmt = '#,##0';
        }
      });
    });

    wsDet.columns.forEach((c) => {
      c.width = 18;
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }
}
