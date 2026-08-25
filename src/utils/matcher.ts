import {
  SystemRecord,
  BankRecord,
  ReconciliationResults,
  MatchInfo,
  ComparisonDirectionMode,
  TransactionDirection
} from '../types';
import {
  normalizeDigits,
  computeTextSimilarity,
  extractNumericTokens,
  jalaliDaysDifference
} from './normalization';

export function checkDirectionMatch(
  sysDir: TransactionDirection,
  bankDir: TransactionDirection,
  mode: ComparisonDirectionMode = 'DIRECT'
): boolean {
  if (mode === 'DIRECT') {
    // مستقیم: بدهکار با بدهکار، بستانکار با بستانکار
    return sysDir === bankDir;
  } else {
    // معکوس: بستانکار با بدهکار، بدهکار با بستانکار
    return (sysDir === 'CREDIT' && bankDir === 'DEBIT') || (sysDir === 'DEBIT' && bankDir === 'CREDIT');
  }
}

export interface ScoreMeta {
  score: number;
  reason: string;
  isYellow?: boolean;
}

export function computePairScore(
  sysRow: SystemRecord,
  bankRow: BankRecord,
  isUnique: boolean,
  isTomanMatch: boolean,
  maxDateDiff: number = 5
): ScoreMeta {
  const sysTrack = normalizeDigits(sysRow.tracking_code).trim();
  const bankSerial = normalizeDigits(bankRow.serial_no).trim();
  const bankDepId = normalizeDigits(bankRow.deposit_id).trim();
  const bankDesc = bankRow.description || '';
  const bankParty = bankRow.party_name || '';
  const sysAccName = sysRow.account_name || '';

  // Check date difference penalty if dates exist
  const dateDiff = jalaliDaysDifference(sysRow.date, bankRow.date);
  const datePenalty = (dateDiff !== null && dateDiff > maxDateDiff) ? 0.08 : 0.0;

  // 1. Exact match with tracking code or bank serial / deposit ID
  if (sysTrack && sysTrack.length >= 3) {
    if (sysTrack === bankSerial || sysTrack === bankDepId) {
      return {
        score: Math.max(0.7, 0.99 - datePenalty),
        reason: `تطبیق قطعی با شناسه/سریال بانک (${sysTrack})`
      };
    }

    if (normalizeDigits(bankDesc).includes(sysTrack)) {
      return {
        score: Math.max(0.7, 0.98 - datePenalty),
        reason: `کد رهگیری (${sysTrack}) در شرح بانک قرار دارد`
      };
    }

    const tokens = extractNumericTokens(bankDesc, sysTrack.length);
    for (const tok of tokens) {
      if (sysTrack === tok || sysTrack.includes(tok) || tok.includes(sysTrack)) {
        return {
          score: Math.max(0.7, 0.96 - datePenalty),
          reason: `تطبیق توکن رهگیری (${sysTrack}) با شرح بانک`
        };
      }
    }
  }

  // 2. Name & Description similarity
  const nameSim = computeTextSimilarity(sysAccName, bankParty);
  const descSim = computeTextSimilarity(sysAccName, bankDesc);
  const bestSim = Math.max(nameSim, descSim);

  if (bestSim >= 0.35) {
    return {
      score: Math.max(0.7, 0.94 - datePenalty),
      reason: `تشابه نام و شرح تراکنش (${sysAccName || bankParty || 'انطباق متن'})`
    };
  }

  // 3. Amount matching
  if (isTomanMatch) {
    return {
      score: Math.max(0.7, 0.88 - datePenalty),
      reason: 'تطبیق مبلغ با ضریب ریال/تومان (نیازمند بررسی)',
      isYellow: true
    };
  }

  if (isUnique) {
    return {
      score: Math.max(0.7, 0.92 - datePenalty),
      reason: 'مبلغ یکتا و منطبق در هر دو فایل'
    };
  }

  return {
    score: Math.max(0.7, 0.85 - datePenalty),
    reason: 'مبلغ یکسان (دارای چند تراکنش هم‌مبلغ)',
    isYellow: true
  };
}

/**
 * Solve Linear Sum Assignment Problem (Hungarian Algorithm / Jonker-Volgenant)
 * Solves rectangular/square cost matrices to find minimal total cost.
 */
export function linearSumAssignment(costMatrix: number[][]): [number[], number[]] {
  const n = costMatrix.length;
  if (n === 0) return [[], []];
  const m = costMatrix[0].length;
  if (m === 0) return [[], []];

  // Hungarian algorithm implementation for n x m
  const maxDim = Math.max(n, m);
  const cost: number[][] = Array.from({ length: maxDim }, (_, i) =>
    Array.from({ length: maxDim }, (_, j) => (i < n && j < m ? costMatrix[i][j] : 1000))
  );

  const u = new Array(maxDim + 1).fill(0);
  const v = new Array(maxDim + 1).fill(0);
  const p = new Array(maxDim + 1).fill(0);
  const way = new Array(maxDim + 1).fill(0);

  for (let i = 1; i <= maxDim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(maxDim + 1).fill(Infinity);
    const used = new Array(maxDim + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= maxDim; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= maxDim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowInd: number[] = [];
  const colInd: number[] = [];

  for (let j = 1; j <= maxDim; j++) {
    const r = p[j] - 1;
    const c = j - 1;
    if (r < n && c < m) {
      rowInd.push(r);
      colInd.push(c);
    }
  }

  return [rowInd, colInd];
}

export class ReconciliationEngine {
  maxDateDiff: number;

  constructor(maxDateDiff: number = 5) {
    this.maxDateDiff = maxDateDiff;
  }

  reconcile(
    sysRecords: SystemRecord[],
    bankRecords: BankRecord[],
    customMaxDays?: number,
    directionMode: ComparisonDirectionMode = 'DIRECT'
  ): ReconciliationResults {
    const maxDays = customMaxDays !== undefined ? customMaxDays : this.maxDateDiff;
    const matchesSysToBank: Record<number, MatchInfo> = {};
    const matchesBankToSys: Record<number, MatchInfo> = {};

    // Group bank records by amount
    const bankByAmt = new Map<number, number[]>();
    bankRecords.forEach((bRec, bIdx) => {
      const arr = bankByAmt.get(bRec.amount) || [];
      arr.push(bIdx);
      bankByAmt.set(bRec.amount, arr);
    });

    interface Candidate {
      sIdx: number;
      bIdx: number;
      isToman: boolean;
    }

    const candidates: Candidate[] = [];

    const addMatchingBankIndices = (sIdx: number, sRec: SystemRecord, bankIndices: number[], isToman: boolean) => {
      bankIndices.forEach((bIdx) => {
        const bRec = bankRecords[bIdx];
        if (checkDirectionMatch(sRec.direction, bRec.direction, directionMode)) {
          candidates.push({ sIdx, bIdx, isToman });
        }
      });
    };

    sysRecords.forEach((sRec, sIdx) => {
      const sAmt = sRec.amount;

      // Direct amount match
      if (bankByAmt.has(sAmt)) {
        addMatchingBankIndices(sIdx, sRec, bankByAmt.get(sAmt)!, false);
      }

      // 10x multiplier / Toman match (10x or 0.1x)
      if (sAmt % 10 === 0 && bankByAmt.has(Math.floor(sAmt / 10))) {
        addMatchingBankIndices(sIdx, sRec, bankByAmt.get(Math.floor(sAmt / 10))!, true);
      }
      if (bankByAmt.has(sAmt * 10)) {
        addMatchingBankIndices(sIdx, sRec, bankByAmt.get(sAmt * 10)!, true);
      }
    });

    if (candidates.length === 0) {
      return {
        sys_matches: {},
        bank_matches: {},
        detected_mode: 'DIRECT'
      };
    }

    const uniqueSys = Array.from(new Set(candidates.map((c) => c.sIdx)));
    const uniqueBank = Array.from(new Set(candidates.map((c) => c.bIdx)));

    const sysMap = new Map<number, number>();
    uniqueSys.forEach((sIdx, i) => sysMap.set(sIdx, i));

    const bankMap = new Map<number, number>();
    uniqueBank.forEach((bIdx, j) => bankMap.set(bIdx, j));

    const scoreMatrix: number[][] = Array.from({ length: uniqueSys.length }, () =>
      new Array(uniqueBank.length).fill(0)
    );

    const metaMatrix: (ScoreMeta | null)[][] = Array.from({ length: uniqueSys.length }, () =>
      new Array(uniqueBank.length).fill(null)
    );

    candidates.forEach(({ sIdx, bIdx, isToman }) => {
      const i = sysMap.get(sIdx)!;
      const j = bankMap.get(bIdx)!;
      const sRec = sysRecords[sIdx];
      const bRec = bankRecords[bIdx];

      const isUnique = (bankByAmt.get(sRec.amount)?.length || 0) === 1;
      const meta = computePairScore(sRec, bRec, isUnique, isToman, maxDays);

      scoreMatrix[i][j] = meta.score;
      metaMatrix[i][j] = meta;
    });

    // Cost matrix = 1.0 - score
    const costMatrix: number[][] = scoreMatrix.map((row) =>
      row.map((score) => (score > 0 ? 1.0 - score : 10.0))
    );

    const [rowInd, colInd] = linearSumAssignment(costMatrix);

    for (let k = 0; k < rowInd.length; k++) {
      const r = rowInd[k];
      const c = colInd[k];
      const assignedScore = scoreMatrix[r][c];

      if (assignedScore >= 0.70) {
        const sIdx = uniqueSys[r];
        const bIdx = uniqueBank[c];
        const meta = metaMatrix[r][c]!;

        const status = assignedScore >= 0.90 && !meta.isYellow ? 'GREEN' : 'YELLOW';
        const matchInfo: MatchInfo = {
          matched_index: bIdx,
          status,
          confidence: assignedScore,
          reason: meta.reason
        };

        const bankMatchInfo: MatchInfo = {
          matched_index: sIdx,
          status,
          confidence: assignedScore,
          reason: meta.reason
        };

        matchesSysToBank[sIdx] = matchInfo;
        matchesBankToSys[bIdx] = bankMatchInfo;
      }
    }

    return {
      sys_matches: matchesSysToBank,
      bank_matches: matchesBankToSys,
      detected_mode: 'SMART_MULTI_TIER'
    };
  }
}
