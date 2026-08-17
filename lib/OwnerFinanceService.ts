import { isSalesInvoice } from '@/lib/DashboardMetricsService';

export type OwnerWithdrawalStatus = 'ACTIVE' | 'ANULADO';
export type OwnerFinancePeriod = 'MONTHLY' | 'FORTNIGHTLY';
export type OwnerFinancePeriodStatus = 'OPEN' | 'CLOSED';

export const DEFAULT_OWNER_WITHDRAWAL_PERCENTAGE = 30;
export const DEFAULT_OWNER_MONTHLY_PROFIT_GOAL = 0;
export const DEFAULT_OWNER_FINANCE_PERIOD: OwnerFinancePeriod = 'MONTHLY';
export const DEFAULT_OWNER_FINANCE_PERIOD_STATUS: OwnerFinancePeriodStatus = 'OPEN';

export const DEFAULT_OWNER_WITHDRAWAL_CONCEPTS = [
  { id: 'owner-concept-owner-withdrawal', name: 'Retiro del propietario' },
  { id: 'owner-concept-salaries', name: 'Pago de sueldos' },
  { id: 'owner-concept-commissions', name: 'Pago de comisiones' },
  { id: 'owner-concept-reinvestment', name: 'Reinversión' },
  { id: 'owner-concept-petty-cash', name: 'Caja menor' },
  { id: 'owner-concept-other', name: 'Otros' },
] as const;

export interface OwnerWithdrawalConcept {
  id: string;
  name: string;
  nameKey: string;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerFinancePeriodConfiguration {
  periodKey: string;
  projectedWithdrawalPercentage: number;
  monthlyProfitGoal: number;
  financialPeriod: OwnerFinancePeriod;
  status: OwnerFinancePeriodStatus;
  updatedAt: string;
  closedAt?: string | null;
  closedBy?: string | null;
  reopenedAt?: string | null;
  reopenedBy?: string | null;
}

export interface OwnerFinancePeriodOption {
  key: string;
  label: string;
  status: OwnerFinancePeriodStatus;
  hasFinancialData: boolean;
}

export interface OwnerFinanceSettings {
  projectedWithdrawalPercentage: number;
  monthlyProfitGoal: number;
  financialPeriod: OwnerFinancePeriod;
  /** Month being configured. Optional only for compatibility with V1 callers. */
  periodKey?: string;
  /** State of periodKey. Optional only for compatibility with V1 callers. */
  periodStatus?: OwnerFinancePeriodStatus;
  /** Latest close audit retained in the existing owner-finance settings row. */
  closedAt?: string | null;
  closedBy?: string | null;
  /** Latest reopen audit retained in the existing owner-finance settings row. */
  reopenedAt?: string | null;
  reopenedBy?: string | null;
}

export interface OwnerWithdrawal {
  id: string;
  withdrawalDate: string;
  periodKey?: string;
  userId: string;
  userName: string;
  conceptId: string;
  conceptName: string;
  amount: number;
  observations: string;
  accountId: string;
  accountName: string;
  paymentMethod: string;
  status: OwnerWithdrawalStatus;
  financialMovementId: string;
  createdAt: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  reversalMovementId?: string | null;
}

export interface OwnerFinanceInvoiceLike {
  id: string;
  date: string;
  status: string;
  tipoDocumento?: 'factura' | 'cotizacion';
  total: number;
  cost?: number;
  totalCost?: number;
  grossProfit?: number;
}

export interface OwnerFinanceExpenseLike {
  id: string;
  date: string;
  status?: string;
  total: number;
}

export interface OwnerFinanceFilters {
  periodKey?: string;
  from?: string;
  to?: string;
  userId?: string;
  conceptId?: string;
  accountId?: string;
  paymentMethod?: string;
}

export interface OwnerFinanceDashboard {
  monthlyProfitGoal: number;
  profitMonth: number;
  availableProfit: number;
  withdrawnProfit: number;
  availableBalance: number;
  projectedWithdrawalPercentage: number;
  suggestedWithdrawalValue: number;
  monthlyGoalProgressPercentage: number;
  monthlyGoalProgressBarPercentage: number;
  monthlyGoalReachedValue: number;
  monthlyGoalRemainingValue: number;
  monthlyGoalReached: boolean;
  exceedsAvailable: boolean;
}

export interface OwnerFinanceMonthlyPoint {
  month: string;
  sales: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  withdrawals: number;
  available: number;
  equity: number;
}

export interface OwnerFinanceWorkspace {
  selectedPeriod: string;
  periods: OwnerFinancePeriodOption[];
  dashboard: OwnerFinanceDashboard;
  withdrawals: OwnerWithdrawal[];
  concepts: OwnerWithdrawalConcept[];
  settings: OwnerFinanceSettings;
  accounts: Array<{ id: string; name: string; balance: number }>;
  users: Array<{ id: string; displayName: string }>;
  paymentMethods: string[];
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const day = (value: string): string => String(value || '').slice(0, 10);
export const ownerFinanceMonthKey = (value: string): string => String(value || '').slice(0, 7);
const pad = (value: number): string => String(value).padStart(2, '0');
const localDateKey = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

export function currentOwnerFinancePeriodKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function isFutureOwnerFinancePeriod(periodKey: string, now = new Date()): boolean {
  return normalizeOwnerFinancePeriodKey(periodKey) > currentOwnerFinancePeriodKey(now);
}

export function normalizeOwnerFinancePeriodKey(value: string): string {
  const key = String(value || '').trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) throw new Error('OWNER_FINANCE_PERIOD_KEY_INVALID');
  return key;
}

export function normalizeOwnerFinancePeriodStatus(value: string): OwnerFinancePeriodStatus {
  if (value === 'OPEN' || value === 'CLOSED') return value;
  throw new Error('OWNER_FINANCE_PERIOD_STATUS_INVALID');
}

export function ownerFinancePeriodDateRange(periodKey: string): { from: string; to: string } {
  const normalized = normalizeOwnerFinancePeriodKey(periodKey);
  const [year, month] = normalized.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${normalized}-01`,
    to: `${normalized}-${pad(lastDay)}`,
  };
}

export function formatOwnerFinancePeriodLabel(periodKey: string): string {
  const normalized = normalizeOwnerFinancePeriodKey(periodKey);
  const [year, month] = normalized.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
  return label.charAt(0).toLocaleUpperCase('es') + label.slice(1);
}

export function normalizeOwnerConceptName(value: string): { name: string; nameKey: string } {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('OWNER_CONCEPT_NAME_REQUIRED');
  return { name, nameKey: name.toLocaleLowerCase('es') };
}

export function normalizeProjectedWithdrawalPercentage(value: number): number {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('OWNER_WITHDRAWAL_PERCENTAGE_INVALID');
  }
  return Math.round(percentage * 100) / 100;
}

export function normalizeMonthlyProfitGoal(value: number): number {
  const goal = Number(value);
  if (!Number.isFinite(goal) || goal < 0) {
    throw new Error('OWNER_MONTHLY_PROFIT_GOAL_INVALID');
  }
  return Math.round(goal * 100) / 100;
}

export function normalizeOwnerFinancePeriod(value: string): OwnerFinancePeriod {
  if (value === 'MONTHLY' || value === 'FORTNIGHTLY') return value;
  throw new Error('OWNER_FINANCE_PERIOD_INVALID');
}

export function createDefaultOwnerWithdrawalConcepts(now = new Date().toISOString()): OwnerWithdrawalConcept[] {
  return DEFAULT_OWNER_WITHDRAWAL_CONCEPTS.map(item => ({
    id: item.id,
    name: item.name,
    nameKey: item.name.toLocaleLowerCase('es'),
    active: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }));
}

export function isActiveWithdrawal(withdrawal: OwnerWithdrawal): boolean {
  return withdrawal.status === 'ACTIVE';
}

export function filterOwnerWithdrawals(
  withdrawals: OwnerWithdrawal[],
  filters: OwnerFinanceFilters = {},
): OwnerWithdrawal[] {
  const selectedPeriod = filters.periodKey
    ? normalizeOwnerFinancePeriodKey(filters.periodKey)
    : undefined;

  return withdrawals.filter(item => {
    const itemDate = item.withdrawalDate || item.createdAt;
    const itemDay = day(itemDate);
    if (selectedPeriod && ownerFinanceMonthKey(itemDate) !== selectedPeriod) return false;
    if (filters.from && itemDay < filters.from) return false;
    if (filters.to && itemDay > filters.to) return false;
    if (filters.userId && item.userId !== filters.userId) return false;
    if (filters.conceptId && item.conceptId !== filters.conceptId) return false;
    if (filters.accountId && item.accountId !== filters.accountId) return false;
    if (filters.paymentMethod && item.paymentMethod !== filters.paymentMethod) return false;
    return true;
  });
}

function validExpense(expense: OwnerFinanceExpenseLike): boolean {
  const status = String(expense.status || '').toUpperCase();
  return !['CANCELLED', 'CANCELED', 'ANULADA', 'ANULADO', 'VOID'].includes(status);
}

export function invoiceGrossProfit(invoice: OwnerFinanceInvoiceLike): number {
  if (typeof invoice.grossProfit === 'number') return n(invoice.grossProfit);
  const cost = typeof invoice.totalCost === 'number' ? invoice.totalCost : invoice.cost;
  return n(invoice.total) - n(cost);
}

function netProfitBetween(
  invoices: OwnerFinanceInvoiceLike[],
  expenses: OwnerFinanceExpenseLike[],
  from: string,
  to: string,
): number {
  const grossProfit = invoices
    .filter(isSalesInvoice)
    .filter(invoice => day(invoice.date) >= from && day(invoice.date) <= to)
    .reduce((sum, invoice) => sum + invoiceGrossProfit(invoice), 0);
  const expenseTotal = expenses
    .filter(validExpense)
    .filter(expense => day(expense.date) >= from && day(expense.date) <= to)
    .reduce((sum, expense) => sum + n(expense.total), 0);
  return grossProfit - expenseTotal;
}

export function calculateMonthlyGoalProgress(monthlyProfitGoal: number, profitMonth: number) {
  const goal = normalizeMonthlyProfitGoal(monthlyProfitGoal);
  const reachedValue = Math.max(0, n(profitMonth));
  const progressPercentage = goal > 0
    ? Math.max(0, Math.round((reachedValue / goal) * 10_000) / 100)
    : 0;

  return {
    monthlyGoalProgressPercentage: progressPercentage,
    monthlyGoalProgressBarPercentage: Math.min(100, progressPercentage),
    monthlyGoalReachedValue: reachedValue,
    monthlyGoalRemainingValue: Math.max(0, goal - reachedValue),
    monthlyGoalReached: goal > 0 && progressPercentage >= 100,
  };
}

export function calculateOwnerFinanceDashboard(input: {
  invoices: OwnerFinanceInvoiceLike[];
  expenses: OwnerFinanceExpenseLike[];
  withdrawals: OwnerWithdrawal[];
  projectedWithdrawalPercentage: number;
  monthlyProfitGoal?: number;
  periodKey?: string;
  now?: Date;
}): OwnerFinanceDashboard {
  const now = input.now ? new Date(input.now) : new Date();
  const periodKey = normalizeOwnerFinancePeriodKey(
    input.periodKey || currentOwnerFinancePeriodKey(now),
  );
  const range = ownerFinancePeriodDateRange(periodKey);
  const validInvoices = input.invoices
    .filter(isSalesInvoice)
    .filter(invoice => ownerFinanceMonthKey(invoice.date) === periodKey);
  const validExpenses = input.expenses
    .filter(validExpense)
    .filter(expense => ownerFinanceMonthKey(expense.date) === periodKey);
  const activeWithdrawals = input.withdrawals
    .filter(isActiveWithdrawal)
    .filter(withdrawal => ownerFinanceMonthKey(withdrawal.withdrawalDate || withdrawal.createdAt) === periodKey);
  const generatedProfitMonth = netProfitBetween(validInvoices, validExpenses, range.from, range.to);
  const withdrawnProfit = activeWithdrawals.reduce((sum, item) => sum + n(item.amount), 0);

  // Owner withdrawals reduce distributable monthly profit, but never alter the
  // commercial sales ledger. The withdrawal is subtracted exactly once here.
  const profitMonth = generatedProfitMonth - withdrawnProfit;
  const availableProfit = profitMonth;
  const availableBalance = profitMonth;
  const projectedWithdrawalPercentage = normalizeProjectedWithdrawalPercentage(input.projectedWithdrawalPercentage);
  const monthlyProfitGoal = normalizeMonthlyProfitGoal(input.monthlyProfitGoal ?? DEFAULT_OWNER_MONTHLY_PROFIT_GOAL);
  const suggestedWithdrawalValue = Math.max(0, availableBalance) * projectedWithdrawalPercentage / 100;

  return {
    monthlyProfitGoal,
    profitMonth,
    availableProfit,
    withdrawnProfit,
    availableBalance,
    projectedWithdrawalPercentage,
    suggestedWithdrawalValue,
    ...calculateMonthlyGoalProgress(monthlyProfitGoal, profitMonth),
    exceedsAvailable: withdrawnProfit > generatedProfitMonth,
  };
}

export function buildOwnerFinanceMonthlySeries(input: {
  invoices: OwnerFinanceInvoiceLike[];
  expenses: OwnerFinanceExpenseLike[];
  withdrawals: OwnerWithdrawal[];
}): OwnerFinanceMonthlyPoint[] {
  const buckets = new Map<string, OwnerFinanceMonthlyPoint>();
  const ensure = (month: string): OwnerFinanceMonthlyPoint => {
    const existing = buckets.get(month);
    if (existing) return existing;
    const created: OwnerFinanceMonthlyPoint = {
      month,
      sales: 0,
      grossProfit: 0,
      expenses: 0,
      netProfit: 0,
      withdrawals: 0,
      available: 0,
      equity: 0,
    };
    buckets.set(month, created);
    return created;
  };

  input.invoices.filter(isSalesInvoice).forEach(item => {
    const bucket = ensure(ownerFinanceMonthKey(item.date));
    bucket.sales += n(item.total);
    bucket.grossProfit += invoiceGrossProfit(item);
  });
  input.expenses.filter(validExpense).forEach(item => {
    ensure(ownerFinanceMonthKey(item.date)).expenses += n(item.total);
  });
  input.withdrawals.filter(isActiveWithdrawal).forEach(item => {
    ensure(ownerFinanceMonthKey(item.withdrawalDate || item.createdAt)).withdrawals += n(item.amount);
  });

  let accumulatedEquity = 0;
  return [...buckets.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map(point => {
      point.netProfit = point.grossProfit - point.expenses;
      point.available = point.netProfit - point.withdrawals;
      accumulatedEquity += point.available;
      point.equity = accumulatedEquity;
      return point;
    });
}

export function validateOwnerWithdrawalAmount(amount: number, accountBalance: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('OWNER_WITHDRAWAL_AMOUNT_INVALID');
  if (amount > accountBalance) throw new Error('OWNER_WITHDRAWAL_INSUFFICIENT_ACCOUNT_BALANCE');
}
