import type {
  ExpenseInvoice,
  FinancialAccount,
  FinancialMovement,
  FinancialSummary,
  Invoice,
  Product,
  PurchaseInvoice,
  Contact,
} from '@/data/mockData';
import type { CashSession, Layaway, SupplierInvoiceView } from '@/domain/models';
import { getProductAvailableGrams, getProductAveragePurchasePrice } from '@/data/mockData';
import { auditFinancialLedger, buildFinancialCompositions } from '@/lib/FinancialTraceabilityService';
import { calculateActiveLayawayBankFunds, isLayawayBankFlow } from '@/lib/LayawayBankAccountingService';
import { MAIN_CASH_ACCOUNT_ID } from '@/lib/FinancialPositionService';
import {
  calculateAccountIncomeForDate,
  calculateSaleAccountIncomeForDate,
  calculateLedgerAccountBalances,
  compensatedReversedFinancialMovementIds,
  getLedgerBalance,
  isActiveFinancialMovement,
  financialMovementDateKey,
  neutralizedDirectSaleMovementIds,
  participatesInNetFinancialFlow,
  resolveFinancialMovementCode,
} from '@/lib/FinancialLedgerService';

const INVENTORY_ORIGINS = new Set([
  'inventory_adjustment',
  'stock_adjustment',
  'inventory_gain',
  'inventory_loss',
  'inventory_recalculation',
  'inventory_regularization',
]);

const INTERNAL_MOVEMENT_TYPES = new Set([
  'transfer',
  'transfer_in',
  'transfer_out',
  'opening_balance',
  'adjustment',
]);

export interface DashboardMetricsInput {
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  payables: SupplierInvoiceView[];
  expenses: ExpenseInvoice[];
  invoices: Invoice[];
  products: Product[];
  today?: string;
}

export interface CashDayMetricsInput {
  date: string;
  invoices: Invoice[];
  expenses: ExpenseInvoice[];
  purchases: PurchaseInvoice[];
  layaways: Layaway[];
  movements: FinancialMovement[];
}

export interface CashDayMetrics {
  salesIncome: number;
  layawayIncome: number;
  operatingExpenses: number;
  purchaseOutflows: number;
  supplierPayments: number;
  totalIncome: number;
  totalOutflow: number;
}

export type SalesInvoiceValidityInput = Pick<Invoice, 'status' | 'tipoDocumento'>;

/**
 * Official JoyaControl definition of a completed commercial sale.
 *
 * Records created before tipoDocumento existed are treated as invoices for
 * backwards compatibility. Pending layaways, quotations and cancellations are
 * never commercial sales.
 */
export const isSalesInvoice = (invoice: SalesInvoiceValidityInput): boolean =>
  (!invoice.tipoDocumento || invoice.tipoDocumento === 'factura') && invoice.status === 'paid';

export const isValidExpense = (expense: ExpenseInvoice): boolean => expense.status === 'paid';

export const isValidPurchase = (purchase: PurchaseInvoice): boolean => purchase.status !== 'cancelled';

export const isInventoryOrigin = (movement: Pick<FinancialMovement, 'documentType'>): boolean =>
  INVENTORY_ORIGINS.has(movement.documentType);

export const isCompensatoryMovement = (movement: FinancialMovement): boolean =>
  movement.documentType === 'invoice_cancellation' ||
  movement.documentType.endsWith('_cancellation') ||
  movement.documentType.endsWith('_reversal') ||
  movement.observation.toLowerCase().includes('revers');

export const isInternalMovement = (movement: FinancialMovement): boolean =>
  INTERNAL_MOVEMENT_TYPES.has(movement.type) || movement.documentType === 'transfer';


export const isExceptionalCashMovement = (movement: FinancialMovement): boolean =>
  movement.documentType === 'exceptional_cash_adjustment' && movement.type === 'adjustment';

export const isExceptionalCashIncome = (movement: FinancialMovement): boolean =>
  isExceptionalCashMovement(movement) && Boolean(movement.destinationAccountId) && !movement.originAccountId;

export const isExceptionalCashOutflow = (movement: FinancialMovement): boolean =>
  isExceptionalCashMovement(movement) && Boolean(movement.originAccountId) && !movement.destinationAccountId;

export const isOperatingExpenseMovement = (movement: FinancialMovement): boolean =>
  movement.type === 'expense' &&
  movement.documentType === 'expense' &&
  !isInventoryOrigin(movement) &&
  !isCompensatoryMovement(movement) &&
  !isInternalMovement(movement);

export const isEffectiveIncomeMovement = (movement: FinancialMovement): boolean =>
  movement.type === 'sale_income' &&
  !isCompensatoryMovement(movement) &&
  !isInternalMovement(movement) &&
  !isInventoryOrigin(movement);

const localDateKeyFromTimestamp = (value: string | undefined): string | null => {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, '0');
  const day = String(instant.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Resolves the business-local day used only by the Dashboard's Banco Hoy KPI.
 *
 * Sales and manual movements may persist a date created with toISOString(),
 * while the Dashboard cuts the day in local time. When the persisted date is
 * merely the UTC day of createdAt, use createdAt's local day. Explicitly
 * backdated movements keep their persisted business date.
 */
const dashboardBankMovementDateKey = (movement: FinancialMovement): string => {
  const persistedDate = financialMovementDateKey(movement);
  const movementDateValue = String(movement.date || '');
  const timestampValue = movementDateValue.includes('T')
    ? movementDateValue
    : movement.createdAt;
  const localDate = localDateKeyFromTimestamp(timestampValue);
  if (!localDate) return persistedDate;

  const timestamp = new Date(timestampValue);
  const utcDate = Number.isNaN(timestamp.getTime())
    ? ''
    : timestamp.toISOString().slice(0, 10);

  if (!persistedDate || persistedDate === utcDate) return localDate;
  return persistedDate;
};

/**
 * Returns the net movement of active bank/wallet accounts on one local date.
 *
 * It uses the same participating Ledger rows and account direction as the
 * accumulated bank balance: inflows add, outflows subtract and bank-to-bank
 * transfers are neutral. Opening balances are excluded from the daily KPI. A
 * direct SALE_PAYMENT linked to SALE_CANCEL remains one neutral event.
 */
export function calculateBankDepositsForDate(
  accounts: FinancialAccount[],
  movements: FinancialMovement[],
  date: string,
): number {
  const bankAccountIds = new Set(
    accounts
      .filter(account => account.active && account.kind !== 'cash')
      .map(account => account.id),
  );

  if (bankAccountIds.size === 0) return 0;

  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(movements);
  const neutralizedSaleIds = neutralizedDirectSaleMovementIds(movements);
  return movements.reduce((total, movement) => {
    if (dashboardBankMovementDateKey(movement) !== date) return total;
    if (!participatesInNetFinancialFlow(movement, compensatedOriginalIds)) return total;
    if (neutralizedSaleIds.has(movement.id)) return total;

    const code = resolveFinancialMovementCode(movement);
    if (isLayawayBankFlow(movement)) return total;
    if (code === 'OPENING_BALANCE' || code === 'REVERSAL') return total;

    const originIsBank = Boolean(
      movement.originAccountId && bankAccountIds.has(movement.originAccountId),
    );
    const destinationIsBank = Boolean(
      movement.destinationAccountId && bankAccountIds.has(movement.destinationAccountId),
    );

    // Moving money between bank/wallet accounts does not change the combined
    // banking position shown by the Dashboard.
    if (originIsBank && destinationIsBank) return total;

    const amount = Number(movement.amount);
    if (!Number.isFinite(amount) || amount <= 0) return total;
    if (destinationIsBank) return total + amount;
    if (originIsBank) return total - amount;
    return total;
  }, 0);
}

export function calculateFinancialSummary(input: DashboardMetricsInput): FinancialSummary {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const productById = new Map(input.products.map(product => [product.id, product]));
  const validInvoices = input.invoices.filter(isSalesInvoice);
  const validExpenses = input.expenses.filter(isValidExpense);

  const sales = validInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const costOfSales = validInvoices.reduce((sum, invoice) => sum + invoice.items.reduce((itemSum, item) => {
    const product = productById.get(item.productId);
    const unitCost = item.costPrice ?? (product ? getProductAveragePurchasePrice(product) : 0);
    return itemSum + (unitCost * item.quantity);
  }, 0), 0);
  const expensesTotal = validExpenses.reduce((sum, expense) => sum + expense.total, 0);
  const accountsPayable = input.payables
    .filter(payable => payable.status !== 'cancelled')
    .reduce((sum, payable) => sum + Math.max(0, payable.pendingBalance), 0);
  const grossProfit = sales - costOfSales;
  const netProfit = grossProfit - expensesTotal;
  const ledgerBalances = calculateLedgerAccountBalances(input.accounts, input.movements);
  const accountBalance = (account: FinancialAccount): number => getLedgerBalance(ledgerBalances, account);

  return {
    cash: input.accounts.filter(account => account.kind === 'cash').reduce((sum, account) => sum + accountBalance(account), 0),
    banks: input.accounts.filter(account => account.kind !== 'cash').reduce((sum, account) => sum + accountBalance(account), 0),
    totalFunds: input.accounts.reduce((sum, account) => sum + accountBalance(account), 0),
    accountsPayable,
    sales,
    costOfSales,
    grossProfit,
    expenses: expensesTotal,
    netProfit,
    availableProfit: netProfit - accountsPayable,
    incomeToday: calculateAccountIncomeForDate(
      input.movements,
      MAIN_CASH_ACCOUNT_ID,
      today,
    ),
    expensesToday: input.movements
      .filter(movement => movement.date === today && isOperatingExpenseMovement(movement))
      .reduce((sum, movement) => sum + movement.amount, 0),
  };
}

export function calculateCashDayMetrics(input: CashDayMetricsInput): CashDayMetrics {
  const salesIncome = calculateSaleAccountIncomeForDate(
    input.movements,
    MAIN_CASH_ACCOUNT_ID,
    input.date,
  );
  const layawayIncome = input.layaways
    .filter(layaway => !layaway.completed && (!layaway.invoice || layaway.invoice.status !== 'cancelled'))
    .flatMap(layaway => layaway.payments)
    .filter(payment => (
      payment.date === input.date
      && (payment.accountId === MAIN_CASH_ACCOUNT_ID || (!payment.accountId && payment.method === 'Efectivo'))
    ))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const operatingExpenses = input.expenses
    .filter(expense => expense.date === input.date && isValidExpense(expense))
    .reduce((sum, expense) => sum + expense.total, 0);
  const purchaseOutflows = input.purchases
    .filter(purchase => purchase.date === input.date && isValidPurchase(purchase) && purchase.status === 'paid')
    .reduce((sum, purchase) => sum + purchase.total, 0);
  const supplierPayments = input.movements
    .filter(movement => movement.date === input.date && movement.type === 'supplier_payment' && !isCompensatoryMovement(movement))
    .reduce((sum, movement) => sum + movement.amount, 0);
  const exceptionalIncome = input.movements
    .filter(movement => movement.date === input.date && isExceptionalCashIncome(movement))
    .reduce((sum, movement) => sum + movement.amount, 0);
  const exceptionalOutflow = input.movements
    .filter(movement => movement.date === input.date && isExceptionalCashOutflow(movement))
    .reduce((sum, movement) => sum + movement.amount, 0);

  return {
    salesIncome,
    layawayIncome,
    operatingExpenses,
    purchaseOutflows,
    supplierPayments,
    totalIncome: salesIncome + layawayIncome + exceptionalIncome,
    totalOutflow: operatingExpenses + purchaseOutflows + supplierPayments + exceptionalOutflow,
  };
}


export type DashboardAlertTone = 'critical' | 'warning' | 'info';

export interface DashboardAlert {
  id: string;
  title: string;
  description: string;
  count?: number;
  href: string;
  tone: DashboardAlertTone;
}

export interface DashboardSalesMetric {
  count: number;
  value: number;
}

export interface DashboardInventoryMetric {
  products: number;
  activeProducts: number;
  saleValue: number;
  totalWeightGrams: number;
  totalCost: number;
}

export interface DashboardLayawayMetric {
  count: number;
  pendingValue: number;
  clients: number;
}

export interface DashboardCustomerMetric {
  registered: number;
  newThisMonth: number;
  active: number;
}

export interface DashboardChartPoint {
  date: string;
  label: string;
  value: number;
  count: number;
}

export interface DashboardTopProduct {
  productId: string;
  name: string;
  quantity: number;
  value: number;
}

export interface DashboardRecentSale {
  id: string;
  number: string;
  clientName: string;
  date: string;
  total: number;
}

export interface DashboardSnapshot {
  today: DashboardSalesMetric;
  month: DashboardSalesMetric;
  financialPosition: {
    mainCash: number;
    layawayReserve: number;
    banks: number;
    /** Deposits received by active bank/wallet accounts on the selected day. */
    banksToday?: number;
    /** Active layaway payments attributed to bank/wallet accounts. Informational only. */
    layawayBankFunds?: number;
    totalAvailable: number;
    mainCashUpdatedAt: string | null;
    mainCashStatus: 'RECONCILED' | 'NO_MOVEMENTS' | 'MISMATCH';
    banksUpdatedAt: string | null;
    totalAvailableUpdatedAt: string | null;
  };
  inventory: DashboardInventoryMetric;
  layaways: DashboardLayawayMetric;
  customers: DashboardCustomerMetric;
  purchasesMonth: number;
  salesLast30Days: DashboardChartPoint[];
  topProducts: DashboardTopProduct[];
  recentSales: DashboardRecentSale[];
  alerts: DashboardAlert[];
}

export interface DashboardSnapshotInput {
  products: Product[];
  contacts: Contact[];
  invoices: Invoice[];
  purchases: PurchaseInvoice[];
  expenses: ExpenseInvoice[];
  layaways: Layaway[];
  cashSessions: CashSession[];
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  financialSummary: FinancialSummary | null;
  lastSuccessfulBackupAt?: string | null;
  backupStatusAvailable?: boolean;
  now?: Date;
}

const isoDateLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
};

const successfulBackupIsRecent = (value: string | null | undefined, now: Date): boolean => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return now.getTime() - timestamp <= sevenDaysMs;
};

/**
 * Dashboard sales are commercial-document metrics, not cash-receipt metrics.
 *
 * A paid invoice is the single source of truth for a completed sale, including
 * layaways that became sales after their final payment and historical invoices
 * created before FinancialMovement was introduced. FinancialMovement remains
 * the source of truth for cash, banks and financial traceability.
 */
const buildInvoiceSalesMetric = (
  invoices: Invoice[],
  dateMatches: (date: string) => boolean,
): DashboardSalesMetric => {
  const matchingInvoices = invoices.filter(invoice => isSalesInvoice(invoice) && dateMatches(invoice.date));
  return {
    count: matchingInvoices.length,
    value: matchingInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
  };
};

const buildInvoiceSalesByDate = (invoices: Invoice[]): Map<string, { value: number; count: number }> => {
  const result = new Map<string, { value: number; count: number }>();
  invoices.filter(isSalesInvoice).forEach(invoice => {
    const current = result.get(invoice.date) ?? { value: 0, count: 0 };
    current.value += Number(invoice.total || 0);
    current.count += 1;
    result.set(invoice.date, current);
  });
  return result;
};

export function buildDashboardSnapshot(input: DashboardSnapshotInput): DashboardSnapshot {
  const now = input.now ? new Date(input.now) : new Date();
  const todayKey = isoDateLocal(now);
  const monthKey = todayKey.slice(0, 7);
  const today = buildInvoiceSalesMetric(input.invoices, date => date === todayKey);
  const month = buildInvoiceSalesMetric(input.invoices, date => date.startsWith(monthKey));
  const banksToday = calculateBankDepositsForDate(input.accounts, input.movements, todayKey);
  const layawayBankFunds = calculateActiveLayawayBankFunds(input.accounts, input.layaways).total;

  const financialCompositions = buildFinancialCompositions({
    accounts: input.accounts,
    movements: input.movements,
    contacts: input.contacts,
    invoices: input.invoices,
    purchases: input.purchases,
    expenses: input.expenses,
    layaways: input.layaways,
  });
  const financialAudit = auditFinancialLedger({
    accounts: input.accounts,
    movements: input.movements,
    contacts: input.contacts,
    invoices: input.invoices,
    purchases: input.purchases,
    expenses: input.expenses,
    layaways: input.layaways,
  });
  const mainCashHasMismatch = financialAudit.issues.some(issue => (
    issue.type === 'BALANCE_MISMATCH' && issue.accountId === MAIN_CASH_ACCOUNT_ID
  ));
  const inventory = input.products.reduce<DashboardInventoryMetric>((metric, product) => {
    const stock = Math.max(0, product.stock);
    metric.products += 1;
    if (stock > 0) metric.activeProducts += 1;
    metric.saleValue += stock * Math.max(0, product.salePrice);
    metric.totalCost += stock * getProductAveragePurchasePrice(product);
    metric.totalWeightGrams += getProductAvailableGrams(product);
    return metric;
  }, { products: 0, activeProducts: 0, saleValue: 0, totalWeightGrams: 0, totalCost: 0 });

  const activeLayaways = input.layaways.filter(layaway => !layaway.completed && layaway.invoice.status !== 'cancelled');
  const layaways = activeLayaways.reduce<DashboardLayawayMetric>((metric, layaway) => {
    const paid = layaway.payments.reduce((sum, payment) => sum + payment.amount, 0);
    metric.count += 1;
    metric.pendingValue += Math.max(0, layaway.invoice.total - paid);
    return metric;
  }, { count: 0, pendingValue: 0, clients: 0 });
  layaways.clients = new Set(activeLayaways.map(layaway => layaway.invoice.clientId).filter(Boolean)).size;

  const clients = input.contacts.filter(contact => contact.type === 'client');
  const firstSaleByClient = new Map<string, string>();
  input.invoices.filter(isSalesInvoice).forEach(invoice => {
    if (!invoice.clientId) return;
    const current = firstSaleByClient.get(invoice.clientId);
    if (!current || invoice.date < current) firstSaleByClient.set(invoice.clientId, invoice.date);
  });
  const customers: DashboardCustomerMetric = {
    registered: clients.length,
    newThisMonth: Array.from(firstSaleByClient.values()).filter(date => date.startsWith(monthKey)).length,
    active: firstSaleByClient.size,
  };

  const purchasesMonth = input.movements
    .filter(movement => {
      if (!isActiveFinancialMovement(movement) || !movement.date.startsWith(monthKey)) return false;
      const code = resolveFinancialMovementCode(movement);
      return code === 'PURCHASE_PAYMENT' || code === 'SUPPLIER_PAYMENT';
    })
    .reduce((sum, movement) => sum + movement.amount, 0);

  const totalsByDate = buildInvoiceSalesByDate(input.invoices);
  const salesLast30Days = Array.from({ length: 30 }, (_, index) => {
    const date = addDays(now, index - 29);
    const dateKey = isoDateLocal(date);
    const current = totalsByDate.get(dateKey) ?? { value: 0, count: 0 };
    return {
      date: dateKey,
      label: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(date),
      value: current.value,
      count: current.count,
    };
  });

  const productsSold = new Map<string, DashboardTopProduct>();
  input.invoices.filter(isSalesInvoice).forEach(invoice => {
    invoice.items.forEach(item => {
      const current = productsSold.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        quantity: 0,
        value: 0,
      };
      current.quantity += item.quantity;
      current.value += item.subtotal;
      productsSold.set(item.productId, current);
    });
  });
  const topProducts = Array.from(productsSold.values())
    .sort((left, right) => right.value - left.value || right.quantity - left.quantity)
    .slice(0, 10);

  const recentSales = input.invoices
    .filter(isSalesInvoice)
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date) || right.number.localeCompare(left.number))
    .slice(0, 10)
    .map(invoice => ({
      id: invoice.id,
      number: invoice.number,
      clientName: invoice.clientName || 'Consumidor final',
      date: invoice.date,
      total: Number(invoice.total || 0),
    }));

  const alerts: DashboardAlert[] = [];
  const outOfStock = input.products.filter(product => product.stock <= 0);
  const lowStock = input.products.filter(product => product.stock > 0 && product.stock <= product.minStock);
  if (outOfStock.length > 0) alerts.push({
    id: 'products-out-of-stock',
    title: 'Productos sin stock',
    description: `${outOfStock.length} producto${outOfStock.length === 1 ? '' : 's'} requiere${outOfStock.length === 1 ? '' : 'n'} reposición.`,
    count: outOfStock.length,
    href: '/inventario',
    tone: 'critical',
  });
  if (lowStock.length > 0) alerts.push({
    id: 'products-low-stock',
    title: 'Productos con stock bajo',
    description: `${lowStock.length} producto${lowStock.length === 1 ? '' : 's'} llegó${lowStock.length === 1 ? '' : 'aron'} al mínimo configurado.`,
    count: lowStock.length,
    href: '/inventario',
    tone: 'warning',
  });
  if (layaways.count > 0) alerts.push({
    id: 'layaways-pending',
    title: 'Separados pendientes',
    description: `${layaways.count} separado${layaways.count === 1 ? '' : 's'} con ${layaways.pendingValue.toLocaleString('es-CO')} pendientes.`,
    count: layaways.count,
    href: '/ventas',
    tone: 'info',
  });
  const openCashSession = input.cashSessions
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date) || right.openedAt.localeCompare(left.openedAt))
    .find(session => !session.closedAt);
  if (openCashSession) alerts.push({
    id: 'cash-open',
    title: 'Caja abierta',
    description: `Abierta por ${openCashSession.openedBy} desde ${openCashSession.openedAt}.`,
    href: '/caja',
    tone: 'info',
  });
  if (input.backupStatusAvailable !== false && !successfulBackupIsRecent(input.lastSuccessfulBackupAt, now)) alerts.push({
    id: 'backup-not-recent',
    title: 'Sin copia de seguridad reciente',
    description: input.lastSuccessfulBackupAt
      ? 'El último respaldo exitoso tiene más de siete días.'
      : 'No existe un respaldo exitoso registrado.',
    href: '/respaldos',
    tone: 'warning',
  });

  return {
    today,
    month,
    financialPosition: {
      mainCash: financialCompositions.mainCash.total,
      layawayReserve: financialCompositions.layawayReserve.total,
      banks: financialCompositions.banks.total,
      banksToday,
      layawayBankFunds,
      totalAvailable: financialCompositions.totalAvailable.total,
      mainCashUpdatedAt: financialCompositions.mainCash.lastUpdatedAt,
      mainCashStatus: mainCashHasMismatch ? 'MISMATCH' : financialCompositions.mainCash.status,
      banksUpdatedAt: financialCompositions.banks.lastUpdatedAt,
      totalAvailableUpdatedAt: financialCompositions.totalAvailable.lastUpdatedAt,
    },
    inventory,
    layaways,
    customers,
    purchasesMonth,
    salesLast30Days,
    topProducts,
    recentSales,
    alerts,
  };
}
