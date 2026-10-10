import {
  SystemRecord,
  BankRecord,
  ReconciliationResults,
  ComparisonDirectionMode
} from '../types';

const AUTH_TOKEN_KEY = 'baroutkoub_auth_token';

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {}
}

/**
 * Client-side proxy that invokes the protected server-side reconciliation engine.
 * The proprietary matching formula and Hungarian assignment algorithm reside strictly on the server.
 */
export class ReconciliationEngine {
  maxDateDiff: number;

  constructor(maxDateDiff: number = 5) {
    this.maxDateDiff = maxDateDiff;
  }

  async reconcile(
    sysRecords: SystemRecord[],
    bankRecords: BankRecord[],
    customMaxDays?: number,
    directionMode: ComparisonDirectionMode = 'DIRECT'
  ): Promise<ReconciliationResults> {
    const maxDays = customMaxDays !== undefined ? customMaxDays : this.maxDateDiff;
    const token = getStoredAuthToken();

    // Strip heavy raw_data array from network payload to keep request ultra-fast
    const lightSysRecords = sysRecords.map(({ raw_data, ...rest }) => rest);
    const lightBankRecords = bankRecords.map(({ raw_data, ...rest }) => rest);

    const response = await fetch('/api/reconcile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        sys_records: lightSysRecords,
        bank_records: lightBankRecords,
        max_days: maxDays,
        direction_mode: directionMode
      })
    });

    if (!response.ok) {
      let errMsg = 'خطا در ارتباط با سرور تطبیق';
      try {
        const errData = await response.json();
        if (errData && errData.error) {
          errMsg = errData.error;
        }
      } catch {}
      const error = new Error(errMsg) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    return data.matches as ReconciliationResults;
  }
}
