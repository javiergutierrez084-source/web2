import type {
  Contact,
  ExpenseInvoice,
  FinancialMovement,
  FinancialSummary,
  Invoice,
  Product,
  PurchaseInvoice,
} from '@/data/mockData';
import { getProductAveragePurchasePrice, isSoldByWeight } from '@/data/mockData';
import type { SupplierInvoiceView } from '@/domain/models';
import type { DashboardSnapshot } from '@/lib/DashboardMetricsService';
import { isSalesInvoice, isValidExpense, isValidPurchase } from '@/lib/DashboardMetricsService';
import type { LayawayAlertSummary } from '@/lib/LayawayAlertService';
import { MAIN_CASH_ACCOUNT_ID } from '@/lib/FinancialPositionService';

export interface DashboardChartDatum {
  label: string;
  value: number;
  secondary?: number;
  count?: number;
}

export interface DashboardVisualMetrics {
  salesWeek: { value: number; count: number };
  ticketAverage: number;
  invoicesMonth: number;
  productsSoldMonth: number;
  profitToday: number;
  profitWeek: number;
  profitMonth: number;
  lowStock: number;
  outOfStock: number;
  leastSoldProduct: { name: string; quantity: number } | null;
  frequentCustomers: number;
  topCustomer: { name: string; value: number } | null;
  accountsPayable: number;
  overdueSupplierInvoices: number;
  expensesMonth: number;
  cashFlowToday: number;
  incomeExpenseBalanceMonth: number;
  profitabilityMonth: number;
  capitalAvailable: number;
  layaways: LayawayAlertSummary;
  charts: {
    salesMonth: DashboardChartDatum[];
    profitMonth: DashboardChartDatum[];
    paymentMethods: DashboardChartDatum[];
    clientsTop: DashboardChartDatum[];
    productsTop: DashboardChartDatum[];
    categoriesTop: DashboardChartDatum[];
    purchasesVsSales: DashboardChartDatum[];
    incomeVsExpenses: DashboardChartDatum[];
    cashEvolution: DashboardChartDatum[];
  };
}

export interface DashboardVisualMetricsInput {
  now: Date;
  snapshot: DashboardSnapshot;
  products: readonly Product[];
  contacts: readonly Contact[];
  invoices: readonly Invoice[];
  purchases: readonly PurchaseInvoice[];
  expenses: readonly ExpenseInvoice[];
  movements: readonly FinancialMovement[];
  financialSummary: FinancialSummary | null;
  supplierInvoices: readonly SupplierInvoiceView[];
  layawaySummary: LayawayAlertSummary;
}

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfWeekKey = (date: Date): string => {
  const value = new Date(date);
  value.setHours(12, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return localDateKey(value);
};

const monthKey = (date: Date): string => localDateKey(date).slice(0, 7);

const dateInRange = (value: string, from: string, to: string): boolean => value >= from && value <= to;

const validSales = (invoices: readonly Invoice[]): Invoice[] => invoices.filter(isSalesInvoice);

const invoiceCost = (invoice: Invoice, productById: Map<string, Product>): number =>
  invoice.items.reduce((sum, item) => {
    const product = productById.get(item.productId);
    const unitCost = Number(item.costPrice ?? (product ? getProductAveragePurchasePrice(product) : 0));
    return sum + (Number.isFinite(unitCost) ? unitCost * Number(item.quantity || 0) : 0);
  }, 0);

const profitForRange = (
  invoices: readonly Invoice[],
  expenses: readonly ExpenseInvoice[],
  productById: Map<string, Product>,
  from: string,
  to: string,
): number => {
  const matchingSales = validSales(invoices).filter(invoice => dateInRange(invoice.date, from, to));
  const sales = matchingSales.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const costs = matchingSales.reduce((sum, invoice) => sum + invoiceCost(invoice, productById), 0);
  const operatingExpenses = expenses
    .filter(expense => isValidExpense(expense) && dateInRange(expense.date, from, to))
    .reduce((sum, expense) => sum + Number(expense.total || 0), 0);
  return sales - costs - operatingExpenses;
};

const lastMonthKeys = (now: Date, total = 12): string[] => {
  const result: string[] = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1, 12);
    result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
};

const monthLabel = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', { month: 'short', year: '2-digit' })
    .format(new Date(year, month - 1, 1, 12))
    .replace('.', '');
};

const lastDayKeys = (now: Date, total = 30): string[] => {
  const result: string[] = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    result.push(localDateKey(date));
  }
  return result;
};

const sumInvoiceItems = (invoices: readonly Invoice[]): Map<string, { name: string; quantity: number; value: number }> => {
  const result = new Map<string, { name: string; quantity: number; value: number }>();
  validSales(invoices).forEach(invoice => invoice.items.forEach(item => {
    const current = result.get(item.productId) || { name: item.name, quantity: 0, value: 0 };
    current.quantity += Number(item.quantity || 0);
    current.value += Number(item.subtotal || 0);
    result.set(item.productId, current);
  }));
  return result;
};

const mainCashMovementDelta = (movement: FinancialMovement): number => {
  const amount = Number(movement.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const enters = movement.destinationAccountId === MAIN_CASH_ACCOUNT_ID;
  const leaves = movement.originAccountId === MAIN_CASH_ACCOUNT_ID;
  if (enters && leaves) return 0;
  if (enters) return amount;
  if (leaves) return -amount;
  return 0;
};

export function buildDashboardVisualMetrics(input: DashboardVisualMetricsInput): DashboardVisualMetrics {
  const today = localDateKey(input.now);
  const weekStart = startOfWeekKey(input.now);
  const currentMonth = monthKey(input.now);
  const monthStart = `${currentMonth}-01`;
  const productById = new Map(input.products.map(product => [product.id, product]));
  const sales = validSales(input.invoices);
  const salesWeekRows = sales.filter(invoice => dateInRange(invoice.date, weekStart, today));
  const salesMonthRows = sales.filter(invoice => invoice.date.startsWith(currentMonth));
  const expensesMonth = input.expenses
    .filter(expense => isValidExpense(expense) && expense.date.startsWith(currentMonth))
    .reduce((sum, expense) => sum + Number(expense.total || 0), 0);

  const productSales = sumInvoiceItems(input.invoices);
  const soldProducts = Array.from(productSales.values()).filter(item => item.quantity > 0);
  const leastSoldProduct = soldProducts.length > 0
    ? [...soldProducts].sort((left, right) => left.quantity - right.quantity)[0]
    : null;

  const salesByCustomer = new Map<string, { name: string; value: number; count: number }>();
  sales.forEach(invoice => {
    const id = invoice.clientId || `name:${invoice.clientName}`;
    const current = salesByCustomer.get(id) || { name: invoice.clientName || 'Consumidor final', value: 0, count: 0 };
    current.value += Number(invoice.total || 0);
    current.count += 1;
    salesByCustomer.set(id, current);
  });
  const customerRows = Array.from(salesByCustomer.values()).sort((left, right) => right.value - left.value);

  const monthKeys = lastMonthKeys(input.now);
  const salesByMonth = new Map(monthKeys.map(key => [key, 0]));
  const purchasesByMonth = new Map(monthKeys.map(key => [key, 0]));
  const expensesByMonth = new Map(monthKeys.map(key => [key, 0]));
  const profitByMonth = new Map(monthKeys.map(key => [key, 0]));
  sales.forEach(invoice => {
    const key = invoice.date.slice(0, 7);
    if (!salesByMonth.has(key)) return;
    salesByMonth.set(key, (salesByMonth.get(key) || 0) + Number(invoice.total || 0));
    profitByMonth.set(key, (profitByMonth.get(key) || 0) + Number(invoice.total || 0) - invoiceCost(invoice, productById));
  });
  input.purchases.filter(isValidPurchase).forEach(purchase => {
    const key = purchase.date.slice(0, 7);
    if (purchasesByMonth.has(key)) purchasesByMonth.set(key, (purchasesByMonth.get(key) || 0) + Number(purchase.total || 0));
  });
  input.expenses.filter(isValidExpense).forEach(expense => {
    const key = expense.date.slice(0, 7);
    if (!expensesByMonth.has(key)) return;
    const amount = Number(expense.total || 0);
    expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + amount);
    profitByMonth.set(key, (profitByMonth.get(key) || 0) - amount);
  });

  const paymentMethods = new Map<string, number>();
  sales.forEach(invoice => {
    const label = String(invoice.paymentMethod || 'No registrado').trim() || 'No registrado';
    paymentMethods.set(label, (paymentMethods.get(label) || 0) + Number(invoice.total || 0));
  });

  const categoryByProductId = new Map(input.products.map(product => [product.id, product.category || 'Sin categoría']));
  const categorySales = new Map<string, number>();
  sales.forEach(invoice => invoice.items.forEach(item => {
    const category = categoryByProductId.get(item.productId) || 'Sin categoría';
    categorySales.set(category, (categorySales.get(category) || 0) + Number(item.subtotal || 0));
  }));

  const dayKeys = lastDayKeys(input.now);
  const deltaByDate = new Map(dayKeys.map(key => [key, 0]));
  input.movements.forEach(movement => {
    const key = String(movement.date || '').slice(0, 10);
    if (deltaByDate.has(key)) deltaByDate.set(key, (deltaByDate.get(key) || 0) + mainCashMovementDelta(movement));
  });
  let runningCash = Number(input.snapshot.financialPosition.mainCash || 0);
  const reverseValues = new Map<string, number>();
  [...dayKeys].reverse().forEach(key => {
    reverseValues.set(key, runningCash);
    runningCash -= deltaByDate.get(key) || 0;
  });

  const profitToday = profitForRange(input.invoices, input.expenses, productById, today, today);
  const profitWeek = profitForRange(input.invoices, input.expenses, productById, weekStart, today);
  const profitMonth = profitForRange(input.invoices, input.expenses, productById, monthStart, today);
  const salesMonthValue = salesMonthRows.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const accountsPayable = input.supplierInvoices
    .filter(invoice => invoice.status !== 'cancelled')
    .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.pendingBalance || 0)), 0);
  const overdueSupplierInvoices = input.supplierInvoices.filter(invoice => (
    invoice.status !== 'cancelled' && invoice.status !== 'paid' && invoice.pendingBalance > 0 && invoice.dueDate < today
  )).length;

  return {
    salesWeek: {
      value: salesWeekRows.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      count: salesWeekRows.length,
    },
    ticketAverage: salesMonthRows.length > 0 ? salesMonthValue / salesMonthRows.length : 0,
    invoicesMonth: salesMonthRows.length,
    productsSoldMonth: salesMonthRows.reduce((sum, invoice) => sum + invoice.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0),
    profitToday,
    profitWeek,
    profitMonth,
    lowStock: input.products.filter(product => product.stock > 0 && product.stock <= product.minStock).length,
    outOfStock: input.products.filter(product => product.stock <= 0).length,
    leastSoldProduct,
    frequentCustomers: customerRows.filter(customer => customer.count >= 2).length,
    topCustomer: customerRows[0] || null,
    accountsPayable,
    overdueSupplierInvoices,
    expensesMonth,
    cashFlowToday: Number(input.financialSummary?.incomeToday || 0) - Number(input.financialSummary?.expensesToday || 0),
    incomeExpenseBalanceMonth: salesMonthValue - expensesMonth,
    profitabilityMonth: salesMonthValue > 0 ? (profitMonth / salesMonthValue) * 100 : 0,
    capitalAvailable: Number(input.snapshot.financialPosition.totalAvailable || 0),
    layaways: input.layawaySummary,
    charts: {
      salesMonth: monthKeys.map(key => ({ label: monthLabel(key), value: salesByMonth.get(key) || 0 })),
      profitMonth: monthKeys.map(key => ({ label: monthLabel(key), value: profitByMonth.get(key) || 0 })),
      paymentMethods: Array.from(paymentMethods.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })),
      clientsTop: customerRows.slice(0, 10).map(customer => ({ label: customer.name, value: customer.value, count: customer.count })),
      productsTop: Array.from(productSales.values()).sort((a, b) => b.value - a.value).slice(0, 10).map(product => ({ label: product.name, value: product.value, count: product.quantity })),
      categoriesTop: Array.from(categorySales.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })),
      purchasesVsSales: monthKeys.map(key => ({ label: monthLabel(key), value: salesByMonth.get(key) || 0, secondary: purchasesByMonth.get(key) || 0 })),
      incomeVsExpenses: monthKeys.map(key => ({ label: monthLabel(key), value: salesByMonth.get(key) || 0, secondary: expensesByMonth.get(key) || 0 })),
      cashEvolution: dayKeys.map(key => ({ label: key.slice(5), value: reverseValues.get(key) || 0 })),
    },
  };
}
