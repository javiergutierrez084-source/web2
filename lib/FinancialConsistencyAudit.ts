import { localDb } from '@/lib/localDb';
import { requirePermission } from '@/lib/authCore';
import { calculateFinancialSummary, isInventoryOrigin, isOperatingExpenseMovement, isSalesInvoice } from '@/lib/DashboardMetricsService';
import {
  fetchExpenses,
  fetchFinancialAccounts,
  fetchFinancialMovements,
  fetchFinancialSummary,
  fetchInvoices,
  fetchProducts,
  fetchSupplierInvoices,
} from '@/lib/database';

export type AuditStatus = 'correct' | 'warning' | 'error';

export interface FinancialAuditFinding {
  status: AuditStatus;
  origin: string;
  document: string;
  table: string;
  amount: number;
  date: string;
  type: string;
  user: string;
  state: string;
  message: string;
}

export interface FinancialAuditReport {
  generatedAt: string;
  readOnly: true;
  summary: { correct: number; warnings: number; errors: number };
  dashboardComparison: { stored: number; recalculated: number; difference: number };
  findings: FinancialAuditFinding[];
}

const EPSILON = 0.01;
const nearlyEqual = (left: number, right: number): boolean => Math.abs(left - right) <= EPSILON;

export async function runFinancialConsistencyAudit(): Promise<FinancialAuditReport> {
  await requirePermission('system_maintenance');

  const [accounts, movements, payables, expenses, invoices, products, activity, allocations, supplierPayments, adjustments] = await Promise.all([
    fetchFinancialAccounts(),
    fetchFinancialMovements(100000),
    fetchSupplierInvoices(),
    fetchExpenses(),
    fetchInvoices(),
    fetchProducts(),
    localDb.activity_log.toArray(),
    localDb.invoice_payment_allocations.toArray(),
    localDb.supplier_invoice_payments.toArray(),
    localDb.inventory_adjustments.toArray(),
  ]);

  const findings: FinancialAuditFinding[] = [];
  const add = (finding: FinancialAuditFinding): void => { findings.push(finding); };
  const activityKey = new Set(activity.map(row => `${row.entity}:${row.entity_id}`));
  const movementByDocument = new Map<string, typeof movements>();
  movements.forEach(movement => {
    const key = `${movement.documentType}:${movement.documentId}`;
    const current = movementByDocument.get(key) ?? [];
    current.push(movement);
    movementByDocument.set(key, current);
  });

  invoices.forEach(invoice => {
    if (!isSalesInvoice(invoice)) return;
    const invoiceMovements = movementByDocument.get(`invoice:${invoice.id}`) ?? [];
    const paid = allocations.filter(allocation => allocation.invoice_id === invoice.id).reduce((sum, allocation) => sum + allocation.amount, 0);
    const moved = invoiceMovements.filter(movement => movement.type === 'sale_income').reduce((sum, movement) => sum + movement.amount, 0);
    if (!nearlyEqual(invoice.total, paid) || !nearlyEqual(invoice.total, moved)) {
      add({ status: 'error', origin: 'Venta', document: invoice.number, table: 'invoices / invoice_payment_allocations / financial_movements', amount: invoice.total, date: invoice.date, type: 'sale', user: invoiceMovements[0]?.userName ?? 'Desconocido', state: invoice.status, message: `Factura ${invoice.total}, pagos ${paid}, movimientos ${moved}.` });
    }
    if (!activityKey.has(`invoice:${invoice.id}`)) {
      add({ status: 'warning', origin: 'Venta', document: invoice.number, table: 'activity_log', amount: invoice.total, date: invoice.date, type: 'missing_activity', user: 'Desconocido', state: invoice.status, message: 'No existe Activity Log asociado.' });
    }
  });

  expenses.forEach(expense => {
    if (expense.status !== 'paid') return;
    const expenseMovements = movementByDocument.get(`expense:${expense.id}`) ?? [];
    const moved = expenseMovements.filter(isOperatingExpenseMovement).reduce((sum, movement) => sum + movement.amount, 0);
    if (!nearlyEqual(expense.total, moved)) {
      add({ status: 'error', origin: 'Gasto', document: expense.number, table: 'expenses / financial_movements', amount: expense.total, date: expense.date, type: 'expense', user: expenseMovements[0]?.userName ?? 'Desconocido', state: expense.status, message: `Gasto ${expense.total}, movimiento operativo ${moved}.` });
    }
    if (!activityKey.has(`expense:${expense.id}`)) {
      add({ status: 'warning', origin: 'Gasto', document: expense.number, table: 'activity_log', amount: expense.total, date: expense.date, type: 'missing_activity', user: 'Desconocido', state: expense.status, message: 'No existe Activity Log asociado.' });
    }
  });

  supplierPayments.forEach(payment => {
    const related = movements.filter(movement => movement.documentType === 'supplier_invoice' && movement.documentId === payment.supplier_invoice_id && movement.type === 'supplier_payment' && nearlyEqual(movement.amount, payment.amount) && movement.date === payment.date);
    if (related.length === 0) {
      add({ status: 'error', origin: 'Pago proveedor', document: payment.supplier_invoice_id, table: 'supplier_invoice_payments / financial_movements', amount: payment.amount, date: payment.date, type: 'supplier_payment', user: payment.user_name ?? 'Desconocido', state: 'recorded', message: 'Pago sin movimiento financiero equivalente.' });
    }
  });

  adjustments.forEach(adjustment => {
    const related = movements.filter(movement =>
      movement.documentType === 'inventory_adjustment' && movement.documentId === adjustment.id
    );
    if (related.length > 0) {
      add({ status: 'error', origin: 'Ajuste de inventario', document: adjustment.id, table: 'inventory_adjustments / financial_movements', amount: related.reduce((sum, movement) => sum + movement.amount, 0), date: adjustment.adjustment_date ?? adjustment.created_at.slice(0, 10), type: 'INVENTORY_ADJUSTMENT_FINANCIAL_AUDIT', user: related[0]?.userName ?? 'Desconocido', state: adjustment.type, message: 'El ajuste tiene movimientos financieros vinculados por document_type + document_id.' });
    }
    if (!activityKey.has(`inventory_adjustment:${adjustment.id}`)) {
      add({ status: 'warning', origin: 'Ajuste de inventario', document: adjustment.id, table: 'activity_log', amount: adjustment.total_cost ?? 0, date: adjustment.adjustment_date ?? adjustment.created_at.slice(0, 10), type: 'missing_activity', user: 'Desconocido', state: adjustment.type, message: 'No existe Activity Log asociado.' });
    }
  });

  movements.filter(isInventoryOrigin).forEach(movement => {
    const adjustmentExists = adjustments.some(adjustment => adjustment.id === movement.documentId);
    if (!adjustmentExists) {
      add({ status: 'error', origin: movement.documentType, document: movement.reference, table: 'financial_movements', amount: movement.amount, date: movement.date, type: 'INVENTORY_ADJUSTMENT_FINANCIAL_AUDIT', user: movement.userName, state: 'orphan_financial_movement', message: 'Movimiento financiero de inventario sin ajuste existente; no se corrige automáticamente.' });
    }
  });

  accounts.forEach(account => {
    const related = movements.filter(movement => movement.originAccountId === account.id || movement.destinationAccountId === account.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = related.at(-1);
    if (!latest) return;
    const expected = latest.originAccountId === account.id ? latest.originBalanceAfter : latest.destinationBalanceAfter;
    if (!nearlyEqual(account.balance, expected)) {
      add({ status: 'error', origin: 'Cuenta financiera', document: account.name, table: 'financial_accounts / financial_movements', amount: account.balance, date: latest.date, type: 'account_balance', user: latest.userName, state: account.active ? 'active' : 'inactive', message: `Saldo cuenta ${account.balance}, último saldo trazado ${expected}.` });
    }
  });

  const stored = await fetchFinancialSummary();
  const recalculated = calculateFinancialSummary({ accounts, movements, payables, expenses, invoices, products });
  const difference = stored.totalFunds - recalculated.totalFunds;
  if (!nearlyEqual(stored.expensesToday, recalculated.expensesToday) || !nearlyEqual(difference, 0)) {
    add({ status: 'error', origin: 'Dashboard', document: 'Resumen financiero', table: 'financial_summary', amount: difference, date: new Date().toISOString().slice(0, 10), type: 'dashboard_difference', user: 'Sistema', state: 'calculated', message: `Dashboard y recálculo difieren. Fondos: ${difference}; gastos del día: ${stored.expensesToday - recalculated.expensesToday}.` });
  }

  const correct = findings.length === 0 ? 1 : 0;
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary: { correct, warnings: findings.filter(finding => finding.status === 'warning').length, errors: findings.filter(finding => finding.status === 'error').length },
    dashboardComparison: { stored: stored.totalFunds, recalculated: recalculated.totalFunds, difference },
    findings,
  };
}
