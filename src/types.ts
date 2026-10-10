export type TransactionDirection = 'CREDIT' | 'DEBIT';
export type ComparisonDirectionMode = 'DIRECT' | 'INVERSE';

export interface SystemRecord {
  sys_index: number;
  original_row: number;
  amount: number;
  direction: TransactionDirection;
  date: string | null; // Jalali date string: YYYY/MM/DD
  tracking_code: string;
  account_name: string;
  doc_type: string;
  raw_desc: string;
  raw_data: (string | number | null | undefined)[];
}

export interface BankRecord {
  bank_index: number;
  original_row: number;
  amount: number;
  direction: TransactionDirection;
  date: string | null; // Jalali date string: YYYY/MM/DD
  description: string;
  party_name: string;
  serial_no: string;
  deposit_id: string;
  raw_desc: string;
  raw_data: (string | number | null | undefined)[];
}

export type MatchStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface MatchInfo {
  matched_index: number;
  status: MatchStatus;
  confidence: number;
  reason: string;
}

export interface ReconciliationResults {
  sys_matches: Record<number, MatchInfo>;
  bank_matches: Record<number, MatchInfo>;
  detected_mode: string;
}

export interface ReconciliationDataStore {
  sys_name?: string;
  bank_name?: string;
  sys_records: SystemRecord[];
  bank_records: BankRecord[];
  matches: ReconciliationResults;
  rejected_sys: number[];
  rejected_bank: number[];
}

export interface KnowledgeDecision {
  id?: number;
  sys_name: string;
  sys_desc: string;
  bank_name: string;
  bank_desc: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  amount?: number;
  tracking?: string;
  created_at?: string;
}

export interface ReconciliationSummary {
  total_sys: number;
  total_bank: number;
  green_count: number;
  yellow_count: number;
  red_sys_count: number;
  red_bank_count: number;
  success_rate: number;
  total_sys_amount: number;
  total_bank_amount: number;
  matched_amount: number;
}

export type UserRole = 'ADMIN' | 'USER';
export type SessionLockPolicy = 'STRICT_BLOCK' | 'KICK_PREVIOUS';

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  expiresAt: string | null;
  remainingDays: number | null;
}

export interface ManagedUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  expiresAt: string | null;
  remainingDays: number | null;
  isExpired: boolean;
  hasActiveSession: boolean;
  lastActiveAt: string | null;
  lastDeviceInfo: string | null;
  createdAt: string;
}

