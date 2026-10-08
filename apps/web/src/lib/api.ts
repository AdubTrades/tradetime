import { accessToken, authEnabled, signOut } from './auth';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${url}`, init);
  // A session that's expired or been revoked: back to the sign-in screen.
  if (res.status === 401 && authEnabled) void signOut();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, detail } = data as { error?: string; detail?: unknown };
    throw new ApiError(error ?? res.statusText, res.status, detail);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

// Shapes returned by the server. Kept here until a shared types package is needed.
export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  rolloverTime: string;
  theme: Theme;
  backupFolder: string | null;
  backupIntervalHours: 0 | 6 | 12 | 24 | 168;
  backupRetention: number;
  longSessionHours: number;
  gstRegistered: boolean;
  checkInEnabled: boolean;
  checkInMinutes: number;
  checkInSecondMinutes: number | null;
  checkInSnoozeMinutes: number;
  /** Masked by the server, e.g. "••••ab12". */
  fredApiKey: string | null;
  includeMediumEvents: boolean;
  reportName: string | null;
  reportAbn: string | null;
  homeHidePnl: boolean;
}
export interface BackupStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastFile: string | null;
  lastBytes: number | null;
  folder: string;
}
export interface Attachment {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  originalName: string | null;
}
export interface AttachmentLink {
  id: string;
  attachmentId: string;
  ownerType: string;
  ownerId: string;
  role: string | null;
}
export interface SessionType {
  id: string;
  name: string;
  isTrading: boolean;
  color: string;
  sortOrder: number;
  archived: boolean;
}
export interface Session {
  id: string;
  typeId: string;
  start: string;
  end: string | null;
  tradingDay: string;
  source: 'timer' | 'manual';
  notes: string | null;
  editedAt: string | null;
  createdAt: string;
}
export interface AuditEntry {
  id: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  at: string;
}
export type ListKind = 'expense_category' | 'expense_type' | 'payment_method' | 'mood' | 'mistake';
export interface ListItem {
  id: string;
  kind: ListKind;
  name: string;
  color: string | null;
  sortOrder: number;
  archived: boolean;
}
export interface Firm {
  id: string;
  name: string;
  website: string | null;
  archived: boolean;
}
export type AccountType = 'evaluation' | 'funded' | 'live' | 'sim';
export type AccountStatus = 'active' | 'passed' | 'failed' | 'closed';
export interface Account {
  id: string;
  firmId: string | null;
  name: string;
  type: AccountType;
  status: AccountStatus;
  startDate: string | null;
  endDate: string | null;
  startingBalanceCents: number | null;
  currency: string;
  notes: string | null;
}
export interface Expense {
  id: string;
  name: string;
  vendor: string | null;
  date: string;
  description: string | null;
  categoryId: string | null;
  typeId: string | null;
  paymentMethodId: string | null;
  accountId: string | null;
  exGstCents: number;
  gstCents: number;
  incGstCents: number;
  businessUsePct: number;
  recurringId: string | null;
  importBatchId: string | null;
}
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export interface RecurringExpense extends Omit<Expense, 'date' | 'incGstCents' | 'recurringId' | 'importBatchId'> {
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  nextDate: string | null;
}
export interface Payout {
  id: string;
  accountId: string | null;
  requestedDate: string | null;
  receivedDate: string;
  grossUsdCents: number | null;
  audReceivedCents: number;
  notes: string | null;
}
export interface Totals {
  count: number;
  exGstCents: number;
  gstCents: number;
  incGstCents: number;
  deductibleCents: number;
  gstCreditCents: number;
}
export interface FySummary {
  fy: { startYear: number; label: string; start: string; end: string };
  gstRegistered: boolean;
  expenses: { total: Totals; byCategory: (Totals & { categoryId: string | null; name: string })[] };
  payouts: { count: number; audReceivedCents: number; grossUsdCents: number };
}
export interface Contract {
  id: string;
  symbol: string;
  name: string;
  tickSize: number;
  pointValueCents: number;
  feePerSideCents: number;
  archived: boolean;
}
export interface AccountGroup {
  id: string;
  name: string;
  members: { accountId: string; multiplier: number }[];
}
export interface GradeRule {
  grade: string;
  maxMissed: number;
  riskNote?: string | null;
}
export interface PlayCriterion {
  id: string;
  playId: string;
  label: string;
  mustHave: boolean;
  sortOrder: number;
  archived: boolean;
}
export interface Play {
  id: string;
  title: string;
  description: string | null;
  gradeRules: GradeRule[];
  sortOrder: number;
  archived: boolean;
  criteria: PlayCriterion[];
  exampleCount: number;
  /** Up to three example images for the card collage, best grade first. */
  coverAttachmentIds: string[];
}
export interface PlayExample {
  id: string;
  playId: string;
  grade: string;
  attachmentId: string;
  caption: string | null;
  date: string | null;
  resultLabel: string | null;
  sourceTradeId: string | null;
  mime: string;
}
export type PlayDetail = Play & { examples: PlayExample[] };
export interface FillRow {
  at: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
}
export interface TradeAccountRow {
  id: string;
  accountId: string;
  multiplier: number;
  maxQty: number;
  avgEntry: number;
  avgExit: number;
  grossCents: number;
  feesCents: number;
  netCents: number;
  plannedRiskCents: number | null;
}
export interface TradeBase {
  id: string;
  tradingDay: string;
  contractId: string;
  direction: 'long' | 'short';
  playId: string | null;
  grade: string | null;
  outsidePlan: boolean;
  stopPrice: number | null;
  targetPrice: number | null;
  plannedRiskPoints: number | null;
  followedPlan: 'yes' | 'partly' | 'no' | null;
  emotionId: string | null;
  confidence: number | null;
  notes: string | null;
  sessionId: string | null;
  openedAt: string;
  closedAt: string;
  netCents: number;
  grossCents: number;
  feesCents: number;
  r: number | null;
  mistakeIds: string[];
  stateReadingId: string | null;
  stateOverridden: boolean;
  source: 'manual' | 'import';
  needsReview: boolean;
  state: Pick<StateReading, 'id' | 'kind' | 'at' | 'answers'> & { decision?: StateReading['decision'] } | null;
}
export interface TradeRow extends TradeBase {
  accounts: TradeAccountRow[];
  sessionStart: string | null;
  plannedRR: number | null;
}
export interface TradeDetail extends TradeBase {
  accounts: (TradeAccountRow & { fills: (FillRow & { id: string })[] })[];
  checks: { criterionId: string; label: string; mustHave: boolean; checked: boolean }[];
}
export type QuestionKind = 'mood' | 'scale' | 'yesPartlyNo' | 'text';
export interface Question {
  id: string;
  prompt: string;
  kind: QuestionKind;
  appliesTo: 'both' | 'start' | 'checkin';
  sortOrder: number;
  archived: boolean;
}
export interface ReadingAnswer {
  questionId: string;
  prompt: string;
  kind: QuestionKind;
  value: string | number | null;
  label?: string | null;
}
export type Decision = 'keep_trading' | 'take_break' | 'stop';
export interface StateReading {
  id: string;
  sessionId: string;
  kind: 'start' | 'checkin';
  at: string;
  answers: ReadingAnswer[];
  decision: Decision | null;
}
export interface DueCheckIn {
  sessionId: string;
  elapsedMinutes: number;
  level: number;
  thresholdMinutes: number;
}
export interface MarketEvent {
  id: string;
  provider: string;
  title: string;
  at: string;
  impact: 'high' | 'medium' | 'low';
  country: string;
  currency: string;
  tradingDay: string;
}
export interface EventRecurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  byWeekday?: number[];
  until?: string | null;
}
export interface CalendarEventType {
  id: string;
  name: string;
  color: string;
  sessionTypeId: string | null;
  isNoTrade: boolean;
  sortOrder: number;
  archived: boolean;
}
export interface OccurrenceView {
  key: string;
  eventId: string;
  occurrenceDate: string;
  date: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  allDay: boolean;
  typeId: string;
  link: string | null;
  isTask: boolean;
  done: boolean;
  recurring: boolean;
  recurrence: EventRecurrence | null;
  reminderMinutes: number | null;
  startAt: string | null;
}
export interface DayFigures {
  netCents: number;
  trades: number;
  wins: number;
  tradingMinutes: number;
  otherMinutes: number;
  expensesCents: number;
  hasReview: boolean;
}
export interface CalendarRangeData {
  days: Record<string, DayFigures>;
  market: MarketEvent[];
  occurrences: OccurrenceView[];
}
export interface Renewal {
  id: string;
  name: string;
  vendor: string | null;
  nextDate: string;
  incGstCents: number;
  frequency: Frequency;
  interval: number;
}
export interface UpcomingData {
  today: string;
  market: MarketEvent[];
  occurrences: OccurrenceView[];
  renewals: Renewal[];
}
export interface MarketStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  count: number;
}
