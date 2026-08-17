import type { IDataRepository } from '@/repositories/IDataRepository';
import type { UserRole } from '@/domain/models';
import type { SessionUser } from '@/lib/authCore';
import {
  ensureLanClientSession,
  invalidateLanClientSession,
  isLanSessionExpirationError,
  loadLanConfig,
  restoreLanUserWithGrace,
  saveLanConfig,
  type LanCommunicationConfig,
} from '@/lib/LanCommunicationConfig';
import { lanFetch, readLanJson } from '@/lib/LanFetchDiagnostics';
import type { Contact, Product } from '@/data/mockData';
import type { CategoryRecord } from '@/domain/models';
import type { LanPagedResult, LanRepositoryArgs, LanRepositoryMethod, LanRepositoryResults } from '@/lib/LanRepositoryContract';
import { LanServerDescriptor } from '@/lib/LanServerDescriptor';

export interface ApiRepositoryOptions {
  /** @deprecated Retained only because RepositoryRegistry is contractually immutable. ApiRepository ignores it. */
  baseUrl: string;
  timeoutMs?: number;
  getAccessToken?: () => string | null;
}

interface ApiSuccess<T> { data: T; }
interface ApiFailure { error?: string; message?: string; }

/**
 * LAN implementation of the existing IDataRepository contract.
 * Every operational call uses the single authoritative transport:
 * POST /repository/call on the Principal Server.
 */
export class ApiRepository implements IDataRepository {
  private readonly timeoutMs: number;
  private readonly getAccessToken: () => string | null;

  constructor(options: ApiRepositoryOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.getAccessToken = options.getAccessToken ?? (() => null);
  }

  private productCache: Product[] | null = null;
  private categoryCache: CategoryRecord[] | null = null;
  private clientCache: Contact[] | null = null;
  private salesCache: LanRepositoryResults['getSalesWorkspace'] | null = null;

  /** Clear only the last successfully synchronized products snapshot. */
  invalidateProducts(): void {
    this.productCache = null;
  }

  /** Clear only the last successfully synchronized categories snapshot. */
  invalidateCategories(): void {
    this.categoryCache = null;
  }

  /** Clear the last successfully synchronized Sales workspace. */
  invalidateSales(): void {
    this.salesCache = null;
  }

  /** Clear the last successfully synchronized Sales clients snapshot. */
  invalidateClients(): void {
    this.clientCache = null;
    this.invalidateSales();
  }

  /** Clear every LAN read-through fallback maintained by this Repository. */
  invalidateCache(): void {
    this.invalidateProducts();
    this.invalidateCategories();
    this.invalidateClients();
    this.invalidateSales();
  }

  private emitStaleData(module: 'products' | 'categories' | 'sales', error: unknown): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('joyacontrol:lan-stale-data', {
      detail: { module, message: error instanceof Error ? error.message : 'LAN_SERVER_UNAVAILABLE' },
    }));
  }

  private async callRepository<M extends LanRepositoryMethod>(method: M, args: LanRepositoryArgs[M]): Promise<LanRepositoryResults[M]> {
    let config = loadLanConfig();
    if (config.mode !== 'lan' || config.role !== 'client') throw new Error('LAN_CLIENT_MODE_REQUIRED');
    if (!config.clientId || !config.sessionToken) config = await ensureLanClientSession();
    const execute = async (activeConfig: LanCommunicationConfig): Promise<LanRepositoryResults[M]> => {
      if (!activeConfig.clientId || !activeConfig.sessionToken || !activeConfig.authToken) throw new Error('LAN_SESSION_NOT_AVAILABLE');
      const response = await lanFetch(new URL('repository/call', `${LanServerDescriptor.getBaseUrl()}/`).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          args,
          sessionToken: activeConfig.sessionToken,
          clientId: activeConfig.clientId,
          authToken: activeConfig.authToken,
        }),
        timeoutMs: this.timeoutMs,
        timeoutError: 'LAN_API_TIMEOUT',
      });
      const payload = await readLanJson<ApiSuccess<LanRepositoryResults[M]> & ApiFailure>(response, {} as ApiSuccess<LanRepositoryResults[M]> & ApiFailure);
      if (!response.ok) throw new Error(payload.error || payload.message || `LAN_API_${response.status}`);
      return payload.data;
    };

    try {
      return await execute(config);
    } catch (error) {
      if (!isLanSessionExpirationError(error)) throw error;
      const restored = await restoreLanUserWithGrace(config);
      if (!restored) throw error;
      config = loadLanConfig();
      return execute(config);
    }
  }

  private async invoke<M extends LanRepositoryMethod>(
    operation: M,
    args: LanRepositoryArgs[M],
  ): Promise<LanRepositoryResults[M]> {
    return this.callRepository(operation, args);
  }

  private async unsupported<T>(): Promise<T> {
    throw new Error('LAN_MODULE_NOT_AVAILABLE');
  }

  async getProducts(): Promise<LanPagedResult<Product>> {
    return this.callRepository('getProducts', {});
  }

  async searchProducts(text: string): Promise<LanPagedResult<Product>> {
    return this.callRepository('searchProducts', { text });
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.callRepository('getProductById', { id });
  }

  async getCategories(): Promise<LanPagedResult<CategoryRecord>> {
    return this.callRepository('getCategories', {});
  }

  async getDashboardMetrics(): Promise<LanRepositoryResults['getDashboardMetrics']> {
    return this.callRepository('getDashboardMetrics', {});
  }

  async fetchOwnerFinanceWorkspace(
    filters?: LanRepositoryArgs['fetchOwnerFinanceWorkspace']['filters'],
  ): Promise<LanRepositoryResults['fetchOwnerFinanceWorkspace']> {
    return this.callRepository('fetchOwnerFinanceWorkspace', { filters });
  }

  async createOwnerWithdrawal(
    input: LanRepositoryArgs['createOwnerWithdrawal']['input'],
  ): Promise<LanRepositoryResults['createOwnerWithdrawal']> {
    return this.callRepository('createOwnerWithdrawal', { input });
  }

  async cancelOwnerWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<LanRepositoryResults['cancelOwnerWithdrawal']> {
    return this.callRepository('cancelOwnerWithdrawal', { withdrawalId, reason });
  }

  async createOwnerWithdrawalConcept(
    name: string,
  ): Promise<LanRepositoryResults['createOwnerWithdrawalConcept']> {
    return this.callRepository('createOwnerWithdrawalConcept', { name });
  }

  async updateOwnerWithdrawalConcept(
    conceptId: string,
    changes: LanRepositoryArgs['updateOwnerWithdrawalConcept']['changes'],
  ): Promise<LanRepositoryResults['updateOwnerWithdrawalConcept']> {
    return this.callRepository('updateOwnerWithdrawalConcept', { conceptId, changes });
  }

  async saveOwnerFinanceSettings(
    settings: LanRepositoryArgs['saveOwnerFinanceSettings']['settings'],
  ): Promise<LanRepositoryResults['saveOwnerFinanceSettings']> {
    return this.callRepository('saveOwnerFinanceSettings', { settings });
  }

  async getSalesWorkspace(): Promise<LanRepositoryResults['getSalesWorkspace']> {
    try {
      const workspace = await this.callRepository('getSalesWorkspace', {});
      this.salesCache = workspace;
      return workspace;
    } catch (error) {
      if (this.salesCache) {
        this.emitStaleData('sales', error);
        return this.salesCache;
      }
      throw error;
    }
  }

  async getSalesClients(): Promise<LanRepositoryResults['getSalesClients']> {
    try {
      const clients = await this.callRepository('getSalesClients', {});
      this.clientCache = clients;
      return clients;
    } catch (error) {
      if (this.clientCache) {
        this.emitStaleData('sales', error);
        return this.clientCache;
      }
      throw error;
    }
  }

  async searchSalesClients(text: string): Promise<LanRepositoryResults['searchSalesClients']> {
    return this.callRepository('searchSalesClients', { text });
  }

  async getSalesClientById(id: string): Promise<LanRepositoryResults['getSalesClientById']> {
    return this.callRepository('getSalesClientById', { id });
  }

  async createSalesClient(client: Contact): Promise<Contact> {
    const created = await this.callRepository('createSalesClient', { client });
    this.invalidateClients();
    return created;
  }

  async updateSalesClient(client: Contact): Promise<Contact> {
    const updated = await this.callRepository('updateSalesClient', { client });
    this.invalidateClients();
    return updated;
  }

  async deleteSalesClient(id: string): Promise<void> {
    await this.callRepository('deleteSalesClient', { id });
    this.invalidateClients();
  }

  async querySales(query: LanRepositoryArgs['querySales']['query']): Promise<LanRepositoryResults['querySales']> {
    return this.callRepository('querySales', { query });
  }

  async getSaleById(id: string): Promise<LanRepositoryResults['getSaleById']> {
    return this.callRepository('getSaleById', { id });
  }

  async createSale(
    invoice: LanRepositoryArgs['createSale']['invoice'],
    allocations: LanRepositoryArgs['createSale']['allocations'],
    options: LanRepositoryArgs['createSale']['options'] = {},
  ): Promise<LanRepositoryResults['createSale']> {
    const result = await this.callRepository('createSale', { invoice, allocations, options });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  }

  async updateSaleStatus(id: string, status: string): Promise<void> {
    await this.callRepository('updateSaleStatus', { id, status });
    this.invalidateSales();
  }

  async cancelSale(id: string, reason: string): Promise<LanRepositoryResults['cancelSale']> {
    const result = await this.callRepository('cancelSale', { id, reason });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  }

  async applySalesContactChanges(changes: LanRepositoryArgs['applySalesContactChanges']['changes']): Promise<void> {
    await this.callRepository('applySalesContactChanges', { changes });
    this.invalidateClients();
  }

  async createSalesQuotation(input: LanRepositoryArgs['createSalesQuotation']['input']): Promise<LanRepositoryResults['createSalesQuotation']> {
    const result = await this.callRepository('createSalesQuotation', { input });
    this.invalidateSales();
    return result;
  }

  async updateSalesQuotationStatus(id: string, status: LanRepositoryArgs['updateSalesQuotationStatus']['status']): Promise<void> {
    await this.callRepository('updateSalesQuotationStatus', { id, status });
    this.invalidateSales();
  }

  async createSalesLayaway(layaway: LanRepositoryArgs['createSalesLayaway']['layaway']): Promise<LanRepositoryResults['createSalesLayaway']> {
    const result = await this.callRepository('createSalesLayaway', { layaway });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  }

  async updateSalesLayaway(
    layawayId: string,
    invoice: LanRepositoryArgs['updateSalesLayaway']['invoice'],
  ): Promise<LanRepositoryResults['updateSalesLayaway']> {
    const result = await this.callRepository('updateSalesLayaway', { layawayId, invoice });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  }

  async deleteSalesLayaway(
    layawayId: string,
    resolution: LanRepositoryArgs['deleteSalesLayaway']['resolution'] = 'refund',
  ): Promise<LanRepositoryResults['deleteSalesLayaway']> {
    const result = await this.callRepository('deleteSalesLayaway', { layawayId, resolution });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  }

  async addSalesLayawayPayment(
    layawayId: string,
    payment: LanRepositoryArgs['addSalesLayawayPayment']['payment'],
  ): Promise<LanRepositoryResults['addSalesLayawayPayment']> {
    const result = await this.callRepository('addSalesLayawayPayment', { layawayId, payment });
    this.invalidateSales();
    return result;
  }

  async completeSalesLayaway(layawayId: string, completedDate: string): Promise<string> {
    const invoiceId = await this.callRepository('completeSalesLayaway', { layawayId, completedDate });
    this.invalidateSales();
    return invoiceId;
  }

  readonly fetchCompany: IDataRepository['fetchCompany'] = async () => this.invoke('fetchCompany', {});
  readonly saveCompany: IDataRepository['saveCompany'] = async (company) => {
    await this.invoke('saveCompany', { company });
    this.invalidateSales();
  };
  readonly fetchProducts: IDataRepository['fetchProducts'] = async () => {
    try { const result = await this.getProducts(); this.productCache = result.items; return result.items; }
    catch (error) { if (this.productCache) { this.emitStaleData('products', error); return this.productCache; } throw error; }
  };
  readonly upsertProduct: IDataRepository['upsertProduct'] = async (product) => {
    await this.invoke('upsertProduct', { product });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly deleteProduct: IDataRepository['deleteProduct'] = async (id) => {
    await this.invoke('deleteProduct', { id });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly applyProductChanges: IDataRepository['applyProductChanges'] = async (changes) => {
    await this.invoke('applyProductChanges', { changes });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly fetchContacts: IDataRepository['fetchContacts'] = async () => this.invoke('fetchContacts', {});
  readonly upsertContact: IDataRepository['upsertContact'] = async (contact) => {
    await this.invoke('upsertContact', { contact });
    this.invalidateClients();
  };
  readonly deleteContact: IDataRepository['deleteContact'] = async (id) => {
    await this.invoke('deleteContact', { id });
    this.invalidateClients();
  };
  readonly applyContactChanges: IDataRepository['applyContactChanges'] = async (changes) => {
    await this.invoke('applyContactChanges', { changes });
    this.invalidateClients();
  };
  readonly fetchInvoices: IDataRepository['fetchInvoices'] = async () => (await this.getSalesWorkspace()).invoices;
  readonly insertInvoice: IDataRepository['insertInvoice'] = async (invoice) => {
    await this.invoke('insertInvoice', { invoice });
    this.invalidateSales();
  };
  readonly updateInvoiceStatus: IDataRepository['updateInvoiceStatus'] = async (id, status) => this.updateSaleStatus(id, status);
  readonly cancelInvoice: IDataRepository['cancelInvoice'] = async (id, reason) => this.cancelSale(id, reason);
  readonly fetchPurchaseInvoices: IDataRepository['fetchPurchaseInvoices'] = async () => this.invoke('fetchPurchaseInvoices', {});
  readonly createPurchaseWithInventory: IDataRepository['createPurchaseWithInventory'] = async (purchase, accountId) => {
    await this.invoke('createPurchaseWithInventory', { purchase, accountId });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly updatePurchaseWithInventory: IDataRepository['updatePurchaseWithInventory'] = async (purchase) => {
    await this.invoke('updatePurchaseWithInventory', { purchase });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly deletePurchaseWithInventory: IDataRepository['deletePurchaseWithInventory'] = async (id) => {
    await this.invoke('deletePurchaseWithInventory', { id });
    this.invalidateProducts();
    this.invalidateSales();
  };
  readonly markPurchaseAsPaid: IDataRepository['markPurchaseAsPaid'] = async (id, accountId) => {
    await this.invoke('markPurchaseAsPaid', { id, accountId });
    this.invalidateSales();
  };
  readonly fetchExpenses: IDataRepository['fetchExpenses'] = async () => this.invoke('fetchExpenses', {});
  readonly insertExpense: IDataRepository['insertExpense'] = async (expense) => {
    await this.invoke('insertExpense', { expense });
    this.invalidateSales();
  };
  readonly fetchQuotations: IDataRepository['fetchQuotations'] = async () => (await this.getSalesWorkspace()).quotations;
  readonly createQuotation: IDataRepository['createQuotation'] = async (input) => this.createSalesQuotation(input);
  readonly updateQuotationStatus: IDataRepository['updateQuotationStatus'] = async (id, status) => this.updateSalesQuotationStatus(id, status);
  readonly fetchLayawayPayments: IDataRepository['fetchLayawayPayments'] = async (layawayIds) => this.invoke('fetchLayawayPayments', { layawayIds });
  readonly fetchLayaways: IDataRepository['fetchLayaways'] = async () => (await this.getSalesWorkspace()).layaways;
  readonly insertLayaway: IDataRepository['insertLayaway'] = async (layaway) => this.createSalesLayaway(layaway);
  readonly updateLayaway: IDataRepository['updateLayaway'] = async (layawayId, invoice) => this.updateSalesLayaway(layawayId, invoice);
  readonly deleteLayaway: IDataRepository['deleteLayaway'] = async (layawayId) => this.deleteSalesLayaway(layawayId);
  readonly addLayawayPayment: IDataRepository['addLayawayPayment'] = async (layawayId, payment) => this.addSalesLayawayPayment(layawayId, payment);
  readonly completeLayawayDb: IDataRepository['completeLayawayDb'] = async (layawayId, completedDate) => this.completeSalesLayaway(layawayId, completedDate);
  readonly fetchCashSessions: IDataRepository['fetchCashSessions'] = async () => this.invoke('fetchCashSessions', {});
  readonly insertCashSession: IDataRepository['insertCashSession'] = async (session) => {
    await this.invoke('insertCashSession', { session });
    this.invalidateSales();
  };
  readonly closeCashSession: IDataRepository['closeCashSession'] = async (id, closedAt, closedBy, observations) => {
    await this.invoke('closeCashSession', { id, closedAt, closedBy, observations });
    this.invalidateSales();
  };
  readonly fetchInventoryAdjustments: IDataRepository['fetchInventoryAdjustments'] = async () => this.invoke('fetchInventoryAdjustments', {});
  readonly applyInventoryAdjustment: IDataRepository['applyInventoryAdjustment'] = async (input) => {
    const result = await this.invoke('applyInventoryAdjustment', { input });
    this.invalidateProducts();
    this.invalidateSales();
    return result;
  };
  readonly fetchSupplierInvoices: IDataRepository['fetchSupplierInvoices'] = async () => this.invoke('fetchSupplierInvoices', {});
  readonly insertSupplierInvoice: IDataRepository['insertSupplierInvoice'] = async (input) => this.invoke('insertSupplierInvoice', { input });
  readonly addSupplierInvoicePayment: IDataRepository['addSupplierInvoicePayment'] = async (supplierInvoiceId, payment) => {
    const result = await this.invoke('addSupplierInvoicePayment', { supplierInvoiceId, payment });
    this.invalidateSales();
    return result;
  };
  readonly updateSupplierInvoiceStatus: IDataRepository['updateSupplierInvoiceStatus'] = async (id, status) => {
    await this.invoke('updateSupplierInvoiceStatus', { id, status });
    this.invalidateSales();
  };
  readonly updateSupplierInvoiceSafe: IDataRepository['updateSupplierInvoiceSafe'] = async (id, input) => {
    await this.invoke('updateSupplierInvoiceSafe', { id, input });
    this.invalidateSales();
  };
  readonly deleteSupplierInvoiceSafe: IDataRepository['deleteSupplierInvoiceSafe'] = async (id) => {
    await this.invoke('deleteSupplierInvoiceSafe', { id });
    this.invalidateSales();
  };
  readonly fetchSupplierPaymentsForReports: IDataRepository['fetchSupplierPaymentsForReports'] = async () => this.invoke('fetchSupplierPaymentsForReports', {});
  readonly ensureDefaultFinancialAccounts: IDataRepository['ensureDefaultFinancialAccounts'] = async () => this.invoke('ensureDefaultFinancialAccounts', {});
  readonly fetchFinancialAccounts: IDataRepository['fetchFinancialAccounts'] = async () => this.invoke('fetchFinancialAccounts', {});
  readonly createFinancialAccount: IDataRepository['createFinancialAccount'] = async (input) => {
    const result = await this.invoke('createFinancialAccount', { input });
    this.invalidateSales();
    return result;
  };
  readonly transferBetweenAccounts: IDataRepository['transferBetweenAccounts'] = async (input) => {
    const result = await this.invoke('transferBetweenAccounts', { input });
    this.invalidateSales();
    return result;
  };
  readonly fetchFinancialMovements: IDataRepository['fetchFinancialMovements'] = async (limit) => this.invoke('fetchFinancialMovements', { limit });
  readonly insertInvoiceWithFinancials: IDataRepository['insertInvoiceWithFinancials'] = async (invoice, allocations, options = {}) => this.createSale(invoice, allocations, options);
  readonly insertExpenseWithFinancials: IDataRepository['insertExpenseWithFinancials'] = async (expense, accountId) => {
    await this.invoke('insertExpenseWithFinancials', { expense, accountId });
    this.invalidateSales();
  };
  readonly updateExpenseWithFinancialAdjustment: IDataRepository['updateExpenseWithFinancialAdjustment'] = async (expense) => {
    await this.invoke('updateExpenseWithFinancialAdjustment', { expense });
    this.invalidateSales();
  };
  readonly createInventoryPayable: IDataRepository['createInventoryPayable'] = async (input) => {
    await this.invoke('createInventoryPayable', { input });
    this.invalidateSales();
  };
  readonly postPaidInventoryPurchase: IDataRepository['postPaidInventoryPurchase'] = async (input) => {
    await this.invoke('postPaidInventoryPurchase', { input });
    this.invalidateSales();
  };
  readonly addSupplierPaymentWithAccount: IDataRepository['addSupplierPaymentWithAccount'] = async (supplierInvoiceId, input) => {
    await this.invoke('addSupplierPaymentWithAccount', { supplierInvoiceId, input });
    this.invalidateSales();
  };
  readonly fetchFinancialSummary: IDataRepository['fetchFinancialSummary'] = async () => this.invoke('fetchFinancialSummary', {});
  readonly createUser: IDataRepository['createUser'] = async (username, displayName, password, role) => this.invoke('createUser', { username, displayName, password, role });
  readonly loginUser: IDataRepository['loginUser'] = async (username, password): Promise<SessionUser> => {
    let config = loadLanConfig();
    if (config.mode !== 'lan' || config.role !== 'client') throw new Error('LAN_CLIENT_MODE_REQUIRED');
    if (!config.clientId || !config.sessionToken) config = await ensureLanClientSession();

    const attemptLogin = async (sessionConfig: typeof config): Promise<SessionUser> => {
      if (!sessionConfig.clientId || !sessionConfig.sessionToken) throw new Error('LAN_SESSION_NOT_AVAILABLE');
      const response = await lanFetch(new URL('login', `${LanServerDescriptor.getBaseUrl()}/`).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          clientId: sessionConfig.clientId,
          sessionToken: sessionConfig.sessionToken,
          ...(sessionConfig.rememberDevice === false ? { rememberDevice: false } : {}),
        }),
        timeoutMs: this.timeoutMs,
        timeoutError: 'LAN_API_TIMEOUT',
      });
      const payload = await readLanJson<{
        success?: boolean;
        userId?: string;
        username?: string;
        displayName?: string;
        role?: UserRole;
        permissions?: string[];
        authToken?: string;
        error?: string;
        message?: string;
      }>(response, {});
      if (!response.ok || !payload.success || !payload.userId || !payload.username || !payload.role || !payload.authToken) {
        throw new Error(payload.error || payload.message || `LAN_LOGIN_${response.status}`);
      }

      saveLanConfig({ ...sessionConfig, authToken: payload.authToken });
      return {
        id: payload.userId,
        username: payload.username,
        displayName: payload.displayName || payload.username,
        role: payload.role,
        permissions: Array.isArray(payload.permissions) ? [...payload.permissions] : [],
      };
    };

    try {
      return await attemptLogin(config);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code !== 'LAN_INVALID_SESSION' && code !== 'LAN_SESSION_EXPIRED') throw error;
      invalidateLanClientSession(code, config.clientId);
      config = await ensureLanClientSession();
      return attemptLogin(config);
    }
  };

  readonly changePassword: IDataRepository['changePassword'] = async (userId, currentPassword, newPassword) => { await this.invoke('changePassword', { userId, currentPassword, newPassword }); };
  readonly getMasterExists: IDataRepository['getMasterExists'] = async () => true;
  readonly logActivity: IDataRepository['logActivity'] = async (session, action, entity, entityId, detail) => { await this.invoke('logActivity', { session, action, entity, entityId, detail }); };
  readonly fetchUsers: IDataRepository['fetchUsers'] = async () => this.invoke('fetchUsers', {});
  readonly updateUser: IDataRepository['updateUser'] = async (userId, changes) => { await this.invoke('updateUser', { userId, changes }); };
  readonly fetchActivityLog: IDataRepository['fetchActivityLog'] = async (limit) => this.invoke('fetchActivityLog', { limit });
  readonly fetchCategories: IDataRepository['fetchCategories'] = async () => {
    try { const result = await this.getCategories(); this.categoryCache = result.items; return result.items; }
    catch (error) { if (this.categoryCache) { this.emitStaleData('categories', error); return this.categoryCache; } throw error; }
  };
  readonly bulkPutCategories: IDataRepository['bulkPutCategories'] = async (categories) => {
    await this.invoke('bulkPutCategories', { categories });
    this.invalidateCategories();
  };
  readonly findCategoryByKey: IDataRepository['findCategoryByKey'] = async (nameKey) => this.invoke('findCategoryByKey', { nameKey });
  readonly putCategory: IDataRepository['putCategory'] = async (category) => {
    await this.invoke('putCategory', { category });
    this.invalidateCategories();
  };
  readonly deleteCategory: IDataRepository['deleteCategory'] = async (id) => {
    await this.invoke('deleteCategory', { id });
    this.invalidateCategories();
  };
  readonly bulkPutProducts: IDataRepository['bulkPutProducts'] = async (products) => {
    await this.invoke('bulkPutProducts', { products });
    this.invalidateProducts();
    this.invalidateSales();
  };
}
