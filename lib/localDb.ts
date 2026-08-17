import Dexie, { type Table } from 'dexie';

// ── Category name normalization (shared by migration + bulk import) ──
export function normalizeCategoryKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeCategoryName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word)
    .join(' ');
}

// ── Persisted interfaces ──

export interface DbProduct {
  id: string;
  code: string;
  name: string;
  category: string;
  purchase_price: number;
  sale_price: number;
  weight_grams: number;
  margin: number;
  stock: number;
  min_stock: number;
  description: string;
  supplier_ids: string[];
  created_at: string;
  // Added in database v5. Optional so legacy restores remain readable.
  reference?: string;
  available_grams?: number;
  average_purchase_price?: number;
  last_purchase_date?: string;
}

export interface DbContact {
  id: string; type: string; name: string; document: string;
  phone: string; email: string; address: string; notes: string; created_at: string;
}

export interface DbInvoice {
  id: string; number: string; client_id: string; client_name: string;
  subtotal: number; discount: number; tax: number; total: number;
  date: string; status: string; payment_method: string;
  client_notes: string; internal_notes: string;
  cancellation_reason: string; cancelled_at: string; cancelled_by: string;
  tipo_documento: string; created_at: string;
}

export interface DbInvoiceItem {
  id?: number; invoice_id: string; product_id: string; code: string; name: string;
  quantity: number; weight_grams: number; unit_price: number; subtotal: number;
  price_modified: boolean; original_price: number; cost_price?: number;
}

/** Legacy purchase storage retained only for old databases, reports and backups. */
export interface DbPurchaseInvoice {
  id: string; number: string; supplier_id: string; supplier_name: string;
  subtotal: number; discount: number; tax: number; total: number;
  date: string; status: string; description: string; payment_method: string; created_at: string;
}

/** Legacy purchase item storage retained only for compatibility. */
export interface DbPurchaseInvoiceItem {
  id?: number; purchase_invoice_id: string; product_id: string; code: string; name: string;
  quantity: number; weight_grams: number; unit_price: number; subtotal: number;
}

export interface DbExpense {
  id: string; number: string; supplier_id: string; supplier_name: string;
  total: number; description: string; date: string; payment_method: string;
  status: string; created_at: string; account_id?: string;
}

/** Legacy manual supplier-price row. Never read or written by the active app. */
export interface DbLegacyPriceRow {
  id: string; supplier_id: string; product_id: string; price: number; last_updated: string;
}

export interface DbQuotation {
  id: string; number: string; client_id: string; client_name: string;
  subtotal: number; discount: number; tax: number; total: number;
  date: string; valid_until: string; status: string; notes: string; created_at: string;
}

export interface DbQuotationItem {
  id?: number; quotation_id: string; product_id: string; code: string; name: string;
  quantity: number; weight_grams: number; unit_price: number; subtotal: number;
}

export interface DbLayaway {
  id: string;
  invoice_id: string;
  completed: boolean;
  completed_date: string | null;
  created_at: string;
  // Additive snapshots used only as a recovery fallback. The persisted invoice
  // remains the source of truth; these fields do not store a pending balance.
  client_id?: string;
  client_name?: string;
  invoice_number?: string;
  invoice_total?: number;
  invoice_date?: string;
}

export interface DbLayawayPayment {
  id?: number; layaway_id: string; amount: number; date: string; method: string; created_at: string;
  account_id?: string; user_id?: string; user_name?: string;
}

export interface DbCashSession {
  id: string; date: string; opened_at: string; opened_by: string;
  initial_amount: number; closed_at: string | null; closed_by: string | null;
  observations: string | null; created_at: string;
}

export interface DbCompanySettings {
  id: string; name: string; nit: string; phone: string;
  city: string; address: string; email: string; logo_url: string;
}

export interface DbInventoryAdjustment {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  reason: string;
  created_at: string;
  // Added in database v5. Optional for legacy adjustment rows/backups.
  product_code?: string;
  product_name?: string;
  grams?: number;
  total_cost?: number;
  unit_cost?: number;
  value_per_gram?: number;
  purchase_price?: number;
  average_price_before?: number;
  average_price_after?: number;
  stock_before?: number;
  stock_after?: number;
  grams_before?: number;
  grams_after?: number;
  supplier_id?: string;
  supplier_name?: string;
  adjustment_date?: string;
  notes?: string;
}

export interface DbSupplierInvoice {
  id: string; supplier_id: string; supplier_name: string; invoice_number: string;
  issue_date: string; due_date: string; total: number; status: string;
  notes: string; created_at: string; initial_value?: number; pending_balance?: number;
  source_type?: string; source_id?: string; updated_at?: string;
}

export interface DbSupplierInvoicePayment {
  id: string; supplier_invoice_id: string; amount: number; date: string;
  method: string; created_at: string; account_id?: string;
  balance_before?: number; balance_after?: number; user_id?: string; user_name?: string;
}

export type UserRole = 'master' | 'admin' | 'vendedor' | 'cajero';

export interface DbUser {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  last_login: string | null;
}

export interface DbActivityLog {
  id?: number;
  user_id: string;
  user_name: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  created_at: string;
}

export interface DbCategory {
  id: string;
  name: string;
  name_key: string;
  created_at: string;
  auto_created: boolean;
}

export interface DbBackupMeta {
  id: string;
  last_backup_at: string;
  backup_size_kb: number;
}

export interface DbBackupHistory {
  id: string;
  date: string;
  type: string;
  destination: string;
  size: number;
  status: string;
  version: number;
  created_by: string;
  device_id: string;
  notes: string;
}


export type FinancialAccountKind = 'cash' | 'bank' | 'wallet';
export type FinancialMovementType =
  | 'sale_income' | 'expense' | 'inventory_purchase' | 'supplier_payment'
  | 'transfer' | 'transfer_out' | 'transfer_in' | 'opening_balance' | 'adjustment';

export type FinancialMovementCode = import('@/data/mockData').FinancialMovementCode;
export type FinancialReferenceType = import('@/data/mockData').FinancialReferenceType;
export type FinancialMovementStatus = import('@/data/mockData').FinancialMovementStatus;

export interface DbFinancialAccount {
  id: string; name: string; kind: FinancialAccountKind; active: boolean;
  balance: number; created_at: string; updated_at: string;
}

export interface DbFinancialMovement {
  id: string; type: FinancialMovementType; amount: number;
  origin_account_id: string; destination_account_id: string;
  origin_balance_before: number; origin_balance_after: number;
  destination_balance_before: number; destination_balance_after: number;
  reference: string; document_type: string; document_id: string;
  observation: string; user_id: string; user_name: string;
  movement_date: string; created_at: string;
  movement_code?: FinancialMovementCode;
  related_movement_id?: string;
  reference_type?: FinancialReferenceType;
  reference_id?: string;
  status?: FinancialMovementStatus;
  updated_at?: string;
  notes?: string;
  customer_id?: string;
}

export interface DbInvoicePaymentAllocation {
  id: string; invoice_id: string; account_id: string; amount: number;
  payment_method: string; created_at: string;
}

export interface DbOwnerWithdrawalConcept {
  id: string;
  name: string;
  name_key: string;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbSystemSettings {
  id: string;
  backup_enabled: boolean;
  backup_interval: string;
  backup_hour: number;
  backup_folder: string;
  max_backups: number;
  delete_old_backups: boolean;
  verify_checksum: boolean;
  backup_before_restore: boolean;
  backup_on_startup: boolean;
  backup_on_exit: boolean;
  backup_on_import: boolean;
  compression_enabled: boolean;
  default_destination: string;
  // Finanzas del Propietario uses a separate row (id = 'owner-finance') in
  // this existing settings table. The backup settings row remains untouched.
  owner_projected_withdrawal_percentage?: number;
  owner_monthly_profit_goal?: number;
  owner_financial_period?: 'MONTHLY' | 'FORTNIGHTLY';
  owner_withdrawal_concepts?: DbOwnerWithdrawalConcept[];
}

const STORES_V2 = {
  products: 'id, code, name, category, created_at',
  contacts: 'id, type, name, created_at',
  invoices: 'id, number, client_id, date, status, created_at',
  invoice_items: '++id, invoice_id, product_id',
  purchase_invoices: 'id, number, supplier_id, date, created_at',
  purchase_invoice_items: '++id, purchase_invoice_id, product_id',
  expenses: 'id, number, date, created_at',
  supplier_prices: 'id, supplier_id, product_id',
  quotations: 'id, number, client_id, date, created_at',
  quotation_items: '++id, quotation_id, product_id',
  layaways: 'id, invoice_id, created_at',
  layaway_payments: '++id, layaway_id',
  cash_sessions: 'id, date, created_at',
  company_settings: 'id',
  inventory_adjustments: 'id, product_id, created_at',
  supplier_invoices: 'id, supplier_id, created_at',
  supplier_invoice_payments: 'id, supplier_invoice_id',
  users: 'id, &username, role, active',
  activity_log: '++id, user_id, action, entity, created_at',
  backup_meta: 'id',
};

const STORES_V3 = {
  ...STORES_V2,
  categories: 'id, &name_key, name, created_at',
};

const STORES_V4 = {
  ...STORES_V3,
  backup_history: 'id, date, type, destination, status',
  system_settings: 'id',
};

// V5 keeps every V4 table and adds only indexes for fields that already exist
// in persisted rows. No table is removed or renamed.
const STORES_V5 = {
  ...STORES_V4,
  expenses: 'id, number, supplier_id, date, created_at',
  layaway_payments: '++id, layaway_id, created_at',
  inventory_adjustments: 'id, product_id, supplier_id, created_at, adjustment_date',
  supplier_invoice_payments: 'id, supplier_invoice_id, created_at',
  users: 'id, &username, role, active, created_at',
};


const STORES_V6 = {
  ...STORES_V5,
  expenses: 'id, number, supplier_id, account_id, date, created_at',
  layaway_payments: '++id, layaway_id, account_id, created_at',
  supplier_invoices: 'id, supplier_id, source_id, status, issue_date, due_date, created_at',
  supplier_invoice_payments: 'id, supplier_invoice_id, account_id, created_at',
  financial_accounts: 'id, name, kind, active, created_at',
  financial_movements: 'id, type, origin_account_id, destination_account_id, document_id, movement_date, created_at',
  invoice_payment_allocations: 'id, invoice_id, account_id, created_at',
};

class JoyaControlDB extends Dexie {
  products!: Table<DbProduct, string>;
  contacts!: Table<DbContact, string>;
  invoices!: Table<DbInvoice, string>;
  invoice_items!: Table<DbInvoiceItem, number>;
  purchase_invoices!: Table<DbPurchaseInvoice, string>;
  purchase_invoice_items!: Table<DbPurchaseInvoiceItem, number>;
  expenses!: Table<DbExpense, string>;
  // Kept physically for old backups only. Active application code never uses it.
  supplier_prices!: Table<DbLegacyPriceRow, string>;
  quotations!: Table<DbQuotation, string>;
  quotation_items!: Table<DbQuotationItem, number>;
  layaways!: Table<DbLayaway, string>;
  layaway_payments!: Table<DbLayawayPayment, number>;
  cash_sessions!: Table<DbCashSession, string>;
  company_settings!: Table<DbCompanySettings, string>;
  inventory_adjustments!: Table<DbInventoryAdjustment, string>;
  supplier_invoices!: Table<DbSupplierInvoice, string>;
  supplier_invoice_payments!: Table<DbSupplierInvoicePayment, string>;
  users!: Table<DbUser, string>;
  activity_log!: Table<DbActivityLog, number>;
  backup_meta!: Table<DbBackupMeta, string>;
  categories!: Table<DbCategory, string>;
  backup_history!: Table<DbBackupHistory, string>;
  system_settings!: Table<DbSystemSettings, string>;
  financial_accounts!: Table<DbFinancialAccount, string>;
  financial_movements!: Table<DbFinancialMovement, string>;
  invoice_payment_allocations!: Table<DbInvoicePaymentAllocation, string>;

  constructor() {
    super('JoyaControlDB');

    this.version(2).stores(STORES_V2);

    this.version(3).stores(STORES_V3).upgrade(async tx => {
      const products = await tx.table('products').toArray();
      const seen = new Set<string>();
      const now = new Date().toISOString();

      for (const product of products) {
        if (!product.category) continue;
        const key = normalizeCategoryKey(product.category);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        await tx.table('categories').put({
          id: crypto.randomUUID(),
          name: normalizeCategoryName(product.category),
          name_key: key,
          created_at: now,
          auto_created: false,
        });
      }
    });

    this.version(4).stores(STORES_V4);

    // Additive migration only: no table is removed or renamed. V5 adds the
    // missing secondary indexes declared in STORES_V5 and backfills fields used
    // by the current inventory flow. Old backup payloads remain valid because
    // runtime mappers also provide fallbacks when optional fields are absent.
    this.version(5).stores(STORES_V5).upgrade(async tx => {
      await tx.table('products').toCollection().modify((product: DbProduct) => {
        const derivedAvailableGrams = product.category === 'Venta por gramos'
          ? Math.max(0, Number(product.stock) || 0)
          : Math.max(0, (Number(product.weight_grams) || 0) * (Number(product.stock) || 0));

        if (typeof product.reference !== 'string' || !product.reference.trim()) {
          product.reference = product.code || '';
        }
        if (typeof product.available_grams !== 'number' || !Number.isFinite(product.available_grams) || product.available_grams < 0) {
          product.available_grams = derivedAvailableGrams;
        }
        if (typeof product.average_purchase_price !== 'number' || !Number.isFinite(product.average_purchase_price) || product.average_purchase_price < 0) {
          product.average_purchase_price = Math.max(0, Number(product.purchase_price) || 0);
        }
        if (typeof product.last_purchase_date !== 'string') {
          product.last_purchase_date = '';
        }
      });

      await tx.table('inventory_adjustments').toCollection().modify((adjustment: DbInventoryAdjustment) => {
        const numericFields: Array<keyof DbInventoryAdjustment> = [
          'grams',
          'total_cost',
          'unit_cost',
          'value_per_gram',
          'purchase_price',
          'average_price_before',
          'average_price_after',
          'stock_before',
          'stock_after',
          'grams_before',
          'grams_after',
        ];

        numericFields.forEach(field => {
          const value = adjustment[field];
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            (adjustment[field] as number | undefined) = 0;
          }
        });

        if (typeof adjustment.supplier_id !== 'string') adjustment.supplier_id = '';
        if (typeof adjustment.supplier_name !== 'string') adjustment.supplier_name = '';
        if (typeof adjustment.adjustment_date !== 'string' || !adjustment.adjustment_date) {
          adjustment.adjustment_date = adjustment.created_at?.slice(0, 10) || '';
        }
        if (typeof adjustment.notes !== 'string') adjustment.notes = adjustment.reason || '';
      });
    });

    this.version(6).stores(STORES_V6).upgrade(async tx => {
      const now = new Date().toISOString();
      const defaults: DbFinancialAccount[] = [
        { id: 'account-caja-principal', name: 'Caja Principal', kind: 'cash', active: true, balance: 0, created_at: now, updated_at: now },
        { id: 'account-bancolombia', name: 'Bancolombia', kind: 'bank', active: true, balance: 0, created_at: now, updated_at: now },
        { id: 'account-nequi', name: 'Nequi', kind: 'wallet', active: true, balance: 0, created_at: now, updated_at: now },
        { id: 'account-davivienda', name: 'Davivienda', kind: 'bank', active: true, balance: 0, created_at: now, updated_at: now },
        { id: 'account-caja-menor', name: 'Efectivo Caja Menor', kind: 'cash', active: true, balance: 0, created_at: now, updated_at: now },
      ];
      for (const account of defaults) {
        if (!await tx.table('financial_accounts').get(account.id)) await tx.table('financial_accounts').add(account);
      }

      await tx.table('supplier_invoices').toCollection().modify((row: DbSupplierInvoice) => {
        if (typeof row.initial_value !== 'number') row.initial_value = Number(row.total) || 0;
        if (typeof row.pending_balance !== 'number') row.pending_balance = row.status === 'paid' ? 0 : Number(row.total) || 0;
        if (typeof row.source_type !== 'string') row.source_type = 'legacy';
        if (typeof row.source_id !== 'string') row.source_id = '';
        if (typeof row.updated_at !== 'string') row.updated_at = row.created_at || now;
      });
      await tx.table('expenses').toCollection().modify((row: DbExpense) => {
        if (typeof row.account_id !== 'string') row.account_id = '';
      });
    });
  }
}

export const localDb = new JoyaControlDB();
