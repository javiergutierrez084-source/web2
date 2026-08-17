import { applyAdjustmentValue, reverseAdjustmentValue } from '@/lib/InventoryAdjustmentValuation';
import {
  localDb,
  type DbProduct,
  type DbInventoryAdjustment,
  type DbInvoice,
  type DbInvoiceItem,
  type DbLayaway,
  type DbLayawayPayment,
  type DbQuotation,
  type DbFinancialMovement,
  type DbUser,
  type UserRole,
  type DbCategory,
} from '@/lib/localDb';
import {
  calculateInventoryProjection,
  getProductAvailableGrams,
  getProductAveragePurchasePrice,
  isSoldByWeight,
  type Product,
  type Contact,
  type Invoice,
  type PurchaseInvoice,
  type ExpenseInvoice,
  type Quotation,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
} from '@/data/mockData';
import type { CompanyInfo, CashSession, Layaway, LayawayPayment, LayawayPaymentsById, InvoiceCancellationResult, LayawayPaymentResult, LayawayUpdateResult, LayawayDeleteResult, LayawayCancellationResolution, InvoiceFinancialTransactionOptions, ProductChangeSet, ContactChangeSet, CreateQuotationInput } from '@/domain/models';
export type { InvoiceCancellationResult, LayawayPaymentResult, LayawayUpdateResult, LayawayDeleteResult, LayawayCancellationResolution, InvoiceFinancialTransactionOptions } from '@/domain/models';
import type { BackupHistory, BackupSettings } from '@/types/backup';
import { getSession, hashPassword, requirePermission, verifyPassword, type Permission, type SessionUser } from '@/lib/authCore';
import { getAuthorizedLanRepositorySession } from '@/lib/LanRepositoryExecutionContext';
import type { FinancialAccount, FinancialMovement, PaymentAllocation, FinancialSummary } from '@/data/mockData';
import { calculateFinancialSummary, isSalesInvoice } from '@/lib/DashboardMetricsService';
import { LAYAWAY_RESERVE_ACCOUNT_ID, MAIN_CASH_ACCOUNT_ID } from '@/lib/FinancialPositionService';
import { localDateKey } from '@/lib/reportDateRange';

const requireRepositoryPermission = async (permission: Permission): Promise<SessionUser> => {
  const authorizedLanSession = getAuthorizedLanRepositorySession();
  if (authorizedLanSession) {
    // The Principal Server already validated the exact Repository method using
    // the permission snapshot issued at LAN login. Never consult the local
    // desktop session or its Dexie user while executing that request.
    return {
      id: authorizedLanSession.id,
      username: authorizedLanSession.username,
      displayName: authorizedLanSession.displayName,
      role: authorizedLanSession.role,
    };
  }

  return requirePermission(permission);
};

const groupRowsBy = <TRow, TKey extends string | number>(
  rows: TRow[],
  keyOf: (row: TRow) => TKey,
): Map<TKey, TRow[]> => {
  const grouped = new Map<TKey, TRow[]>();
  rows.forEach(row => {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  });
  return grouped;
};

// ── Users, authentication and activity ──
export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: UserRole,
): Promise<DbUser> {
  const userCount = await localDb.users.count();
  if (userCount === 0) {
    if (role !== 'master') throw new Error('El primer usuario debe ser maestro');
  } else {
    await requirePermission('manage_users');
  }

  const normalizedUsername = username.toLowerCase().trim();
  const existing = await localDb.users.where('username').equals(normalizedUsername).first();
  if (existing) throw new Error('El nombre de usuario ya existe');

  const user: DbUser = {
    id: crypto.randomUUID(),
    username: normalizedUsername,
    display_name: displayName.trim(),
    password_hash: await hashPassword(password),
    role,
    active: true,
    created_at: new Date().toISOString(),
    last_login: null,
  };
  await localDb.users.add(user);
  return user;
}

export async function loginUser(username: string, password: string): Promise<SessionUser> {
  const user = await localDb.users.where('username').equals(username.toLowerCase().trim()).first();
  if (!user) throw new Error('Usuario no encontrado');
  if (!user.active) throw new Error('Usuario desactivado. Contacte al administrador.');
  if (!(await verifyPassword(password, user.password_hash))) throw new Error('Contraseña incorrecta');

  await localDb.users.update(user.id, { last_login: new Date().toISOString() });
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const session = getSession();
  if (session?.id === userId) await requirePermission('change_own_password');
  else await requirePermission('manage_users');

  const user = await localDb.users.get(userId);
  if (!user) throw new Error('Usuario no encontrado');
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new Error('Contrasena actual incorrecta');
  }
  if (newPassword.length < 4) {
    throw new Error('La nueva contrasena debe tener al menos 4 caracteres');
  }
  await localDb.users.update(userId, { password_hash: await hashPassword(newPassword) });
}

export async function getMasterExists(): Promise<boolean> {
  return (await localDb.users.where('role').equals('master').count()) > 0;
}

export async function logActivity(
  _session: SessionUser,
  action: string,
  entity: string,
  entityId: string,
  detail = '',
): Promise<void> {
  const session = await requirePermission('write_activity_log');
  await localDb.activity_log.add({
    user_id: session.id,
    user_name: session.displayName,
    action,
    entity,
    entity_id: entityId,
    detail,
    created_at: new Date().toISOString(),
  });
}

export async function fetchUsers(): Promise<DbUser[]> {
  return localDb.users.orderBy('created_at').toArray();
}

export async function updateUser(
  userId: string,
  changes: Partial<Pick<DbUser, 'active' | 'password_hash' | 'display_name' | 'role'>>,
): Promise<void> {
  await requirePermission('manage_users');
  const updated = await localDb.users.update(userId, changes);
  if (!updated) throw new Error('Usuario no encontrado');
}

export async function fetchActivityLog(limit = 500) {
  return localDb.activity_log.orderBy('created_at').reverse().limit(limit).toArray();
}

// ── Categories and bulk import storage ──
export async function fetchCategories(): Promise<DbCategory[]> {
  return localDb.categories.toArray();
}

export async function bulkPutCategories(categories: DbCategory[]): Promise<void> {
  await requireRepositoryPermission('manage_products');
  if (categories.length > 0) await localDb.categories.bulkPut(categories);
}

export async function findCategoryByKey(nameKey: string): Promise<DbCategory | undefined> {
  return localDb.categories.where('name_key').equals(nameKey).first();
}

export async function putCategory(category: DbCategory): Promise<void> {
  await requireRepositoryPermission('manage_products');
  await localDb.categories.put(category);
}

export async function deleteCategory(id: string): Promise<void> {
  await requireRepositoryPermission('manage_products');
  await localDb.categories.delete(id);
}

export async function bulkPutProducts(products: DbProduct[]): Promise<void> {
  await requireRepositoryPermission('manage_products');
  if (products.length > 0) await localDb.products.bulkPut(products);
}

// ── Company ──
export async function fetchCompany(): Promise<CompanyInfo> {
  const data = await localDb.company_settings.toCollection().first();
  if (!data) return { name: 'JoyaControl', nit: '', phone: '', city: '', address: '', email: '', logoUrl: '' };
  return {
    name: data.name, nit: data.nit || '', phone: data.phone || '',
    city: data.city || '', address: data.address || '', email: data.email || '',
    logoUrl: data.logo_url || '',
  };
}

export async function saveCompany(c: CompanyInfo) {
  await requireRepositoryPermission('manage_settings');
  const existing = await localDb.company_settings.toCollection().first();
  if (existing) {
    await localDb.company_settings.update(existing.id, {
      name: c.name, nit: c.nit, phone: c.phone, city: c.city,
      address: c.address, email: c.email, logo_url: c.logoUrl,
    });
  } else {
    await localDb.company_settings.add({
      id: crypto.randomUUID(), name: c.name, nit: c.nit, phone: c.phone,
      city: c.city, address: c.address, email: c.email, logo_url: c.logoUrl,
    });
  }
}

// ── Products ──
const mapDbProduct = (product: DbProduct): Product => {
  const mapped: Product = {
    id: product.id,
    code: product.code,
    name: product.name,
    category: product.category,
    purchasePrice: Number(product.purchase_price) || 0,
    salePrice: Number(product.sale_price) || 0,
    weightGrams: Number(product.weight_grams) || 0,
    margin: Number(product.margin) || 0,
    stock: Number(product.stock) || 0,
    minStock: Number(product.min_stock) || 0,
    description: product.description || '',
    supplierIds: product.supplier_ids || [],
    reference: product.reference || product.code || '',
    availableGrams: typeof product.available_grams === 'number' && Number.isFinite(product.available_grams)
      ? Math.max(0, product.available_grams)
      : undefined,
    averagePurchasePrice: typeof product.average_purchase_price === 'number' && Number.isFinite(product.average_purchase_price)
      ? Math.max(0, product.average_purchase_price)
      : undefined,
    lastPurchaseDate: product.last_purchase_date || '',
  };

  mapped.availableGrams = getProductAvailableGrams(mapped);
  mapped.averagePurchasePrice = getProductAveragePurchasePrice(mapped);
  return mapped;
};

const mapProductToDb = (product: Product, createdAt: string): DbProduct => ({
  id: product.id,
  code: product.code,
  name: product.name,
  category: product.category,
  purchase_price: product.purchasePrice,
  sale_price: product.salePrice,
  weight_grams: product.weightGrams,
  margin: product.margin,
  stock: product.stock,
  min_stock: product.minStock,
  description: product.description || '',
  supplier_ids: product.supplierIds || [],
  reference: product.reference || product.code || '',
  available_grams: getProductAvailableGrams(product),
  average_purchase_price: getProductAveragePurchasePrice(product),
  last_purchase_date: product.lastPurchaseDate || '',
  created_at: createdAt,
});

const productNeedsV5Repair = (product: DbProduct): boolean =>
  typeof product.reference !== 'string' || !product.reference.trim() ||
  typeof product.available_grams !== 'number' || !Number.isFinite(product.available_grams) || product.available_grams < 0 ||
  typeof product.average_purchase_price !== 'number' || !Number.isFinite(product.average_purchase_price) || product.average_purchase_price < 0 ||
  typeof product.last_purchase_date !== 'string';

export async function fetchProducts(): Promise<Product[]> {
  const rows = await localDb.products.orderBy('created_at').reverse().toArray();
  const products = rows.map(mapDbProduct);

  // A legacy backup can be restored after the database is already on V5, in
  // which case the version upgrader does not run again. Persist the derived V5
  // fields lazily so they do not exist only in React memory.
  const repairs = rows.flatMap((row, index) =>
    productNeedsV5Repair(row)
      ? [mapProductToDb(products[index], row.created_at || '')]
      : [],
  );
  if (repairs.length > 0) {
    await requireRepositoryPermission('system_maintenance');
    await localDb.products.bulkPut(repairs);
  }

  return products;
}

export async function upsertProduct(product: Product): Promise<void> {
  await requireRepositoryPermission('manage_products');
  const existing = await localDb.products.get(product.id);
  await localDb.products.put(mapProductToDb(
    product,
    existing?.created_at || new Date().toISOString(),
  ));
}

export async function deleteProduct(id: string): Promise<void> {
  await requireRepositoryPermission('manage_products');
  await localDb.products.delete(id);
}

/**
 * Applies a complete product change set in one repository call. The context
 * computes the diff; the storage adapter commits every write atomically.
 */
export async function applyProductChanges(changes: ProductChangeSet): Promise<void> {
  await requireRepositoryPermission('manage_products');
  if (changes.upserts.length === 0 && changes.deleteIds.length === 0) return;

  await localDb.transaction('rw', localDb.products, async () => {
    if (changes.upserts.length > 0) {
      const existingRows = await localDb.products.bulkGet(changes.upserts.map(product => product.id));
      const now = new Date().toISOString();
      const rows = changes.upserts.map((product, index) => mapProductToDb(
        product,
        existingRows[index]?.created_at || now,
      ));
      await localDb.products.bulkPut(rows);
    }
    if (changes.deleteIds.length > 0) {
      await localDb.products.bulkDelete(changes.deleteIds);
    }
  });
}

// ── Contacts ──
export async function fetchContacts(): Promise<Contact[]> {
  const data = await localDb.contacts.orderBy('created_at').reverse().toArray();
  return data.map(c => ({
    id: c.id, type: c.type as 'client' | 'supplier', name: c.name,
    document: c.document || '', phone: c.phone || '', email: c.email || '',
    address: c.address || '', notes: c.notes || '',
  }));
}

export async function upsertContact(c: Contact) {
  await requireRepositoryPermission('manage_contacts');
  await localDb.contacts.put({
    id: c.id, type: c.type, name: c.name, document: c.document,
    phone: c.phone, email: c.email, address: c.address, notes: c.notes || '',
    created_at: new Date().toISOString(),
  });
}

export async function deleteContact(id: string) {
  await requireRepositoryPermission('manage_contacts');
  await localDb.contacts.delete(id);
}

/** Applies contact additions, edits and removals atomically. */
export async function applyContactChanges(changes: ContactChangeSet<Contact>): Promise<void> {
  await requireRepositoryPermission('manage_contacts');
  if (changes.upserts.length === 0 && changes.deleteIds.length === 0) return;

  await localDb.transaction('rw', localDb.contacts, async () => {
    if (changes.upserts.length > 0) {
      const now = new Date().toISOString();
      await localDb.contacts.bulkPut(changes.upserts.map(contact => ({
        id: contact.id,
        type: contact.type,
        name: contact.name,
        document: contact.document,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        notes: contact.notes || '',
        created_at: now,
      })));
    }
    if (changes.deleteIds.length > 0) {
      await localDb.contacts.bulkDelete(changes.deleteIds);
    }
  });
}

// ── Invoices ──
const mapInvoiceToDb = (invoice: Invoice, createdAt: string): DbInvoice => ({
  id: invoice.id,
  number: invoice.number,
  client_id: invoice.clientId || '',
  client_name: invoice.clientName || '',
  subtotal: invoice.subtotal,
  discount: invoice.discount,
  tax: invoice.tax,
  total: invoice.total,
  date: invoice.date,
  status: invoice.status,
  payment_method: invoice.paymentMethod || '',
  client_notes: invoice.clientNotes || '',
  internal_notes: invoice.internalNotes || '',
  cancellation_reason: invoice.cancellationReason || '',
  cancelled_at: invoice.cancelledAt || '',
  cancelled_by: invoice.cancelledBy || '',
  tipo_documento: invoice.tipoDocumento || 'factura',
  created_at: createdAt,
});

const mapInvoiceItemToDb = (invoiceId: string, item: Invoice['items'][number]): DbInvoiceItem => ({
  invoice_id: invoiceId,
  product_id: item.productId || '',
  code: item.code,
  name: item.name,
  quantity: item.quantity,
  weight_grams: item.weightGrams,
  unit_price: item.unitPrice,
  subtotal: item.subtotal,
  price_modified: item.priceModified || false,
  original_price: item.originalPrice || 0,
  cost_price: item.costPrice,
});

const mapDbInvoice = (invoice: DbInvoice, items: DbInvoiceItem[]): Invoice => ({
  id: invoice.id,
  number: invoice.number,
  clientId: invoice.client_id || '',
  clientName: invoice.client_name || '',
  items: items.map(item => ({
    productId: item.product_id || '',
    code: item.code,
    name: item.name,
    quantity: item.quantity,
    weightGrams: item.weight_grams,
    unitPrice: item.unit_price,
    subtotal: item.subtotal,
    priceModified: item.price_modified,
    originalPrice: item.original_price,
    costPrice: item.cost_price,
  })),
  paymentAllocations: [],
  subtotal: invoice.subtotal,
  discount: invoice.discount,
  tax: invoice.tax,
  total: invoice.total,
  date: invoice.date,
  status: invoice.status as Invoice['status'],
  paymentMethod: invoice.payment_method || '',
  clientNotes: invoice.client_notes || '',
  internalNotes: invoice.internal_notes || '',
  cancellationReason: invoice.cancellation_reason || '',
  cancelledAt: invoice.cancelled_at || '',
  cancelledBy: invoice.cancelled_by || '',
  tipoDocumento: (invoice.tipo_documento || 'factura') as Invoice['tipoDocumento'],
});

const groupInvoiceItems = (items: DbInvoiceItem[]): Map<string, DbInvoiceItem[]> =>
  groupRowsBy(items, item => item.invoice_id);

async function addInvoiceTx(invoice: Invoice): Promise<void> {
  await localDb.invoices.add(mapInvoiceToDb(invoice, new Date().toISOString()));
  if (invoice.items.length > 0) {
    await localDb.invoice_items.bulkAdd(invoice.items.map(item => mapInvoiceItemToDb(invoice.id, item)));
  }
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const invoiceRows = await localDb.invoices.orderBy('created_at').reverse().toArray();
  if (invoiceRows.length === 0) return [];

  const invoiceIds = invoiceRows.map(invoice => invoice.id);
  const itemRows = await localDb.invoice_items.where('invoice_id').anyOf(invoiceIds).toArray();
  const itemsByInvoice = groupInvoiceItems(itemRows);
  return invoiceRows.map(invoice => mapDbInvoice(invoice, itemsByInvoice.get(invoice.id) || []));
}

export async function insertInvoice(invoice: Invoice): Promise<void> {
  await requireRepositoryPermission('edit_sales');
  if (isSalesInvoice(invoice)) {
    throw new Error('ATOMIC_SALE_TRANSACTION_REQUIRED');
  }
  await localDb.transaction('rw', localDb.invoices, localDb.invoice_items, async () => {
    await addInvoiceTx(invoice);
  });
}

export async function updateInvoiceStatus(id: string, status: string) {
  await requireRepositoryPermission('edit_sales');
  if (status === 'cancelled') throw new Error('ATOMIC_INVOICE_CANCELLATION_REQUIRED');
  await localDb.invoices.update(id, { status });
}

type CancellationPaymentSource = {
  id: string;
  accountId: string;
  amount: number;
  source: 'invoice_allocation' | 'layaway_payment' | 'customer_credit';
  destinationAccountId?: string;
  movementId?: string;
};

const CANCELLATION_EPSILON = 0.01;

const aggregatePaymentSources = (sources: CancellationPaymentSource[]): Map<string, number> => {
  const byAccount = new Map<string, number>();
  sources.forEach(source => {
    byAccount.set(source.accountId, (byAccount.get(source.accountId) || 0) + source.amount);
  });
  return byAccount;
};

const validatePaymentSources = (
  sources: CancellationPaymentSource[],
  invoiceTotal: number,
  invoiceStatus: string,
): void => {
  sources.forEach(source => {
    if (!source.id) throw new Error('CORRUPT_PAYMENT_ASSIGNMENT');
    if (!source.accountId) throw new Error('CORRUPT_PAYMENT_ASSIGNMENT');
    if (!Number.isFinite(source.amount) || source.amount <= 0) throw new Error('CORRUPT_PAYMENT_ASSIGNMENT');
  });
  const total = sources.reduce((sum, source) => sum + source.amount, 0);
  if (total > invoiceTotal + CANCELLATION_EPSILON) throw new Error('CORRUPT_PAYMENT_ASSIGNMENT');
  if (invoiceStatus === 'paid' && Math.abs(total - invoiceTotal) > CANCELLATION_EPSILON) {
    throw new Error('CORRUPT_PAYMENT_ASSIGNMENT');
  }
};

const validateOriginalFinancialMovements = (
  sources: CancellationPaymentSource[],
  movements: DbFinancialMovement[],
  allowLayawayCompletionTransfers = false,
): void => {
  if (sources.length === 0) {
    if (movements.length > 0) throw new Error('ORPHAN_FINANCIAL_MOVEMENTS');
    return;
  }
  if (movements.length === 0) throw new Error('FINANCIAL_MOVEMENTS_NOT_FOUND');

  const expected = aggregatePaymentSources(sources);
  const actual = new Map<string, number>();
  movements.forEach(movement => {
    if (!isActiveDbFinancialMovement(movement)) throw new Error('CORRUPT_FINANCIAL_MOVEMENTS');
    const regularSaleIncome = movement.type === 'sale_income' && !movement.origin_account_id;
    const layawayCompletionTransfer = allowLayawayCompletionTransfers
      && movement.type === 'transfer'
      && movement.origin_account_id === LAYAWAY_RESERVE_ACCOUNT_ID;
    const customerCreditPayment = movement.movement_code === 'CUSTOMER_CREDIT_USED'
      && movement.type === 'transfer'
      && movement.origin_account_id === LAYAWAY_RESERVE_ACCOUNT_ID;
    if (
      (!regularSaleIncome && !layawayCompletionTransfer && !customerCreditPayment) ||
      !movement.destination_account_id ||
      !Number.isFinite(movement.amount) ||
      movement.amount <= 0
    ) {
      throw new Error('CORRUPT_FINANCIAL_MOVEMENTS');
    }
    actual.set(
      movement.destination_account_id,
      (actual.get(movement.destination_account_id) || 0) + movement.amount,
    );
  });

  if (expected.size !== actual.size) throw new Error('CORRUPT_FINANCIAL_MOVEMENTS');
  expected.forEach((amount, accountId) => {
    if (Math.abs((actual.get(accountId) || 0) - amount) > CANCELLATION_EPSILON) {
      throw new Error('CORRUPT_FINANCIAL_MOVEMENTS');
    }
  });
};

const findConvertedQuotationTx = async (invoice: DbInvoice): Promise<DbQuotation | null> => {
  const conversionLogs = await localDb.activity_log
    .where('action')
    .equals('QUOTATION_CONVERTED')
    .and(entry => entry.entity === 'quotation' && entry.detail.endsWith(`→ ${invoice.number}`))
    .toArray();
  if (conversionLogs.length > 1) throw new Error('AMBIGUOUS_QUOTATION_SOURCE');
  if (conversionLogs.length === 0) return null;

  const quotation = await localDb.quotations.get(conversionLogs[0].entity_id);
  if (!quotation) throw new Error('QUOTATION_SOURCE_NOT_FOUND');
  if (quotation.status !== 'accepted') throw new Error('QUOTATION_SOURCE_STATUS_INVALID');
  const quotationItems = await localDb.quotation_items
    .where('quotation_id')
    .equals(quotation.id)
    .toArray();
  if (quotationItems.length === 0) throw new Error('QUOTATION_SOURCE_ITEMS_NOT_FOUND');
  return quotation;
};

/**
 * Official ACID cancellation engine for invoices.
 *
 * Inventory restoration, financial reversals, payment-assignment cleanup,
 * document status, related layaway/quotation changes and activity logging are
 * committed in one Dexie transaction. Any exception aborts every write.
 */
export async function cancelInvoice(id: string, reason: string): Promise<InvoiceCancellationResult> {
  const permissionUser = await requireRepositoryPermission('cancel_invoices');
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('CANCELLATION_REASON_REQUIRED');

  return localDb.transaction('rw', [
    localDb.products,
    localDb.invoices,
    localDb.invoice_items,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
    localDb.invoice_payment_allocations,
    localDb.supplier_invoice_payments,
    localDb.layaways,
    localDb.layaway_payments,
    localDb.quotation_items,
    localDb.quotations,
  ], async () => {
    const invoice = await localDb.invoices.get(id);
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    if (invoice.status === 'cancelled') throw new Error('INVOICE_ALREADY_CANCELLED');
    if (!isSalesInvoice({
      status: invoice.status,
      tipoDocumento: (invoice.tipo_documento || 'factura') as Invoice['tipoDocumento'],
    })) throw new Error('INVOICE_NOT_COMMERCIAL_SALE');
    const user = permissionUser;

    const itemRows = await localDb.invoice_items.where('invoice_id').equals(id).toArray();
    if (itemRows.length === 0) throw new Error('INVOICE_ITEMS_NOT_FOUND');

    const restoreByProduct = new Map<string, { quantity: number; soldWeight: number; unitWeightTotal: number }>();
    for (const item of itemRows) {
      if (!item.product_id) throw new Error('CANCELLATION_PRODUCT_REFERENCE_MISSING');
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('CORRUPT_INVOICE_ITEMS');
      if (!Number.isFinite(item.weight_grams) || item.weight_grams < 0) throw new Error('CORRUPT_INVOICE_ITEMS');
      const current = restoreByProduct.get(item.product_id) || { quantity: 0, soldWeight: 0, unitWeightTotal: 0 };
      current.quantity += item.quantity;
      current.soldWeight += item.weight_grams;
      current.unitWeightTotal += item.weight_grams * item.quantity;
      restoreByProduct.set(item.product_id, current);
    }

    const productIds = Array.from(restoreByProduct.keys());
    const productRows = await localDb.products.bulkGet(productIds);
    const restorationPlan: Array<{ row: DbProduct; product: Product; stockAfter: number; gramsAfter: number }> = [];
    productRows.forEach((row, index) => {
      if (!row) throw new Error('CANCELLATION_PRODUCT_NOT_FOUND');
      const product = mapDbProduct(row);
      const restore = restoreByProduct.get(productIds[index]);
      if (!restore) throw new Error('CORRUPT_INVOICE_ITEMS');
      const currentStock = Number(product.stock);
      const currentGrams = Number(getProductAvailableGrams(product));
      if (!Number.isFinite(currentStock) || currentStock < 0 || !Number.isFinite(currentGrams) || currentGrams < 0) {
        throw new Error('CORRUPT_PRODUCT_INVENTORY');
      }
      const stockAfter = currentStock + restore.quantity;
      const gramsToRestore = isSoldByWeight(product) ? restore.soldWeight : restore.unitWeightTotal;
      const gramsAfter = currentGrams + gramsToRestore;
      if (!Number.isFinite(stockAfter) || stockAfter < 0 || !Number.isFinite(gramsAfter) || gramsAfter < 0) {
        throw new Error('CANCELLATION_INVENTORY_INVALID');
      }
      restorationPlan.push({ row, product, stockAfter, gramsAfter });
    });

    const layaway = await localDb.layaways.where('invoice_id').equals(id).first();
    const allocations = await localDb.invoice_payment_allocations.where('invoice_id').equals(id).toArray();
    const layawayPayments = layaway
      ? await localDb.layaway_payments.where('layaway_id').equals(layaway.id).toArray()
      : [];
    if (layaway && allocations.length > 0) throw new Error('MIXED_INVOICE_PAYMENT_SOURCES');

    const customerCreditMovements = layaway
      ? []
      : await localDb.financial_movements
          .where('document_id')
          .equals(id)
          .and(movement => (
            movement.movement_code === 'CUSTOMER_CREDIT_USED'
            && isActiveDbFinancialMovement(movement)
          ))
          .toArray();
    const paymentSources: CancellationPaymentSource[] = layaway
      ? layawayPayments.map(payment => ({
          id: String(payment.id || ''),
          accountId: payment.account_id || '',
          amount: Number(payment.amount),
          source: 'layaway_payment' as const,
        }))
      : [
          ...allocations.map(allocation => ({
            id: allocation.id,
            accountId: allocation.account_id,
            amount: Number(allocation.amount),
            source: 'invoice_allocation' as const,
          })),
          ...customerCreditMovements.map(movement => ({
            id: movement.id,
            movementId: movement.id,
            accountId: movement.destination_account_id,
            destinationAccountId: LAYAWAY_RESERVE_ACCOUNT_ID,
            amount: Number(movement.amount),
            source: 'customer_credit' as const,
          })),
        ];
    validatePaymentSources(paymentSources, Number(invoice.total) || 0, invoice.status);

    const originalMovements = layaway
      ? await localDb.financial_movements
          .where('document_id')
          .equals(layaway.id)
          .and(movement => (
            movement.document_type === 'layaway_completion'
            || (movement.document_type === 'layaway' && movement.destination_account_id !== LAYAWAY_RESERVE_ACCOUNT_ID)
          ))
          .toArray()
      : await localDb.financial_movements
          .where('document_id')
          .equals(id)
          .and(movement => (
            movement.document_type === 'invoice'
            || movement.movement_code === 'CUSTOMER_CREDIT_USED'
          ))
          .toArray();
    validateOriginalFinancialMovements(paymentSources, originalMovements, Boolean(layaway));

    const supplierPayments = await localDb.supplier_invoice_payments
      .where('supplier_invoice_id')
      .equals(id)
      .toArray();
    if (supplierPayments.length > 0) throw new Error('INVOICE_SUPPLIER_PAYMENT_CONFLICT');

    const amountsByAccount = aggregatePaymentSources(paymentSources);
    const accountIds = Array.from(amountsByAccount.keys());
    const accountRows = await localDb.financial_accounts.bulkGet(accountIds);
    accountRows.forEach((account, index) => {
      if (!account) throw new Error('CANCELLATION_ACCOUNT_NOT_FOUND');
      const required = amountsByAccount.get(accountIds[index]) || 0;
      if (!Number.isFinite(account.balance) || account.balance < required - CANCELLATION_EPSILON) {
        throw new Error('CANCELLATION_NEGATIVE_ACCOUNT_BALANCE');
      }
    });

    const convertedQuotation = await findConvertedQuotationTx(invoice);

    // All validations above complete before the first write.
    const restoredProducts: Product[] = [];
    for (const plan of restorationPlan) {
      await localDb.products.update(plan.row.id, {
        stock: plan.stockAfter,
        available_grams: plan.gramsAfter,
      });
      restoredProducts.push({
        ...plan.product,
        stock: plan.stockAfter,
        availableGrams: plan.gramsAfter,
      });
    }

    const cancellationInstant = new Date();
    const cancellationDate = cancellationInstant.toISOString();
    const cancellationDay = localDateKey(cancellationInstant);
    // Reverse the immutable ledger entries themselves, one by one. Payment
    // allocations may be split differently from a completed layaway movement,
    // so using allocations as the reversal loop could link several SALE_CANCEL
    // rows to the same original and leave another original orphaned.
    for (const originalMovement of originalMovements) {
      const customerCredit = originalMovement.movement_code === 'CUSTOMER_CREDIT_USED';
      const reversalOriginAccountId = originalMovement.destination_account_id;
      if (!reversalOriginAccountId) throw new Error('CORRUPT_FINANCIAL_MOVEMENTS');
      await addFinancialMovementTx({
        type: customerCredit ? 'transfer' : 'adjustment',
        amount: Number(originalMovement.amount),
        originAccountId: reversalOriginAccountId,
        destinationAccountId: customerCredit ? LAYAWAY_RESERVE_ACCOUNT_ID : undefined,
        reference: `Anulación ${invoice.number}`,
        documentType: customerCredit ? 'customer_credit_reversal' : 'invoice_cancellation',
        documentId: id,
        observation: normalizedReason,
        date: cancellationDay,
        movementCode: customerCredit ? 'REVERSAL' : 'SALE_CANCEL',
        referenceType: 'SALE',
        referenceId: id,
        relatedMovementId: originalMovement.id,
        notes: normalizedReason,
        customerId: customerCredit ? invoice.client_id : undefined,
      });
      if (customerCredit) {
        await localDb.financial_movements.update(originalMovement.id, {
          status: 'REVERSED',
          updated_at: cancellationDate,
        });
      }
    }

    if (allocations.length > 0) {
      await localDb.invoice_payment_allocations.bulkDelete(allocations.map(allocation => allocation.id));
    }
    if (layaway) {
      if (layawayPayments.length > 0) {
        await localDb.layaway_payments.bulkDelete(
          layawayPayments.map(payment => payment.id).filter((paymentId): paymentId is number => typeof paymentId === 'number'),
        );
      }
      await localDb.layaways.delete(layaway.id);
    }

    const updated = await localDb.invoices.update(id, {
      status: 'cancelled',
      cancellation_reason: normalizedReason,
      cancelled_at: cancellationDate,
      cancelled_by: user.displayName,
    });
    if (!updated) throw new Error('INVOICE_NOT_FOUND');

    if (convertedQuotation) {
      const quotationUpdated = await localDb.quotations.update(convertedQuotation.id, { status: 'active' });
      if (!quotationUpdated) throw new Error('QUOTATION_SOURCE_NOT_FOUND');
      await addActivityTx(
        'QUOTATION_REOPENED_AFTER_INVOICE_CANCELLATION',
        'quotation',
        convertedQuotation.id,
        `${convertedQuotation.number} ← ${invoice.number}`,
      );
    }

    await addActivityTx(
      'INVOICE_CANCELLED',
      'invoice',
      id,
      JSON.stringify({
        reason: normalizedReason,
        number: invoice.number,
        restoredProducts: restoredProducts.length,
        reversedPayments: paymentSources.length,
        layawayId: layaway?.id || '',
        quotationId: convertedQuotation?.id || '',
      }),
    );

    return {
      invoiceId: id,
      cancelledAt: cancellationDate,
      cancelledBy: user.displayName,
      restoredProducts,
      removedLayawayId: layaway?.id,
      reopenedQuotationId: convertedQuotation?.id,
    };
  });
}

// ── Purchase Invoices ──
export async function fetchPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const purchases = await localDb.purchase_invoices.orderBy('created_at').reverse().toArray();
  if (purchases.length === 0) return [];

  const ids = purchases.map(p => p.id);
  const items = await localDb.purchase_invoice_items.where('purchase_invoice_id').anyOf(ids).toArray();
  const itemsByPurchase = groupRowsBy(items, item => item.purchase_invoice_id);

  return purchases.map(p => ({
    id: p.id, number: p.number, supplierId: p.supplier_id || '', supplierName: p.supplier_name,
    items: (itemsByPurchase.get(p.id) || []).map(it => ({
      productId: it.product_id || '', code: it.code, name: it.name,
      quantity: it.quantity, weightGrams: it.weight_grams,
      unitPrice: it.unit_price, subtotal: it.subtotal,
    })),
    subtotal: p.subtotal, discount: p.discount, tax: p.tax,
    total: p.total, date: p.date, status: p.status as any,
    description: p.description || '', paymentMethod: p.payment_method || '',
  }));
}


export async function createPurchaseWithInventory(purchase: PurchaseInvoice, accountId?: string): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  await localDb.transaction('rw', localDb.purchase_invoices, localDb.purchase_invoice_items, localDb.products,
    localDb.supplier_invoices, localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
      if (await localDb.purchase_invoices.get(purchase.id)) throw new Error('PURCHASE_ALREADY_EXISTS');
      const createdAt = new Date().toISOString();
      for (const item of purchase.items) {
        const dbProduct = await localDb.products.get(item.productId);
        if (!dbProduct) throw new Error('PRODUCT_NOT_FOUND');
        const product = mapDbProduct(dbProduct);
        const oldStock = product.stock;
        const oldValue = getProductAveragePurchasePrice(product) * oldStock;
        const nextStock = oldStock + item.quantity;
        const addedValue = item.unitPrice * item.quantity;
        const nextAverage = nextStock > 0 ? (oldValue + addedValue) / nextStock : item.unitPrice;
        const next: Product = {
          ...product,
          stock: nextStock,
          availableGrams: getProductAvailableGrams(product) + (item.weightGrams * item.quantity),
          purchasePrice: item.unitPrice,
          averagePurchasePrice: nextAverage,
          lastPurchaseDate: purchase.date,
        };
        await localDb.products.put(mapProductToDb(next, dbProduct.created_at));
      }
      await localDb.purchase_invoices.add({ id: purchase.id, number: purchase.number, supplier_id: purchase.supplierId,
        supplier_name: purchase.supplierName, subtotal: purchase.subtotal, discount: purchase.discount, tax: purchase.tax,
        total: purchase.total, date: purchase.date, status: purchase.status, description: purchase.description || '',
        payment_method: purchase.paymentMethod || '', created_at: createdAt });
      await localDb.purchase_invoice_items.bulkAdd(purchase.items.map(item => ({ purchase_invoice_id: purchase.id,
        product_id: item.productId, code: item.code, name: item.name, quantity: item.quantity,
        weight_grams: item.weightGrams, unit_price: item.unitPrice, subtotal: item.subtotal })));
      if (purchase.status === 'paid') {
        if (!accountId) throw new Error('PAYMENT_ACCOUNT_REQUIRED');
        await addFinancialMovementTx({ type: 'inventory_purchase', amount: purchase.total, originAccountId: accountId,
          reference: purchase.number, documentType: 'purchase_invoice', documentId: purchase.id,
          observation: purchase.supplierName, date: purchase.date });
        await addActivityTx('PURCHASE_MARKED_AS_PAID', 'purchase_invoice', purchase.id, JSON.stringify({ previousValue: 0, newValue: purchase.total }));
      } else {
        await localDb.supplier_invoices.add({ id: crypto.randomUUID(), supplier_id: purchase.supplierId,
          supplier_name: purchase.supplierName, invoice_number: purchase.number, issue_date: purchase.date,
          due_date: purchase.date, total: purchase.total, initial_value: purchase.total, pending_balance: purchase.total,
          source_type: 'purchase_invoice', source_id: purchase.id, status: 'pending', notes: purchase.description || '', created_at: createdAt });
      }
      await addActivityTx('PURCHASE_CREATED', 'purchase_invoice', purchase.id, JSON.stringify({ value: purchase.total, status: purchase.status }));
    });
}

export async function updatePurchaseWithInventory(purchase: PurchaseInvoice): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  await localDb.transaction('rw', localDb.purchase_invoices, localDb.purchase_invoice_items, localDb.products,
    localDb.supplier_invoices, localDb.supplier_invoice_payments, localDb.financial_movements, localDb.activity_log, async () => {
      const previous = await localDb.purchase_invoices.get(purchase.id);
      if (!previous) throw new Error('PURCHASE_NOT_FOUND');
      const linkedPayable = await localDb.supplier_invoices.filter(row => row.source_type === 'purchase_invoice' && row.source_id === purchase.id).first();
      const linkedPaymentCount = linkedPayable ? await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(linkedPayable.id).count() : 0;
      if (linkedPaymentCount > 0) throw new Error('PURCHASE_HAS_PARTIAL_PAYMENTS');
      if (previous.status === 'paid' && Math.abs(previous.total - purchase.total) > 0.01) throw new Error('PAID_PURCHASE_VALUE_LOCKED');
      const oldItems = await localDb.purchase_invoice_items.where('purchase_invoice_id').equals(purchase.id).toArray();
      const deltas = new Map<string, { qty: number; grams: number; value: number; price: number }>();
      for (const item of oldItems) deltas.set(item.product_id, { qty: -item.quantity, grams: -(item.weight_grams * item.quantity), value: -(item.unit_price * item.quantity), price: item.unit_price });
      for (const item of purchase.items) {
        const d = deltas.get(item.productId) || { qty: 0, grams: 0, value: 0, price: item.unitPrice };
        d.qty += item.quantity; d.grams += item.weightGrams * item.quantity; d.value += item.unitPrice * item.quantity; d.price = item.unitPrice;
        deltas.set(item.productId, d);
      }
      for (const [productId, delta] of deltas) {
        const dbProduct = await localDb.products.get(productId);
        if (!dbProduct) throw new Error('PRODUCT_NOT_FOUND');
        const product = mapDbProduct(dbProduct);
        const nextStock = product.stock + delta.qty;
        const nextGrams = getProductAvailableGrams(product) + delta.grams;
        if (nextStock < -0.0001 || nextGrams < -0.0001) throw new Error('PURCHASE_REVERSAL_INSUFFICIENT_STOCK');
        const currentValue = getProductAveragePurchasePrice(product) * product.stock;
        const nextValue = currentValue + delta.value;
        const nextAverage = nextStock > 0 ? Math.max(0, nextValue / nextStock) : 0;
        await localDb.products.put(mapProductToDb({ ...product, stock: Math.max(0, nextStock), availableGrams: Math.max(0, nextGrams),
          purchasePrice: delta.price, averagePurchasePrice: nextAverage, lastPurchaseDate: purchase.date }, dbProduct.created_at));
      }
      await localDb.purchase_invoice_items.where('purchase_invoice_id').equals(purchase.id).delete();
      await localDb.purchase_invoice_items.bulkAdd(purchase.items.map(item => ({ purchase_invoice_id: purchase.id,
        product_id: item.productId, code: item.code, name: item.name, quantity: item.quantity,
        weight_grams: item.weightGrams, unit_price: item.unitPrice, subtotal: item.subtotal })));
      await localDb.purchase_invoices.update(purchase.id, { supplier_id: purchase.supplierId, supplier_name: purchase.supplierName,
        subtotal: purchase.subtotal, discount: purchase.discount, tax: purchase.tax, total: purchase.total, date: purchase.date,
        description: purchase.description || '', payment_method: purchase.paymentMethod || '' });
      const payable = linkedPayable;
      if (payable) {
        await localDb.supplier_invoices.update(payable.id, { supplier_id: purchase.supplierId, supplier_name: purchase.supplierName,
          invoice_number: purchase.number, issue_date: purchase.date, total: purchase.total, initial_value: purchase.total,
          pending_balance: purchase.total, status: 'pending', notes: purchase.description || '', updated_at: new Date().toISOString() });
        await addActivityTx('PURCHASE_PAYABLE_UPDATED', 'supplier_invoice', payable.id, JSON.stringify({
          purchaseId: purchase.id, previousValue: payable.initial_value ?? payable.total, newValue: purchase.total,
          sourceType: 'purchase_invoice', sourceId: purchase.id,
        }));
      }
      await addActivityTx('PURCHASE_EDITED', 'purchase_invoice', purchase.id, JSON.stringify({ previousValue: previous.total, newValue: purchase.total }));
    });
}

export async function deletePurchaseWithInventory(id: string): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  await localDb.transaction('rw', localDb.purchase_invoices, localDb.purchase_invoice_items, localDb.products,
    localDb.supplier_invoices, localDb.supplier_invoice_payments, localDb.financial_movements, localDb.activity_log, async () => {
      const purchase = await localDb.purchase_invoices.get(id);
      if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
      const linkedMovements = await localDb.financial_movements.filter(m => m.document_type === 'purchase_invoice' && m.document_id === id).count();
      if (purchase.status === 'paid' || linkedMovements > 0) throw new Error('PAID_PURCHASE_REVERSAL_REQUIRED');
      const payable = await localDb.supplier_invoices.filter(row => row.source_type === 'purchase_invoice' && row.source_id === id).first();
      if (payable && await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(payable.id).count()) throw new Error('PAID_PURCHASE_REVERSAL_REQUIRED');
      const items = await localDb.purchase_invoice_items.where('purchase_invoice_id').equals(id).toArray();
      for (const item of items) {
        const dbProduct = await localDb.products.get(item.product_id);
        if (!dbProduct) throw new Error('PRODUCT_NOT_FOUND');
        const product = mapDbProduct(dbProduct);
        const nextStock = product.stock - item.quantity;
        const nextGrams = getProductAvailableGrams(product) - item.weight_grams * item.quantity;
        if (nextStock < -0.0001 || nextGrams < -0.0001) throw new Error('PURCHASE_REVERSAL_INSUFFICIENT_STOCK');
        const nextValue = getProductAveragePurchasePrice(product) * product.stock - item.unit_price * item.quantity;
        await localDb.products.put(mapProductToDb({ ...product, stock: Math.max(0, nextStock), availableGrams: Math.max(0, nextGrams),
          averagePurchasePrice: nextStock > 0 ? Math.max(0, nextValue / nextStock) : 0 }, dbProduct.created_at));
      }
      await localDb.purchase_invoice_items.where('purchase_invoice_id').equals(id).delete();
      await localDb.purchase_invoices.delete(id);
      if (payable) await localDb.supplier_invoices.delete(payable.id);
      await addActivityTx('PURCHASE_DELETED', 'purchase_invoice', id, JSON.stringify({ previousValue: purchase.total, reason: 'Compra pendiente sin pagos' }));
    });
}

export async function markPurchaseAsPaid(id: string, accountId: string): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  await localDb.transaction('rw', localDb.purchase_invoices, localDb.supplier_invoices, localDb.supplier_invoice_payments,
    localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
      const purchase = await localDb.purchase_invoices.get(id);
      if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
      if (purchase.status === 'paid') return;
      const payable = await localDb.supplier_invoices.filter(row => row.source_type === 'purchase_invoice' && row.source_id === id).first();
      if (payable && await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(payable.id).count()) throw new Error('PURCHASE_HAS_PARTIAL_PAYMENTS');
      await addFinancialMovementTx({ type: 'inventory_purchase', amount: purchase.total, originAccountId: accountId,
        reference: purchase.number, documentType: 'purchase_invoice', documentId: id, observation: purchase.supplier_name, date: purchase.date });
      await localDb.purchase_invoices.update(id, { status: 'paid' });
      if (payable) await localDb.supplier_invoices.delete(payable.id);
      await addActivityTx('PURCHASE_MARKED_AS_PAID', 'purchase_invoice', id, JSON.stringify({ previousValue: 0, newValue: purchase.total }));
    });
}

/** Purchase writes above remain atomic and authoritative in the Principal Server Repository. */

// ── Expenses ──
export async function fetchExpenses(): Promise<ExpenseInvoice[]> {
  const data = await localDb.expenses.orderBy('created_at').reverse().toArray();
  return data.map(e => ({
    id: e.id, number: e.number, supplierId: e.supplier_id || '', supplierName: e.supplier_name,
    total: e.total, description: e.description || '', date: e.date,
    paymentMethod: e.payment_method || '', status: e.status as any, accountId: e.account_id || '',
  }));
}

export async function insertExpense(e: ExpenseInvoice) {
  await requireRepositoryPermission('manage_expenses');
  const existing = await localDb.expenses.get(e.id);
  await localDb.expenses.put({
    id: e.id, number: e.number, supplier_id: e.supplierId || '',
    supplier_name: e.supplierName, total: e.total, description: e.description,
    date: e.date, payment_method: e.paymentMethod, status: e.status, account_id: e.accountId || '',
    created_at: existing?.created_at || new Date().toISOString(),
  });
}

// ── Quotations ──
export async function fetchQuotations(): Promise<Quotation[]> {
  const quotations = await localDb.quotations.orderBy('created_at').reverse().toArray();
  if (quotations.length === 0) return [];

  const ids = quotations.map(q => q.id);
  const items = await localDb.quotation_items.where('quotation_id').anyOf(ids).toArray();
  const itemsByQuotation = groupRowsBy(items, item => item.quotation_id);

  return quotations.map(q => ({
    id: q.id, number: q.number, clientId: q.client_id || '', clientName: q.client_name,
    items: (itemsByQuotation.get(q.id) || []).map(it => ({
      productId: it.product_id || '', code: it.code, name: it.name,
      quantity: it.quantity, weightGrams: it.weight_grams,
      unitPrice: it.unit_price, subtotal: it.subtotal,
    })),
    subtotal: q.subtotal, discount: q.discount, tax: q.tax,
    total: q.total, date: q.date, validUntil: q.valid_until,
    status: q.status as any, notes: q.notes || '',
  }));
}


const nextQuotationNumberTx = async (): Promise<string> => {
  const rows = await localDb.quotations.toArray();
  const highest = rows.reduce((max, row) => {
    const match = /^COT-(\d+)$/.exec(row.number || '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `COT-${String(highest + 1).padStart(4, '0')}`;
};

/**
 * Single quotation-creation path used by every screen.
 * The header, line items and activity entry commit atomically.
 */
export async function createQuotation(input: CreateQuotationInput): Promise<Quotation> {
  await requireRepositoryPermission('manage_quotations');
  if (!input.clientId) throw new Error('QUOTATION_CLIENT_REQUIRED');
  if (!input.items.length) throw new Error('QUOTATION_ITEMS_REQUIRED');

  input.items.forEach(item => {
    if (!item.productId) throw new Error('QUOTATION_PRODUCT_REQUIRED');
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('INVALID_QUOTATION_QUANTITY');
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error('INVALID_QUOTATION_PRICE');
    if (!Number.isFinite(item.subtotal) || item.subtotal < 0) throw new Error('INVALID_QUOTATION_SUBTOTAL');
  });

  return localDb.transaction(
    'rw',
    localDb.quotations,
    localDb.quotation_items,
    localDb.activity_log,
    async () => {
      const quotation: Quotation = {
        ...input,
        id: crypto.randomUUID(),
        number: await nextQuotationNumberTx(),
      };
      const createdAt = new Date().toISOString();

      await localDb.quotations.add({
        id: quotation.id,
        number: quotation.number,
        client_id: quotation.clientId,
        client_name: quotation.clientName,
        subtotal: quotation.subtotal,
        discount: quotation.discount,
        tax: quotation.tax,
        total: quotation.total,
        date: quotation.date,
        valid_until: quotation.validUntil,
        status: quotation.status,
        notes: quotation.notes || '',
        created_at: createdAt,
      });

      await localDb.quotation_items.bulkAdd(
        quotation.items.map(item => ({
          quotation_id: quotation.id,
          product_id: item.productId,
          code: item.code,
          name: item.name,
          quantity: item.quantity,
          weight_grams: item.weightGrams,
          unit_price: item.unitPrice,
          subtotal: item.subtotal,
        })),
      );

      await addActivityTx(
        'QUOTATION_CREATED',
        'quotation',
        quotation.id,
        `${quotation.number} · ${quotation.total}`,
      );

      return quotation;
    },
  );
}

export async function updateQuotationStatus(
  id: string,
  status: Quotation['status'],
): Promise<void> {
  await requireRepositoryPermission('manage_quotations');
  if (status === 'accepted') throw new Error('ATOMIC_QUOTATION_CONVERSION_REQUIRED');

  await localDb.transaction('rw', localDb.quotations, localDb.quotation_items, localDb.activity_log, async () => {
    const quotation = await localDb.quotations.get(id);
    if (!quotation) throw new Error('QUOTATION_NOT_FOUND');

    if (status === 'cancelled') {
      if (quotation.status === 'cancelled') throw new Error('QUOTATION_ALREADY_CANCELLED');
      if (quotation.status !== 'active') throw new Error('QUOTATION_NOT_CANCELLABLE');
      const itemCount = await localDb.quotation_items.where('quotation_id').equals(id).count();
      if (itemCount === 0) throw new Error('QUOTATION_ITEMS_NOT_FOUND');
    }

    const updated = await localDb.quotations.update(id, { status });
    if (!updated) throw new Error('QUOTATION_NOT_FOUND');
    await addActivityTx(
      status === 'cancelled' ? 'QUOTATION_CANCELLED' : 'QUOTATION_STATUS_UPDATED',
      'quotation',
      id,
      status,
    );
  });
}

// ── Layaways ──
const mapDbLayawayPayment = (payment: DbLayawayPayment): LayawayPayment => ({
  id: String(payment.id),
  amount: Number(payment.amount) || 0,
  date: payment.date || '',
  method: payment.method || '',
  accountId: payment.account_id || undefined,
});

const mapLayawaySnapshotToInvoice = (
  layaway: DbLayaway,
  contactName: string,
): Invoice => ({
  id: layaway.invoice_id,
  number: layaway.invoice_number || '',
  clientId: layaway.client_id || '',
  clientName: layaway.client_name || contactName || '',
  items: [],
  subtotal: Number(layaway.invoice_total) || 0,
  discount: 0,
  tax: 0,
  total: Number(layaway.invoice_total) || 0,
  date: layaway.invoice_date || layaway.created_at?.slice(0, 10) || '',
  status: layaway.completed ? 'paid' : 'pending',
  paymentMethod: '',
  clientNotes: '',
  internalNotes: '',
  tipoDocumento: 'factura',
});

const layawaySnapshotNeedsRepair = (layaway: DbLayaway, invoice: Invoice): boolean =>
  layaway.client_id !== invoice.clientId ||
  layaway.client_name !== invoice.clientName ||
  layaway.invoice_number !== invoice.number ||
  layaway.invoice_total !== invoice.total ||
  layaway.invoice_date !== invoice.date;

const withInvoiceSnapshot = (layaway: DbLayaway, invoice: Invoice): DbLayaway => ({
  ...layaway,
  client_id: invoice.clientId || '',
  client_name: invoice.clientName || '',
  invoice_number: invoice.number || '',
  invoice_total: Number(invoice.total) || 0,
  invoice_date: invoice.date || '',
});

async function ensureLayawayInvoiceTx(invoice: Invoice): Promise<void> {
  const existing = await localDb.invoices.get(invoice.id);
  if (!existing) {
    await addInvoiceTx(invoice);
    return;
  }

  const needsRepair = !existing.client_id || !existing.client_name || !existing.number ||
    !Number.isFinite(existing.total) || existing.total <= 0;
  if (!needsRepair) return;

  await localDb.invoices.put(mapInvoiceToDb(invoice, existing.created_at || new Date().toISOString()));
  await localDb.invoice_items.where('invoice_id').equals(invoice.id).delete();
  if (invoice.items.length > 0) {
    await localDb.invoice_items.bulkAdd(invoice.items.map(item => mapInvoiceItemToDb(invoice.id, item)));
  }
}

export async function fetchLayawayPayments(layawayIds?: string[]): Promise<LayawayPaymentsById> {
  if (layawayIds && layawayIds.length === 0) return {};
  const rows = layawayIds
    ? await localDb.layaway_payments.where('layaway_id').anyOf(layawayIds).toArray()
    : await localDb.layaway_payments.orderBy('created_at').toArray();

  rows.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const paymentsByLayaway: LayawayPaymentsById = {};
  rows.forEach(row => {
    const mapped = mapDbLayawayPayment(row);
    const bucket = paymentsByLayaway[row.layaway_id];
    if (bucket) bucket.push(mapped);
    else paymentsByLayaway[row.layaway_id] = [mapped];
  });
  return paymentsByLayaway;
}

export async function fetchLayaways(): Promise<Layaway[]> {
  const layawayRows = await localDb.layaways.orderBy('created_at').reverse().toArray();
  if (layawayRows.length === 0) return [];

  const invoiceIds = Array.from(new Set(layawayRows.map(layaway => layaway.invoice_id).filter(Boolean)));
  const invoiceRows = invoiceIds.length > 0
    ? await localDb.invoices.where('id').anyOf(invoiceIds).toArray()
    : [];
  const invoiceItemRows = invoiceIds.length > 0
    ? await localDb.invoice_items.where('invoice_id').anyOf(invoiceIds).toArray()
    : [];
  const itemsByInvoice = groupInvoiceItems(invoiceItemRows);
  const invoicesById = new Map<string, Invoice>(
    invoiceRows.map(invoice => [invoice.id, mapDbInvoice(invoice, itemsByInvoice.get(invoice.id) || [])]),
  );

  const clientIds = Array.from(new Set([
    ...invoiceRows.map(invoice => invoice.client_id),
    ...layawayRows.map(layaway => layaway.client_id || ''),
  ].filter(Boolean)));
  const contactRows = clientIds.length > 0
    ? await localDb.contacts.where('id').anyOf(clientIds).toArray()
    : [];
  const contactNameById = new Map(contactRows.map(contact => [contact.id, contact.name || '']));
  const paymentsByLayaway = await fetchLayawayPayments(layawayRows.map(layaway => layaway.id));
  const snapshotRepairs: DbLayaway[] = [];

  const result = layawayRows.map(layaway => {
    let invoice = invoicesById.get(layaway.invoice_id);
    if (invoice) {
      if (!invoice.clientName && invoice.clientId) {
        invoice = { ...invoice, clientName: contactNameById.get(invoice.clientId) || '' };
      }
      if (layawaySnapshotNeedsRepair(layaway, invoice)) {
        snapshotRepairs.push(withInvoiceSnapshot(layaway, invoice));
      }
    } else {
      const contactName = layaway.client_id ? contactNameById.get(layaway.client_id) || '' : '';
      invoice = mapLayawaySnapshotToInvoice(layaway, contactName);
      console.warn(`Apartado ${layaway.id} referencia una factura no persistida: ${layaway.invoice_id}`);
    }

    const payments = paymentsByLayaway[layaway.id] || [];
    return {
      id: layaway.id,
      invoiceId: layaway.invoice_id,
      invoice,
      payments,
      completed: layaway.completed,
      completedDate: layaway.completed_date || undefined,
    };
  });

  if (snapshotRepairs.length > 0) {
    await requireRepositoryPermission('system_maintenance');
    await localDb.layaways.bulkPut(snapshotRepairs);
  }
  return result;
}


const LAYAWAY_STOCK_RESERVED_ACTION = 'LAYAWAY_STOCK_RESERVED';

const aggregateInvoiceQuantities = (items: Invoice['items']): Map<string, number> => {
  const quantities = new Map<string, number>();
  items.forEach(item => {
    if (!item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0) return;
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  });
  return quantities;
};

const hasLayawayStockReservationTx = async (layawayId: string): Promise<boolean> =>
  Boolean(await localDb.activity_log
    .where('action')
    .equals(LAYAWAY_STOCK_RESERVED_ACTION)
    .and(entry => entry.entity_id === layawayId)
    .first());

const updateReservedStockTx = async (
  previousItems: Invoice['items'],
  nextItems: Invoice['items'],
): Promise<Product[]> => {
  const previousQuantities = aggregateInvoiceQuantities(previousItems);
  const nextQuantities = aggregateInvoiceQuantities(nextItems);
  const productIds = Array.from(new Set([...previousQuantities.keys(), ...nextQuantities.keys()]));
  const updatedProducts: Product[] = [];

  for (const productId of productIds) {
    const row = await localDb.products.get(productId);
    if (!row) throw new Error('LAYAWAY_PRODUCT_NOT_FOUND');
    const product = mapDbProduct(row);
    const delta = (nextQuantities.get(productId) || 0) - (previousQuantities.get(productId) || 0);
    if (delta > 0 && product.stock < delta) throw new Error('LAYAWAY_INSUFFICIENT_STOCK');

    const stockAfter = product.stock - delta;
    const gramsDelta = isSoldByWeight(product) ? delta : delta * product.weightGrams;
    const gramsAfter = Math.max(0, getProductAvailableGrams(product) - gramsDelta);
    await localDb.products.update(productId, {
      stock: Math.max(0, stockAfter),
      available_grams: gramsAfter,
    });
    updatedProducts.push({
      ...product,
      stock: Math.max(0, stockAfter),
      availableGrams: gramsAfter,
    });
  }

  return updatedProducts;
};

const reserveLayawayStockTx = async (layaway: Layaway): Promise<Product[]> => {
  const updatedProducts = await updateReservedStockTx([], layaway.invoice.items);
  await addActivityTx(
    LAYAWAY_STOCK_RESERVED_ACTION,
    'layaway',
    layaway.id,
    JSON.stringify({
      invoiceId: layaway.invoiceId,
      items: layaway.invoice.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    }),
  );
  return updatedProducts;
};

const ensureLayawayReserveAccountTx = async (): Promise<void> => {
  if (await localDb.financial_accounts.get(LAYAWAY_RESERVE_ACCOUNT_ID)) return;
  const now = new Date().toISOString();
  await localDb.financial_accounts.add({
    id: LAYAWAY_RESERVE_ACCOUNT_ID,
    name: 'Caja Separados',
    kind: 'cash',
    active: true,
    balance: 0,
    created_at: now,
    updated_at: now,
  });
};

export async function insertLayaway(layaway: Layaway): Promise<Layaway> {
  await requireRepositoryPermission('manage_layaways');
  if (!layaway.invoiceId || layaway.invoice.id !== layaway.invoiceId) {
    throw new Error('LAYAWAY_INVOICE_ID_MISMATCH');
  }
  if (!layaway.invoice.clientId) throw new Error('LAYAWAY_CLIENT_REQUIRED');

  return localDb.transaction('rw', [
    localDb.invoices,
    localDb.invoice_items,
    localDb.products,
    localDb.layaways,
    localDb.layaway_payments,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
  ], async () => {
    if (await localDb.layaways.get(layaway.id)) throw new Error('LAYAWAY_ALREADY_EXISTS');
    await ensureLayawayReserveAccountTx();
    await ensureLayawayInvoiceTx({ ...layaway.invoice, status: 'pending' });

    const createdAt = new Date().toISOString();
    const dbLayaway: DbLayaway = withInvoiceSnapshot({
      id: layaway.id,
      invoice_id: layaway.invoiceId,
      completed: false,
      completed_date: null,
      created_at: createdAt,
    }, layaway.invoice);
    await localDb.layaways.add(dbLayaway);
    await reserveLayawayStockTx(layaway);

    const persistedPayments: LayawayPayment[] = [];
    for (const payment of layaway.payments) {
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) continue;
      const user = getSession();
      const paymentId = await localDb.layaway_payments.add({
        layaway_id: layaway.id,
        amount: payment.amount,
        date: payment.date,
        method: payment.method,
        account_id: payment.accountId || '',
        user_id: user?.id || '',
        user_name: user?.displayName || 'Sistema',
        created_at: createdAt,
      });
      persistedPayments.push({ ...payment, id: String(paymentId) });

      await addFinancialMovementTx({
        type: 'adjustment',
        amount: payment.amount,
        destinationAccountId: LAYAWAY_RESERVE_ACCOUNT_ID,
        reference: `Reserva ${layaway.invoice.number}`,
        documentType: 'layaway',
        documentId: layaway.id,
        observation: `${layaway.invoice.clientName} · ${payment.method}`,
        date: payment.date,
        movementCode: 'LAYAWAY_PAYMENT',
        referenceType: 'LAYAWAY',
        referenceId: layaway.id,
        notes: `Abono ${String(paymentId)} · ${payment.method}`,
      });
    }

    const paidTotal = persistedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paidTotal > layaway.invoice.total + 0.01) throw new Error('LAYAWAY_PAYMENT_EXCEEDS_TOTAL');
    await addActivityTx('LAYAWAY_CREATED', 'layaway', layaway.id, layaway.invoice.number);
    return {
      ...layaway,
      invoice: { ...layaway.invoice, status: 'pending' },
      payments: persistedPayments,
      completed: false,
      completedDate: undefined,
    };
  });
}


export async function updateLayaway(
  layawayId: string,
  nextInvoice: Invoice,
): Promise<LayawayUpdateResult> {
  await requireRepositoryPermission('manage_layaways');
  return localDb.transaction('rw', [
    localDb.products,
    localDb.invoices,
    localDb.invoice_items,
    localDb.layaways,
    localDb.layaway_payments,
    localDb.activity_log,
  ], async () => {
    const layaway = await localDb.layaways.get(layawayId);
    if (!layaway) throw new Error('LAYAWAY_NOT_FOUND');
    if (nextInvoice.id !== layaway.invoice_id) throw new Error('LAYAWAY_INVOICE_ID_MISMATCH');
    if (!nextInvoice.clientId) throw new Error('LAYAWAY_CLIENT_REQUIRED');
    if (nextInvoice.items.length === 0) throw new Error('LAYAWAY_ITEMS_REQUIRED');

    const existingInvoice = await localDb.invoices.get(layaway.invoice_id);
    if (!existingInvoice) throw new Error('LAYAWAY_INVOICE_NOT_FOUND');
    const previousItemRows = await localDb.invoice_items.where('invoice_id').equals(layaway.invoice_id).toArray();
    const previousInvoice = mapDbInvoice(existingInvoice, previousItemRows);
    const paymentRows = await localDb.layaway_payments.where('layaway_id').equals(layawayId).toArray();
    const paidTotal = paymentRows.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    if (nextInvoice.total < paidTotal - 0.01) throw new Error('LAYAWAY_TOTAL_BELOW_PAYMENTS');

    const stockReserved = await hasLayawayStockReservationTx(layawayId);
    const updatedProducts = stockReserved
      ? await updateReservedStockTx(previousInvoice.items, nextInvoice.items)
      : [];

    const completed = paidTotal >= nextInvoice.total - 0.01;
    const completedDate = completed
      ? layaway.completed_date || paymentRows[paymentRows.length - 1]?.date || nextInvoice.date
      : null;
    const persistedInvoice: Invoice = {
      ...nextInvoice,
      status: completed ? 'paid' : 'pending',
    };

    await localDb.invoices.put(mapInvoiceToDb(persistedInvoice, existingInvoice.created_at));
    await localDb.invoice_items.where('invoice_id').equals(layaway.invoice_id).delete();
    await localDb.invoice_items.bulkAdd(
      persistedInvoice.items.map(item => mapInvoiceItemToDb(persistedInvoice.id, item)),
    );
    await localDb.layaways.put(withInvoiceSnapshot({
      ...layaway,
      completed,
      completed_date: completedDate,
    }, persistedInvoice));

    await addActivityTx(
      'LAYAWAY_UPDATED',
      'layaway',
      layawayId,
      JSON.stringify({
        previousTotal: previousInvoice.total,
        total: persistedInvoice.total,
        previousClientId: previousInvoice.clientId,
        clientId: persistedInvoice.clientId,
        itemCount: persistedInvoice.items.length,
      }),
    );

    return {
      layaway: {
        id: layawayId,
        invoiceId: persistedInvoice.id,
        invoice: persistedInvoice,
        payments: paymentRows
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
          .map(mapDbLayawayPayment),
        completed,
        completedDate: completedDate || undefined,
      },
      updatedProducts,
    };
  });
}

const createFinancialReversalTx = async (
  movement: import('@/lib/localDb').DbFinancialMovement,
  input: {
    movementCode: import('@/lib/localDb').FinancialMovementCode;
    reference: string;
    documentType: string;
    documentId: string;
    observation: string;
    date: string;
    referenceType: import('@/lib/localDb').FinancialReferenceType;
    referenceId?: string;
    status?: import('@/lib/localDb').FinancialMovementStatus;
  },
): Promise<import('@/lib/localDb').DbFinancialMovement> => {
  const reversal = await addFinancialMovementTx({
    type: 'adjustment',
    amount: movement.amount,
    originAccountId: movement.destination_account_id || undefined,
    destinationAccountId: movement.origin_account_id || undefined,
    reference: input.reference,
    documentType: input.documentType,
    documentId: input.documentId,
    observation: input.observation,
    date: input.date,
    movementCode: input.movementCode,
    relatedMovementId: movement.id,
    referenceType: input.referenceType,
    referenceId: input.referenceId || input.documentId,
    status: input.status || 'POSTED',
    notes: input.observation,
  });
  await localDb.financial_movements.update(movement.id, {
    status: 'REVERSED',
    updated_at: new Date().toISOString(),
  });
  return reversal;
};

const reverseFinancialMovementTx = async (
  movement: import('@/lib/localDb').DbFinancialMovement,
): Promise<void> => {
  const now = new Date().toISOString();
  if (movement.origin_account_id) {
    const origin = await localDb.financial_accounts.get(movement.origin_account_id);
    if (origin) {
      await localDb.financial_accounts.update(origin.id, {
        balance: origin.balance + movement.amount,
        updated_at: now,
      });
    }
  }
  if (movement.destination_account_id) {
    const destination = await localDb.financial_accounts.get(movement.destination_account_id);
    if (destination) {
      await localDb.financial_accounts.update(destination.id, {
        balance: destination.balance - movement.amount,
        updated_at: now,
      });
    }
  }
};

export async function deleteLayaway(
  layawayId: string,
  resolution: LayawayCancellationResolution = 'refund',
): Promise<LayawayDeleteResult> {
  await requireRepositoryPermission('manage_layaways');
  if (resolution !== 'refund' && resolution !== 'credit') {
    throw new Error('LAYAWAY_CANCELLATION_RESOLUTION_REQUIRED');
  }

  return localDb.transaction('rw', [
    localDb.products,
    localDb.invoices,
    localDb.invoice_items,
    localDb.invoice_payment_allocations,
    localDb.layaways,
    localDb.layaway_payments,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
  ], async () => {
    const layaway = await localDb.layaways.get(layawayId);
    if (!layaway) throw new Error('LAYAWAY_NOT_FOUND');
    const invoice = await localDb.invoices.get(layaway.invoice_id);
    const itemRows = await localDb.invoice_items.where('invoice_id').equals(layaway.invoice_id).toArray();
    const invoiceModel = invoice ? mapDbInvoice(invoice, itemRows) : mapLayawaySnapshotToInvoice(layaway, layaway.client_name || '');
    const paymentRows = await localDb.layaway_payments.where('layaway_id').equals(layawayId).toArray();
    const paidTotal = paymentRows.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);

    const stockReserved = await hasLayawayStockReservationTx(layawayId);
    const restoredProducts = stockReserved
      ? await updateReservedStockTx(invoiceModel.items, [])
      : [];

    const movements = await localDb.financial_movements
      .where('document_id')
      .equals(layawayId)
      .and(movement => (
        movement.document_type === 'layaway'
        && movement.status !== 'REVERSED'
        && movement.status !== 'CANCELLED'
      ))
      .toArray();
    const cancellationDate = localDateKey(new Date());
    let refundedAmount = 0;
    let creditAmount = 0;

    if (paidTotal > 0.01 && resolution === 'refund') {
      for (const movement of movements) {
        await createFinancialReversalTx(movement, {
          movementCode: 'LAYAWAY_REFUND',
          reference: `Devolución ${invoiceModel.number}`,
          documentType: 'layaway_refund',
          documentId: layawayId,
          observation: `Devolución al cliente por cancelación del separado ${invoiceModel.number}`,
          date: cancellationDate,
          referenceType: 'CUSTOMER',
          referenceId: invoiceModel.clientId,
          status: 'COMPLETED',
        });
        refundedAmount += Number(movement.amount) || 0;
      }

      // Payments made before the dedicated reserve ledger existed may not have
      // an associated FinancialMovement. Refund only the uncovered legacy part.
      let legacyToRefund = Math.max(0, paidTotal - refundedAmount);
      for (const payment of paymentRows) {
        if (legacyToRefund <= 0.01) break;
        const amount = Math.min(Math.max(0, Number(payment.amount) || 0), legacyToRefund);
        if (amount <= 0) continue;
        const originAccountId = payment.account_id || MAIN_CASH_ACCOUNT_ID;
        await addFinancialMovementTx({
          type: 'adjustment',
          amount,
          originAccountId,
          reference: `Devolución ${invoiceModel.number}`,
          documentType: 'layaway_refund',
          documentId: layawayId,
          observation: `Devolución al cliente por cancelación del separado ${invoiceModel.number}`,
          date: cancellationDate,
          movementCode: 'LAYAWAY_REFUND',
          referenceType: 'CUSTOMER',
          referenceId: invoiceModel.clientId,
          status: 'COMPLETED',
          notes: `Abono histórico devuelto · ${payment.method}`,
        });
        refundedAmount += amount;
        legacyToRefund -= amount;
      }
    }

    if (paidTotal > 0.01 && resolution === 'credit') {
      const existingCredit = await localDb.financial_movements
        .where('document_id')
        .equals(layawayId)
        .and(movement => movement.movement_code === 'CUSTOMER_CREDIT')
        .first();
      if (!existingCredit) {
        await addFinancialMovementTx({
          type: 'adjustment',
          amount: paidTotal,
          reference: `Saldo a favor ${invoiceModel.number}`,
          documentType: 'layaway_credit',
          documentId: layawayId,
          observation: `Saldo a favor de ${invoiceModel.clientName}`,
          date: cancellationDate,
          movementCode: 'CUSTOMER_CREDIT',
          relatedMovementId: movements[0]?.id,
          referenceType: 'CUSTOMER',
          referenceId: invoiceModel.clientId,
          status: 'COMPLETED',
          notes: `Crédito originado por cancelación del separado ${invoiceModel.number}`,
          customerId: invoiceModel.clientId,
        });
      }
      creditAmount = paidTotal;
    }

    await localDb.invoice_payment_allocations.where('invoice_id').equals(layaway.invoice_id).delete();
    await localDb.layaway_payments.where('layaway_id').equals(layawayId).delete();
    await localDb.invoice_items.where('invoice_id').equals(layaway.invoice_id).delete();
    await localDb.invoices.delete(layaway.invoice_id);
    await localDb.layaways.delete(layawayId);

    await addActivityTx(
      resolution === 'refund' ? 'LAYAWAY_CANCELLED_REFUND' : 'LAYAWAY_CANCELLED_CREDIT',
      'layaway',
      layawayId,
      JSON.stringify({
        invoiceId: layaway.invoice_id,
        invoiceNumber: invoiceModel.number,
        clientId: invoiceModel.clientId,
        clientName: invoiceModel.clientName,
        total: invoiceModel.total,
        paidTotal,
        resolution,
        refundedAmount,
        creditAmount,
        stockRestored: stockReserved,
      }),
    );

    return {
      invoiceId: layaway.invoice_id,
      restoredProducts,
      resolution,
      refundedAmount,
      creditAmount,
      clientId: invoiceModel.clientId,
    };
  });
}

export async function addLayawayPayment(
  layawayId: string,
  payment: { amount: number; date: string; method: string; accountId?: string },
): Promise<LayawayPaymentResult> {
  await requireRepositoryPermission('manage_layaways');
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) throw new Error('INVALID_LAYAWAY_PAYMENT');

  return localDb.transaction('rw', [
    localDb.layaway_payments,
    localDb.layaways,
    localDb.invoices,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
  ], async () => {
    const layaway = await localDb.layaways.get(layawayId);
    if (!layaway) throw new Error('LAYAWAY_NOT_FOUND');
    if (layaway.completed) throw new Error('LAYAWAY_ALREADY_COMPLETED');
    await ensureLayawayReserveAccountTx();
    const invoice = await localDb.invoices.get(layaway.invoice_id);
    const invoiceTotal = Number(invoice?.total ?? layaway.invoice_total ?? 0);
    if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) throw new Error('LAYAWAY_INVOICE_NOT_FOUND');

    const existingPayments = await localDb.layaway_payments.where('layaway_id').equals(layawayId).toArray();
    const paidBefore = existingPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const remainingBefore = Math.max(0, invoiceTotal - paidBefore);
    if (payment.amount > remainingBefore + 0.01) throw new Error('LAYAWAY_PAYMENT_EXCEEDS_BALANCE');

    const user = getSession();
    const createdAt = new Date().toISOString();
    const paymentId = await localDb.layaway_payments.add({
      layaway_id: layawayId,
      amount: payment.amount,
      date: payment.date,
      method: payment.method,
      account_id: payment.accountId || '',
      user_id: user?.id || '',
      user_name: user?.displayName || 'Sistema',
      created_at: createdAt,
    });

    await addFinancialMovementTx({
      type: 'adjustment',
      amount: payment.amount,
      destinationAccountId: LAYAWAY_RESERVE_ACCOUNT_ID,
      reference: `Reserva ${invoice?.number || layaway.invoice_number || layawayId.slice(0, 8)}`,
      documentType: 'layaway',
      documentId: layawayId,
      observation: `${invoice?.client_name || layaway.client_name || 'Abono de separado'} · ${payment.method}`,
      date: payment.date,
      movementCode: 'LAYAWAY_PAYMENT',
      referenceType: 'LAYAWAY',
      referenceId: layawayId,
      notes: `Abono ${String(paymentId)} · ${payment.method}`,
    });

    await addActivityTx('LAYAWAY_PAYMENT', 'layaway', layawayId, `${payment.amount}`);
    return {
      payment: { ...payment, id: String(paymentId) },
      invoiceId: layaway.invoice_id,
      completed: false,
      completedDate: undefined,
    };
  });
}

export async function completeLayawayDb(layawayId: string, completedDate: string): Promise<string> {
  await requireRepositoryPermission('manage_layaways');
  return localDb.transaction('rw', [
    localDb.layaways,
    localDb.layaway_payments,
    localDb.invoices,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
  ], async () => {
    const layaway = await localDb.layaways.get(layawayId);
    if (!layaway) throw new Error('LAYAWAY_NOT_FOUND');
    if (layaway.completed) return layaway.invoice_id;

    const invoice = await localDb.invoices.get(layaway.invoice_id);
    const invoiceTotal = Number(invoice?.total ?? layaway.invoice_total ?? 0);
    const payments = await localDb.layaway_payments.where('layaway_id').equals(layawayId).toArray();
    const paidTotal = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    if (invoiceTotal <= 0 || paidTotal < invoiceTotal - 0.01) throw new Error('LAYAWAY_BALANCE_REMAINING');

    await ensureLayawayReserveAccountTx();
    const reserveMovements = await localDb.financial_movements
      .where('document_id')
      .equals(layawayId)
      .and(movement => movement.document_type === 'layaway' && movement.destination_account_id === LAYAWAY_RESERVE_ACCOUNT_ID)
      .toArray();
    let reserveToRelease = Math.min(
      paidTotal,
      reserveMovements.reduce((sum, movement) => sum + (Number(movement.amount) || 0), 0),
    );

    // New payments are appended after legacy payments. Release the newest
    // reserve-backed amounts to the destination accounts selected at payment
    // time. Legacy payments were already credited by older versions and are
    // therefore not moved a second time.
    const releaseByAccount = new Map<string, number>();
    for (const payment of [...payments].reverse()) {
      if (reserveToRelease <= 0.01) break;
      const release = Math.min(Number(payment.amount) || 0, reserveToRelease);
      if (release <= 0) continue;
      const destinationAccountId = payment.account_id && payment.account_id !== LAYAWAY_RESERVE_ACCOUNT_ID
        ? payment.account_id
        : MAIN_CASH_ACCOUNT_ID;
      releaseByAccount.set(destinationAccountId, (releaseByAccount.get(destinationAccountId) || 0) + release);
      reserveToRelease -= release;
    }
    if (reserveToRelease > 0.01) throw new Error('LAYAWAY_RESERVE_ALLOCATION_INVALID');

    for (const [destinationAccountId, amount] of releaseByAccount) {
      await addFinancialMovementTx({
        type: 'transfer',
        amount,
        originAccountId: LAYAWAY_RESERVE_ACCOUNT_ID,
        destinationAccountId,
        reference: `Venta ${invoice?.number || layaway.invoice_number || layawayId.slice(0, 8)}`,
        documentType: 'layaway_completion',
        documentId: layawayId,
        observation: invoice?.client_name || layaway.client_name || 'Separado completado',
        date: completedDate,
        movementCode: 'LAYAWAY_COMPLETED',
        relatedMovementId: reserveMovements[0]?.id,
        referenceType: invoice?.id ? 'SALE' : 'LAYAWAY',
        referenceId: invoice?.id || layawayId,
        notes: `Conversión a venta ${invoice?.number || layaway.invoice_number || layawayId.slice(0, 8)}`,
      });
    }

    await localDb.layaways.update(layawayId, { completed: true, completed_date: completedDate });
    if (layaway.invoice_id) await localDb.invoices.update(layaway.invoice_id, { status: 'paid', date: completedDate });
    await addActivityTx(
      'LAYAWAY_COMPLETED',
      'layaway',
      layawayId,
      JSON.stringify({ completedDate, paidTotal, releasedFromReserve: Array.from(releaseByAccount.values()).reduce((sum, amount) => sum + amount, 0) }),
    );
    return layaway.invoice_id;
  });
}

// ── Cash Sessions ──
export async function fetchCashSessions(): Promise<CashSession[]> {
  const data = await localDb.cash_sessions.orderBy('created_at').reverse().toArray();
  return data.map(s => ({
    id: s.id, date: s.date, openedAt: s.opened_at, openedBy: s.opened_by,
    initialAmount: s.initial_amount, closedAt: s.closed_at || undefined,
    closedBy: s.closed_by || undefined, observations: s.observations || undefined,
  }));
}

export async function insertCashSession(s: CashSession) {
  await requireRepositoryPermission('manage_cash');
  await localDb.cash_sessions.add({
    id: s.id, date: s.date, opened_at: s.openedAt, opened_by: s.openedBy,
    initial_amount: s.initialAmount, closed_at: null, closed_by: null,
    observations: null, created_at: new Date().toISOString(),
  });
}

export async function closeCashSession(id: string, closedAt: string, closedBy: string, observations: string) {
  await requireRepositoryPermission('manage_cash');
  await localDb.cash_sessions.update(id, {
    closed_at: closedAt, closed_by: closedBy, observations,
  });
}

// ── Inventory Adjustments ──
const INVENTORY_ADJUSTMENT_NUMERIC_FIELDS = [
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
] as const;


const normalizeDbInventoryAdjustment = (row: DbInventoryAdjustment): DbInventoryAdjustment => {
  const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
  const normalized: DbInventoryAdjustment = {
    ...row,
    created_at: createdAt,
    supplier_id: typeof row.supplier_id === 'string' ? row.supplier_id : '',
    supplier_name: typeof row.supplier_name === 'string' ? row.supplier_name : '',
    adjustment_date: typeof row.adjustment_date === 'string' && row.adjustment_date
      ? row.adjustment_date
      : createdAt.slice(0, 10),
    notes: typeof row.notes === 'string' ? row.notes : row.reason || '',
  };

  INVENTORY_ADJUSTMENT_NUMERIC_FIELDS.forEach(field => {
    const value = row[field];
    normalized[field] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  });

  return normalized;
};

const inventoryAdjustmentNeedsV5Repair = (row: DbInventoryAdjustment): boolean =>
  INVENTORY_ADJUSTMENT_NUMERIC_FIELDS.some(field => {
    const value = row[field];
    return typeof value !== 'number' || !Number.isFinite(value);
  }) ||
  typeof row.supplier_id !== 'string' ||
  typeof row.supplier_name !== 'string' ||
  typeof row.adjustment_date !== 'string' || !row.adjustment_date ||
  typeof row.notes !== 'string';

const mapDbInventoryAdjustment = (row: DbInventoryAdjustment): InventoryAdjustment => {
  const normalized = normalizeDbInventoryAdjustment(row);
  const createdAt = normalized.created_at;

  return {
    id: normalized.id,
    productId: normalized.product_id,
    productCode: normalized.product_code || '',
    productName: normalized.product_name || '',
    type: normalized.type === 'decrease' ? 'decrease' : 'increase',
    quantity: Number(normalized.quantity) || 0,
    grams: Number(normalized.grams) || 0,
    totalCost: Number(normalized.total_cost) || 0,
    unitCost: Number(normalized.unit_cost) || 0,
    valuePerGram: Number(normalized.value_per_gram) || 0,
    purchasePrice: Number(normalized.purchase_price) || 0,
    averagePriceBefore: Number(normalized.average_price_before) || 0,
    averagePriceAfter: Number(normalized.average_price_after) || 0,
    stockBefore: Number(normalized.stock_before) || 0,
    stockAfter: Number(normalized.stock_after) || 0,
    gramsBefore: Number(normalized.grams_before) || 0,
    gramsAfter: Number(normalized.grams_after) || 0,
    notes: normalized.notes || normalized.reason || '',
    date: normalized.adjustment_date || createdAt.slice(0, 10),
    supplierId: normalized.supplier_id || undefined,
    supplierName: normalized.supplier_name || undefined,
    createdAt,
  };
};

export async function fetchInventoryAdjustments(): Promise<InventoryAdjustment[]> {
  // Keep created_at as the full-history index: legacy backups restored directly
  // into V5 can omit adjustment_date, while every historical row has created_at.
  const rows = await localDb.inventory_adjustments.orderBy('created_at').reverse().toArray();
  const normalizedRows = rows.map(normalizeDbInventoryAdjustment);
  const repairs = normalizedRows.filter((_, index) => inventoryAdjustmentNeedsV5Repair(rows[index]));
  if (repairs.length > 0) {
    await requireRepositoryPermission('system_maintenance');
    await localDb.inventory_adjustments.bulkPut(repairs);
  }
  return normalizedRows.map(mapDbInventoryAdjustment);
}

/**
 * Applies the product mutation and writes its audit row in one IndexedDB
 * transaction, preventing a saved movement from becoming detached from stock.
 */
export async function applyInventoryAdjustment(input: InventoryAdjustmentInput): Promise<{
  adjustment: InventoryAdjustment;
  product: Product;
}> {
  await requireRepositoryPermission('manage_inventory');

  if (input.operation === 'update' || input.operation === 'delete') {
    if (!input.adjustmentId) throw new Error('ADJUSTMENT_ID_REQUIRED');
    return localDb.transaction('rw', [localDb.products, localDb.inventory_adjustments, localDb.supplier_invoices,
      localDb.supplier_invoice_payments, localDb.financial_accounts, localDb.financial_movements, localDb.activity_log], async () => {
      const previousRow = await localDb.inventory_adjustments.get(input.adjustmentId!);
      if (!previousRow) throw new Error('ADJUSTMENT_NOT_FOUND');
      const previous = mapDbInventoryAdjustment(previousRow);
      const dbProduct = await localDb.products.get(previous.productId);
      if (!dbProduct) throw new Error('PRODUCT_NOT_FOUND');
      const product = mapDbProduct(dbProduct);
      const byWeight = isSoldByWeight(product);
      const oldStockDelta = byWeight ? previous.grams : previous.quantity;
      const oldSignedStock = previous.type === 'increase' ? oldStockDelta : -oldStockDelta;
      const oldSignedGrams = previous.type === 'increase' ? previous.grams : -previous.grams;
      const currentBasis = byWeight ? getProductAvailableGrams(product) : product.stock;
      const currentValue = Math.max(0, currentBasis) * getProductAveragePurchasePrice(product);
      const baseStock = product.stock - oldSignedStock;
      const baseGrams = getProductAvailableGrams(product) - oldSignedGrams;
      const baseValue = reverseAdjustmentValue({
        currentValue,
        direction: previous.type,
        adjustmentCost: previous.totalCost,
        basisDelta: oldStockDelta,
        averageBefore: previous.averagePriceBefore,
      });
      if (baseStock < -1e-9 || baseGrams < -1e-9 || baseValue < -0.01) throw new Error('ADJUSTMENT_REVERSAL_CONFLICT');

      const linkedMovements = await localDb.financial_movements
        .where('document_id').equals(previous.id)
        .and(row => row.document_type === 'inventory_adjustment')
        .toArray();

      if (input.operation === 'delete') {
        for (const movement of linkedMovements) await reverseFinancialMovementTx(movement);
        if (linkedMovements.length) await localDb.financial_movements.bulkDelete(linkedMovements.map(row => row.id));

        const baseBasis = byWeight ? baseGrams : baseStock;
        const averageAfter = baseBasis > 0 ? Math.max(0, baseValue) / baseBasis : 0;
        const updatedProduct: Product = {
          ...product,
          stock: Math.max(0, baseStock),
          availableGrams: Math.max(0, baseGrams),
          averagePurchasePrice: averageAfter,
        };
        await localDb.products.put(mapProductToDb(updatedProduct, dbProduct.created_at));
        await localDb.inventory_adjustments.delete(previous.id);
        await addActivityTx('INVENTORY_ADJUSTMENT_DELETED', 'inventory_adjustment', previous.id, JSON.stringify({
          productId: previous.productId, quantity: previous.quantity, grams: previous.grams, totalCost: previous.totalCost,
        }));
        return { adjustment: previous, product: updatedProduct };
      }

      if (input.productId !== previous.productId || input.type !== previous.type) throw new Error('IMMUTABLE_ADJUSTMENT_FIELD');
      if (input.quantity <= 0 || input.grams <= 0) throw new Error('INVALID_ADJUSTMENT_QUANTITY');
      if (previous.type === 'increase' && (input.totalCost <= 0 || input.purchasePrice <= 0)) throw new Error('INVALID_ADJUSTMENT_COST');

      const newStockDelta = byWeight ? input.grams : input.quantity;
      const newSignedStock = previous.type === 'increase' ? newStockDelta : -newStockDelta;
      const newSignedGrams = previous.type === 'increase' ? input.grams : -input.grams;
      const stockAfter = baseStock + newSignedStock;
      const gramsAfter = baseGrams + newSignedGrams;
      if (stockAfter < -1e-9) throw new Error('INSUFFICIENT_STOCK');
      if (gramsAfter < -1e-9) throw new Error('INSUFFICIENT_GRAMS');
      const baseBasis = byWeight ? baseGrams : baseStock;
      const { valueAfter } = applyAdjustmentValue({
        baseValue,
        baseBasis,
        direction: previous.type,
        adjustmentCost: input.totalCost,
        basisDelta: newStockDelta,
        fallbackAverage: previous.averagePriceBefore,
      });
      if (valueAfter < -0.01) throw new Error('ADJUSTMENT_REVERSAL_CONFLICT');
      const basisAfter = byWeight ? gramsAfter : stockAfter;
      const averageAfter = basisAfter > 0 ? Math.max(0, valueAfter) / basisAfter : 0;
      const updatedProduct: Product = {
        ...product,
        stock: Math.max(0, stockAfter),
        availableGrams: Math.max(0, gramsAfter),
        averagePurchasePrice: averageAfter,
      };

      const updatedRow: DbInventoryAdjustment = {
        ...previousRow,
        quantity: input.quantity, grams: input.grams,
        total_cost: previous.type === 'increase' ? input.totalCost : 0,
        unit_cost: previous.type === 'increase' ? input.unitCost : 0,
        value_per_gram: previous.type === 'increase' ? input.valuePerGram : 0,
        purchase_price: previous.type === 'increase' ? input.purchasePrice : previous.purchasePrice,
        average_price_after: averageAfter,
        stock_after: Math.max(0, previous.stockBefore + (previous.type === 'increase' ? newStockDelta : -newStockDelta)),
        grams_after: Math.max(0, previous.gramsBefore + newSignedGrams),
        notes: input.notes, reason: input.notes,
      };

      // QA #8.2: editing an inventory adjustment is inventory-only. Historical
      // financial rows are deliberately left untouched and reported by maintenance audit.

      await localDb.products.put(mapProductToDb(updatedProduct, dbProduct.created_at));
      await localDb.inventory_adjustments.put(updatedRow);
      await addActivityTx('INVENTORY_ADJUSTMENT_UPDATED', 'inventory_adjustment', previous.id, JSON.stringify({
        before: { quantity: previous.quantity, grams: previous.grams, totalCost: previous.totalCost, notes: previous.notes },
        after: { quantity: input.quantity, grams: input.grams, totalCost: input.totalCost, notes: input.notes },
      }));
      return { adjustment: mapDbInventoryAdjustment(updatedRow), product: updatedProduct };
    });
  }

  return localDb.transaction('rw', [localDb.products, localDb.inventory_adjustments, localDb.activity_log], async () => {
    const dbProduct = await localDb.products.get(input.productId);
    if (!dbProduct) throw new Error('PRODUCT_NOT_FOUND');

    const product = mapDbProduct(dbProduct);
    const projection = calculateInventoryProjection(product, input);

    if (input.quantity <= 0 || input.grams <= 0) {
      throw new Error('INVALID_ADJUSTMENT_QUANTITY');
    }
    if (projection.stockAfter < -1e-9) throw new Error('INSUFFICIENT_STOCK');
    if (projection.gramsAfter < -1e-9) throw new Error('INSUFFICIENT_GRAMS');
    if (input.type === 'increase' && (input.totalCost <= 0 || input.purchasePrice <= 0)) {
      throw new Error('INVALID_ADJUSTMENT_COST');
    }

    const updatedProduct: Product = {
      ...product,
      stock: Math.max(0, projection.stockAfter),
      availableGrams: Math.max(0, projection.gramsAfter),
      weightGrams: input.type === 'increase'
        ? Math.max(0, projection.weightGramsAfter)
        : product.weightGrams,
      ...(input.type === 'increase' ? {
        averagePurchasePrice: Math.max(0, projection.averagePriceAfter),
      } : {}),
    };

    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const dbAdjustment: DbInventoryAdjustment = {
      id,
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      type: input.type,
      quantity: input.quantity,
      grams: input.grams,
      total_cost: input.type === 'increase' ? input.totalCost : 0,
      unit_cost: input.type === 'increase' ? input.unitCost : 0,
      value_per_gram: input.type === 'increase' ? input.valuePerGram : 0,
      purchase_price: input.type === 'increase' ? projection.purchasePriceAfter : product.purchasePrice,
      average_price_before: projection.averagePriceBefore,
      average_price_after: projection.averagePriceAfter,
      stock_before: projection.stockBefore,
      stock_after: Math.max(0, projection.stockAfter),
      grams_before: projection.gramsBefore,
      grams_after: Math.max(0, projection.gramsAfter),
      supplier_id: input.supplierId || '',
      supplier_name: input.supplierName || '',
      adjustment_date: input.date,
      notes: input.notes,
      reason: input.notes,
      created_at: createdAt,
    };

    await localDb.products.put(mapProductToDb(updatedProduct, dbProduct.created_at));
    await localDb.inventory_adjustments.add(dbAdjustment);

    await addActivityTx('INVENTORY_ADJUSTMENT_CREATED', 'inventory_adjustment', id, JSON.stringify({
      type: input.type,
      productId: product.id,
      quantity: input.quantity,
      grams: input.grams,
      totalCost: input.type === 'increase' ? input.totalCost : 0,
      notes: input.notes,
    }));

    // QA #8.2: inventory adjustments never create monetary or payable records.

    return {
      product: updatedProduct,
      adjustment: mapDbInventoryAdjustment(dbAdjustment),
    };
  });
}

// ── Supplier Invoices (Accounts Payable) ──
export async function fetchSupplierInvoices() {
  const invData = await localDb.supplier_invoices.orderBy('created_at').reverse().toArray();
  if (invData.length === 0) return [];
  const ids = invData.map(i => i.id);
  const payData = await localDb.supplier_invoice_payments.where('supplier_invoice_id').anyOf(ids).toArray();
  const paymentsByInvoice = groupRowsBy(payData, payment => payment.supplier_invoice_id);
  return invData.map(i => ({
    id: i.id, supplierId: i.supplier_id || '', supplierName: i.supplier_name,
    invoiceNumber: i.invoice_number, issueDate: i.issue_date, dueDate: i.due_date,
    total: i.total, initialValue: i.initial_value ?? i.total, pendingBalance: i.pending_balance ?? (i.status === 'paid' ? 0 : i.total),
    sourceType: i.source_type || 'legacy', sourceId: i.source_id || '', status: i.status, notes: i.notes || '',
    payments: [...(paymentsByInvoice.get(i.id) || [])]
      .sort((a, b) => (a.created_at || a.date).localeCompare(b.created_at || b.date))
      .map(p => ({
        id: p.id, amount: p.amount, date: p.date, method: p.method, accountId: p.account_id || '',
        balanceBefore: p.balance_before ?? 0, balanceAfter: p.balance_after ?? 0, userName: p.user_name || '',
      })),
  }));
}

export async function insertSupplierInvoice(inv: {
  supplier_id: string; supplier_name: string; invoice_number: string;
  issue_date: string; due_date: string; total: number; notes: string;
}) {
  await requireRepositoryPermission('manage_accounts_payable');
  const id = crypto.randomUUID();
  const record = { id, ...inv, status: 'pending', created_at: new Date().toISOString() };
  await localDb.supplier_invoices.add(record);
  return record;
}

export async function addSupplierInvoicePayment(supplierInvoiceId: string, payment: { amount: number; date: string; method: string }) {
  await requireRepositoryPermission('manage_accounts_payable');
  const id = crypto.randomUUID();
  const record = { id, supplier_invoice_id: supplierInvoiceId, ...payment, created_at: new Date().toISOString() };
  await localDb.supplier_invoice_payments.add(record);
  return record;
}

export async function updateSupplierInvoiceStatus(id: string, status: string) {
  await requireRepositoryPermission('manage_accounts_payable');
  await localDb.supplier_invoices.update(id, { status });
}

// ── Supplier Payments for Reports ──
export async function fetchSupplierPaymentsForReports() {
  const payments = await localDb.supplier_invoice_payments.toArray();
  if (payments.length === 0) return [];
  const invoiceIds = [...new Set(payments.map(p => p.supplier_invoice_id))];
  const sinvoices = await localDb.supplier_invoices.where('id').anyOf(invoiceIds).toArray();
  const invoicesById = new Map(sinvoices.map(invoice => [invoice.id, invoice]));
  return payments.map(p => {
    const si = invoicesById.get(p.supplier_invoice_id);
    return {
      id: p.id, amount: p.amount, date: p.date, method: p.method,
      supplierName: si?.supplier_name || '', invoiceNumber: si?.invoice_number || '',
    };
  });
}

// ── Backup V2: history ──
export async function insertBackupHistoryEntry(entry: BackupHistory): Promise<void> {
  await requirePermission('manage_backup');
  await localDb.backup_history.add({
    id: entry.id, date: entry.date, type: entry.type, destination: entry.destination,
    size: entry.size, status: entry.status, version: entry.version,
    created_by: entry.createdBy, device_id: entry.deviceId, notes: entry.notes || '',
  });
}

export async function fetchBackupHistory(limit = 20): Promise<BackupHistory[]> {
  const rows = await localDb.backup_history.orderBy('date').reverse().limit(limit).toArray();
  return rows.map(r => ({
    id: r.id, date: r.date, type: r.type as BackupHistory['type'],
    destination: r.destination as BackupHistory['destination'],
    size: r.size, status: r.status as BackupHistory['status'], version: r.version,
    createdBy: r.created_by, deviceId: r.device_id, notes: r.notes || '',
  }));
}

export async function deleteBackupHistoryEntry(id: string): Promise<void> {
  await requirePermission('manage_backup');
  await localDb.backup_history.delete(id);
}

export async function clearBackupHistory(): Promise<void> {
  await requirePermission('manage_backup');
  await localDb.backup_history.clear();
}

// ── Backup V2: settings (single row, id = 'default') ──
const SYSTEM_SETTINGS_ID = 'default';

export async function fetchSystemSettings(): Promise<BackupSettings | null> {
  const row = await localDb.system_settings.get(SYSTEM_SETTINGS_ID);
  if (!row) return null;
  return {
    backupEnabled: row.backup_enabled,
    backupInterval: row.backup_interval as BackupSettings['backupInterval'],
    backupHour: row.backup_hour,
    backupFolder: row.backup_folder,
    maxBackups: row.max_backups,
    deleteOldBackups: row.delete_old_backups,
    verifyChecksum: row.verify_checksum,
    backupBeforeRestore: row.backup_before_restore,
    // Fallback for rows saved before this field existed.
    backupOnStartup: row.backup_on_startup ?? false,
    backupOnExit: row.backup_on_exit,
    backupOnImport: row.backup_on_import,
    compressionEnabled: row.compression_enabled,
    defaultDestination: row.default_destination as BackupSettings['defaultDestination'],
  };
}

export async function saveSystemSettings(settings: BackupSettings): Promise<void> {
  await requirePermission('manage_backup');
  await localDb.system_settings.put({
    id: SYSTEM_SETTINGS_ID,
    backup_enabled: settings.backupEnabled,
    backup_interval: settings.backupInterval,
    backup_hour: settings.backupHour,
    backup_folder: settings.backupFolder,
    max_backups: settings.maxBackups,
    delete_old_backups: settings.deleteOldBackups,
    verify_checksum: settings.verifyChecksum,
    backup_before_restore: settings.backupBeforeRestore,
    backup_on_startup: settings.backupOnStartup,
    backup_on_exit: settings.backupOnExit,
    backup_on_import: settings.backupOnImport,
    compression_enabled: settings.compressionEnabled,
    default_destination: settings.defaultDestination,
  });
}

// ── Financial accounting (database V6) ──
const mapFinancialAccount = (row: import('@/lib/localDb').DbFinancialAccount): FinancialAccount => ({
  id: row.id, name: row.name, kind: row.kind, active: row.active,
  balance: Number(row.balance) || 0, createdAt: row.created_at, updatedAt: row.updated_at,
});

const mapFinancialMovement = (row: import('@/lib/localDb').DbFinancialMovement): FinancialMovement => ({
  id: row.id, type: row.type, amount: Number(row.amount) || 0,
  originAccountId: row.origin_account_id || undefined,
  destinationAccountId: row.destination_account_id || undefined,
  originBalanceBefore: Number(row.origin_balance_before) || 0,
  originBalanceAfter: Number(row.origin_balance_after) || 0,
  destinationBalanceBefore: Number(row.destination_balance_before) || 0,
  destinationBalanceAfter: Number(row.destination_balance_after) || 0,
  reference: row.reference || '', documentType: row.document_type || '',
  documentId: row.document_id || '', observation: row.observation || '',
  userId: row.user_id || '', userName: row.user_name || '',
  date: row.movement_date, createdAt: row.created_at,
  movementCode: row.movement_code,
  relatedMovementId: row.related_movement_id || undefined,
  referenceType: row.reference_type,
  referenceId: row.reference_id || row.document_id || undefined,
  status: row.status || 'POSTED',
  updatedAt: row.updated_at || row.created_at,
  notes: row.notes || row.observation || undefined,
  customerId: row.customer_id || undefined,
});

export async function ensureDefaultFinancialAccounts(): Promise<FinancialAccount[]> {
  await requireRepositoryPermission('system_maintenance');
  const now = new Date().toISOString();
  const defaults: import('@/lib/localDb').DbFinancialAccount[] = [
    { id: MAIN_CASH_ACCOUNT_ID, name: 'Caja Principal', kind: 'cash', active: true, balance: 0, created_at: now, updated_at: now },
    { id: LAYAWAY_RESERVE_ACCOUNT_ID, name: 'Caja Separados', kind: 'cash', active: true, balance: 0, created_at: now, updated_at: now },
    { id: 'account-bancolombia', name: 'Bancolombia', kind: 'bank', active: true, balance: 0, created_at: now, updated_at: now },
    { id: 'account-nequi', name: 'Nequi', kind: 'wallet', active: true, balance: 0, created_at: now, updated_at: now },
    { id: 'account-davivienda', name: 'Davivienda', kind: 'bank', active: true, balance: 0, created_at: now, updated_at: now },
    { id: 'account-caja-menor', name: 'Efectivo Caja Menor', kind: 'cash', active: true, balance: 0, created_at: now, updated_at: now },
  ];
  await localDb.transaction('rw', localDb.financial_accounts, async () => {
    for (const account of defaults) {
      if (!await localDb.financial_accounts.get(account.id)) await localDb.financial_accounts.add(account);
    }
  });
  return fetchFinancialAccounts();
}

export async function fetchFinancialAccounts(): Promise<FinancialAccount[]> {
  const rows = await localDb.financial_accounts.orderBy('created_at').toArray();
  return rows.map(mapFinancialAccount);
}

export async function createFinancialAccount(input: { name: string; kind: FinancialAccount['kind']; initialBalance?: number }): Promise<FinancialAccount> {
  await requireRepositoryPermission('manage_finances');
  const name = input.name.trim();
  if (!name) throw new Error('ACCOUNT_NAME_REQUIRED');
  const now = new Date().toISOString();
  const balance = Math.max(0, Number(input.initialBalance) || 0);
  const row: import('@/lib/localDb').DbFinancialAccount = {
    id: crypto.randomUUID(), name, kind: input.kind, active: true, balance: 0,
    created_at: now, updated_at: now,
  };
  await localDb.transaction('rw', localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    await localDb.financial_accounts.add(row);
    if (balance > 0) await addFinancialMovementTx({
      type: 'opening_balance', amount: balance, destinationAccountId: row.id,
      reference: 'Saldo inicial', documentType: 'financial_account', documentId: row.id,
      observation: 'Creación de cuenta financiera', date: now.slice(0, 10),
      movementCode: 'OPENING_BALANCE', referenceType: 'FINANCIAL_ACCOUNT', referenceId: row.id,
    });
    await addActivityTx('FINANCIAL_ACCOUNT_CREATED', 'financial_account', row.id, name);
  });
  return mapFinancialAccount(row);
}

async function addActivityTx(action: string, entity: string, entityId: string, detail: string): Promise<void> {
  const user = getSession();
  await localDb.activity_log.add({
    user_id: user?.id || '', user_name: user?.displayName || 'Sistema', action,
    entity, entity_id: entityId, detail, created_at: new Date().toISOString(),
  });
}

type MovementTxInput = {
  type: import('@/lib/localDb').FinancialMovementType;
  amount: number;
  originAccountId?: string;
  destinationAccountId?: string;
  reference: string;
  documentType: string;
  documentId: string;
  observation?: string;
  date: string;
  movementCode?: import('@/lib/localDb').FinancialMovementCode;
  relatedMovementId?: string;
  referenceType?: import('@/lib/localDb').FinancialReferenceType;
  referenceId?: string;
  status?: import('@/lib/localDb').FinancialMovementStatus;
  notes?: string;
  customerId?: string;
};

const inferMovementCode = (input: MovementTxInput): import('@/lib/localDb').FinancialMovementCode => {
  if (input.movementCode) return input.movementCode;
  if (input.documentType === 'invoice_cancellation') return 'SALE_CANCEL';
  if (input.documentType === 'layaway_completion') return 'LAYAWAY_COMPLETED';
  if (input.documentType === 'layaway_refund') return 'LAYAWAY_REFUND';
  if (input.documentType === 'layaway_credit') return 'CUSTOMER_CREDIT';
  if (input.documentType === 'customer_credit_used') return 'CUSTOMER_CREDIT_USED';
  if (input.documentType === 'layaway') return 'LAYAWAY_PAYMENT';
  if (input.documentType === 'invoice' && input.type === 'sale_income') return 'SALE_PAYMENT';
  if (input.type === 'opening_balance') return 'OPENING_BALANCE';
  if (input.type === 'expense') return 'EXPENSE';
  if (input.type === 'inventory_purchase') return 'PURCHASE_PAYMENT';
  if (input.type === 'supplier_payment') return 'SUPPLIER_PAYMENT';
  if (input.type === 'transfer' || input.type === 'transfer_in' || input.type === 'transfer_out') return 'BANK_TRANSFER';
  if (input.type === 'adjustment') {
    if (input.originAccountId && !input.destinationAccountId) return 'CASH_OUT';
    if (!input.originAccountId && input.destinationAccountId) return 'CASH_IN';
  }
  return 'ADJUSTMENT';
};

const inferReferenceType = (documentType: string): import('@/lib/localDb').FinancialReferenceType => {
  if (documentType === 'invoice' || documentType === 'invoice_cancellation') return 'SALE';
  if (documentType === 'layaway' || documentType === 'layaway_completion' || documentType === 'layaway_refund') return 'LAYAWAY';
  if (documentType === 'layaway_credit') return 'CUSTOMER';
  if (documentType === 'customer_credit_used') return 'SALE';
  if (documentType === 'quotation') return 'QUOTATION';
  if (documentType === 'expense') return 'EXPENSE';
  if (documentType === 'purchase_invoice') return 'PURCHASE';
  if (documentType === 'supplier_invoice') return 'SUPPLIER_INVOICE';
  if (documentType === 'financial_account') return 'FINANCIAL_ACCOUNT';
  if (documentType === 'transfer') return 'TRANSFER';
  return 'MANUAL';
};

async function addFinancialMovementTx(input: MovementTxInput): Promise<import('@/lib/localDb').DbFinancialMovement> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_FINANCIAL_AMOUNT');
  if (input.originAccountId && input.originAccountId === input.destinationAccountId) throw new Error('SAME_FINANCIAL_ACCOUNT');

  const origin = input.originAccountId ? await localDb.financial_accounts.get(input.originAccountId) : undefined;
  const destination = input.destinationAccountId ? await localDb.financial_accounts.get(input.destinationAccountId) : undefined;
  if (input.originAccountId && !origin) throw new Error('ORIGIN_ACCOUNT_NOT_FOUND');
  if (input.destinationAccountId && !destination) throw new Error('DESTINATION_ACCOUNT_NOT_FOUND');
  if (origin && origin.balance < amount) throw new Error('INSUFFICIENT_ACCOUNT_BALANCE');

  const originBefore = origin?.balance || 0;
  const destinationBefore = destination?.balance || 0;
  const originAfter = origin ? originBefore - amount : 0;
  const destinationAfter = destination ? destinationBefore + amount : 0;
  const now = new Date().toISOString();
  const user = getSession();
  const movement: import('@/lib/localDb').DbFinancialMovement = {
    id: crypto.randomUUID(), type: input.type, amount,
    origin_account_id: origin?.id || '', destination_account_id: destination?.id || '',
    origin_balance_before: originBefore, origin_balance_after: originAfter,
    destination_balance_before: destinationBefore, destination_balance_after: destinationAfter,
    reference: input.reference, document_type: input.documentType, document_id: input.documentId,
    observation: input.observation || '', user_id: user?.id || '', user_name: user?.displayName || 'Sistema',
    movement_date: input.date, created_at: now,
    movement_code: inferMovementCode(input),
    related_movement_id: input.relatedMovementId || '',
    reference_type: input.referenceType || inferReferenceType(input.documentType),
    reference_id: input.referenceId || input.documentId,
    status: input.status || 'POSTED',
    updated_at: now,
    notes: input.notes || input.observation || '',
    customer_id: input.customerId || '',
  };
  if (origin) await localDb.financial_accounts.update(origin.id, { balance: originAfter, updated_at: now });
  if (destination) await localDb.financial_accounts.update(destination.id, { balance: destinationAfter, updated_at: now });
  await localDb.financial_movements.add(movement);
  return movement;
}

const isActiveDbFinancialMovement = (movement: DbFinancialMovement): boolean =>
  !movement.status || movement.status === 'POSTED' || movement.status === 'COMPLETED';

interface AvailableCustomerCreditSourceTx {
  movement: DbFinancialMovement;
  available: number;
}

const financialMovementCustomerId = (movement: DbFinancialMovement): string =>
  movement.customer_id || (movement.movement_code === 'CUSTOMER_CREDIT' ? movement.reference_id : '') || '';

async function getAvailableCustomerCreditSourcesTx(customerId: string): Promise<AvailableCustomerCreditSourceTx[]> {
  const rows = await localDb.financial_movements.toArray();
  const credits = rows
    .filter(movement => (
      movement.movement_code === 'CUSTOMER_CREDIT'
      && isActiveDbFinancialMovement(movement)
      && financialMovementCustomerId(movement) === customerId
    ))
    .sort((left, right) => (
      (left.created_at || '').localeCompare(right.created_at || '')
      || left.id.localeCompare(right.id)
    ));
  const usedBySource = new Map<string, number>();
  rows
    .filter(movement => movement.movement_code === 'CUSTOMER_CREDIT_USED' && isActiveDbFinancialMovement(movement))
    .forEach(movement => {
      if (!movement.related_movement_id) return;
      usedBySource.set(
        movement.related_movement_id,
        (usedBySource.get(movement.related_movement_id) || 0) + Math.max(0, Number(movement.amount) || 0),
      );
    });

  return credits
    .map(movement => ({
      movement,
      available: Math.max(0, (Number(movement.amount) || 0) - (usedBySource.get(movement.id) || 0)),
    }))
    .filter(source => source.available > CANCELLATION_EPSILON);
}

async function applyCustomerCreditToSaleTx(
  invoice: Invoice,
  customerId: string,
  requestedAmount: number,
): Promise<DbFinancialMovement[]> {
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount <= CANCELLATION_EPSILON) return [];
  if (!customerId || invoice.clientId !== customerId) throw new Error('CUSTOMER_CREDIT_CLIENT_MISMATCH');

  await ensureLayawayReserveAccountTx();
  if (!await localDb.financial_accounts.get(MAIN_CASH_ACCOUNT_ID)) {
    const now = new Date().toISOString();
    await localDb.financial_accounts.add({
      id: MAIN_CASH_ACCOUNT_ID,
      name: 'Caja Principal',
      kind: 'cash',
      active: true,
      balance: 0,
      created_at: now,
      updated_at: now,
    });
  }
  const sources = await getAvailableCustomerCreditSourcesTx(customerId);
  const available = sources.reduce((sum, source) => sum + source.available, 0);
  if (amount > available + CANCELLATION_EPSILON) throw new Error('CUSTOMER_CREDIT_EXCEEDS_AVAILABLE');
  if (amount > invoice.total + CANCELLATION_EPSILON) throw new Error('CUSTOMER_CREDIT_EXCEEDS_SALE_TOTAL');

  let remaining = amount;
  const created: DbFinancialMovement[] = [];
  for (const source of sources) {
    if (remaining <= CANCELLATION_EPSILON) break;
    const consumed = Math.min(source.available, remaining);
    const movement = await addFinancialMovementTx({
      type: 'transfer',
      amount: consumed,
      originAccountId: LAYAWAY_RESERVE_ACCOUNT_ID,
      destinationAccountId: MAIN_CASH_ACCOUNT_ID,
      reference: invoice.number,
      documentType: 'customer_credit_used',
      documentId: invoice.id,
      observation: `Saldo a favor aplicado a ${invoice.number}`,
      date: invoice.date,
      movementCode: 'CUSTOMER_CREDIT_USED',
      relatedMovementId: source.movement.id,
      referenceType: 'SALE',
      referenceId: invoice.id,
      status: 'COMPLETED',
      notes: `Crédito ${source.movement.reference || source.movement.id} aplicado a ${invoice.number}`,
      customerId,
    });
    created.push(movement);
    remaining -= consumed;
  }
  if (remaining > CANCELLATION_EPSILON) throw new Error('CUSTOMER_CREDIT_ALLOCATION_INCOMPLETE');
  return created;
}

export async function transferBetweenAccounts(input: { originAccountId: string; destinationAccountId: string; amount: number; date: string; observation?: string }): Promise<FinancialMovement[]> {
  await requireRepositoryPermission('manage_finances');
  return localDb.transaction('rw', localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    const transferId = crypto.randomUUID();
    const movement = await addFinancialMovementTx({ type: 'transfer', amount: input.amount,
      originAccountId: input.originAccountId, destinationAccountId: input.destinationAccountId,
      reference: `Transferencia ${transferId}`, documentType: 'transfer', documentId: transferId,
      observation: input.observation, date: input.date,
      movementCode: 'BANK_TRANSFER', referenceType: 'TRANSFER', referenceId: transferId });
    await addActivityTx('FINANCIAL_TRANSFER', 'transfer', transferId, JSON.stringify(input));
    return [mapFinancialMovement(movement)];
  });
}

export async function fetchFinancialMovements(limit = 5000): Promise<FinancialMovement[]> {
  const rows = await localDb.financial_movements.orderBy('created_at').reverse().limit(limit).toArray();
  return rows.map(mapFinancialMovement);
}

const SALE_QUANTITY_EPSILON = 0.000001;

type SaleInventoryRequest = {
  product: Product;
  row: DbProduct;
  quantity: number;
  grams: number;
};

/**
 * Validates and applies every inventory deduction required by an invoice.
 *
 * This helper must only be called from a Dexie transaction that includes the
 * products table. All validation is completed before the first product update,
 * so malformed sales fail early; any later exception is still protected by the
 * surrounding transaction rollback.
 */
async function deductInvoiceInventoryTx(invoice: Invoice): Promise<Product[]> {
  if (invoice.items.length === 0) throw new Error('INVOICE_ITEMS_REQUIRED');

  const productIds = Array.from(new Set(invoice.items.map(item => item.productId).filter(Boolean)));
  if (productIds.length !== invoice.items.length) {
    // The UI normally keeps one line per product. Reject duplicate or missing
    // identifiers here so an external caller cannot under/over-discount stock.
    throw new Error('INVALID_INVOICE_PRODUCT_LINES');
  }

  const rows = await localDb.products.bulkGet(productIds);
  const requests: SaleInventoryRequest[] = [];

  invoice.items.forEach((item, index) => {
    const row = rows[index];
    if (!row) throw new Error('SALE_PRODUCT_NOT_FOUND');

    const product = mapDbProduct(row);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_SALE_QUANTITY');

    // The current product model has no independent `active` column. The
    // existing deactivation workflow marks a product with stock=0/minStock=0;
    // reject that state explicitly while retaining full schema compatibility.
    if (product.stock <= 0 && product.minStock <= 0) throw new Error('SALE_PRODUCT_INACTIVE');

    if (isSoldByWeight(product)) {
      const grams = Number(item.weightGrams);
      if (!Number.isFinite(grams) || grams <= 0) throw new Error('INVALID_SALE_GRAMS');
      if (Math.abs(quantity - grams) > SALE_QUANTITY_EPSILON) {
        throw new Error('SALE_WEIGHT_QUANTITY_MISMATCH');
      }

      const availableGrams = getProductAvailableGrams(product);
      if (product.stock + SALE_QUANTITY_EPSILON < grams || availableGrams + SALE_QUANTITY_EPSILON < grams) {
        throw new Error('INSUFFICIENT_SALE_GRAMS');
      }
      requests.push({ product, row, quantity: grams, grams });
      return;
    }

    if (product.stock + SALE_QUANTITY_EPSILON < quantity) throw new Error('INSUFFICIENT_SALE_STOCK');
    requests.push({
      product,
      row,
      quantity,
      grams: Math.max(0, product.weightGrams * quantity),
    });
  });

  const updatedProducts: Product[] = [];
  for (const request of requests) {
    const byWeight = isSoldByWeight(request.product);
    const stockAfter = request.product.stock - request.quantity;
    const gramsAfter = byWeight
      ? getProductAvailableGrams(request.product) - request.grams
      : Math.max(0, request.product.weightGrams * stockAfter);

    if (stockAfter < -SALE_QUANTITY_EPSILON || gramsAfter < -SALE_QUANTITY_EPSILON) {
      throw new Error('SALE_INVENTORY_NEGATIVE');
    }

    const normalizedStock = Math.max(0, stockAfter);
    const normalizedGrams = Math.max(0, gramsAfter);
    await localDb.products.update(request.product.id, {
      stock: normalizedStock,
      available_grams: normalizedGrams,
    });

    updatedProducts.push({
      ...request.product,
      stock: normalizedStock,
      availableGrams: normalizedGrams,
    });
  }

  return updatedProducts;
}

const DOCUMENT_VALUE_EPSILON = 0.01;

const sameDocumentValue = (left: number, right: number): boolean =>
  Math.abs(Number(left) - Number(right)) <= DOCUMENT_VALUE_EPSILON;

/**
 * Validates that a quotation conversion is still based on the persisted,
 * active quotation. This function performs no writes and must run inside the
 * same transaction that creates the invoice.
 */
async function validateQuotationConversionTx(
  invoice: Invoice,
  quotationId: string,
): Promise<DbQuotation> {
  const quotation = await localDb.quotations.get(quotationId);
  if (!quotation) throw new Error('QUOTATION_NOT_FOUND');
  if (quotation.status === 'accepted') throw new Error('QUOTATION_ALREADY_CONVERTED');
  if (quotation.status !== 'active') throw new Error('QUOTATION_NOT_ACTIVE');
  if (!isSalesInvoice(invoice)) {
    throw new Error('INVALID_QUOTATION_INVOICE');
  }

  const quotationItems = await localDb.quotation_items
    .where('quotation_id')
    .equals(quotationId)
    .toArray();
  if (quotationItems.length === 0) throw new Error('QUOTATION_ITEMS_REQUIRED');

  if (
    invoice.clientId !== quotation.client_id ||
    !sameDocumentValue(invoice.subtotal, quotation.subtotal) ||
    !sameDocumentValue(invoice.discount, quotation.discount) ||
    !sameDocumentValue(invoice.tax, quotation.tax) ||
    !sameDocumentValue(invoice.total, quotation.total) ||
    invoice.items.length !== quotationItems.length
  ) {
    throw new Error('QUOTATION_CONTENT_MISMATCH');
  }

  const invoiceItemsByProduct = new Map(invoice.items.map(item => [item.productId, item]));
  if (invoiceItemsByProduct.size !== invoice.items.length) {
    throw new Error('QUOTATION_CONTENT_MISMATCH');
  }

  quotationItems.forEach(item => {
    const invoiceItem = invoiceItemsByProduct.get(item.product_id);
    if (
      !invoiceItem ||
      !sameDocumentValue(invoiceItem.quantity, item.quantity) ||
      !sameDocumentValue(invoiceItem.unitPrice, item.unit_price) ||
      !sameDocumentValue(invoiceItem.subtotal, item.subtotal)
    ) {
      throw new Error('QUOTATION_CONTENT_MISMATCH');
    }
  });

  return quotation;
}

/**
 * Official ACID engine for paid invoices and quotation conversions.
 *
 * When quotationId is supplied, the persisted quotation is validated and
 * marked accepted inside the exact same Dexie transaction as inventory,
 * invoice, payments, balances, movements and activity log.
 */
export async function insertInvoiceWithFinancials(
  inv: Invoice,
  allocations: PaymentAllocation[],
  options: InvoiceFinancialTransactionOptions = {},
): Promise<Product[]> {
  await requireRepositoryPermission('create_sales');
  if (!isSalesInvoice(inv)) throw new Error('INVALID_SALES_INVOICE');
  const valid = allocations.filter(a => a.accountId && Number(a.amount) > 0);
  const allocationTotal = valid.reduce((sum, a) => sum + Number(a.amount), 0);
  const customerCreditAmount = Math.max(0, Number(options.customerCredit?.amount) || 0);
  if (options.customerCredit && options.customerCredit.customerId !== inv.clientId) {
    throw new Error('CUSTOMER_CREDIT_CLIENT_MISMATCH');
  }
  if (Math.abs((allocationTotal + customerCreditAmount) - inv.total) > 1) {
    throw new Error('PAYMENT_ALLOCATION_MISMATCH');
  }

  return localDb.transaction('rw', [
    localDb.products,
    localDb.invoices,
    localDb.invoice_items,
    localDb.invoice_payment_allocations,
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
    localDb.quotations,
    localDb.quotation_items,
  ], async () => {
    if (await localDb.invoices.get(inv.id)) throw new Error('INVOICE_ALREADY_EXISTS');

    const quotationSource = options.quotationId
      ? await validateQuotationConversionTx(inv, options.quotationId)
      : null;

    // Inventory is validated and discounted first. Invoice, money and audit
    // records are created only afterwards, within this exact transaction.
    const updatedProducts = await deductInvoiceInventoryTx(inv);
    await addInvoiceTx(inv);

    const customerCreditMovements = options.customerCredit
      ? await applyCustomerCreditToSaleTx(inv, options.customerCredit.customerId, customerCreditAmount)
      : [];

    for (const allocation of valid) {
      const id = crypto.randomUUID();
      await localDb.invoice_payment_allocations.add({
        id,
        invoice_id: inv.id,
        account_id: allocation.accountId,
        amount: allocation.amount,
        payment_method: allocation.paymentMethod || '',
        created_at: new Date().toISOString(),
      });
      await addFinancialMovementTx({
        type: 'sale_income',
        amount: allocation.amount,
        destinationAccountId: allocation.accountId,
        reference: inv.number,
        documentType: 'invoice',
        documentId: inv.id,
        observation: inv.clientName,
        date: inv.date,
        movementCode: 'SALE_PAYMENT',
        referenceType: 'SALE',
        referenceId: inv.id,
        notes: `Pago ${id} · ${allocation.paymentMethod || 'Sin método'}`,
      });
    }

    await addActivityTx(
      options.manualTotal ? 'INVOICE_CREATED_WITH_MANUAL_TOTAL' : 'INVOICE_CREATED',
      'invoice',
      inv.id,
      options.manualTotal || customerCreditMovements.length > 0
        ? JSON.stringify({
            number: inv.number,
            calculatedTotal: options.manualTotal?.calculatedTotal,
            finalTotal: options.manualTotal?.finalTotal || inv.total,
            difference: options.manualTotal
              ? options.manualTotal.finalTotal - options.manualTotal.calculatedTotal
              : 0,
            customerCreditUsed: customerCreditMovements.reduce((sum, movement) => sum + movement.amount, 0),
          })
        : `${inv.number} · ${inv.total}`,
    );

    if (quotationSource && options.quotationId) {
      await addActivityTx(
        'QUOTATION_CONVERTED',
        'quotation',
        options.quotationId,
        `${quotationSource.number} → ${inv.number}`,
      );
      const updated = await localDb.quotations.update(options.quotationId, { status: 'accepted' });
      if (!updated) throw new Error('QUOTATION_NOT_FOUND');
    }

    return updatedProducts;
  });
}

export async function insertExpenseWithFinancials(expense: ExpenseInvoice, accountId: string): Promise<void> {
  await requireRepositoryPermission('manage_expenses');
  await localDb.transaction('rw', localDb.expenses, localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    const existing = await localDb.expenses.get(expense.id);
    if (existing) throw new Error('EXPENSE_ALREADY_EXISTS');
    const paid = expense.status === 'paid';
    await localDb.expenses.add({
      id: expense.id, number: expense.number, supplier_id: expense.supplierId || '', supplier_name: expense.supplierName,
      total: expense.total, description: expense.description, date: expense.date, payment_method: expense.paymentMethod,
      status: expense.status, account_id: paid ? accountId : '', created_at: new Date().toISOString(),
    });
    if (paid) {
      await addFinancialMovementTx({ type: 'expense', amount: expense.total, originAccountId: accountId,
        reference: expense.number, documentType: 'expense', documentId: expense.id,
        observation: expense.description, date: expense.date });
    }
    await addActivityTx('EXPENSE_CREATED', 'expense', expense.id, JSON.stringify({ value: expense.total, status: expense.status }));
  });
}

export async function updateExpenseWithFinancialAdjustment(expense: ExpenseInvoice): Promise<void> {
  await requireRepositoryPermission('manage_expenses');
  await localDb.transaction('rw', localDb.expenses, localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    const previous = await localDb.expenses.get(expense.id);
    if (!previous) throw new Error('EXPENSE_NOT_FOUND');
    const wasPaid = previous.status === 'paid';
    const becomesPaid = expense.status === 'paid';
    if (wasPaid && Math.abs(previous.total - expense.total) > 0.01) throw new Error('PAID_EXPENSE_VALUE_LOCKED');
    if (wasPaid && expense.status !== 'paid') throw new Error('PAID_EXPENSE_REVERSAL_REQUIRED');
    const accountId = expense.accountId || previous.account_id || '';
    if (!wasPaid && becomesPaid) {
      if (!accountId) throw new Error('PAYMENT_ACCOUNT_REQUIRED');
      await addFinancialMovementTx({ type: 'expense', amount: expense.total, originAccountId: accountId,
        reference: expense.number, documentType: 'expense', documentId: expense.id,
        observation: expense.description, date: expense.date });
      await addActivityTx('EXPENSE_MARKED_AS_PAID', 'expense', expense.id, JSON.stringify({ previousValue: previous.total, newValue: expense.total }));
    }
    await localDb.expenses.put({
      ...previous, supplier_id: expense.supplierId || '', supplier_name: expense.supplierName,
      total: expense.total, description: expense.description, date: expense.date,
      payment_method: expense.paymentMethod, status: expense.status, account_id: becomesPaid ? accountId : '',
    });
    await addActivityTx('EXPENSE_UPDATED', 'expense', expense.id, JSON.stringify({ previousValue: previous.total, newValue: expense.total, previousStatus: previous.status, newStatus: expense.status }));
  });
}

export async function createInventoryPayable(_input: { adjustmentId: string; supplierId: string; supplierName: string; total: number; date: string; dueDate?: string }): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  throw new Error('INVENTORY_ADJUSTMENT_FINANCIAL_OPERATION_FORBIDDEN');
}

export async function postPaidInventoryPurchase(_input: { adjustmentId: string; accountId: string; total: number; date: string; supplierName?: string }): Promise<void> {
  await requireRepositoryPermission('manage_inventory');
  throw new Error('INVENTORY_ADJUSTMENT_FINANCIAL_OPERATION_FORBIDDEN');
}

export async function addSupplierPaymentWithAccount(supplierInvoiceId: string, input: { amount: number; date: string; method: string; accountId: string }): Promise<void> {
  await requireRepositoryPermission('manage_accounts_payable');
  await localDb.transaction('rw', localDb.supplier_invoices, localDb.supplier_invoice_payments, localDb.purchase_invoices,
    localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
      const invoice = await localDb.supplier_invoices.get(supplierInvoiceId);
      if (!invoice) throw new Error('PAYABLE_NOT_FOUND');
      const payments = await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(supplierInvoiceId).toArray();
      const alreadyPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const pendingBefore = Math.max(0, (invoice.initial_value ?? invoice.total) - alreadyPaid);
      if (input.amount > pendingBefore + 0.01) throw new Error('PAYMENT_EXCEEDS_BALANCE');
      const pendingAfter = Math.max(0, pendingBefore - input.amount);
      const user = getSession();
      await localDb.supplier_invoice_payments.add({ id: crypto.randomUUID(), supplier_invoice_id: supplierInvoiceId,
        amount: input.amount, date: input.date, method: input.method, account_id: input.accountId,
        balance_before: pendingBefore, balance_after: pendingAfter, user_id: user?.id || '', user_name: user?.displayName || 'Sistema',
        created_at: new Date().toISOString() });
      const paymentStatus = pendingAfter <= 0.01 ? 'paid' : 'partial';
      await localDb.supplier_invoices.update(supplierInvoiceId, {
        pending_balance: pendingAfter, status: paymentStatus, updated_at: new Date().toISOString(),
      });
      if (invoice.source_type === 'purchase_invoice' && invoice.source_id && paymentStatus === 'paid') {
        await localDb.purchase_invoices.update(invoice.source_id, { status: 'paid' });
      }
      await addFinancialMovementTx({ type: 'supplier_payment', amount: input.amount, originAccountId: input.accountId,
        reference: invoice.invoice_number, documentType: 'supplier_invoice', documentId: supplierInvoiceId,
        observation: invoice.supplier_name, date: input.date });
      await addActivityTx(paymentStatus === 'paid' ? 'PAYABLE_FULL_PAYMENT' : 'PAYABLE_PARTIAL_PAYMENT', 'supplier_invoice', supplierInvoiceId, JSON.stringify({
        previousValue: pendingBefore, paidValue: input.amount, remainingBalance: pendingAfter, accountId: input.accountId,
        paymentMethod: input.method, paymentDate: input.date, userId: user?.id || '', userName: user?.displayName || 'Sistema',
      }));
    });
}


export async function updateSupplierInvoiceSafe(id: string, input: {
  supplierId: string; supplierName: string; invoiceNumber: string; issueDate: string;
  dueDate: string; total: number; notes: string; status: 'pending' | 'paid';
}): Promise<void> {
  await requireRepositoryPermission('manage_accounts_payable');
  await localDb.transaction('rw', localDb.supplier_invoices, localDb.supplier_invoice_payments, localDb.activity_log, async () => {
    const previous = await localDb.supplier_invoices.get(id);
    if (!previous) throw new Error('PAYABLE_NOT_FOUND');
    const payments = await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(id).toArray();
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid > 0 && Math.abs(input.total - (previous.initial_value ?? previous.total)) > 0.01) throw new Error('PAID_PAYABLE_VALUE_LOCKED');
    if (paid > 0 && input.status !== 'paid') throw new Error('PAID_PAYABLE_REVERSAL_REQUIRED');
    if (paid <= 0 && input.status === 'paid') throw new Error('PAYMENT_REQUIRED_TO_MARK_PAID');
    const pending = Math.max(0, input.total - paid);
    await localDb.supplier_invoices.update(id, {
      supplier_id: input.supplierId, supplier_name: input.supplierName, invoice_number: input.invoiceNumber,
      issue_date: input.issueDate, due_date: input.dueDate, total: input.total,
      initial_value: input.total, pending_balance: pending,
      status: paid > 0 ? (pending <= 0.01 ? 'paid' : 'partial') : input.status,
      notes: input.notes, updated_at: new Date().toISOString(),
    });
    await addActivityTx('PAYABLE_EDITED', 'supplier_invoice', id, JSON.stringify({ previousValue: previous.total, newValue: input.total }));
  });
}

export async function deleteSupplierInvoiceSafe(id: string): Promise<void> {
  await requireRepositoryPermission('manage_accounts_payable');
  await localDb.transaction('rw', localDb.supplier_invoices, localDb.supplier_invoice_payments, localDb.financial_movements, localDb.activity_log, async () => {
    const previous = await localDb.supplier_invoices.get(id);
    if (!previous) throw new Error('PAYABLE_NOT_FOUND');
    const payments = await localDb.supplier_invoice_payments.where('supplier_invoice_id').equals(id).count();
    const movements = await localDb.financial_movements.filter(movement =>
      movement.document_type === 'supplier_invoice' && movement.document_id === id
    ).count();
    if (payments > 0 || movements > 0) throw new Error('PAYABLE_HAS_PAYMENTS');
    await localDb.supplier_invoices.delete(id);
    await addActivityTx('PAYABLE_DELETED', 'supplier_invoice', id, JSON.stringify({ previousValue: previous.total, reason: 'Sin pagos ni movimientos asociados' }));
  });
}

export async function fetchFinancialSummary(): Promise<FinancialSummary> {
  const [accounts, movements, payables, expenses, invoices, products] = await Promise.all([
    fetchFinancialAccounts(),
    fetchFinancialMovements(),
    fetchSupplierInvoices(),
    fetchExpenses(),
    fetchInvoices(),
    fetchProducts(),
  ]);

  return calculateFinancialSummary({ accounts, movements, payables, expenses, invoices, products });
}
