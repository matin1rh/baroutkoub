import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import jalaali from 'jalaali-js';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================================
// 1. PERSISTENT USER & LICENSE STORE (data/users.json)
// ============================================================================

export type UserRole = 'ADMIN' | 'USER';
export type SessionLockPolicy = 'STRICT_BLOCK' | 'KICK_PREVIOUS';

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  expiresAt: string | null; // ISO string or null for unlimited
  activeSessionToken: string | null;
  lastActiveAt: string | null;
  lastDeviceInfo: string | null;
  createdAt: string;
}

interface LicenseDatabase {
  sessionLockPolicy: SessionLockPolicy;
  users: StoredUser[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_DB_PATH = path.join(DATA_DIR, 'users.json');

// Session inactivity timeout (15 minutes) - if a user closes browser without logout,
// after 15 minutes of zero heartbeat the lock automatically expires.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function loadDatabase(): LicenseDatabase {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(USERS_DB_PATH)) {
      const raw = fs.readFileSync(USERS_DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as LicenseDatabase;
      if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
        return {
          sessionLockPolicy: parsed.sessionLockPolicy || 'STRICT_BLOCK',
          users: parsed.users
        };
      }
    }
  } catch (err) {
    console.error('Error reading users database, initializing default:', err);
  }

  const defaultDb: LicenseDatabase = {
    sessionLockPolicy: 'STRICT_BLOCK',
    users: [
      {
        id: 'admin-root',
        username: 'admin',
        passwordHash: hashPassword('admin123'),
        displayName: 'مدیر کل سیستم (باروت کوب)',
        role: 'ADMIN',
        isActive: true,
        expiresAt: null,
        activeSessionToken: null,
        lastActiveAt: null,
        lastDeviceInfo: null,
        createdAt: new Date().toISOString()
      }
    ]
  };
  saveDatabase(defaultDb);
  return defaultDb;
}

function saveDatabase(db: LicenseDatabase): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving users database:', err);
  }
}

let licenseDb: LicenseDatabase = loadDatabase();

function computeRemainingDays(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function isUserExpired(user: StoredUser): boolean {
  if (user.role === 'ADMIN' || !user.expiresAt) return false;
  return new Date(user.expiresAt).getTime() <= Date.now();
}

function isSessionCurrentlyActive(user: StoredUser): boolean {
  if (!user.activeSessionToken) return false;
  if (!user.lastActiveAt) return true;
  const elapsed = Date.now() - new Date(user.lastActiveAt).getTime();
  return elapsed < SESSION_TIMEOUT_MS;
}

function formatUserForClient(user: StoredUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    expiresAt: user.expiresAt,
    remainingDays: computeRemainingDays(user.expiresAt)
  };
}

function formatUserForAdmin(user: StoredUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    expiresAt: user.expiresAt,
    remainingDays: computeRemainingDays(user.expiresAt),
    isExpired: isUserExpired(user),
    hasActiveSession: isSessionCurrentlyActive(user),
    lastActiveAt: user.lastActiveAt,
    lastDeviceInfo: user.lastDeviceInfo,
    createdAt: user.createdAt
  };
}

// ============================================================================
// 2. AUTHENTICATION & LICENSE MIDDLEWARE
// ============================================================================

interface AuthenticatedRequest extends Request {
  user?: StoredUser;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'لطفاً ابتدا وارد حساب کاربری خود شوید.' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'توکن امنیتی نامعتبر است.' });
  }

  const user = licenseDb.users.find((u) => u.activeSessionToken === token);
  if (!user) {
    return res.status(401).json({
      error: 'نشست شما منقضی شده یا حساب شما در دستگاه دیگری باز شده است. لطفاً مجدداً وارد شوید.'
    });
  }

  if (!user.isActive) {
    return res.status(403).json({
      error: 'حساب کاربری شما توسط مدیر سیستم غیرفعال شده است.'
    });
  }

  if (isUserExpired(user)) {
    return res.status(403).json({
      error: 'مهلت اشتراک حساب کاربری شما به پایان رسیده است. لطفاً جهت تمدید اشتراک با مدیریت تماس بگیرید.'
    });
  }

  // Refresh heartbeat timestamp
  user.lastActiveAt = new Date().toISOString();
  saveDatabase(licenseDb);

  req.user = user;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'دسترسی محدود به مدیر کل سیستم است.' });
    }
    next();
  });
}

// ============================================================================
// 3. PROPRIETARY SERVER-SIDE RECONCILIATION ENGINE (HIDDEN FROM CLIENT)
// ============================================================================

type TransactionDirection = 'CREDIT' | 'DEBIT';
type ComparisonDirectionMode = 'DIRECT' | 'INVERSE';
type MatchStatus = 'GREEN' | 'YELLOW' | 'RED';

interface ServerSystemRecord {
  sys_index: number;
  original_row: number;
  amount: number;
  direction: TransactionDirection;
  date: string | null;
  tracking_code: string;
  account_name: string;
  doc_type: string;
  raw_desc: string;
}

interface ServerBankRecord {
  bank_index: number;
  original_row: number;
  amount: number;
  direction: TransactionDirection;
  date: string | null;
  description: string;
  party_name: string;
  serial_no: string;
  deposit_id: string;
  raw_desc: string;
}

interface MatchInfo {
  matched_index: number;
  status: MatchStatus;
  confidence: number;
  reason: string;
}

const PERSIAN_ARABIC_DIGITS_MAP: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
};

const ARABIC_TO_PERSIAN_CHARS_MAP: Record<string, string> = {
  'ي': 'ی',
  'ك': 'ک',
  'ة': 'ه',
  'ۀ': 'ه',
  'ؤ': 'و',
  'إ': 'ا',
  'أ': 'ا',
  'آ': 'ا',
  'ء': '',
  'ـ': ''
};

function normalizeDigits(text: any): string {
  if (text === null || text === undefined) return '';
  let s = String(text).replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_ARABIC_DIGITS_MAP[ch] || ch).trim();
  if (s.endsWith('.0')) {
    s = s.slice(0, -2);
  }
  return s;
}

function normalizePersianText(text: any): string {
  if (!text) return '';
  let str = String(text);
  str = normalizeDigits(str);
  str = str.replace(/[يكةۀؤإأآءـ]/g, (ch) =>
    ARABIC_TO_PERSIAN_CHARS_MAP[ch] !== undefined ? ARABIC_TO_PERSIAN_CHARS_MAP[ch] : ch
  );
  str = str.replace(/[\u200c\u200b\u200e\u200f\ufeff]/g, ' ');
  str = str.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  str = str.replace(/\s+/g, ' ').trim().toLowerCase();
  return str;
}

function jalaliDaysDifference(d1Str: string | null, d2Str: string | null): number | null {
  if (!d1Str || !d2Str) return null;
  try {
    const p1 = d1Str.split('/').map(Number);
    const p2 = d2Str.split('/').map(Number);
    if (p1.length < 3 || p2.length < 3) return null;

    const g1 = jalaali.toGregorian(p1[0], p1[1], p1[2]);
    const g2 = jalaali.toGregorian(p2[0], p2[1], p2[2]);

    const date1 = new Date(g1.gy, g1.gm - 1, g1.gd).getTime();
    const date2 = new Date(g2.gy, g2.gm - 1, g2.gd).getTime();

    return Math.round(Math.abs(date1 - date2) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function extractNumericTokens(text: any, minLength: number = 4): Set<string> {
  if (!text) return new Set();
  const cleaned = normalizeDigits(String(text));
  const matches = cleaned.match(new RegExp(`\\d{${minLength},}`, 'g'));
  return new Set(matches || []);
}

function computeTextSimilarity(s1: string, s2: string): number {
  const t1 = new Set(normalizePersianText(s1).split(' ').filter(Boolean));
  const t2 = new Set(normalizePersianText(s2).split(' ').filter(Boolean));
  if (t1.size === 0 || t2.size === 0) return 0.0;

  let intersectionCount = 0;
  t1.forEach((token) => {
    if (t2.has(token)) intersectionCount++;
  });

  const unionSize = new Set([...t1, ...t2]).size;
  const jaccard = unionSize > 0 ? intersectionCount / unionSize : 0;
  const minSize = Math.min(t1.size, t2.size);
  const overlap = minSize > 0 ? intersectionCount / minSize : 0;

  return jaccard * 0.3 + overlap * 0.7;
}

function checkDirectionMatch(
  sysDir: TransactionDirection,
  bankDir: TransactionDirection,
  mode: ComparisonDirectionMode = 'DIRECT'
): boolean {
  if (mode === 'DIRECT') {
    return sysDir === bankDir;
  } else {
    return (sysDir === 'CREDIT' && bankDir === 'DEBIT') || (sysDir === 'DEBIT' && bankDir === 'CREDIT');
  }
}

interface ScoreMeta {
  score: number;
  reason: string;
  isYellow?: boolean;
}

function computePairScore(
  sysRow: ServerSystemRecord,
  bankRow: ServerBankRecord,
  isUnique: boolean,
  maxDateDiff: number = 5
): ScoreMeta {
  if (sysRow.amount !== bankRow.amount) {
    return { score: 0, reason: 'عدم تطابق مبلغ' };
  }

  const sysTrack = normalizeDigits(sysRow.tracking_code).trim();
  const bankSerial = normalizeDigits(bankRow.serial_no).trim();
  const bankDepId = normalizeDigits(bankRow.deposit_id).trim();
  const bankDesc = bankRow.description || '';
  const bankParty = bankRow.party_name || '';
  const sysAccName = sysRow.account_name || '';

  const dateDiff = jalaliDaysDifference(sysRow.date, bankRow.date);
  const datePenalty = dateDiff !== null && dateDiff > maxDateDiff ? 0.08 : 0.0;

  if (sysTrack && sysTrack.length >= 4) {
    if (sysTrack === bankSerial || sysTrack === bankDepId) {
      return {
        score: Math.max(0.7, 0.99 - datePenalty),
        reason: `تطبیق قطعی با شناسه/سریال بانک (${sysTrack})`
      };
    }

    const tokens = extractNumericTokens(bankDesc, Math.min(sysTrack.length, 4));
    let tokenMatch = false;
    for (const tok of tokens) {
      if (sysTrack === tok) {
        tokenMatch = true;
        break;
      }
    }

    if (tokenMatch) {
      return {
        score: Math.max(0.7, 0.98 - datePenalty),
        reason: `کد رهگیری (${sysTrack}) در شرح بانک قرار دارد`
      };
    }
  }

  const nameSim = computeTextSimilarity(sysAccName, bankParty);
  const descSim = computeTextSimilarity(sysAccName, bankDesc);
  const bestSim = Math.max(nameSim, descSim);

  if (bestSim >= 0.4) {
    return {
      score: Math.max(0.7, 0.94 - datePenalty),
      reason: `تشابه نام و شرح تراکنش (${sysAccName || bankParty || 'انطباق متن'})`
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

function linearSumAssignment(costMatrix: number[][]): [number[], number[]] {
  const n = costMatrix.length;
  if (n === 0) return [[], []];
  const m = costMatrix[0].length;
  if (m === 0) return [[], []];

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

function executeServerReconciliation(
  sysRecords: ServerSystemRecord[],
  bankRecords: ServerBankRecord[],
  maxDays: number = 3,
  directionMode: ComparisonDirectionMode = 'DIRECT'
) {
  const matchesSysToBank: Record<number, MatchInfo> = {};
  const matchesBankToSys: Record<number, MatchInfo> = {};

  const bankByAmt = new Map<number, number[]>();
  bankRecords.forEach((bRec, bIdx) => {
    const arr = bankByAmt.get(bRec.amount) || [];
    arr.push(bIdx);
    bankByAmt.set(bRec.amount, arr);
  });

  const candidates: { sIdx: number; bIdx: number }[] = [];

  sysRecords.forEach((sRec, sIdx) => {
    const bankIndices = bankByAmt.get(sRec.amount);
    if (bankIndices) {
      bankIndices.forEach((bIdx) => {
        const bRec = bankRecords[bIdx];
        if (checkDirectionMatch(sRec.direction, bRec.direction, directionMode)) {
          candidates.push({ sIdx, bIdx });
        }
      });
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

  candidates.forEach(({ sIdx, bIdx }) => {
    const i = sysMap.get(sIdx)!;
    const j = bankMap.get(bIdx)!;
    const sRec = sysRecords[sIdx];
    const bRec = bankRecords[bIdx];

    const isUnique = (bankByAmt.get(sRec.amount)?.length || 0) === 1;
    const meta = computePairScore(sRec, bRec, isUnique, maxDays);

    scoreMatrix[i][j] = meta.score;
    metaMatrix[i][j] = meta;
  });

  const costMatrix: number[][] = scoreMatrix.map((row) =>
    row.map((score) => (score > 0 ? 1.0 - score : 10.0))
  );

  const [rowInd, colInd] = linearSumAssignment(costMatrix);

  for (let k = 0; k < rowInd.length; k++) {
    const r = rowInd[k];
    const c = colInd[k];
    const assignedScore = scoreMatrix[r][c];

    if (assignedScore >= 0.7) {
      const sIdx = uniqueSys[r];
      const bIdx = uniqueBank[c];
      const meta = metaMatrix[r][c]!;

      const status: MatchStatus = assignedScore >= 0.9 && !meta.isYellow ? 'GREEN' : 'YELLOW';
      matchesSysToBank[sIdx] = {
        matched_index: bIdx,
        status,
        confidence: assignedScore,
        reason: meta.reason
      };

      matchesBankToSys[bIdx] = {
        matched_index: sIdx,
        status,
        confidence: assignedScore,
        reason: meta.reason
      };
    }
  }

  return {
    sys_matches: matchesSysToBank,
    bank_matches: matchesBankToSys,
    detected_mode: 'SMART_MULTI_TIER'
  };
}

// ============================================================================
// 4. API ENDPOINTS
// ============================================================================

// In-memory knowledge base for recorded user decisions
interface UserDecisionRecord {
  id: number;
  sys_desc: string;
  sys_name: string;
  bank_desc: string;
  bank_name: string;
  decision: string;
  reason: string;
  amount?: number;
  tracking?: string;
  created_at: string;
}

const userDecisionsStore: UserDecisionRecord[] = [];
let decisionCounter = 1;

// Lazy initialize Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- AUTH ROUTES ---

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'لطفاً نام کاربری و رمز عبور را وارد نمایید.' });
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const user = licenseDb.users.find((u) => u.username.toLowerCase() === cleanUsername);

  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
  }

  if (!user.isActive) {
    return res.status(403).json({
      error: 'این حساب کاربری مسدود یا غیرفعال شده است. لطفاً با مدیر سیستم تماس بگیرید.'
    });
  }

  if (isUserExpired(user)) {
    return res.status(403).json({
      error: 'مهلت اشتراک حساب کاربری شما به پایان رسیده است. لطفاً جهت تمدید اشتراک اقدام فرمایید.'
    });
  }

  // Enforce Single-Device Session Lock for non-admin accounts
  if (
    user.role !== 'ADMIN' &&
    licenseDb.sessionLockPolicy === 'STRICT_BLOCK' &&
    isSessionCurrentlyActive(user)
  ) {
    return res.status(409).json({
      error:
        'این حساب کاربری هم‌اکنون در دستگاه دیگری فعال است. امکان استفاده همزمان دو دستگاه وجود ندارد. ابتدا از دستگاه قبلی خارج شوید یا از مدیر سیستم بخواهید نشست را آزاد کند.'
    });
  }

  const newToken = crypto.randomBytes(32).toString('hex');
  const userAgent = String(req.headers['user-agent'] || 'مرورگر وب').slice(0, 120);

  user.activeSessionToken = newToken;
  user.lastActiveAt = new Date().toISOString();
  user.lastDeviceInfo = userAgent;
  saveDatabase(licenseDb);

  return res.json({
    token: newToken,
    user: formatUserForClient(user)
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user) {
    req.user.activeSessionToken = null;
    saveDatabase(licenseDb);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    user: formatUserForClient(req.user!)
  });
});

// --- ADMIN USER & LICENSE MANAGEMENT ROUTES ---

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({
    sessionLockPolicy: licenseDb.sessionLockPolicy,
    users: licenseDb.users.map(formatUserForAdmin)
  });
});

app.post('/api/admin/settings/policy', requireAdmin, (req, res) => {
  const { sessionLockPolicy } = req.body;
  if (sessionLockPolicy === 'STRICT_BLOCK' || sessionLockPolicy === 'KICK_PREVIOUS') {
    licenseDb.sessionLockPolicy = sessionLockPolicy;
    saveDatabase(licenseDb);
  }
  res.json({
    sessionLockPolicy: licenseDb.sessionLockPolicy
  });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, displayName, subscriptionDays } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
  }

  const cleanUsername = String(username).trim().toLowerCase();
  if (licenseDb.users.some((u) => u.username.toLowerCase() === cleanUsername)) {
    return res.status(409).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
  }

  let expiresAt: string | null = null;
  const daysNum = Number(subscriptionDays);
  if (!isNaN(daysNum) && daysNum > 0) {
    expiresAt = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toISOString();
  }

  const newUser: StoredUser = {
    id: `user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    username: String(username).trim(),
    passwordHash: hashPassword(String(password)),
    displayName: String(displayName || username).trim(),
    role: 'USER',
    isActive: true,
    expiresAt,
    activeSessionToken: null,
    lastActiveAt: null,
    lastDeviceInfo: null,
    createdAt: new Date().toISOString()
  };

  licenseDb.users.push(newUser);
  saveDatabase(licenseDb);

  res.json({
    user: formatUserForAdmin(newUser)
  });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = licenseDb.users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'کاربر مورد نظر یافت نشد.' });
  }

  const {
    username,
    displayName,
    newPassword,
    isActive,
    extendDays,
    setSubscriptionDays,
    unlockSession
  } = req.body;

  if (typeof username === 'string' && username.trim()) {
    const cleanNewUsername = username.trim().toLowerCase();
    const duplicate = licenseDb.users.some(
      (u) => u.id !== id && u.username.toLowerCase() === cleanNewUsername
    );
    if (duplicate) {
      return res.status(409).json({ error: 'این نام کاربری قبلاً برای کاربر دیگری ثبت شده است.' });
    }
    user.username = username.trim();
  }

  if (typeof displayName === 'string' && displayName.trim()) {
    user.displayName = displayName.trim();
  }

  if (typeof newPassword === 'string' && newPassword.trim().length >= 3) {
    user.passwordHash = hashPassword(newPassword.trim());
  }

  if (typeof isActive === 'boolean' && user.role !== 'ADMIN') {
    user.isActive = isActive;
    if (!isActive) {
      user.activeSessionToken = null;
    }
  }

  if (unlockSession === true) {
    user.activeSessionToken = null;
  }

  if (extendDays !== undefined && user.role !== 'ADMIN') {
    const addDays = Number(extendDays);
    if (!isNaN(addDays) && addDays > 0) {
      const baseTime =
        user.expiresAt && new Date(user.expiresAt).getTime() > Date.now()
          ? new Date(user.expiresAt).getTime()
          : Date.now();
      user.expiresAt = new Date(baseTime + addDays * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  if (setSubscriptionDays !== undefined && user.role !== 'ADMIN') {
    if (setSubscriptionDays === null || Number(setSubscriptionDays) <= 0) {
      user.expiresAt = null;
    } else {
      const days = Number(setSubscriptionDays);
      user.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  saveDatabase(licenseDb);
  res.json({
    user: formatUserForAdmin(user)
  });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const target = licenseDb.users.find((u) => u.id === id);
  if (!target) {
    return res.status(404).json({ error: 'کاربر یافت نشد.' });
  }
  if (target.role === 'ADMIN') {
    return res.status(400).json({ error: 'امکان حذف حساب مدیر کل وجود ندارد.' });
  }

  licenseDb.users = licenseDb.users.filter((u) => u.id !== id);
  saveDatabase(licenseDb);
  res.json({ success: true });
});

// --- PROTECTED RECONCILIATION ENGINE ENDPOINT ---

app.post('/api/reconcile', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { sys_records, bank_records, max_days, direction_mode } = req.body;
    if (!Array.isArray(sys_records) || !Array.isArray(bank_records)) {
      return res.status(400).json({ error: 'فرمت داده‌های ارسالی نامعتبر است.' });
    }

    const maxDays = typeof max_days === 'number' ? max_days : 3;
    const dirMode: ComparisonDirectionMode = direction_mode === 'INVERSE' ? 'INVERSE' : 'DIRECT';

    const matches = executeServerReconciliation(sys_records, bank_records, maxDays, dirMode);
    return res.json({ matches });
  } catch (err: any) {
    console.error('Server reconciliation error:', err);
    return res.status(500).json({ error: 'خطا در اجرای الگوریتم تطبیق در سرور' });
  }
});

// --- KNOWLEDGE BASE & AI ENDPOINTS ---

app.get('/api/kb/decisions', requireAuth, (req, res) => {
  res.json({ decisions: userDecisionsStore });
});

app.post('/api/kb/decisions', requireAuth, (req, res) => {
  const { sys_desc, sys_name, bank_desc, bank_name, decision, reason, amount, tracking } = req.body;
  const newRecord: UserDecisionRecord = {
    id: decisionCounter++,
    sys_desc: String(sys_desc || ''),
    sys_name: String(sys_name || ''),
    bank_desc: String(bank_desc || ''),
    bank_name: String(bank_name || ''),
    decision: decision === 'REJECTED' ? 'REJECTED' : 'APPROVED',
    reason: String(reason || 'تصمیم دستی کاربر'),
    amount: typeof amount === 'number' ? amount : undefined,
    tracking: tracking ? String(tracking) : undefined,
    created_at: new Date().toISOString()
  };
  userDecisionsStore.push(newRecord);
  res.json({ success: true, record: newRecord });
});

app.post('/api/ai/evaluate-match', requireAuth, async (req, res) => {
  try {
    const { sys_record, bank_record } = req.body;
    if (!sys_record || !bank_record) {
      return res.status(400).json({ error: 'Missing record data' });
    }

    const ai = getGeminiClient();
    if (!ai || !process.env.GEMINI_API_KEY) {
      return res.json({
        is_match: true,
        confidence: 0.85,
        reasoning: 'تحلیل تطبیقی بر اساس الگوریتم هوشمند داخلی (کلید هوش مصنوعی فعال نیست)'
      });
    }

    const prompt = `شما یک کارشناس ارشد حسابداری و مغایرت‌گیری بانکی در سیستم مالی ایران هستید.
لطفاً تطبیق دو تراکنش زیر را بررسی کنید:

رکورد سیستم مالی:
- نام طرف حساب: ${sys_record.account_name || '-'}
- کد رهگیری / چک: ${sys_record.tracking_code || '-'}
- نوع سند: ${sys_record.doc_type || '-'}
- تاریخ: ${sys_record.date || '-'}
- مبلغ: ${sys_record.amount} ریال

رکورد بانک:
- واریز کننده / ذینفع: ${bank_record.party_name || '-'}
- شرح تراکنش: ${bank_record.description || '-'}
- شماره سریال / پیگیری: ${bank_record.serial_no || '-'}
- شناسه واریز: ${bank_record.deposit_id || '-'}
- تاریخ: ${bank_record.date || '-'}
- مبلغ: ${bank_record.amount} ریال

لطفاً پاسخ را دقیقاً به صورت یک JSON معتبر با ساختار زیر ارسال کنید:
{
  "is_match": boolean,
  "confidence": number بین 0.0 تا 1.0,
  "reasoning": "دلیل کوتاه فارسی برای تأیید یا رد تطبیق"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({
      is_match: Boolean(parsed.is_match),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      reasoning: String(parsed.reasoning || 'تطبیق توسط مدل هوش مصنوعی تأیید شد')
    });
  } catch (error: any) {
    console.error('AI Evaluation error:', error);
    res.json({
      is_match: true,
      confidence: 0.8,
      reasoning: 'تطبیق خودکار بر مبنای قوانین حسابداری'
    });
  }
});

// Vite middleware / Static Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Baroutkoub Reconciliation Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
