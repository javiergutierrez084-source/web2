import type {
  Contact,
  ExpenseInvoice,
  FinancialAccount,
  FinancialMovement,
  FinancialSummary,
  InventoryAdjustment,
  InventoryAdjustmentInput,
  Invoice,
  PaymentAllocation,
  Product,
  PurchaseInvoice,
  Quotation,
} from '@/data/mockData';
import type {
  ActivityLogRecord,
  BulkImportProductRecord,
  CashSession,
  CategoryRecord,
  CompanyInfo,
  ContactChangeSet,
  InvoiceCancellationResult,
  InvoiceFinancialTransactionOptions,
  Layaway,
  LayawayCancellationResolution,
  LayawayDeleteResult,
  LayawayPaymentResult,
  LayawayPaymentsById,
  LayawayUpdateResult,
  ProductChangeSet,
  SupplierInvoiceCreateInput,
  SupplierInvoiceCreateResult,
  SupplierInvoicePaymentInput,
  SupplierInvoicePaymentResult,
  SupplierInvoiceUpdateInput,
  SupplierInvoiceView,
  SupplierPaymentReportRow,
} from '@/domain/models';
import type { DashboardSnapshot } from '@/lib/DashboardMetricsService';
import type { SalesQuery, SalesWorkspace } from '@/lib/SalesRepositoryService';
import type {
  OwnerFinanceFilters,
  OwnerFinanceSettings,
  OwnerFinanceWorkspace,
  OwnerWithdrawal,
  OwnerWithdrawalConcept,
} from '@/lib/OwnerFinanceService';

export interface LanPagedResult<T> {
  items: T[];
  total: number;
  page: 1;
  pageSize: number;
}

/**
 * Existing Repository operations exposed through the single LAN transport:
 * POST /repository/call.
 *
 * This contract contains no URL, socket, database or synchronization logic.
 */
export interface LanRepositoryArgs {
  getProducts: Record<string, never>;
  searchProducts: { text: string };
  getProductById: { id: string };
  getCategories: Record<string, never>;
  getDashboardMetrics: Record<string, never>;
  getSalesWorkspace: Record<string, never>;
  getSalesClients: Record<string, never>;
  searchSalesClients: { text: string };
  getSalesClientById: { id: string };
  createSalesClient: { client: Contact };
  updateSalesClient: { client: Contact };
  deleteSalesClient: { id: string };
  querySales: { query: SalesQuery };
  getSaleById: { id: string };
  createSale: {
    invoice: Invoice;
    allocations: PaymentAllocation[];
    options: InvoiceFinancialTransactionOptions;
  };
  updateSaleStatus: { id: string; status: string };
  cancelSale: { id: string; reason: string };
  applySalesContactChanges: { changes: ContactChangeSet<Contact> };
  createSalesQuotation: { input: Omit<Quotation, 'id' | 'number'> };
  updateSalesQuotationStatus: { id: string; status: Quotation['status'] };
  createSalesLayaway: { layaway: Layaway };
  updateSalesLayaway: { layawayId: string; invoice: Invoice };
  deleteSalesLayaway: { layawayId: string; resolution?: LayawayCancellationResolution };
  addSalesLayawayPayment: {
    layawayId: string;
    payment: { amount: number; date: string; method: string; accountId?: string };
  };
  completeSalesLayaway: { layawayId: string; completedDate: string };


  createUser: { username: string; displayName: string; password: string; role: string };
  changePassword: { userId: string; currentPassword: string; newPassword: string };
  logActivity: { session: unknown; action: string; entity: string; entityId: string; detail?: string };
  fetchUsers: Record<string, never>;
  updateUser: { userId: string; changes: Record<string, unknown> };

  fetchCompany: Record<string, never>;
  saveCompany: { company: CompanyInfo };
  upsertProduct: { product: Product };
  deleteProduct: { id: string };
  applyProductChanges: { changes: ProductChangeSet };
  fetchContacts: Record<string, never>;
  insertInvoice: { invoice: Invoice };
  upsertContact: { contact: Contact };
  deleteContact: { id: string };
  applyContactChanges: { changes: ContactChangeSet<Contact> };
  fetchPurchaseInvoices: Record<string, never>;
  createPurchaseWithInventory: { purchase: PurchaseInvoice; accountId?: string };
  updatePurchaseWithInventory: { purchase: PurchaseInvoice };
  deletePurchaseWithInventory: { id: string };
  markPurchaseAsPaid: { id: string; accountId: string };
  fetchExpenses: Record<string, never>;
  insertExpense: { expense: ExpenseInvoice };
  insertExpenseWithFinancials: { expense: ExpenseInvoice; accountId: string };
  updateExpenseWithFinancialAdjustment: { expense: ExpenseInvoice };
  fetchLayawayPayments: { layawayIds?: string[] };
  fetchCashSessions: Record<string, never>;
  insertCashSession: { session: CashSession };
  closeCashSession: { id: string; closedAt: string; closedBy: string; observations: string };
  fetchInventoryAdjustments: Record<string, never>;
  applyInventoryAdjustment: { input: InventoryAdjustmentInput };
  fetchSupplierInvoices: Record<string, never>;
  insertSupplierInvoice: { input: SupplierInvoiceCreateInput };
  addSupplierInvoicePayment: { supplierInvoiceId: string; payment: SupplierInvoicePaymentInput };
  updateSupplierInvoiceStatus: { id: string; status: string };
  updateSupplierInvoiceSafe: { id: string; input: SupplierInvoiceUpdateInput };
  deleteSupplierInvoiceSafe: { id: string };
  fetchSupplierPaymentsForReports: Record<string, never>;
  ensureDefaultFinancialAccounts: Record<string, never>;
  fetchFinancialAccounts: Record<string, never>;
  createFinancialAccount: {
    input: { name: string; kind: FinancialAccount['kind']; initialBalance?: number };
  };
  transferBetweenAccounts: {
    input: {
      originAccountId: string;
      destinationAccountId: string;
      amount: number;
      date: string;
      observation?: string;
    };
  };
  fetchFinancialMovements: { limit?: number };
  createInventoryPayable: {
    input: {
      adjustmentId: string;
      supplierId: string;
      supplierName: string;
      total: number;
      date: string;
      dueDate?: string;
    };
  };
  postPaidInventoryPurchase: {
    input: {
      adjustmentId: string;
      accountId: string;
      total: number;
      date: string;
      supplierName?: string;
    };
  };
  addSupplierPaymentWithAccount: {
    supplierInvoiceId: string;
    input: { amount: number; date: string; method: string; accountId: string };
  };
  fetchFinancialSummary: Record<string, never>;
  fetchOwnerFinanceWorkspace: { filters?: OwnerFinanceFilters };
  createOwnerWithdrawal: {
    input: {
      withdrawalDate: string;
      conceptId: string;
      amount: number;
      observations: string;
      accountId: string;
      paymentMethod: string;
    };
  };
  cancelOwnerWithdrawal: { withdrawalId: string; reason: string };
  createOwnerWithdrawalConcept: { name: string };
  updateOwnerWithdrawalConcept: {
    conceptId: string;
    changes: { name?: string; active?: boolean };
  };
  saveOwnerFinanceSettings: { settings: OwnerFinanceSettings };
  fetchActivityLog: { limit?: number };
  bulkPutCategories: { categories: CategoryRecord[] };
  findCategoryByKey: { nameKey: string };
  putCategory: { category: CategoryRecord };
  deleteCategory: { id: string };
  bulkPutProducts: { products: BulkImportProductRecord[] };
}

export type LanRepositoryMethod = keyof LanRepositoryArgs;

export interface LanRepositoryResults {
  getProducts: LanPagedResult<Product>;
  searchProducts: LanPagedResult<Product>;
  getProductById: Product | null;
  getCategories: LanPagedResult<CategoryRecord>;
  getDashboardMetrics: DashboardSnapshot;
  getSalesWorkspace: SalesWorkspace;
  getSalesClients: Contact[];
  searchSalesClients: Contact[];
  getSalesClientById: Contact | null;
  createSalesClient: Contact;
  updateSalesClient: Contact;
  deleteSalesClient: void;
  querySales: Invoice[];
  getSaleById: Invoice | null;
  createSale: Product[];
  updateSaleStatus: void;
  cancelSale: InvoiceCancellationResult;
  applySalesContactChanges: void;
  createSalesQuotation: Quotation;
  updateSalesQuotationStatus: void;
  createSalesLayaway: Layaway;
  updateSalesLayaway: LayawayUpdateResult;
  deleteSalesLayaway: LayawayDeleteResult;
  addSalesLayawayPayment: LayawayPaymentResult;
  completeSalesLayaway: string;

  fetchCompany: CompanyInfo;
  saveCompany: void;
  upsertProduct: void;
  deleteProduct: void;
  applyProductChanges: void;
  fetchContacts: Contact[];
  insertInvoice: void;
  upsertContact: void;
  deleteContact: void;
  applyContactChanges: void;
  fetchPurchaseInvoices: PurchaseInvoice[];
  createPurchaseWithInventory: void;
  updatePurchaseWithInventory: void;
  deletePurchaseWithInventory: void;
  markPurchaseAsPaid: void;
  fetchExpenses: ExpenseInvoice[];
  insertExpense: void;
  insertExpenseWithFinancials: void;
  updateExpenseWithFinancialAdjustment: void;
  fetchLayawayPayments: LayawayPaymentsById;
  fetchCashSessions: CashSession[];
  insertCashSession: void;
  closeCashSession: void;
  fetchInventoryAdjustments: InventoryAdjustment[];
  applyInventoryAdjustment: { adjustment: InventoryAdjustment; product: Product };
  fetchSupplierInvoices: SupplierInvoiceView[];
  insertSupplierInvoice: SupplierInvoiceCreateResult;
  addSupplierInvoicePayment: SupplierInvoicePaymentResult;
  updateSupplierInvoiceStatus: void;
  updateSupplierInvoiceSafe: void;
  deleteSupplierInvoiceSafe: void;
  fetchSupplierPaymentsForReports: SupplierPaymentReportRow[];
  ensureDefaultFinancialAccounts: FinancialAccount[];
  fetchFinancialAccounts: FinancialAccount[];
  createFinancialAccount: FinancialAccount;
  transferBetweenAccounts: FinancialMovement[];
  fetchFinancialMovements: FinancialMovement[];
  createInventoryPayable: void;
  postPaidInventoryPurchase: void;
  addSupplierPaymentWithAccount: void;
  fetchFinancialSummary: FinancialSummary;
  fetchOwnerFinanceWorkspace: OwnerFinanceWorkspace;
  createOwnerWithdrawal: OwnerWithdrawal;
  cancelOwnerWithdrawal: OwnerWithdrawal;
  createOwnerWithdrawalConcept: OwnerWithdrawalConcept;
  updateOwnerWithdrawalConcept: OwnerWithdrawalConcept;
  saveOwnerFinanceSettings: OwnerFinanceSettings;
  fetchActivityLog: ActivityLogRecord[];
  bulkPutCategories: void;
  findCategoryByKey: CategoryRecord | undefined;
  putCategory: void;
  deleteCategory: void;
  bulkPutProducts: void;
}

export const toPagedResult = <T>(items: T[]): LanPagedResult<T> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: items.length,
});
