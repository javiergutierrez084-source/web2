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
  UserRecord,
  UserRole,
} from '@/domain/models';
import type { SessionUser } from '@/lib/authCore';

/**
 * Storage-agnostic application data contract.
 *
 * The interface depends only on domain/application models. It intentionally
 * contains no Dexie types, tables or implementation functions, so the same
 * contract can be implemented by local IndexedDB or a future LAN API.
 */
export interface IDataRepository {
  fetchCompany(): Promise<CompanyInfo>;
  saveCompany(company: CompanyInfo): Promise<void>;

  fetchProducts(): Promise<Product[]>;
  upsertProduct(product: Product): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  applyProductChanges(changes: ProductChangeSet): Promise<void>;

  fetchContacts(): Promise<Contact[]>;
  upsertContact(contact: Contact): Promise<void>;
  deleteContact(id: string): Promise<void>;
  applyContactChanges(changes: ContactChangeSet<Contact>): Promise<void>;

  fetchInvoices(): Promise<Invoice[]>;
  insertInvoice(invoice: Invoice): Promise<void>;
  updateInvoiceStatus(id: string, status: string): Promise<void>;
  cancelInvoice(id: string, reason: string): Promise<InvoiceCancellationResult>;

  fetchPurchaseInvoices(): Promise<PurchaseInvoice[]>;
  createPurchaseWithInventory(purchase: PurchaseInvoice, accountId?: string): Promise<void>;
  updatePurchaseWithInventory(purchase: PurchaseInvoice): Promise<void>;
  deletePurchaseWithInventory(id: string): Promise<void>;
  markPurchaseAsPaid(id: string, accountId: string): Promise<void>;
  fetchExpenses(): Promise<ExpenseInvoice[]>;
  insertExpense(expense: ExpenseInvoice): Promise<void>;

  fetchQuotations(): Promise<Quotation[]>;
  createQuotation(input: Omit<Quotation, 'id' | 'number'>): Promise<Quotation>;
  updateQuotationStatus(id: string, status: Quotation['status']): Promise<void>;

  fetchLayawayPayments(layawayIds?: string[]): Promise<LayawayPaymentsById>;
  fetchLayaways(): Promise<Layaway[]>;
  insertLayaway(layaway: Layaway): Promise<Layaway>;
  updateLayaway(layawayId: string, invoice: Invoice): Promise<LayawayUpdateResult>;
  deleteLayaway(layawayId: string): Promise<LayawayDeleteResult>;
  addLayawayPayment(
    layawayId: string,
    payment: { amount: number; date: string; method: string; accountId?: string },
  ): Promise<LayawayPaymentResult>;
  completeLayawayDb(layawayId: string, completedDate: string): Promise<string>;

  fetchCashSessions(): Promise<CashSession[]>;
  insertCashSession(session: CashSession): Promise<void>;
  closeCashSession(
    id: string,
    closedAt: string,
    closedBy: string,
    observations: string,
  ): Promise<void>;

  fetchInventoryAdjustments(): Promise<InventoryAdjustment[]>;
  applyInventoryAdjustment(input: InventoryAdjustmentInput): Promise<{
    adjustment: InventoryAdjustment;
    product: Product;
  }>;

  fetchSupplierInvoices(): Promise<SupplierInvoiceView[]>;
  insertSupplierInvoice(input: SupplierInvoiceCreateInput): Promise<SupplierInvoiceCreateResult>;
  addSupplierInvoicePayment(
    supplierInvoiceId: string,
    payment: SupplierInvoicePaymentInput,
  ): Promise<SupplierInvoicePaymentResult>;
  updateSupplierInvoiceStatus(id: string, status: string): Promise<void>;
  updateSupplierInvoiceSafe(id: string, input: SupplierInvoiceUpdateInput): Promise<void>;
  deleteSupplierInvoiceSafe(id: string): Promise<void>;
  fetchSupplierPaymentsForReports(): Promise<SupplierPaymentReportRow[]>;

  ensureDefaultFinancialAccounts(): Promise<FinancialAccount[]>;
  fetchFinancialAccounts(): Promise<FinancialAccount[]>;
  createFinancialAccount(input: {
    name: string;
    kind: FinancialAccount['kind'];
    initialBalance?: number;
  }): Promise<FinancialAccount>;
  transferBetweenAccounts(input: {
    originAccountId: string;
    destinationAccountId: string;
    amount: number;
    date: string;
    observation?: string;
  }): Promise<FinancialMovement[]>;
  fetchFinancialMovements(limit?: number): Promise<FinancialMovement[]>;
  insertInvoiceWithFinancials(
    invoice: Invoice,
    allocations: PaymentAllocation[],
    options?: InvoiceFinancialTransactionOptions,
  ): Promise<Product[]>;
  insertExpenseWithFinancials(expense: ExpenseInvoice, accountId: string): Promise<void>;
  updateExpenseWithFinancialAdjustment(expense: ExpenseInvoice): Promise<void>;
  createInventoryPayable(input: {
    adjustmentId: string;
    supplierId: string;
    supplierName: string;
    total: number;
    date: string;
    dueDate?: string;
  }): Promise<void>;
  postPaidInventoryPurchase(input: {
    adjustmentId: string;
    accountId: string;
    total: number;
    date: string;
    supplierName?: string;
  }): Promise<void>;
  addSupplierPaymentWithAccount(
    supplierInvoiceId: string,
    input: { amount: number; date: string; method: string; accountId: string },
  ): Promise<void>;
  fetchFinancialSummary(): Promise<FinancialSummary>;

  createUser(
    username: string,
    displayName: string,
    password: string,
    role: UserRole,
  ): Promise<UserRecord>;
  loginUser(username: string, password: string): Promise<SessionUser>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
  getMasterExists(): Promise<boolean>;
  logActivity(
    session: SessionUser,
    action: string,
    entity: string,
    entityId: string,
    detail?: string,
  ): Promise<void>;
  fetchUsers(): Promise<UserRecord[]>;
  updateUser(
    userId: string,
    changes: Partial<Pick<UserRecord, 'active' | 'password_hash' | 'display_name' | 'role'>>,
  ): Promise<void>;
  fetchActivityLog(limit?: number): Promise<ActivityLogRecord[]>;

  fetchCategories(): Promise<CategoryRecord[]>;
  bulkPutCategories(categories: CategoryRecord[]): Promise<void>;
  findCategoryByKey(nameKey: string): Promise<CategoryRecord | undefined>;
  putCategory(category: CategoryRecord): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  bulkPutProducts(products: BulkImportProductRecord[]): Promise<void>;
}
