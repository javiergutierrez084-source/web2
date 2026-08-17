import { getDataRepository } from '@/repositories/RepositoryRegistry';
import type { IDataRepository } from '@/repositories/IDataRepository';
import * as localBackupDataSource from '@/repositories/dexieDataSource';

export type {
  InvoiceCancellationResult,
  CreateQuotationInput,
  LayawayPaymentResult,
  LayawayUpdateResult,
  LayawayDeleteResult,
  InvoiceFinancialTransactionOptions,
} from '@/domain/models';

// Compatibility facade: existing callers keep their imports, while every
// domain operation is resolved through IDataRepository.
export const fetchCompany: IDataRepository['fetchCompany'] = (...args) => getDataRepository().fetchCompany(...args);
export const saveCompany: IDataRepository['saveCompany'] = (...args) => getDataRepository().saveCompany(...args);
export const fetchProducts: IDataRepository['fetchProducts'] = (...args) => getDataRepository().fetchProducts(...args);
export const upsertProduct: IDataRepository['upsertProduct'] = (...args) => getDataRepository().upsertProduct(...args);
export const deleteProduct: IDataRepository['deleteProduct'] = (...args) => getDataRepository().deleteProduct(...args);
export const applyProductChanges: IDataRepository['applyProductChanges'] = (...args) => getDataRepository().applyProductChanges(...args);
export const fetchContacts: IDataRepository['fetchContacts'] = (...args) => getDataRepository().fetchContacts(...args);
export const upsertContact: IDataRepository['upsertContact'] = (...args) => getDataRepository().upsertContact(...args);
export const deleteContact: IDataRepository['deleteContact'] = (...args) => getDataRepository().deleteContact(...args);
export const applyContactChanges: IDataRepository['applyContactChanges'] = (...args) => getDataRepository().applyContactChanges(...args);
export const fetchInvoices: IDataRepository['fetchInvoices'] = (...args) => getDataRepository().fetchInvoices(...args);
export const insertInvoice: IDataRepository['insertInvoice'] = (...args) => getDataRepository().insertInvoice(...args);
export const updateInvoiceStatus: IDataRepository['updateInvoiceStatus'] = (...args) => getDataRepository().updateInvoiceStatus(...args);
export const cancelInvoice: IDataRepository['cancelInvoice'] = (...args) => getDataRepository().cancelInvoice(...args);
export const fetchPurchaseInvoices: IDataRepository['fetchPurchaseInvoices'] = (...args) => getDataRepository().fetchPurchaseInvoices(...args);
export const fetchExpenses: IDataRepository['fetchExpenses'] = (...args) => getDataRepository().fetchExpenses(...args);
export const insertExpense: IDataRepository['insertExpense'] = (...args) => getDataRepository().insertExpense(...args);
export const fetchQuotations: IDataRepository['fetchQuotations'] = (...args) => getDataRepository().fetchQuotations(...args);
export const createQuotation: IDataRepository['createQuotation'] = (...args) => getDataRepository().createQuotation(...args);
export const updateQuotationStatus: IDataRepository['updateQuotationStatus'] = (...args) => getDataRepository().updateQuotationStatus(...args);
export const fetchLayawayPayments: IDataRepository['fetchLayawayPayments'] = (...args) => getDataRepository().fetchLayawayPayments(...args);
export const fetchLayaways: IDataRepository['fetchLayaways'] = (...args) => getDataRepository().fetchLayaways(...args);
export const insertLayaway: IDataRepository['insertLayaway'] = (...args) => getDataRepository().insertLayaway(...args);
export const updateLayaway: IDataRepository['updateLayaway'] = (...args) => getDataRepository().updateLayaway(...args);
export const deleteLayaway: IDataRepository['deleteLayaway'] = (...args) => getDataRepository().deleteLayaway(...args);
export const addLayawayPayment: IDataRepository['addLayawayPayment'] = (...args) => getDataRepository().addLayawayPayment(...args);
export const completeLayawayDb: IDataRepository['completeLayawayDb'] = (...args) => getDataRepository().completeLayawayDb(...args);
export const fetchCashSessions: IDataRepository['fetchCashSessions'] = (...args) => getDataRepository().fetchCashSessions(...args);
export const insertCashSession: IDataRepository['insertCashSession'] = (...args) => getDataRepository().insertCashSession(...args);
export const closeCashSession: IDataRepository['closeCashSession'] = (...args) => getDataRepository().closeCashSession(...args);
export const fetchInventoryAdjustments: IDataRepository['fetchInventoryAdjustments'] = (...args) => getDataRepository().fetchInventoryAdjustments(...args);
export const applyInventoryAdjustment: IDataRepository['applyInventoryAdjustment'] = (...args) => getDataRepository().applyInventoryAdjustment(...args);
export const fetchSupplierInvoices: IDataRepository['fetchSupplierInvoices'] = (...args) => getDataRepository().fetchSupplierInvoices(...args);
export const insertSupplierInvoice: IDataRepository['insertSupplierInvoice'] = (...args) => getDataRepository().insertSupplierInvoice(...args);
export const addSupplierInvoicePayment: IDataRepository['addSupplierInvoicePayment'] = (...args) => getDataRepository().addSupplierInvoicePayment(...args);
export const updateSupplierInvoiceStatus: IDataRepository['updateSupplierInvoiceStatus'] = (...args) => getDataRepository().updateSupplierInvoiceStatus(...args);
export const fetchSupplierPaymentsForReports: IDataRepository['fetchSupplierPaymentsForReports'] = (...args) => getDataRepository().fetchSupplierPaymentsForReports(...args);
export const ensureDefaultFinancialAccounts: IDataRepository['ensureDefaultFinancialAccounts'] = (...args) => getDataRepository().ensureDefaultFinancialAccounts(...args);
export const fetchFinancialAccounts: IDataRepository['fetchFinancialAccounts'] = (...args) => getDataRepository().fetchFinancialAccounts(...args);
export const createFinancialAccount: IDataRepository['createFinancialAccount'] = (...args) => getDataRepository().createFinancialAccount(...args);
export const transferBetweenAccounts: IDataRepository['transferBetweenAccounts'] = (...args) => getDataRepository().transferBetweenAccounts(...args);
export const fetchFinancialMovements: IDataRepository['fetchFinancialMovements'] = (...args) => getDataRepository().fetchFinancialMovements(...args);
export const insertInvoiceWithFinancials: IDataRepository['insertInvoiceWithFinancials'] = (...args) => getDataRepository().insertInvoiceWithFinancials(...args);
export const insertExpenseWithFinancials: IDataRepository['insertExpenseWithFinancials'] = (...args) => getDataRepository().insertExpenseWithFinancials(...args);
export const updateExpenseWithFinancialAdjustment: IDataRepository['updateExpenseWithFinancialAdjustment'] = (...args) => getDataRepository().updateExpenseWithFinancialAdjustment(...args);
export const createInventoryPayable: IDataRepository['createInventoryPayable'] = (...args) => getDataRepository().createInventoryPayable(...args);
export const postPaidInventoryPurchase: IDataRepository['postPaidInventoryPurchase'] = (...args) => getDataRepository().postPaidInventoryPurchase(...args);
export const addSupplierPaymentWithAccount: IDataRepository['addSupplierPaymentWithAccount'] = (...args) => getDataRepository().addSupplierPaymentWithAccount(...args);
export const fetchFinancialSummary: IDataRepository['fetchFinancialSummary'] = (...args) => getDataRepository().fetchFinancialSummary(...args);
export const fetchActivityLog: IDataRepository['fetchActivityLog'] = (...args) => getDataRepository().fetchActivityLog(...args);

// Phase-1 exception: backup history/settings remain local by explicit scope.
// The backup subsystem is not migrated to LAN in this branch.
export const insertBackupHistoryEntry = localBackupDataSource.insertBackupHistoryEntry;
export const fetchBackupHistory = localBackupDataSource.fetchBackupHistory;
export const deleteBackupHistoryEntry = localBackupDataSource.deleteBackupHistoryEntry;
export const clearBackupHistory = localBackupDataSource.clearBackupHistory;
export const fetchSystemSettings = localBackupDataSource.fetchSystemSettings;
export const saveSystemSettings = localBackupDataSource.saveSystemSettings;

export const updateSupplierInvoiceSafe: IDataRepository['updateSupplierInvoiceSafe'] = (...args) => getDataRepository().updateSupplierInvoiceSafe(...args);
export const deleteSupplierInvoiceSafe: IDataRepository['deleteSupplierInvoiceSafe'] = (...args) => getDataRepository().deleteSupplierInvoiceSafe(...args);

export const createPurchaseWithInventory: IDataRepository['createPurchaseWithInventory'] = (...args) => getDataRepository().createPurchaseWithInventory(...args);
export const updatePurchaseWithInventory: IDataRepository['updatePurchaseWithInventory'] = (...args) => getDataRepository().updatePurchaseWithInventory(...args);
export const deletePurchaseWithInventory: IDataRepository['deletePurchaseWithInventory'] = (...args) => getDataRepository().deletePurchaseWithInventory(...args);
export const markPurchaseAsPaid: IDataRepository['markPurchaseAsPaid'] = (...args) => getDataRepository().markPurchaseAsPaid(...args);
