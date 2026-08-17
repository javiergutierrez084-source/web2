import * as source from '@/repositories/dexieDataSource';
import type { IDataRepository } from '@/repositories/IDataRepository';

/**
 * Desktop/local adapter. It contains no Dexie calls of its own: every storage
 * operation is implemented in dexieDataSource and exposed through the common
 * repository contract.
 */
export class DexieRepository implements IDataRepository {
  readonly fetchCompany: IDataRepository['fetchCompany'] = source.fetchCompany;
  readonly saveCompany: IDataRepository['saveCompany'] = source.saveCompany;
  readonly fetchProducts: IDataRepository['fetchProducts'] = source.fetchProducts;
  readonly upsertProduct: IDataRepository['upsertProduct'] = source.upsertProduct;
  readonly deleteProduct: IDataRepository['deleteProduct'] = source.deleteProduct;
  readonly applyProductChanges: IDataRepository['applyProductChanges'] = source.applyProductChanges;
  readonly fetchContacts: IDataRepository['fetchContacts'] = source.fetchContacts;
  readonly upsertContact: IDataRepository['upsertContact'] = source.upsertContact;
  readonly deleteContact: IDataRepository['deleteContact'] = source.deleteContact;
  readonly applyContactChanges: IDataRepository['applyContactChanges'] = source.applyContactChanges;
  readonly fetchInvoices: IDataRepository['fetchInvoices'] = source.fetchInvoices;
  readonly insertInvoice: IDataRepository['insertInvoice'] = source.insertInvoice;
  readonly updateInvoiceStatus: IDataRepository['updateInvoiceStatus'] = source.updateInvoiceStatus;
  readonly cancelInvoice: IDataRepository['cancelInvoice'] = source.cancelInvoice;
  readonly fetchPurchaseInvoices: IDataRepository['fetchPurchaseInvoices'] = source.fetchPurchaseInvoices;
  readonly createPurchaseWithInventory: IDataRepository['createPurchaseWithInventory'] = source.createPurchaseWithInventory;
  readonly updatePurchaseWithInventory: IDataRepository['updatePurchaseWithInventory'] = source.updatePurchaseWithInventory;
  readonly deletePurchaseWithInventory: IDataRepository['deletePurchaseWithInventory'] = source.deletePurchaseWithInventory;
  readonly markPurchaseAsPaid: IDataRepository['markPurchaseAsPaid'] = source.markPurchaseAsPaid;
  readonly fetchExpenses: IDataRepository['fetchExpenses'] = source.fetchExpenses;
  readonly insertExpense: IDataRepository['insertExpense'] = source.insertExpense;
  readonly fetchQuotations: IDataRepository['fetchQuotations'] = source.fetchQuotations;
  readonly createQuotation: IDataRepository['createQuotation'] = source.createQuotation;
  readonly updateQuotationStatus: IDataRepository['updateQuotationStatus'] = source.updateQuotationStatus;
  readonly fetchLayawayPayments: IDataRepository['fetchLayawayPayments'] = source.fetchLayawayPayments;
  readonly fetchLayaways: IDataRepository['fetchLayaways'] = source.fetchLayaways;
  readonly insertLayaway: IDataRepository['insertLayaway'] = source.insertLayaway;
  readonly updateLayaway: IDataRepository['updateLayaway'] = source.updateLayaway;
  readonly deleteLayaway: IDataRepository['deleteLayaway'] = source.deleteLayaway;
  readonly addLayawayPayment: IDataRepository['addLayawayPayment'] = source.addLayawayPayment;
  readonly completeLayawayDb: IDataRepository['completeLayawayDb'] = source.completeLayawayDb;
  readonly fetchCashSessions: IDataRepository['fetchCashSessions'] = source.fetchCashSessions;
  readonly insertCashSession: IDataRepository['insertCashSession'] = source.insertCashSession;
  readonly closeCashSession: IDataRepository['closeCashSession'] = source.closeCashSession;
  readonly fetchInventoryAdjustments: IDataRepository['fetchInventoryAdjustments'] = source.fetchInventoryAdjustments;
  readonly applyInventoryAdjustment: IDataRepository['applyInventoryAdjustment'] = source.applyInventoryAdjustment;
  readonly fetchSupplierInvoices: IDataRepository['fetchSupplierInvoices'] = source.fetchSupplierInvoices;
  readonly insertSupplierInvoice: IDataRepository['insertSupplierInvoice'] = source.insertSupplierInvoice;
  readonly addSupplierInvoicePayment: IDataRepository['addSupplierInvoicePayment'] = source.addSupplierInvoicePayment;
  readonly updateSupplierInvoiceStatus: IDataRepository['updateSupplierInvoiceStatus'] = source.updateSupplierInvoiceStatus;
  readonly updateSupplierInvoiceSafe: IDataRepository['updateSupplierInvoiceSafe'] = source.updateSupplierInvoiceSafe;
  readonly deleteSupplierInvoiceSafe: IDataRepository['deleteSupplierInvoiceSafe'] = source.deleteSupplierInvoiceSafe;
  readonly fetchSupplierPaymentsForReports: IDataRepository['fetchSupplierPaymentsForReports'] = source.fetchSupplierPaymentsForReports;
  readonly ensureDefaultFinancialAccounts: IDataRepository['ensureDefaultFinancialAccounts'] = source.ensureDefaultFinancialAccounts;
  readonly fetchFinancialAccounts: IDataRepository['fetchFinancialAccounts'] = source.fetchFinancialAccounts;
  readonly createFinancialAccount: IDataRepository['createFinancialAccount'] = source.createFinancialAccount;
  readonly transferBetweenAccounts: IDataRepository['transferBetweenAccounts'] = source.transferBetweenAccounts;
  readonly fetchFinancialMovements: IDataRepository['fetchFinancialMovements'] = source.fetchFinancialMovements;
  readonly insertInvoiceWithFinancials: IDataRepository['insertInvoiceWithFinancials'] = source.insertInvoiceWithFinancials;
  readonly insertExpenseWithFinancials: IDataRepository['insertExpenseWithFinancials'] = source.insertExpenseWithFinancials;
  readonly updateExpenseWithFinancialAdjustment: IDataRepository['updateExpenseWithFinancialAdjustment'] = source.updateExpenseWithFinancialAdjustment;
  readonly createInventoryPayable: IDataRepository['createInventoryPayable'] = source.createInventoryPayable;
  readonly postPaidInventoryPurchase: IDataRepository['postPaidInventoryPurchase'] = source.postPaidInventoryPurchase;
  readonly addSupplierPaymentWithAccount: IDataRepository['addSupplierPaymentWithAccount'] = source.addSupplierPaymentWithAccount;
  readonly fetchFinancialSummary: IDataRepository['fetchFinancialSummary'] = source.fetchFinancialSummary;
  readonly createUser: IDataRepository['createUser'] = source.createUser;
  readonly loginUser: IDataRepository['loginUser'] = source.loginUser;
  readonly changePassword: IDataRepository['changePassword'] = source.changePassword;
  readonly getMasterExists: IDataRepository['getMasterExists'] = source.getMasterExists;
  readonly logActivity: IDataRepository['logActivity'] = source.logActivity;
  readonly fetchUsers: IDataRepository['fetchUsers'] = source.fetchUsers;
  readonly updateUser: IDataRepository['updateUser'] = source.updateUser;
  readonly fetchActivityLog: IDataRepository['fetchActivityLog'] = source.fetchActivityLog;
  readonly fetchCategories: IDataRepository['fetchCategories'] = source.fetchCategories;
  readonly bulkPutCategories: IDataRepository['bulkPutCategories'] = source.bulkPutCategories;
  readonly findCategoryByKey: IDataRepository['findCategoryByKey'] = source.findCategoryByKey;
  readonly putCategory: IDataRepository['putCategory'] = source.putCategory;
  readonly deleteCategory: IDataRepository['deleteCategory'] = source.deleteCategory;
  readonly bulkPutProducts: IDataRepository['bulkPutProducts'] = source.bulkPutProducts;
}
