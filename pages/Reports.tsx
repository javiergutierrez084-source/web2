import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DollarSign, TrendingUp, Package, ArrowDownUp, WalletCards, AlertTriangle, CalendarRange, Users, Truck, ShoppingBag, HandCoins, FileChartColumnIncreasing } from 'lucide-react';
import { formatCurrency, isSoldByWeight, type Product } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import ExcelDocumentActions from '@/components/ExcelDocumentActions';
import { Button } from '@/components/ui/button';
import { formatWeight } from '@/lib/utils';
import { buildBankDetails, buildFinancialCompositions, buildFinancialLedgerRows } from '@/lib/FinancialTraceabilityService';
import FinancialTraceabilityPanel from '@/components/FinancialTraceabilityPanel';
import ExpressFinancialReport from '@/components/ExpressFinancialReport';
import { isActiveFinancialMovement } from '@/lib/FinancialLedgerService';
import { calculateActiveLayawayBankFunds } from '@/lib/LayawayBankAccountingService';
import { auditCustomerCredits, buildCustomerCreditSummaries } from '@/lib/CustomerCreditService';
import { calculateProductSales } from '@/lib/salesAnalytics';
import { calculateCustomerSalesSummaries } from '@/lib/customerSalesAnalytics';
import { isSalesInvoice } from '@/lib/DashboardMetricsService';
import { fetchSupplierInvoices } from '@/lib/database';
import type { SupplierInvoiceView } from '@/domain/models';
import { filterCommercialSaleLedgerRows } from '@/lib/salesTraceability';
import {
  buildReportDateRange,
  dateMatchesReportRange,
  describeReportDateRange,
  isValidReportDateRange,
  type ReportDateRange,
  type ReportRangePreset,
} from '@/lib/reportDateRange';

interface Movement {
  date: string;
  type: string;
  number: string;
  entity: string;
  paymentMethod: string;
  income: number;
  expense: number;
}

interface CustomerReportRow {
  id: string;
  name: string;
  invoiceCount: number;
  total: number;
  firstSale: string;
  lastSale: string;
}

interface SupplierReportRow {
  id: string;
  name: string;
  invoiceCount: number;
  total: number;
  grams: number;
  firstPurchase: string;
  lastPurchase: string;
}

const RANGE_PRESETS: Array<{ key: Exclude<ReportRangePreset, 'custom'>; label: string }> = [
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: 'last7', label: 'Últimos 7 días' },
  { key: 'last30', label: 'Últimos 30 días' },
  { key: 'currentMonth', label: 'Este mes' },
  { key: 'previousMonth', label: 'Mes anterior' },
  { key: 'last3Months', label: 'Últimos 3 meses' },
  { key: 'currentYear', label: 'Este año' },
  { key: 'previousYear', label: 'Año anterior' },
  { key: 'all', label: 'Todo' },
];

const REPORT_TABS = ['express', 'traceability', 'credits', 'movements', 'monthly', 'profit', 'layaways', 'inventory', 'accounts', 'payables', 'customers', 'suppliers', 'productsSold', 'ownerWithdrawals'] as const;
type ReportsTab = typeof REPORT_TABS[number];

// Module memory keeps the last selection while the application process remains open.
// It is intentionally not stored in localStorage, IndexedDB or Repository.
let reportsRangeMemory: ReportDateRange = buildReportDateRange('today');

const Reports = () => {
  const { company, contacts, invoices, expenses, purchaseInvoices, products, layaways, financialAccounts, financialMovements } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs: readonly ReportsTab[] = REPORT_TABS;
  const requestedTab = searchParams.get('tab');
  const initialTab = validTabs.includes(requestedTab as ReportsTab) ? requestedTab as ReportsTab : 'movements';
  const [tab, setTabState] = useState<ReportsTab>(initialTab);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoiceView[]>([]);
  const setTab = (next: ReportsTab) => {
    setTabState(next);
    const updated = new URLSearchParams(searchParams);
    updated.set('tab', next);
    if (next !== 'traceability') updated.delete('composition');
    setSearchParams(updated, { replace: true });
  };
  const [reportRange, setReportRangeState] = useState<ReportDateRange>(() => ({ ...reportsRangeMemory }));
  const rangeValid = isValidReportDateRange(reportRange);
  const rangeLabel = describeReportDateRange(reportRange);

  const setReportRange = (next: ReportDateRange) => {
    reportsRangeMemory = { ...next };
    setReportRangeState(next);
  };

  const applyPreset = (preset: Exclude<ReportRangePreset, 'custom'>) => {
    setReportRange(buildReportDateRange(preset));
  };

  const updateCustomRange = (field: 'from' | 'to', value: string) => {
    setReportRange({ ...reportRange, [field]: value, preset: 'custom' });
  };

  useEffect(() => {
    if (validTabs.includes(requestedTab as ReportsTab) && requestedTab !== tab) setTabState(requestedTab as ReportsTab);
  }, [requestedTab, tab]);

  useEffect(() => {
    if (tab !== 'express') return;
    let active = true;
    void fetchSupplierInvoices()
      .then(rows => { if (active) setSupplierInvoices(rows); })
      .catch(error => {
        if (import.meta.env.DEV) console.warn('[InformeExpress] Cuentas por pagar no disponibles', error);
      });
    return () => { active = false; };
  }, [tab]);

  const financialTraceabilityInput = useMemo(() => ({
    accounts: financialAccounts,
    movements: financialMovements,
    contacts,
    invoices,
    purchases: purchaseInvoices,
    expenses,
    layaways,
  }), [financialAccounts, financialMovements, contacts, invoices, purchaseInvoices, expenses, layaways]);

  const ledgerRows = useMemo(
    () => buildFinancialLedgerRows(financialTraceabilityInput),
    [financialTraceabilityInput],
  );
  const activeLedgerRows = useMemo(
    () => ledgerRows.filter(row => isActiveFinancialMovement(row.movement)),
    [ledgerRows],
  );
  const periodAllLedgerRows = useMemo(
    () => rangeValid ? ledgerRows.filter(row => dateMatchesReportRange(row.date, reportRange)) : [],
    [ledgerRows, rangeValid, reportRange],
  );
  const periodLedgerRows = useMemo(
    () => rangeValid ? activeLedgerRows.filter(row => dateMatchesReportRange(row.date, reportRange)) : [],
    [activeLedgerRows, rangeValid, reportRange],
  );
  const periodFinancialMovements = useMemo(
    () => rangeValid ? financialMovements.filter(movement => dateMatchesReportRange(movement.date, reportRange)) : [],
    [financialMovements, rangeValid, reportRange],
  );
  // The date selector limits historical rows and period calculations only.
  // Current Caja/Bancos balances must always be reconstructed from the complete
  // Financial Ledger; otherwise selecting “Hoy” drops prior movements and turns
  // an account balance into a partial delta for the selected range.
  const financialCompositions = useMemo(
    () => buildFinancialCompositions(financialTraceabilityInput),
    [financialTraceabilityInput],
  );
  const bankDetails = useMemo(
    () => buildBankDetails(financialTraceabilityInput),
    [financialTraceabilityInput],
  );
  const layawayBankFunds = useMemo(
    () => calculateActiveLayawayBankFunds(financialAccounts, layaways),
    [financialAccounts, layaways],
  );
  const layawayBankFundsByAccount = useMemo(
    () => new Map(layawayBankFunds.byAccount.map(item => [item.accountId, item.amount])),
    [layawayBankFunds],
  );
  const customerCreditSummaries = useMemo(
    () => buildCustomerCreditSummaries(periodFinancialMovements, contacts),
    [periodFinancialMovements, contacts],
  );
  const customerCreditAuditIssues = useMemo(
    () => auditCustomerCredits(periodFinancialMovements),
    [periodFinancialMovements],
  );
  const customerCreditTotals = useMemo(() => customerCreditSummaries.reduce(
    (totals, summary) => ({
      created: totals.created + summary.created,
      used: totals.used + summary.used,
      available: totals.available + summary.available,
    }),
    { created: 0, used: 0, available: 0 },
  ), [customerCreditSummaries]);

  const movements = useMemo(() => periodLedgerRows.map<Movement>(row => ({
    date: row.date,
    type: row.code,
    number: row.document,
    entity: row.client || row.supplier || row.concept,
    paymentMethod: [row.cashOrigin || row.bankOrigin || 'Externo', row.cashDestination || row.bankDestination || 'Externo'].join(' → '),
    income: row.income,
    expense: row.expense,
  })), [periodLedgerRows]);

  const commercialPeriodLedgerRows = useMemo(
    () => filterCommercialSaleLedgerRows(periodLedgerRows, invoices),
    [invoices, periodLedgerRows],
  );

  const totalIncome = movements.reduce((sum, movement) => sum + movement.income, 0);
  const totalExpense = movements.reduce((sum, movement) => sum + movement.expense, 0);

  const monthLedgerRows = commercialPeriodLedgerRows;
  const codeRows = (codes: string[]) => monthLedgerRows.filter(row => codes.includes(row.code));
  const monthSalesRows = monthLedgerRows.filter(row => (
    ['SALE_PAYMENT', 'CUSTOMER_CREDIT_USED', 'LAYAWAY_COMPLETED', 'SALE_CANCEL'].includes(row.code)
    || (row.code === 'REVERSAL' && row.referenceType === 'SALE')
  ));
  const monthPurchaseRows = codeRows(['PURCHASE_PAYMENT']);
  const monthExpenseRows = codeRows(['EXPENSE']);
  const monthSupplierRows = codeRows(['SUPPLIER_PAYMENT']);
  const signedByCode = (rows: typeof monthLedgerRows, negativeCodes: string[] = []) => rows.reduce(
    (sum, row) => sum + (negativeCodes.includes(row.code) ? -row.value : row.value),
    0,
  );
  const distinctDocuments = (rows: typeof monthLedgerRows) => new Set(rows.map(row => row.referenceId || row.document)).size;
  const monthSalesTotal = signedByCode(monthSalesRows, ['SALE_CANCEL', 'REVERSAL']);
  const monthPurchaseTotal = signedByCode(monthPurchaseRows);
  const monthExpenseTotal = signedByCode(monthExpenseRows);
  const monthSupplierPaymentTotal = signedByCode(monthSupplierRows);
  const monthLedgerResult = monthSalesTotal - monthPurchaseTotal - monthExpenseTotal - monthSupplierPaymentTotal;

  const allSalesRows = commercialPeriodLedgerRows.filter(row => (
    ['SALE_PAYMENT', 'CUSTOMER_CREDIT_USED', 'LAYAWAY_COMPLETED', 'SALE_CANCEL'].includes(row.code)
    || (row.code === 'REVERSAL' && row.referenceType === 'SALE')
  ));
  const allOutflowRows = periodLedgerRows.filter(row => ['PURCHASE_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_OUT', 'BANK_OUT'].includes(row.code));
  const totalSalesRevenue = allSalesRows.reduce((sum, row) => sum + (['SALE_CANCEL', 'REVERSAL'].includes(row.code) ? -row.value : row.value), 0);
  const totalFinancialOutflow = allOutflowRows.reduce((sum, row) => sum + row.value, 0);
  const ledgerResult = totalSalesRevenue - totalFinancialOutflow;
  const supplierPaymentRows = periodLedgerRows.filter(row => row.code === 'SUPPLIER_PAYMENT');
  const totalSupplierPaymentsAll = supplierPaymentRows.reduce((sum, row) => sum + row.value, 0);

  const periodInvoices = useMemo(
    () => rangeValid ? invoices.filter(invoice => dateMatchesReportRange(invoice.date, reportRange)) : [],
    [invoices, rangeValid, reportRange],
  );
  const periodSalesInvoices = useMemo(
    () => periodInvoices.filter(isSalesInvoice),
    [periodInvoices],
  );
  const periodPurchases = useMemo(
    () => rangeValid ? purchaseInvoices.filter(purchase => purchase.status !== 'cancelled' && dateMatchesReportRange(purchase.date, reportRange)) : [],
    [purchaseInvoices, rangeValid, reportRange],
  );

  const customerRows = useMemo<CustomerReportRow[]>(() => (
    calculateCustomerSalesSummaries(periodInvoices).map(summary => ({
      id: summary.clientId,
      name: summary.clientName,
      invoiceCount: summary.invoiceCount,
      total: summary.totalPurchased,
      firstSale: summary.firstSale,
      lastSale: summary.lastSale,
    }))
  ), [periodInvoices]);

  const supplierRows = useMemo<SupplierReportRow[]>(() => {
    const map = new Map<string, SupplierReportRow>();
    periodPurchases.forEach(purchase => {
      const current = map.get(purchase.supplierId) || {
        id: purchase.supplierId,
        name: purchase.supplierName || 'Proveedor sin nombre',
        invoiceCount: 0,
        total: 0,
        grams: 0,
        firstPurchase: purchase.date,
        lastPurchase: purchase.date,
      };
      current.invoiceCount += 1;
      current.total += purchase.total;
      current.grams += purchase.items.reduce((sum, item) => sum + (item.totalGramsSold ?? item.weightGrams * item.quantity), 0);
      if (purchase.date < current.firstPurchase) current.firstPurchase = purchase.date;
      if (purchase.date > current.lastPurchase) current.lastPurchase = purchase.date;
      map.set(purchase.supplierId, current);
    });
    return [...map.values()].sort((left, right) => right.total - left.total);
  }, [periodPurchases]);

  const productsSoldRows = useMemo(
    () => calculateProductSales(periodSalesInvoices, products),
    [periodSalesInvoices, products],
  );

  const layawayIdsWithPeriodActivity = useMemo(() => new Set(
    periodLedgerRows
      .filter(row => row.code === 'LAYAWAY_PAYMENT' || row.code === 'LAYAWAY_COMPLETED' || row.code === 'LAYAWAY_REFUND')
      .map(row => row.referenceId),
  ), [periodLedgerRows]);
  const layawaysInPeriod = useMemo(() => rangeValid ? layaways.filter(layaway => (
    dateMatchesReportRange(layaway.invoice.date, reportRange) || layawayIdsWithPeriodActivity.has(layaway.id)
  )) : [], [layawayIdsWithPeriodActivity, layaways, rangeValid, reportRange]);
  const activeLayaways = useMemo(() => layawaysInPeriod.filter(layaway => !layaway.completed), [layawaysInPeriod]);
  const totalLayawayValue = activeLayaways.reduce((sum, layaway) => sum + layaway.invoice.total, 0);
  const totalLayawayPaidToDate = activeLayaways.reduce(
    (sum, layaway) => sum + layaway.payments.reduce((paymentSum, payment) => paymentSum + payment.amount, 0),
    0,
  );
  const layawayPaymentRows = periodLedgerRows.filter(row => row.code === 'LAYAWAY_PAYMENT');
  const totalLayawayPaymentsInPeriod = layawayPaymentRows.reduce((sum, row) => sum + row.value, 0);

  const ownerWithdrawalRows = useMemo(() => periodAllLedgerRows.filter(row => (
    row.movement.documentType === 'owner_withdrawal'
    || row.movement.documentType === 'owner_withdrawal_cancellation'
  )), [periodAllLedgerRows]);
  const ownerWithdrawalsTotal = ownerWithdrawalRows.reduce(
    (sum, row) => sum + (row.movement.documentType === 'owner_withdrawal_cancellation' ? -row.value : row.value),
    0,
  );

  const getInventoryWeight = (product: Product): number =>
    isSoldByWeight(product) ? product.stock : product.weightGrams * product.stock;

  const totalPurchaseValue = products.reduce((sum, product) => sum + product.purchasePrice * product.stock, 0);
  const totalSaleValue = products.reduce((sum, product) => sum + product.salePrice * product.stock, 0);
  const totalGrams = products.reduce((sum, product) => sum + getInventoryWeight(product), 0);
  const totalProjectedProfit = totalSaleValue - totalPurchaseValue;

  const buildMovementsDocument = () => buildTableDocumentData({
    company,
    title: 'Reporte de Movimientos',
    subtitle: rangeLabel,
    columns: [
      { header: 'Fecha' }, { header: 'Tipo' }, { header: 'Documento' },
      { header: 'Cliente / Proveedor' }, { header: 'F. Pago' },
      { header: 'Ingreso', align: 'right' }, { header: 'Egreso', align: 'right' },
    ],
    rows: movements.map(movement => [
      movement.date, movement.type, movement.number, movement.entity, movement.paymentMethod,
      movement.income > 0 ? formatCurrency(movement.income) : '',
      movement.expense > 0 ? formatCurrency(movement.expense) : '',
    ]),
    summaryLines: [
      { label: 'Total Ingresos', value: formatCurrency(totalIncome) },
      { label: 'Total Egresos', value: formatCurrency(totalExpense) },
      { label: 'Resultado del período', value: formatCurrency(totalIncome - totalExpense), bold: true },
    ],
  });

  const buildSalesDocument = () => buildTableDocumentData({
    company,
    title: 'Movimientos de Ventas',
    subtitle: rangeLabel,
    columns: [
      { header: 'Fecha' }, { header: 'Código' }, { header: 'Factura' },
      { header: 'Cliente' }, { header: 'Usuario' }, { header: 'Movimiento', align: 'right' },
    ],
    rows: monthSalesRows.map(row => [
      `${row.date} ${row.time}`, row.code, row.document, row.client, row.user,
      formatCurrency(row.code === 'SALE_CANCEL' ? -row.value : row.value),
    ]),
    summaryLines: [{ label: 'Ventas netas según Ledger', value: formatCurrency(monthSalesTotal), bold: true }],
  });

  const buildPurchasesDocument = () => buildTableDocumentData({
    company,
    title: 'Pagos de Compras',
    subtitle: rangeLabel,
    columns: [
      { header: 'Fecha' }, { header: 'Documento' }, { header: 'Proveedor' },
      { header: 'Cuenta origen' }, { header: 'Usuario' }, { header: 'Total', align: 'right' },
    ],
    rows: monthPurchaseRows.map(row => [
      `${row.date} ${row.time}`, row.document, row.supplier, row.cashOrigin || row.bankOrigin || 'Externo', row.user, formatCurrency(row.value),
    ]),
    summaryLines: [{ label: 'Pagos de compras', value: formatCurrency(monthPurchaseTotal), bold: true }],
  });

  const buildExpensesDocument = () => buildTableDocumentData({
    company,
    title: 'Movimientos de Gastos',
    subtitle: rangeLabel,
    columns: [
      { header: 'Fecha' }, { header: 'Documento' }, { header: 'Proveedor' },
      { header: 'Concepto' }, { header: 'Cuenta origen' }, { header: 'Total', align: 'right' },
    ],
    rows: monthExpenseRows.map(row => [
      `${row.date} ${row.time}`, row.document, row.supplier, row.concept, row.cashOrigin || row.bankOrigin || 'Externo', formatCurrency(row.value),
    ]),
    summaryLines: [{ label: 'Gastos según Ledger', value: formatCurrency(monthExpenseTotal), bold: true }],
  });

  const buildMonthlyDocument = () => buildTableDocumentData({
    company,
    title: 'Cuadre del período desde Financial Ledger',
    subtitle: rangeLabel,
    columns: [
      { header: 'Concepto' }, { header: 'Documentos', align: 'center' }, { header: 'Total', align: 'right' },
    ],
    rows: [
      ['Ventas netas', distinctDocuments(monthSalesRows), formatCurrency(monthSalesTotal)],
      ['Pagos de compras', distinctDocuments(monthPurchaseRows), formatCurrency(monthPurchaseTotal)],
      ['Gastos', distinctDocuments(monthExpenseRows), formatCurrency(monthExpenseTotal)],
      ['Pagos proveedores', distinctDocuments(monthSupplierRows), formatCurrency(monthSupplierPaymentTotal)],
    ],
    summaryLines: [
      { label: 'Resultado financiero del período', value: formatCurrency(monthLedgerResult), bold: true },
    ],
  });

  const buildProfitDocument = () => buildTableDocumentData({
    company,
    title: 'Resultado Financiero Trazable',
    subtitle: `Reconstruido exclusivamente desde FinancialMovement · ${rangeLabel}`,
    columns: [{ header: 'Concepto' }, { header: 'Valor', align: 'right' }],
    rows: [
      ['Ventas netas', formatCurrency(totalSalesRevenue)],
      ['Salidas financieras', formatCurrency(totalFinancialOutflow)],
    ],
    summaryLines: [{ label: 'Resultado Ledger', value: formatCurrency(ledgerResult), bold: true }],
  });

  const buildAccountsDocument = () => buildTableDocumentData({
    company,
    title: 'Reporte de Caja y Bancos',
    subtitle: rangeLabel,
    columns: [
      { header: 'Banco' }, { header: 'Tipo' }, { header: 'Saldo', align: 'right' },
      { header: 'Fondos de separados', align: 'right' },
    ],
    rows: bankDetails.map(account => [
      account.name,
      'bank',
      formatCurrency(account.balance),
      formatCurrency(layawayBankFundsByAccount.get(account.accountId) || 0),
    ]),
    summaryLines: [
      { label: 'Total Bancos', value: formatCurrency(financialCompositions.banks.total), bold: true },
      { label: 'Fondos provenientes de separados (informativo, no son ventas)', value: formatCurrency(layawayBankFunds.total) },
    ],
  });

  const buildPayablesDocument = () => buildTableDocumentData({
    company,
    title: 'Historial de Pagos a Proveedores',
    subtitle: `Movimientos SUPPLIER_PAYMENT del libro mayor · ${rangeLabel}`,
    columns: [
      { header: 'Fecha' }, { header: 'Documento' }, { header: 'Proveedor' },
      { header: 'Cuenta origen' }, { header: 'Usuario' }, { header: 'Valor', align: 'right' },
      { header: 'MovementId' },
    ],
    rows: supplierPaymentRows.map(row => [
      `${row.date} ${row.time}`, row.document, row.supplier, row.cashOrigin || row.bankOrigin || 'Externo', row.user,
      formatCurrency(row.value), row.movementId,
    ]),
    summaryLines: [
      { label: 'Total pagado a proveedores', value: formatCurrency(totalSupplierPaymentsAll), bold: true },
    ],
  });

  const buildLayawaysDocument = () => buildTableDocumentData({
    company,
    title: 'Separados y abonos',
    subtitle: rangeLabel,
    columns: [
      { header: 'Factura' }, { header: 'Cliente' }, { header: 'Fecha' }, { header: 'Estado' },
      { header: 'Total', align: 'right' }, { header: 'Abonado acumulado', align: 'right' },
      { header: 'Abonos del período', align: 'right' }, { header: 'Pendiente actual', align: 'right' },
    ],
    rows: layawaysInPeriod.map(layaway => {
      const paidToDate = layaway.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const paidInPeriod = layawayPaymentRows
        .filter(row => row.referenceId === layaway.id)
        .reduce((sum, row) => sum + row.value, 0);
      return [
        layaway.invoice.number,
        layaway.invoice.clientName,
        layaway.invoice.date,
        layaway.completed ? 'Completado' : 'Activo',
        formatCurrency(layaway.invoice.total),
        formatCurrency(paidToDate),
        formatCurrency(paidInPeriod),
        formatCurrency(Math.max(0, layaway.invoice.total - paidToDate)),
      ];
    }),
    summaryLines: [
      { label: 'Separados relacionados con el período', value: String(layawaysInPeriod.length) },
      { label: 'Separados activos', value: String(activeLayaways.length) },
      { label: 'Abonos del período', value: formatCurrency(totalLayawayPaymentsInPeriod) },
      { label: 'Pendiente actual de separados activos', value: formatCurrency(Math.max(0, totalLayawayValue - totalLayawayPaidToDate)), bold: true },
    ],
  });

  const buildOwnerWithdrawalsDocument = () => buildTableDocumentData({
    company,
    title: 'Retiros del propietario',
    subtitle: rangeLabel,
    columns: [
      { header: 'Fecha' }, { header: 'Documento' }, { header: 'Concepto' },
      { header: 'Usuario' }, { header: 'Cuenta' }, { header: 'Estado' }, { header: 'Valor', align: 'right' },
    ],
    rows: ownerWithdrawalRows.map(row => [
      `${row.date} ${row.time}`,
      row.document,
      row.concept,
      row.user,
      row.cashOrigin || row.bankOrigin || row.cashDestination || row.bankDestination || 'Externo',
      row.movement.documentType === 'owner_withdrawal_cancellation' ? 'Anulación' : row.status,
      formatCurrency(row.movement.documentType === 'owner_withdrawal_cancellation' ? -row.value : row.value),
    ]),
    summaryLines: [
      { label: 'Movimientos', value: String(ownerWithdrawalRows.length) },
      { label: 'Retiros netos del período', value: formatCurrency(ownerWithdrawalsTotal), bold: true },
    ],
  });

  const buildCustomerCreditsDocument = () => buildTableDocumentData({
    company,
    title: 'Saldos a favor por cliente',
    subtitle: `Reconstruido exclusivamente desde CUSTOMER_CREDIT y CUSTOMER_CREDIT_USED · ${rangeLabel}`,
    columns: [
      { header: 'Cliente' }, { header: 'Crédito creado', align: 'right' },
      { header: 'Utilizado', align: 'right' }, { header: 'Disponible', align: 'right' },
      { header: 'Documento origen' }, { header: 'Documentos destino' },
    ],
    rows: customerCreditSummaries.map(summary => [
      summary.customerName,
      formatCurrency(summary.created),
      formatCurrency(summary.used),
      formatCurrency(summary.available),
      summary.sources.map(source => source.originDocument).join(', '),
      summary.usages.map(usage => usage.destinationDocument).join(', ') || '—',
    ]),
    summaryLines: [
      { label: 'Crédito creado', value: formatCurrency(customerCreditTotals.created) },
      { label: 'Saldo utilizado', value: formatCurrency(customerCreditTotals.used) },
      { label: 'Saldo disponible', value: formatCurrency(customerCreditTotals.available), bold: true },
    ],
  });

  const buildInventoryDocument = () => buildTableDocumentData({
    company,
    title: 'Reporte de Inventario Valorizado',
    subtitle: `${products.length} productos · ${formatWeight(totalGrams)} g disponibles`,
    columns: [
      { header: 'Código' }, { header: 'Producto' }, { header: 'Cat.' },
      { header: 'Peso Unitario', align: 'right' }, { header: 'Existencia', align: 'center' },
      { header: 'Peso Disponible', align: 'right' },
      { header: 'P. Compra', align: 'right' }, { header: 'V. Compra Total', align: 'right' },
      { header: 'P. Venta', align: 'right' }, { header: 'V. Venta Total', align: 'right' },
      { header: 'Utilidad', align: 'right' },
    ],
    rows: products.map(product => [
      product.code, product.name, product.category,
      formatWeight(product.weightGrams), isSoldByWeight(product) ? formatWeight(product.stock) : String(product.stock),
      formatWeight(getInventoryWeight(product)),
      formatCurrency(product.purchasePrice), formatCurrency(product.purchasePrice * product.stock),
      formatCurrency(product.salePrice), formatCurrency(product.salePrice * product.stock),
      formatCurrency((product.salePrice - product.purchasePrice) * product.stock),
    ]),
    summaryLines: [
      { label: 'Total Gramos', value: `${formatWeight(totalGrams)} g` },
      { label: 'Total Valor Compra', value: formatCurrency(totalPurchaseValue) },
      { label: 'Total Valor Venta', value: formatCurrency(totalSaleValue) },
      { label: 'Ganancia Proyectada', value: formatCurrency(totalProjectedProfit), bold: true },
    ],
  });

  const buildCustomersDocument = () => buildTableDocumentData({
    company,
    title: 'Clientes por ventas',
    subtitle: rangeLabel,
    columns: [
      { header: 'Cliente' }, { header: 'Facturas', align: 'center' },
      { header: 'Total comprado', align: 'right' }, { header: 'Primera venta' }, { header: 'Última venta' },
    ],
    rows: customerRows.map(row => [row.name, row.invoiceCount, formatCurrency(row.total), row.firstSale, row.lastSale]),
    summaryLines: [
      { label: 'Clientes', value: String(customerRows.length) },
      { label: 'Facturas', value: String(customerRows.reduce((sum, row) => sum + row.invoiceCount, 0)) },
      { label: 'Total vendido', value: formatCurrency(customerRows.reduce((sum, row) => sum + row.total, 0)), bold: true },
    ],
  });

  const buildSuppliersDocument = () => buildTableDocumentData({
    company,
    title: 'Compras por proveedor',
    subtitle: rangeLabel,
    columns: [
      { header: 'Proveedor' }, { header: 'Facturas', align: 'center' },
      { header: 'Gramos', align: 'right' }, { header: 'Total invertido', align: 'right' },
      { header: 'Primera compra' }, { header: 'Última compra' },
    ],
    rows: supplierRows.map(row => [
      row.name, row.invoiceCount, `${formatWeight(row.grams)} g`, formatCurrency(row.total), row.firstPurchase, row.lastPurchase,
    ]),
    summaryLines: [
      { label: 'Proveedores', value: String(supplierRows.length) },
      { label: 'Facturas', value: String(supplierRows.reduce((sum, row) => sum + row.invoiceCount, 0)) },
      { label: 'Gramos adquiridos', value: `${formatWeight(supplierRows.reduce((sum, row) => sum + row.grams, 0))} g` },
      { label: 'Total invertido', value: formatCurrency(supplierRows.reduce((sum, row) => sum + row.total, 0)), bold: true },
    ],
  });

  const buildProductsSoldDocument = () => buildTableDocumentData({
    company,
    title: 'Productos vendidos',
    subtitle: rangeLabel,
    columns: [
      { header: 'Código' }, { header: 'Producto' }, { header: 'Cantidad', align: 'right' },
      { header: 'Gramos', align: 'right' }, { header: 'Valor vendido', align: 'right' },
    ],
    rows: productsSoldRows.map(row => [
      row.code, row.name, row.quantitySold, `${formatWeight(row.gramsSold)} g`, formatCurrency(row.totalSold),
    ]),
    summaryLines: [
      { label: 'Productos diferentes', value: String(productsSoldRows.length) },
      { label: 'Gramos vendidos', value: `${formatWeight(productsSoldRows.reduce((sum, row) => sum + row.gramsSold, 0))} g` },
      { label: 'Valor vendido', value: formatCurrency(productsSoldRows.reduce((sum, row) => sum + row.totalSold, 0)), bold: true },
    ],
  });


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-sm text-muted-foreground mt-1">Control financiero y operativo</p>
        </div>
        <Button type="button" className="gap-2" onClick={() => setTab('express')}>
          <FileChartColumnIncreasing className="h-4 w-4" /> Informe Express
        </Button>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Rango histórico de reportes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><CalendarRange className="h-4 w-4 text-primary" /> Período del reporte</h2>
            <p className="text-xs text-muted-foreground">Todos los cálculos y exportaciones usan el mismo rango: {rangeLabel}.</p>
          </div>
          {!rangeValid && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">La fecha inicial no puede ser posterior a la fecha final.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => applyPreset(option.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${reportRange.preset === option.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            <span>Desde</span>
            <input type="date" value={reportRange.from} onChange={event => updateCustomRange('from', event.target.value)} className="block rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            <span>Hasta</span>
            <input type="date" value={reportRange.to} onChange={event => updateCustomRange('to', event.target.value)} className="block rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <span className="rounded-lg bg-secondary/50 px-3 py-2 text-sm font-medium">{rangeLabel}</span>
        </div>
      </section>

      <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5 w-fit flex-wrap">
        {([['express', 'Informe Express'], ['traceability', 'Trazabilidad Financiera'], ['credits', 'Saldos a favor'], ['movements', 'Movimientos'], ['monthly', 'Cuadre del período'], ['profit', 'Resultado Ledger'], ['accounts', 'Caja y Bancos'], ['payables', 'Pagos Proveedores'], ['layaways', 'Separados'], ['customers', 'Clientes'], ['suppliers', 'Proveedores'], ['productsSold', 'Productos vendidos'], ['ownerWithdrawals', 'Retiros propietario'], ['inventory', 'Inventario']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>


      {tab === 'express' && (
        <ExpressFinancialReport
          company={company}
          accounts={financialAccounts}
          movements={financialMovements}
          invoices={invoices}
          purchases={purchaseInvoices}
          expenses={expenses}
          layaways={layaways}
          supplierInvoices={supplierInvoices}
          range={reportRange}
          onRangeChange={setReportRange}
        />
      )}

      {tab === 'traceability' && (
        <FinancialTraceabilityPanel
          company={company}
          accounts={financialAccounts}
          movements={financialMovements}
          contacts={contacts}
          invoices={invoices}
          purchases={purchaseInvoices}
          expenses={expenses}
          layaways={layaways}
          dateFrom={reportRange.from}
          dateTo={reportRange.to}
          rangeLabel={rangeLabel}
          initialComposition={searchParams.get('composition')}
        />
      )}

      {tab === 'credits' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><WalletCards className="h-4 w-4 text-primary" /> Saldos a favor de clientes</h2>
              <p className="text-xs text-muted-foreground">Fuente única: FinancialMovement</p>
            </div>
            <div className="flex gap-2"><PdfDocumentActions document={buildCustomerCreditsDocument} label="PDF" /><ExcelDocumentActions document={buildCustomerCreditsDocument} /></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">Crédito creado</p><p className="mt-1 text-2xl font-bold">{formatCurrency(customerCreditTotals.created)}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">Saldo utilizado</p><p className="mt-1 text-2xl font-bold text-warning">{formatCurrency(customerCreditTotals.used)}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">Saldo disponible</p><p className="mt-1 text-2xl font-bold text-success">{formatCurrency(customerCreditTotals.available)}</p></div>
          </div>

          {customerCreditAuditIssues.length > 0 && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Auditoría de créditos</p>
              <div className="mt-2 space-y-1 text-sm">{customerCreditAuditIssues.map(issue => <p key={issue.id}>{issue.detail}</p>)}</div>
            </div>
          )}

          <div className="space-y-3">
            {customerCreditSummaries.map(summary => (
              <div key={summary.customerId} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold">{summary.customerName}</p><p className="font-mono text-xs text-muted-foreground">{summary.customerId}</p></div>
                  <div className="text-right"><p className="text-xs uppercase text-muted-foreground">Disponible</p><p className="text-xl font-bold text-success">{formatCurrency(summary.available)}</p></div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Origen del crédito</p>
                    <div className="space-y-2">{summary.sources.map(source => (
                      <div key={source.movementId} className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-sm">
                        <div className="flex justify-between gap-3"><span>{source.originDocument}</span><span className="font-semibold">{formatCurrency(source.amount)}</span></div>
                        <p className="text-xs text-muted-foreground">Creado: {source.createdAt} · Usuario: {source.userName}</p>
                        <p className="text-xs text-muted-foreground">Utilizado: {formatCurrency(source.used)} · Restante: {formatCurrency(source.available)}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">MovementId: {source.movementId}</p>
                      </div>
                    ))}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Historial de utilización</p>
                    <div className="space-y-2">{summary.usages.map(usage => (
                      <div key={usage.movementId} className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-sm">
                        <div className="flex justify-between gap-3"><span>{usage.destinationDocument}</span><span className="font-semibold text-warning">− {formatCurrency(usage.amount)}</span></div>
                        <p className="text-xs text-muted-foreground">Fecha: {usage.createdAt} · Usuario: {usage.userName}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">MovementId: {usage.movementId} · Related: {usage.sourceMovementId}</p>
                      </div>
                    ))}{summary.usages.length === 0 && <p className="text-sm text-muted-foreground">Este saldo todavía no ha sido utilizado.</p>}</div>
                  </div>
                </div>
              </div>
            ))}
            {customerCreditSummaries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen saldos a favor registrados.</p>}
          </div>
        </div>
      )}

      {/* MOVEMENTS */}
      {tab === 'movements' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold flex items-center gap-2"><ArrowDownUp className="h-4 w-4 text-primary" /> Movimientos</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildMovementsDocument} label="PDF" /><ExcelDocumentActions document={buildMovementsDocument} /></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Ingresos</p><p className="text-2xl font-bold text-success mt-1">{formatCurrency(totalIncome)}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Egresos</p><p className="text-2xl font-bold text-destructive mt-1">{formatCurrency(totalExpense)}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Neto</p><p className={`text-2xl font-bold mt-1 ${totalIncome - totalExpense >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(totalIncome - totalExpense)}</p></div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Cliente / Proveedor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">F. Pago</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Ingreso</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Egreso</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{m.date}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          m.type === 'Venta' ? 'bg-success/10 text-success' :
                          m.type === 'Abono' ? 'bg-primary/10 text-primary' :
                          m.type === 'Pago Proveedor' ? 'bg-warning/10 text-warning' :
                          'bg-destructive/10 text-destructive'
                        }`}>{m.type}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-primary">{m.number}</td>
                      <td className="px-4 py-2.5 font-medium">{m.entity}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.paymentMethod}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-success">{m.income > 0 ? formatCurrency(m.income) : ''}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-destructive">{m.expense > 0 ? formatCurrency(m.expense) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-secondary/50 font-semibold">
                    <td className="px-4 py-3" colSpan={5}>Totales</td>
                    <td className="px-4 py-3 text-right text-success">{formatCurrency(totalIncome)}</td>
                    <td className="px-4 py-3 text-right text-destructive">{formatCurrency(totalExpense)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {movements.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No hay movimientos en este período</p>}
          </div>
        </div>
      )}

      {/* MONTHLY */}
      {tab === 'monthly' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="flex items-center gap-2 break-words font-semibold"><TrendingUp className="h-4 w-4 shrink-0 text-primary" /> Cuadre del período</h2><p className="break-words text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex flex-wrap gap-2">
              <PdfDocumentActions document={buildMonthlyDocument} label="Resumen del período PDF" /><ExcelDocumentActions document={buildMonthlyDocument} label="Resumen del período Excel" />
              <PdfDocumentActions document={buildSalesDocument} label="Ventas PDF" formats={['letter']} /><ExcelDocumentActions document={buildSalesDocument} label="Ventas Excel" />
              <PdfDocumentActions document={buildPurchasesDocument} label="Compras PDF" formats={['letter']} /><ExcelDocumentActions document={buildPurchasesDocument} label="Compras Excel" />
              <PdfDocumentActions document={buildExpensesDocument} label="Gastos PDF" formats={['letter']} /><ExcelDocumentActions document={buildExpensesDocument} label="Gastos Excel" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Ventas</p><p className="text-2xl font-bold gold-text mt-1">{formatCurrency(monthSalesTotal)}</p><p className="text-xs text-muted-foreground">{distinctDocuments(monthSalesRows)} documentos</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Compras</p><p className="text-2xl font-bold mt-1">{formatCurrency(monthPurchaseTotal)}</p><p className="text-xs text-muted-foreground">{distinctDocuments(monthPurchaseRows)} documentos</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Gastos</p><p className="text-2xl font-bold text-destructive mt-1">{formatCurrency(monthExpenseTotal)}</p><p className="text-xs text-muted-foreground">{distinctDocuments(monthExpenseRows)} documentos</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Pagos Proveedores</p><p className="text-2xl font-bold text-warning mt-1">{formatCurrency(monthSupplierPaymentTotal)}</p><p className="text-xs text-muted-foreground">{distinctDocuments(monthSupplierRows)} pagos</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Neto</p><p className={`text-2xl font-bold mt-1 ${monthLedgerResult >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(monthLedgerResult)}</p></div>
          </div>
        </div>
      )}

      {/* PROFIT */}
      {tab === 'profit' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 break-words font-semibold"><DollarSign className="h-4 w-4 shrink-0 text-primary" /> Resultado Financiero Trazable</h2>
            <div className="flex shrink-0 flex-wrap gap-2">
              <PdfDocumentActions document={buildProfitDocument} label="PDF" /><ExcelDocumentActions document={buildProfitDocument} />
            </div>
          </div>
          <div className="max-w-lg rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ventas netas</span><span className="font-medium">{formatCurrency(totalSalesRevenue)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">(-) Salidas financieras</span><span className="text-destructive">{formatCurrency(totalFinancialOutflow)}</span></div>
            <div className="flex justify-between text-lg font-bold border-t border-border pt-3"><span>Resultado Ledger</span><span className={ledgerResult >= 0 ? 'text-success' : 'text-destructive'}>{formatCurrency(ledgerResult)}</span></div>
          </div>
        </div>
      )}

      {/* LAYAWAYS */}
      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="break-words font-semibold">Estado de Caja y Bancos</h2><div className="flex shrink-0 flex-wrap gap-2"><PdfDocumentActions document={buildAccountsDocument} label="PDF Bancos" /><ExcelDocumentActions document={buildAccountsDocument} /></div></div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-xs uppercase text-muted-foreground">Bancos</p><p className="text-2xl font-bold">{formatCurrency(financialCompositions.banks.total)}</p></div>
              <p className="text-xs text-muted-foreground">Total consolidado</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border"><th className="px-2 py-2 text-left">Banco</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2 text-right">Fondos de separados</th></tr></thead>
                <tbody>
                  {bankDetails.map(account => <tr key={account.accountId} className="border-b border-border/50 last:border-0"><td className="px-2 py-2">{account.name}</td><td className="px-2 py-2 text-right font-semibold">{formatCurrency(account.balance)}</td><td className="px-2 py-2 text-right font-semibold text-warning">{formatCurrency(layawayBankFundsByAccount.get(account.accountId) || 0)}</td></tr>)}
                  <tr className="border-t border-border"><td className="px-2 py-2 font-bold">Total</td><td className="px-2 py-2 text-right font-bold">{formatCurrency(financialCompositions.banks.total)}</td><td className="px-2 py-2 text-right font-bold text-warning">{formatCurrency(layawayBankFunds.total)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Caja Principal</p><p className="text-2xl font-bold">{formatCurrency(financialCompositions.mainCash.total)}</p><p className="text-xs text-muted-foreground">Reconstruido desde Ledger</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Caja Separados</p><p className="text-2xl font-bold">{formatCurrency(financialCompositions.layawayReserve.total)}</p><p className="text-xs text-muted-foreground">Dinero reservado</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Bancos</p><p className="text-2xl font-bold">{formatCurrency(financialCompositions.banks.total)}</p><p className="text-xs text-muted-foreground">Consolidado desde Ledger</p></div>
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4"><p className="text-xs uppercase text-muted-foreground">Fondos bancarios de separados</p><p className="text-2xl font-bold text-warning">{formatCurrency(layawayBankFunds.total)}</p><p className="text-xs text-muted-foreground">Informativo · No corresponde a ventas realizadas</p></div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="text-xs uppercase text-muted-foreground">Total Disponible</p><p className="text-2xl font-bold gold-text">{formatCurrency(financialCompositions.totalAvailable.total)}</p><p className="text-xs text-muted-foreground">Caja Principal + Bancos</p></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[620px] text-sm"><thead><tr className="bg-secondary/50 border-b border-border"><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Tipo</th><th className="px-3 py-2 text-left">Referencia</th><th className="px-3 py-2 text-right">Monto</th></tr></thead><tbody>
              {periodLedgerRows.slice(0, 200).map(row => <tr key={row.movementId} className="border-b border-border/50"><td className="px-3 py-2">{row.date} {row.time}</td><td className="px-3 py-2">{row.code}</td><td className="px-3 py-2">{row.document}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.value)}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      )}

      {tab === 'payables' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold">Pagos a Proveedores</h2><p className="break-words text-xs text-muted-foreground">Historial explicado por movimientos SUPPLIER_PAYMENT.</p></div><div className="flex shrink-0 flex-wrap gap-2"><PdfDocumentActions document={buildPayablesDocument} label="PDF" /><ExcelDocumentActions document={buildPayablesDocument} /></div></div>
          <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">Total pagado</p><p className="text-2xl font-bold text-warning">{formatCurrency(totalSupplierPaymentsAll)}</p><p className="text-xs text-muted-foreground">{supplierPaymentRows.length} movimientos trazables</p></div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead><tr className="border-b border-border bg-secondary/50"><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Documento</th><th className="px-3 py-2 text-left">Proveedor</th><th className="px-3 py-2 text-left">Cuenta</th><th className="px-3 py-2 text-right">Valor</th></tr></thead><tbody>{supplierPaymentRows.map(row => <tr key={row.movementId} className="border-b border-border/50"><td className="px-3 py-2">{row.date} {row.time}</td><td className="px-3 py-2">{row.document}</td><td className="px-3 py-2">{row.supplier || '—'}</td><td className="px-3 py-2">{row.cashOrigin || row.bankOrigin || 'Externo'}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.value)}</td></tr>)}</tbody></table>{supplierPaymentRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen pagos a proveedores en el ledger.</p>}</div>
        </div>
      )}

      {tab === 'layaways' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">Separados y abonos</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildLayawaysDocument} label="PDF" /><ExcelDocumentActions document={buildLayawaysDocument} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Relacionados</p><p className="text-2xl font-bold mt-1">{layawaysInPeriod.length}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Activos</p><p className="text-2xl font-bold mt-1">{activeLayaways.length}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Abonos del período</p><p className="text-2xl font-bold text-success mt-1">{formatCurrency(totalLayawayPaymentsInPeriod)}</p></div>
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground uppercase">Pendiente actual</p><p className="text-2xl font-bold text-warning mt-1">{formatCurrency(Math.max(0, totalLayawayValue - totalLayawayPaidToDate))}</p></div>
          </div>
          {layawaysInPeriod.map(layaway => {
            const paidToDate = layaway.payments.reduce((sum, payment) => sum + payment.amount, 0);
            const paidInPeriod = layawayPaymentRows.filter(row => row.referenceId === layaway.id).reduce((sum, row) => sum + row.value, 0);
            return (
              <div key={layaway.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div><p className="font-medium">{layaway.invoice.clientName}</p><p className="text-xs text-muted-foreground">{layaway.invoice.number} · {layaway.completed ? 'Completado' : 'Activo'}</p></div>
                  <div className="text-right"><p className="font-bold">{formatCurrency(layaway.invoice.total)}</p><p className="text-xs text-muted-foreground">Abonado acumulado: {formatCurrency(paidToDate)} · En el período: <span className="text-success">{formatCurrency(paidInPeriod)}</span></p></div>
                </div>
              </div>
            );
          })}
          {layawaysInPeriod.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No existen separados ni abonos relacionados con el período.</p>}
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary" /> Clientes por ventas</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildCustomersDocument} label="PDF" /><ExcelDocumentActions document={buildCustomersDocument} /></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50"><tr><th className="px-3 py-2 text-left">Cliente</th><th className="px-3 py-2 text-center">Facturas</th><th className="px-3 py-2 text-right">Total comprado</th><th className="px-3 py-2 text-left">Primera venta</th><th className="px-3 py-2 text-left">Última venta</th></tr></thead>
              <tbody>{customerRows.map(row => <tr key={row.id} className="border-t border-border/60"><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-center">{row.invoiceCount}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.total)}</td><td className="px-3 py-2 text-muted-foreground">{row.firstSale}</td><td className="px-3 py-2 text-muted-foreground">{row.lastSale}</td></tr>)}</tbody>
            </table>
            {customerRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen clientes con ventas en este período.</p>}
          </div>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-primary" /> Compras por proveedor</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildSuppliersDocument} label="PDF" /><ExcelDocumentActions document={buildSuppliersDocument} /></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50"><tr><th className="px-3 py-2 text-left">Proveedor</th><th className="px-3 py-2 text-center">Facturas</th><th className="px-3 py-2 text-right">Gramos</th><th className="px-3 py-2 text-right">Total invertido</th><th className="px-3 py-2 text-left">Primera compra</th><th className="px-3 py-2 text-left">Última compra</th></tr></thead>
              <tbody>{supplierRows.map(row => <tr key={row.id} className="border-t border-border/60"><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-center">{row.invoiceCount}</td><td className="px-3 py-2 text-right">{formatWeight(row.grams)} g</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.total)}</td><td className="px-3 py-2 text-muted-foreground">{row.firstPurchase}</td><td className="px-3 py-2 text-muted-foreground">{row.lastPurchase}</td></tr>)}</tbody>
            </table>
            {supplierRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen compras de proveedores en este período.</p>}
          </div>
        </div>
      )}

      {tab === 'productsSold' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><ShoppingBag className="h-4 w-4 text-primary" /> Productos vendidos</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildProductsSoldDocument} label="PDF" /><ExcelDocumentActions document={buildProductsSoldDocument} /></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50"><tr><th className="px-3 py-2 text-left">Código</th><th className="px-3 py-2 text-left">Producto</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Gramos</th><th className="px-3 py-2 text-right">Valor vendido</th></tr></thead>
              <tbody>{productsSoldRows.map(row => <tr key={row.productId} className="border-t border-border/60"><td className="px-3 py-2 font-mono text-xs text-primary">{row.code}</td><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-right">{row.quantitySold}</td><td className="px-3 py-2 text-right">{formatWeight(row.gramsSold)} g</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(row.totalSold)}</td></tr>)}</tbody>
            </table>
            {productsSoldRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen productos vendidos en este período.</p>}
          </div>
        </div>
      )}

      {tab === 'ownerWithdrawals' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><HandCoins className="h-4 w-4 text-primary" /> Retiros del propietario</h2><p className="text-xs text-muted-foreground">{rangeLabel}</p></div>
            <div className="flex gap-2"><PdfDocumentActions document={buildOwnerWithdrawalsDocument} label="PDF" /><ExcelDocumentActions document={buildOwnerWithdrawalsDocument} /></div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs uppercase text-muted-foreground">Retiros netos del período</p><p className="mt-1 text-2xl font-bold text-warning">{formatCurrency(ownerWithdrawalsTotal)}</p><p className="text-xs text-muted-foreground">{ownerWithdrawalRows.length} movimientos trazables</p></div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50"><tr><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Documento</th><th className="px-3 py-2 text-left">Concepto</th><th className="px-3 py-2 text-left">Usuario</th><th className="px-3 py-2 text-left">Estado</th><th className="px-3 py-2 text-right">Valor</th></tr></thead>
              <tbody>{ownerWithdrawalRows.map(row => {
                const cancellation = row.movement.documentType === 'owner_withdrawal_cancellation';
                return <tr key={row.movementId} className="border-t border-border/60"><td className="px-3 py-2">{row.date} {row.time}</td><td className="px-3 py-2 font-mono text-xs">{row.document}</td><td className="px-3 py-2">{row.concept}</td><td className="px-3 py-2">{row.user}</td><td className="px-3 py-2">{cancellation ? 'Anulación' : row.status}</td><td className={`px-3 py-2 text-right font-semibold ${cancellation ? 'text-success' : 'text-warning'}`}>{cancellation ? '−' : ''}{formatCurrency(row.value)}</td></tr>;
              })}</tbody>
            </table>
            {ownerWithdrawalRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No existen retiros del propietario en este período.</p>}
          </div>
        </div>
      )}

      {/* INVENTORY */}
      {tab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 break-words font-semibold"><Package className="h-4 w-4 shrink-0 text-primary" /> Inventario Valorizado</h2>
            <div className="flex shrink-0 flex-wrap gap-2">
              <PdfDocumentActions document={buildInventoryDocument} label="PDF" /><ExcelDocumentActions document={buildInventoryDocument} />
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] text-muted-foreground uppercase">Productos</p><p className="text-xl font-bold mt-1">{products.length}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] text-muted-foreground uppercase">Total Gramos</p><p className="text-xl font-bold mt-1">{formatWeight(totalGrams)} g</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] text-muted-foreground uppercase">Valor Compra</p><p className="text-xl font-bold mt-1">{formatCurrency(totalPurchaseValue)}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] text-muted-foreground uppercase">Valor Venta</p><p className="text-xl font-bold gold-text mt-1">{formatCurrency(totalSaleValue)}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] text-muted-foreground uppercase">Ganancia Proyectada</p><p className="text-xl font-bold text-success mt-1">{formatCurrency(totalProjectedProfit)}</p></div>
          </div>

          {/* Inventory Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Código</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Producto</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Categoría</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Peso Unitario</th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground">Existencia</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Peso Disponible</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Precio Compra</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Precio Venta</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Utilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => {
                    const totalWeight = getInventoryWeight(p);
                    const purchaseTotal = p.purchasePrice * p.stock;
                    const saleTotal = p.salePrice * p.stock;
                    const profit = saleTotal - purchaseTotal;
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs text-primary">{p.code}</td>
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.category}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{formatWeight(p.weightGrams)}</td>
                        <td className={`px-3 py-2 text-center font-medium ${p.stock <= p.minStock ? 'text-destructive' : ''}`}>{isSoldByWeight(p) ? formatWeight(p.stock) : p.stock}</td>
                        <td className="px-3 py-2 text-right">{formatWeight(totalWeight)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(purchaseTotal)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(saleTotal)}</td>
                        <td className="px-3 py-2 text-right font-medium text-success">{formatCurrency(profit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-secondary/50 font-semibold text-sm">
                    <td className="px-3 py-3" colSpan={3}>Totales</td>
                    <td className="px-3 py-3 text-right"></td>
                    <td className="px-3 py-3 text-center">{formatWeight(products.reduce((s, p) => s + p.stock, 0))}</td>
                    <td className="px-3 py-3 text-right">{formatWeight(totalGrams)} g</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(totalPurchaseValue)}</td>
                    <td className="px-3 py-3 text-right gold-text">{formatCurrency(totalSaleValue)}</td>
                    <td className="px-3 py-3 text-right text-success">{formatCurrency(totalProjectedProfit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
