import type {
  ExpenseInvoice,
  FinancialAccount,
  FinancialMovement,
  Invoice,
  PurchaseInvoice,
} from '@/data/mockData';
import type { Layaway, SupplierInvoiceView } from '@/domain/models';
import { isSalesInvoice } from '@/lib/DashboardMetricsService';
import {
  buildFinancialCompositions,
  type FinancialCompositionRow,
  type FinancialTraceabilityInput,
} from '@/lib/FinancialTraceabilityService';
import { buildBankMovementComposition, calculateActiveLayawayBankFunds } from '@/lib/LayawayBankAccountingService';
import { dateMatchesReportRange, type ReportDateRange } from '@/lib/reportDateRange';

const EPSILON = 0.01;

export interface ExpressReportDetailRow {
  id: string;
  date: string;
  document: string;
  description: string;
  account: string;
  value: number;
  signedValue: number;
}

export interface ExpressExpenseGroup {
  label: string;
  total: number;
  rows: ExpressReportDetailRow[];
}

export interface ExpressFinancialReport {
  range: ReportDateRange;
  current: {
    mainCash: number;
    banks: number;
    totalAvailable: number;
    layawayReserve: number;
    layawayBankFunds: number;
  };
  period: {
    validSales: number;
    validSalesCount: number;
    saleCollections: number;
    otherIncome: number;
    layawayReleased: number;
    entriesConsidered: number;
    supplierPayments: number;
    expenses: number;
    ownerWithdrawals: number;
    otherOutflows: number;
    totalOutflows: number;
    netCashFlow: number;
    purchasesRegistered: number;
    accountsPayablePending: number;
  };
  layaways: {
    cashReserved: number;
    bankReserved: number;
    totalReserved: number;
  };
  bankPeriod: {
    bankSales: number;
    otherIncome: number;
    transfers: number;
    layawayFunds: number;
    totalMovements: number;
  };
  reconciliation: {
    openingAvailable: number;
    periodNetMovement: number;
    closingAvailable: number;
    postPeriodMovement: number;
    reconciledCurrentAvailable: number;
    officialCurrentAvailable: number;
    difference: number;
    reconciled: boolean;
  };
  details: {
    sales: ExpressReportDetailRow[];
    supplierPayments: ExpressReportDetailRow[];
    expenses: ExpressReportDetailRow[];
    ownerWithdrawals: ExpressReportDetailRow[];
    otherIncome: ExpressReportDetailRow[];
    otherOutflows: ExpressReportDetailRow[];
    layawayReleased: ExpressReportDetailRow[];
    reconciliationMovements: ExpressReportDetailRow[];
  };
  expenseGroups: ExpressExpenseGroup[];
}

export interface ExpressFinancialReportInput {
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  invoices: Invoice[];
  purchases: PurchaseInvoice[];
  expenses: ExpenseInvoice[];
  layaways: Layaway[];
  supplierInvoices?: SupplierInvoiceView[];
  range: ReportDateRange;
}

const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const inRange = (row: Pick<FinancialCompositionRow, 'date'>, range: ReportDateRange): boolean =>
  dateMatchesReportRange(row.date, range);

const beforeRange = (row: Pick<FinancialCompositionRow, 'date'>, range: ReportDateRange): boolean =>
  Boolean(range.from && row.date < range.from);

const afterRange = (row: Pick<FinancialCompositionRow, 'date'>, range: ReportDateRange): boolean =>
  Boolean(range.to && row.date > range.to);

const signedTotal = (rows: FinancialCompositionRow[]): number =>
  rows.reduce((sum, row) => sum + number(row.signedAmount), 0);

const toDetailRow = (row: FinancialCompositionRow): ExpressReportDetailRow => ({
  id: row.movementId,
  date: row.date,
  document: row.document,
  description: row.concept,
  account: row.cashOrigin || row.bankOrigin || row.cashDestination || row.bankDestination || 'Externo',
  value: number(row.value),
  signedValue: number(row.signedAmount),
});

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('es');

function buildExpenseGroups(rows: FinancialCompositionRow[]): ExpressExpenseGroup[] {
  const groups = new Map<string, ExpressExpenseGroup>();
  rows.forEach(row => {
    const label = row.concept || 'Sin concepto';
    const key = normalize(label) || 'sin-concepto';
    const current = groups.get(key) || { label, total: 0, rows: [] };
    current.total += Math.abs(number(row.signedAmount));
    current.rows.push(toDetailRow(row));
    groups.set(key, current);
  });
  return [...groups.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, 'es'));
}

const isOwnerWithdrawalRow = (row: FinancialCompositionRow): boolean =>
  row.movement.documentType === 'owner_withdrawal'
  || row.movement.documentType === 'owner_withdrawal_cancellation';

const isSupplierPaymentRow = (row: FinancialCompositionRow): boolean =>
  row.code === 'PURCHASE_PAYMENT' || row.code === 'SUPPLIER_PAYMENT';

const isReconciliationRow = (row: FinancialCompositionRow): boolean =>
  row.code === 'SALE_CANCEL'
  || row.code === 'REVERSAL'
  || row.code === 'LAYAWAY_REFUND'
  || row.code === 'OPENING_BALANCE';

/**
 * Builds a read-only consolidated financial view from the same sources already
 * used by Dashboard and Reports. It never creates movements or materializes a
 * second balance. `current.totalAvailable` is the exact result of
 * buildFinancialCompositions(), which is also the Dashboard source of truth.
 */
export function buildExpressFinancialReport(input: ExpressFinancialReportInput): ExpressFinancialReport {
  const traceabilityInput: FinancialTraceabilityInput = {
    accounts: input.accounts,
    movements: input.movements,
    invoices: input.invoices,
    purchases: input.purchases,
    expenses: input.expenses,
    layaways: input.layaways,
  };
  const compositions = buildFinancialCompositions(traceabilityInput);
  const availableRows = compositions.totalAvailable.rows;
  const periodAvailableRows = availableRows.filter(row => inRange(row, input.range));

  const validPeriodInvoices = input.invoices.filter(invoice => (
    isSalesInvoice(invoice) && dateMatchesReportRange(invoice.date, input.range)
  ));
  const validInvoiceIds = new Set(validPeriodInvoices.map(invoice => invoice.id));

  const saleRows = periodAvailableRows.filter(row => (
    row.code === 'SALE_PAYMENT'
    && row.signedAmount > 0
    && validInvoiceIds.has(row.referenceId || row.movement.documentId)
  ));
  const layawayReleasedRows = periodAvailableRows.filter(row => row.code === 'LAYAWAY_COMPLETED' && row.signedAmount > 0);
  const supplierPaymentRows = periodAvailableRows.filter(row => isSupplierPaymentRow(row) && row.signedAmount < 0);
  const expenseRows = periodAvailableRows.filter(row => row.code === 'EXPENSE' && row.signedAmount < 0);
  const ownerRows = periodAvailableRows.filter(isOwnerWithdrawalRow);

  const classifiedIds = new Set([
    ...saleRows,
    ...layawayReleasedRows,
    ...supplierPaymentRows,
    ...expenseRows,
    ...ownerRows,
  ].map(row => row.movementId));

  const reconciliationRows = periodAvailableRows.filter(row => !classifiedIds.has(row.movementId) && isReconciliationRow(row));
  reconciliationRows.forEach(row => classifiedIds.add(row.movementId));

  const otherIncomeRows = periodAvailableRows.filter(row => (
    !classifiedIds.has(row.movementId)
    && row.signedAmount > 0
    && (row.code === 'CASH_IN' || row.code === 'BANK_IN')
  ));
  otherIncomeRows.forEach(row => classifiedIds.add(row.movementId));

  const otherOutflowRows = periodAvailableRows.filter(row => (
    !classifiedIds.has(row.movementId)
    && row.signedAmount < 0
    && (row.code === 'CASH_OUT' || row.code === 'BANK_OUT' || row.code === 'ADJUSTMENT')
  ));
  otherOutflowRows.forEach(row => classifiedIds.add(row.movementId));

  // Any remaining signed row stays explicit as a reconciliation movement.
  // This guarantees that the bridge always explains the official balance
  // without silently inventing a commercial category.
  periodAvailableRows
    .filter(row => !classifiedIds.has(row.movementId))
    .forEach(row => reconciliationRows.push(row));

  const saleCollections = signedTotal(saleRows);
  const layawayReleased = signedTotal(layawayReleasedRows);
  const otherIncome = signedTotal(otherIncomeRows);
  const supplierPayments = Math.abs(signedTotal(supplierPaymentRows));
  const expenses = Math.abs(signedTotal(expenseRows));
  const ownerWithdrawals = Math.max(0, -signedTotal(ownerRows));
  const otherOutflows = Math.abs(signedTotal(otherOutflowRows));
  const totalOutflows = supplierPayments + expenses + ownerWithdrawals + otherOutflows;
  const entriesConsidered = saleCollections + layawayReleased + otherIncome;

  const currentLedgerDelta = signedTotal(availableRows);
  const residualOpeningBalance = compositions.totalAvailable.total - currentLedgerDelta;
  const movementBeforePeriod = input.range.from
    ? signedTotal(availableRows.filter(row => beforeRange(row, input.range)))
    : 0;
  const openingAvailable = residualOpeningBalance + movementBeforePeriod;
  const periodNetMovement = signedTotal(periodAvailableRows);
  const closingAvailable = openingAvailable + periodNetMovement;
  const postPeriodMovement = input.range.to
    ? signedTotal(availableRows.filter(row => afterRange(row, input.range)))
    : 0;
  const reconciledCurrentAvailable = closingAvailable + postPeriodMovement;
  const difference = compositions.totalAvailable.total - reconciledCurrentAvailable;

  const activeLayawayBankFunds = calculateActiveLayawayBankFunds(input.accounts, input.layaways);
  const bankPeriod = buildBankMovementComposition({
    accounts: input.accounts,
    movements: input.movements,
    layaways: input.layaways,
    dateFrom: input.range.from || undefined,
    dateTo: input.range.to || undefined,
  });
  const totalReserved = Math.max(0, compositions.layawayReserve.total);
  const bankReserved = Math.max(0, activeLayawayBankFunds.total);
  const cashReserved = Math.max(0, totalReserved - bankReserved);

  const purchasesRegistered = input.purchases
    .filter(purchase => purchase.status !== 'cancelled' && dateMatchesReportRange(purchase.date, input.range))
    .reduce((sum, purchase) => sum + number(purchase.total), 0);
  const accountsPayablePending = (input.supplierInvoices || [])
    .filter(invoice => invoice.status !== 'cancelled' && number(invoice.pendingBalance) > EPSILON)
    .reduce((sum, invoice) => sum + number(invoice.pendingBalance), 0);

  const salesDetails: ExpressReportDetailRow[] = validPeriodInvoices.map(invoice => ({
    id: invoice.id,
    date: invoice.date,
    document: invoice.number,
    description: invoice.clientName || 'Consumidor final',
    account: invoice.paymentMethod || 'Según asignaciones de pago',
    value: number(invoice.total),
    signedValue: number(invoice.total),
  }));

  return {
    range: input.range,
    current: {
      mainCash: compositions.mainCash.total,
      banks: compositions.banks.total,
      totalAvailable: compositions.totalAvailable.total,
      layawayReserve: totalReserved,
      layawayBankFunds: bankReserved,
    },
    period: {
      validSales: validPeriodInvoices.reduce((sum, invoice) => sum + number(invoice.total), 0),
      validSalesCount: validPeriodInvoices.length,
      saleCollections,
      otherIncome,
      layawayReleased,
      entriesConsidered,
      supplierPayments,
      expenses,
      ownerWithdrawals,
      otherOutflows,
      totalOutflows,
      netCashFlow: periodNetMovement,
      purchasesRegistered,
      accountsPayablePending,
    },
    layaways: {
      cashReserved,
      bankReserved,
      totalReserved,
    },
    bankPeriod,
    reconciliation: {
      openingAvailable,
      periodNetMovement,
      closingAvailable,
      postPeriodMovement,
      reconciledCurrentAvailable,
      officialCurrentAvailable: compositions.totalAvailable.total,
      difference,
      reconciled: Math.abs(difference) <= EPSILON,
    },
    details: {
      sales: salesDetails,
      supplierPayments: supplierPaymentRows.map(toDetailRow),
      expenses: expenseRows.map(toDetailRow),
      ownerWithdrawals: ownerRows.map(toDetailRow),
      otherIncome: otherIncomeRows.map(toDetailRow),
      otherOutflows: otherOutflowRows.map(toDetailRow),
      layawayReleased: layawayReleasedRows.map(toDetailRow),
      reconciliationMovements: reconciliationRows.map(toDetailRow),
    },
    expenseGroups: buildExpenseGroups(expenseRows),
  };
}
