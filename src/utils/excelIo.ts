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

export interface ParsedExcelFile<T> {
  records: T[];
  headers: { index: number; label: string }[];
  detectedMapping: Record<string, number>;
  rawRows: any[][];
  headerIdx: number;
}

export class ExcelProcessor {
  /**
   * Find the best header row based on keyword matches across all initial rows
   */
  static findHeaderRow(rows: any[][], keywords: string[]): { headerIdx: number; header: string[]; headersWithIndex: { index: number; label: string }[] } {
    let bestHeaderIdx = 0;
    let maxMatch = 0;
    let bestHeader: string[] = [];

    const searchLimit = Math.min(25, rows.length);
    for (let rIdx = 0; rIdx < searchLimit; rIdx++) {
      const row = rows[rIdx];
      if (!Array.isArray(row) || row.length === 0) continue;
      
      const rowCleaned = row.map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : ''));
      const rowStr = rowCleaned.join(' ');
      
      let matchCount = 0;
      for (const kw of keywords) {
        const nKw = normalizePersianText(kw);
        if (rowStr.includes(nKw)) {
          matchCount++;
        }
      }

      if (matchCount > maxMatch) {
        maxMatch = matchCount;
        bestHeaderIdx = rIdx;
        bestHeader = rowCleaned;
      }
    }

    let finalIdx = bestHeaderIdx;
    let finalHeader = bestHeader;

    if (maxMatch < 1) {
      // Fallback to first non-empty row
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        if (Array.isArray(row) && row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) {
          finalIdx = rIdx;
          finalHeader = row.map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : ''));
          break;
        }
      }
      if (finalHeader.length === 0 && rows[0]) {
        finalIdx = 0;
        finalHeader = rows[0].map((c) => (c !== null && c !== undefined ? normalizePersianText(c) : ''));
      }
    }

    const rawHeaderRow = rows[finalIdx] || [];
    const headersWithIndex: { index: number; label: string }[] = [];
    for (let c = 0; c < Math.max(rawHeaderRow.length, finalHeader.length); c++) {
      const label = String(rawHeaderRow[c] !== undefined && rawHeaderRow[c] !== null ? rawHeaderRow[c] : `ستون ${c + 1}`).trim();
      headersWithIndex.push({ index: c, label: label || `ستون ${c + 1}` });
    }

    return {
      headerIdx: finalIdx,
      header: finalHeader,
      headersWithIndex
    };
  }

  /**
   * Parse System Excel file with optional column mapping overrides
   */
  static readSystemFile(
    buffer: ArrayBuffer,
    customMapping?: { dateCol?: number; trackingCol?: number; descCol?: number }
  ): ParsedExcelFile<SystemRecord> {
    try {
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
      }
      
      // Find the sheet with the most rows
      let bestSheet = workbook.Sheets[workbook.SheetNames[0]];
      let maxRowCount = 0;
      for (const sheetName of workbook.SheetNames) {
        const s = workbook.Sheets[sheetName];
        if (s && s['!ref']) {
          const range = XLSX.utils.decode_range(s['!ref']);
          const count = range.e.r - range.s.r + 1;
          if (count > maxRowCount) {
            maxRowCount = count;
            bestSheet = s;
          }
        }
      }

      const rows = XLSX.utils.sheet_to_json(bestSheet, { header: 1, defval: null }) as any[][];
      if (!rows || rows.length === 0) {
        return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
      }

      const { headerIdx, header, headersWithIndex } = this.findHeaderRow(rows, [
        'بستانکار',
        'بدهکار',
        'نام حساب',
        'تاریخ',
        'کد رهگیری',
        'سند',
        'طرف حساب',
        'شرح',
        'مبلغ'
      ]);

      const colKeywords: Record<string, string[]> = {
        credit: ['بستانکار مالی', 'بستانکار', 'مبلغ بستانکار', 'گردش بستانکار', 'بستانكار', 'مبلغ واریز', 'واریز'],
        debit: ['بدهکار مالی', 'بدهکار', 'مبلغ بدهکار', 'گردش بدهکار', 'بدهكار', 'مبلغ برداشت', 'برداشت'],
        op_date: ['تاریخ عملیات', 'تاريخ عمليات', 'تاریخ ثبت', 'تاریخ اقدام', 'تاریخ فاکتور', 'تاریخ رسید'],
        doc_date: ['تاریخ سند', 'تاريخ سند', 'تاریخ صدور', 'تاریخ فاکتور', 'تاریخ موثر', 'تاریخ شمسی', 'تاریخ', 'تاريخ', 'زمان', 'date'],
        check_date: ['تاریخ چک', 'تاريخ چک', 'تاریخ سررسید', 'سررسید'],
        account_name: ['نام حساب', 'طرف حساب', 'حساب', 'نام شخص', 'طرف حساب تفصیلی', 'نام مشتری', 'تفصیلی'],
        doc_type: ['نوع سند', 'شرح سند', 'نوع عملیات', 'شرح', 'شرح آرتیکل', 'عنوان'],
        tracking: ['شماره چک / کد رهگیری', 'کد رهگیری', 'شماره چک', 'رهگیری', 'شماره سند', 'کد پیگیری', 'سند', 'شماره پیگیری', 'ارجاع']
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

      // Apply overrides if passed
      if (customMapping) {
        if (customMapping.dateCol !== undefined && customMapping.dateCol >= 0) {
          idxMap.op_date = customMapping.dateCol;
          delete idxMap.doc_date;
          delete idxMap.check_date;
        }
        if (customMapping.trackingCol !== undefined && customMapping.trackingCol >= 0) {
          idxMap.tracking = customMapping.trackingCol;
        }
        if (customMapping.descCol !== undefined && customMapping.descCol >= 0) {
          idxMap.doc_type = customMapping.descCol;
        }
      }

      const records: SystemRecord[] = [];
      const dataRows = rows.slice(headerIdx + 1);

      dataRows.forEach((row, rowRelIdx) => {
        if (!row || !Array.isArray(row) || !row.some((c) => c !== null && c !== '')) return;

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
          // Check if there is a single amount column with sign
          for (let c = 0; c < row.length; c++) {
            const parsed = parseAmount(row[c]);
            if (parsed && parsed > 0) {
              const headerTitle = header[c] || '';
              if (headerTitle.includes('بدهکار')) {
                amount = parsed;
                direction = 'DEBIT';
                break;
              } else if (headerTitle.includes('بستانکار') || headerTitle.includes('مبلغ')) {
                amount = parsed;
                direction = 'CREDIT';
                break;
              }
            }
          }
          if (amount === 0) return;
        }

        let rawDate: any = null;
        if (customMapping?.dateCol !== undefined && customMapping.dateCol >= 0) {
          rawDate = row[customMapping.dateCol];
        } else {
          for (const dCol of ['op_date', 'doc_date', 'check_date']) {
            if (idxMap[dCol] !== undefined && row[idxMap[dCol]]) {
              rawDate = row[idxMap[dCol]];
              break;
            }
          }
        }

        if (!rawDate) {
          // Look for any date-like string or date cell in the row
          for (const cell of row) {
            if (cell !== null && cell !== undefined && cell !== '') {
              const testJ = parseJalaliDate(cell);
              if (testJ) {
                rawDate = cell;
                break;
              }
            }
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

      return {
        records,
        headers: headersWithIndex,
        detectedMapping: idxMap,
        rawRows: rows,
        headerIdx
      };
    } catch (err) {
      console.error('Error parsing system Excel file:', err);
      return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
    }
  }

  /**
   * Parse Bank Excel file with optional column mapping overrides
   */
  static readBankFile(
    buffer: ArrayBuffer,
    customMapping?: { dateCol?: number; trackingCol?: number; descCol?: number }
  ): ParsedExcelFile<BankRecord> {
    try {
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
      }
      
      let bestSheet = workbook.Sheets[workbook.SheetNames[0]];
      let maxRowCount = 0;
      for (const sheetName of workbook.SheetNames) {
        const s = workbook.Sheets[sheetName];
        if (s && s['!ref']) {
          const range = XLSX.utils.decode_range(s['!ref']);
          const count = range.e.r - range.s.r + 1;
          if (count > maxRowCount) {
            maxRowCount = count;
            bestSheet = s;
          }
        }
      }

      const rows = XLSX.utils.sheet_to_json(bestSheet, { header: 1, defval: null }) as any[][];
      if (!rows || rows.length === 0) {
        return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
      }

      const { headerIdx, header, headersWithIndex } = this.findHeaderRow(rows, [
        'مبلغ گردش بستانکار',
        'مبلغ گردش بدهکار',
        'شرح',
        'واریز کننده',
        'سریال',
        'شناسه واریز',
        'بستانکار',
        'بدهکار',
        'واریز',
        'برداشت'
      ]);

      const colKeywords: Record<string, string[]> = {
        credit: ['مبلغ گردش بستانکار', 'گردش بستانکار', 'بستانکار', 'واریز', 'مبلغ واریز', 'بستانكار', 'واریزی', 'دریافت'],
        debit: ['مبلغ گردش بدهکار', 'گردش بدهکار', 'بدهکار', 'برداشت', 'مبلغ برداشت', 'بدهكار', 'برداشتی', 'پرداخت'],
        desc: ['شرح', 'شرح تراکنش', 'توضیحات', 'شرح سند', 'جزئیات'],
        party: ['واریز کننده/ ذیتفع', 'واریز کننده', 'ذینفع', 'طرف تراکنش', 'صاحب حساب', 'نام واریز کننده', 'طرف حساب', 'فرستنده', 'گیرنده'],
        serial: ['شماره سریال', 'سریال', 'شماره پیگیری', 'کد رهگیری', 'شماره سند', 'شماره ارجاع', 'کد پیگیری', 'پیگیری'],
        deposit_id: ['شناسه واریز', 'شناسه', 'کد شناسه', 'شناسه پرداخت'],
        date: ['تاریخ موثر', 'تاریخ عملیات', 'تاريخ تراکنش', 'تاریخ تراکنش', 'تاریخ سند', 'تاریخ ثبت', 'تاریخ اقدام', 'تاریخ شمسی', 'تاریخ', 'تاريخ', 'زمان', 'date']
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

      // Apply overrides if passed
      if (customMapping) {
        if (customMapping.dateCol !== undefined && customMapping.dateCol >= 0) {
          idxMap.date = customMapping.dateCol;
        }
        if (customMapping.trackingCol !== undefined && customMapping.trackingCol >= 0) {
          idxMap.serial = customMapping.trackingCol;
        }
        if (customMapping.descCol !== undefined && customMapping.descCol >= 0) {
          idxMap.desc = customMapping.descCol;
        }
      }

      const records: BankRecord[] = [];
      const dataRows = rows.slice(headerIdx + 1);

      dataRows.forEach((row, rowRelIdx) => {
        if (!row || !Array.isArray(row) || !row.some((c) => c !== null && c !== '')) return;

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
          // Check if there is a single amount column
          for (let c = 0; c < row.length; c++) {
            const parsed = parseAmount(row[c]);
            if (parsed && parsed > 0) {
              const headerTitle = header[c] || '';
              if (headerTitle.includes('بدهکار') || headerTitle.includes('برداشت')) {
                amount = parsed;
                direction = 'DEBIT';
                break;
              } else if (headerTitle.includes('بستانکار') || headerTitle.includes('واریز') || headerTitle.includes('مبلغ')) {
                amount = parsed;
                direction = 'CREDIT';
                break;
              }
            }
          }
          if (amount === 0) return;
        }

        let rawDate = (customMapping?.dateCol !== undefined && customMapping.dateCol >= 0)
          ? row[customMapping.dateCol]
          : (idxMap.date !== undefined ? row[idxMap.date] : null);

        if (!rawDate) {
          for (const cell of row) {
            if (cell !== null && cell !== undefined && cell !== '') {
              const testJ = parseJalaliDate(cell);
              if (testJ) {
                rawDate = cell;
                break;
              }
            }
          }
        }

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

      return {
        records,
        headers: headersWithIndex,
        detectedMapping: idxMap,
        rawRows: rows,
        headerIdx
      };
    } catch (err) {
      console.error('Error parsing bank Excel file:', err);
      return { records: [], headers: [], detectedMapping: {}, rawRows: [], headerIdx: 0 };
    }
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
