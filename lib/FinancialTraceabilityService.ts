import type {
  Contact,
  ExpenseInvoice,
  FinancialAccount,
  FinancialMovement,
  FinancialMovementCode,
  FinancialMovementStatus,
  Invoice,
  PurchaseInvoice,
} from '@/data/mockData';
import type { Layaway } from '@/domain/models';
import {
  calculateLedgerAccountBalances,
  compensatedReversedFinancialMovementIds,
  isActiveFinancialMovement,
  neutralizedDirectSaleMovementIds,
  participatesInNetFinancialFlow,
  resolveFinancialAccountBalance,
  resolveFinancialMovementCode,
  resolveFinancialReferenceType,
} from '@/lib/FinancialLedgerService';
import {
  LAYAWAY_RESERVE_ACCOUNT_ID,
  MAIN_CASH_ACCOUNT_ID,
} from '@/lib/FinancialPositionService';

const EPSILON = 0.01;

export interface FinancialTraceabilityInput {
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  contacts?: Contact[];
  invoices?: Invoice[];
  purchases?: PurchaseInvoice[];
  expenses?: ExpenseInvoice[];
  layaways?: Layaway[];
}

export interface FinancialTraceabilityFilters {
  dateFrom?: string;
  dateTo?: string;
  document?: string;
  invoice?: string;
  purchase?: string;
  expense?: string;
  layaway?: string;
  supplier?: string;
  client?: string;
  user?: string;
  accountId?: string;
  accountKind?: 'cash' | 'bank';
  movementType?: string;
  status?: FinancialMovementStatus | '';
  movementCode?: FinancialMovementCode | '';
}

export interface FinancialLedgerRow {
  movement: FinancialMovement;
  movementId: string;
  relatedMovementId: string;
  referenceType: string;
  referenceId: string;
  timestamp: string;
  date: string;
  time: string;
  type: string;
  code: FinancialMovementCode;
  document: string;
  client: string;
  supplier: string;
  concept: string;
  value: number;
  income: number;
  expense: number;
  cashOrigin: string;
  cashDestination: string;
  bankOrigin: string;
  bankDestination: string;
  user: string;
  status: FinancialMovementStatus;
  reference: string;
  originAccountId: string;
  destinationAccountId: string;
}

export interface FinancialCompositionRow extends FinancialLedgerRow {
  signedAmount: number;
}

export interface FinancialComposition {
  key: 'mainCash' | 'layawayReserve' | 'banks' | 'totalAvailable' | string;
  label: string;
  total: number;
  lastUpdatedAt: string | null;
  status: 'RECONCILED' | 'NO_MOVEMENTS';
  rows: FinancialCompositionRow[];
}

export interface FinancialBankDetail {
  accountId: string;
  name: string;
  balance: number;
  entries: number;
  exits: number;
  transfers: number;
  lastMovementAt: string | null;
  rows: FinancialCompositionRow[];
}

export type FinancialAuditIssueType =
  | 'ORPHAN_MOVEMENT'
  | 'DUPLICATE_MOVEMENT'
  | 'MISSING_REFERENCE'
  | 'MISSING_DOCUMENT'
  | 'INCOMPLETE_REVERSAL'
  | 'INCOMPLETE_TRANSFER'
  | 'BALANCE_MISMATCH';

export interface FinancialAuditIssue {
  id: string;
  type: FinancialAuditIssueType;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  movementId?: string;
  accountId?: string;
  expected?: number;
  actual?: number;
}

export interface FinancialAuditResult {
  generatedAt: string;
  reconstructedBalances: Map<string, number>;
  issues: FinancialAuditIssue[];
  isBalanced: boolean;
}

const timestampOf = (movement: FinancialMovement): string =>
  movement.createdAt || movement.updatedAt || `${movement.date}T00:00:00.000Z`;

const normalized = (value: unknown): string => String(value || '').trim().toLocaleLowerCase('es');

const documentMatches = (movement: FinancialMovement, type: string): boolean =>
  resolveFinancialReferenceType(movement) === type;

function getDocumentContext(input: FinancialTraceabilityInput, movement: FinancialMovement) {
  const referenceType = resolveFinancialReferenceType(movement);
  const referenceId = movement.referenceId || movement.documentId;
  const invoice = input.invoices?.find(item => item.id === referenceId || item.id === movement.documentId);
  const purchase = input.purchases?.find(item => item.id === referenceId || item.id === movement.documentId);
  const expense = input.expenses?.find(item => item.id === referenceId || item.id === movement.documentId);
  const layaway = input.layaways?.find(item => item.id === referenceId || item.id === movement.documentId);
  const clientId = movement.customerId || invoice?.clientId || layaway?.invoice.clientId || (referenceType === 'CUSTOMER' ? referenceId : '');
  const client = input.contacts?.find(item => item.id === clientId && item.type === 'client');
  const supplierId = purchase?.supplierId || expense?.supplierId || '';
  const supplier = input.contacts?.find(item => item.id === supplierId && item.type === 'supplier');

  return {
    referenceType,
    referenceId,
    document: invoice?.number
      || purchase?.number
      || expense?.number
      || layaway?.invoice.number
      || movement.reference
      || movement.documentId,
    client: invoice?.clientName || layaway?.invoice.clientName || client?.name || '',
    supplier: purchase?.supplierName || expense?.supplierName || supplier?.name
      || (referenceType === 'SUPPLIER_INVOICE' || referenceType === 'PURCHASE' || referenceType === 'EXPENSE'
        ? movement.observation
        : ''),
  };
}

export function buildFinancialLedgerRows(input: FinancialTraceabilityInput): FinancialLedgerRow[] {
  const accountById = new Map(input.accounts.map(account => [account.id, account]));
  const neutralizedSaleIds = neutralizedDirectSaleMovementIds(input.movements);

  return [...input.movements]
    .sort((left, right) => {
      const byTime = timestampOf(right).localeCompare(timestampOf(left));
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    })
    .map(movement => {
      const origin = movement.originAccountId ? accountById.get(movement.originAccountId) : undefined;
      const destination = movement.destinationAccountId ? accountById.get(movement.destinationAccountId) : undefined;
      const context = getDocumentContext(input, movement);
      const timestamp = timestampOf(movement);
      const [date, rawTime = '00:00:00'] = timestamp.split('T');
      const time = rawTime.slice(0, 8);
      return {
        movement,
        movementId: movement.id,
        relatedMovementId: movement.relatedMovementId || '',
        referenceType: context.referenceType,
        referenceId: context.referenceId || '',
        timestamp,
        date: movement.date || date,
        time,
        type: movement.type,
        code: resolveFinancialMovementCode(movement),
        document: context.document || 'Sin documento',
        client: context.client,
        supplier: context.supplier,
        concept: movement.observation || movement.notes || movement.reference || 'Sin concepto',
        value: movement.amount,
        // SALE_CANCEL is an immutable audit row, not a new commercial expense.
        // Its linked SALE_PAYMENT is equally neutral in report totals.
        income: !neutralizedSaleIds.has(movement.id) && movement.destinationAccountId ? movement.amount : 0,
        expense: !neutralizedSaleIds.has(movement.id) && movement.originAccountId ? movement.amount : 0,
        cashOrigin: origin?.kind === 'cash' ? origin.name : '',
        cashDestination: destination?.kind === 'cash' ? destination.name : '',
        bankOrigin: origin && origin.kind !== 'cash' ? origin.name : '',
        bankDestination: destination && destination.kind !== 'cash' ? destination.name : '',
        user: movement.userName || movement.userId || 'Sistema',
        status: movement.status || 'POSTED',
        reference: movement.reference || '',
        originAccountId: movement.originAccountId || '',
        destinationAccountId: movement.destinationAccountId || '',
      };
    });
}

export function filterFinancialLedgerRows(
  rows: FinancialLedgerRow[],
  filters: FinancialTraceabilityFilters,
  accounts: FinancialAccount[],
): FinancialLedgerRow[] {
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const includes = (value: string, query?: string): boolean => !query || normalized(value).includes(normalized(query));

  return rows.filter(row => {
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    if (filters.dateTo && row.date > filters.dateTo) return false;
    if (!includes(`${row.document} ${row.reference} ${row.referenceId}`, filters.document)) return false;
    if (filters.invoice && (!documentMatches(row.movement, 'SALE') || !includes(row.document, filters.invoice))) return false;
    if (filters.purchase && (!documentMatches(row.movement, 'PURCHASE') || !includes(row.document, filters.purchase))) return false;
    if (filters.expense && (!documentMatches(row.movement, 'EXPENSE') || !includes(row.document, filters.expense))) return false;
    if (filters.layaway && (!documentMatches(row.movement, 'LAYAWAY') || !includes(row.document, filters.layaway))) return false;
    if (!includes(row.supplier, filters.supplier)) return false;
    if (!includes(row.client, filters.client)) return false;
    if (!includes(row.user, filters.user)) return false;
    if (filters.accountId && row.originAccountId !== filters.accountId && row.destinationAccountId !== filters.accountId) return false;
    if (filters.accountKind) {
      const originKind = accountById.get(row.originAccountId)?.kind;
      const destinationKind = accountById.get(row.destinationAccountId)?.kind;
      const matches = filters.accountKind === 'cash'
        ? originKind === 'cash' || destinationKind === 'cash'
        : (originKind && originKind !== 'cash') || (destinationKind && destinationKind !== 'cash');
      if (!matches) return false;
    }
    if (filters.movementType && row.type !== filters.movementType) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.movementCode && row.code !== filters.movementCode) return false;
    return true;
  });
}

function compositionForAccounts(
  key: FinancialComposition['key'],
  label: string,
  rows: FinancialLedgerRow[],
  accountIds: Set<string>,
  compensatedOriginalIds: Set<string>,
  totalOverride?: number,
): FinancialComposition {
  const compositionRows = rows
    .filter(row => participatesInNetFinancialFlow(row.movement, compensatedOriginalIds))
    .map<FinancialCompositionRow | null>(row => {
      const destinationIncluded = accountIds.has(row.destinationAccountId);
      const originIncluded = accountIds.has(row.originAccountId);
      const signedAmount = (destinationIncluded ? row.value : 0) - (originIncluded ? row.value : 0);
      if (Math.abs(signedAmount) <= EPSILON) return null;
      return { ...row, signedAmount };
    })
    .filter((row): row is FinancialCompositionRow => Boolean(row));

  return {
    key,
    label,
    total: totalOverride ?? compositionRows.reduce((sum, row) => sum + row.signedAmount, 0),
    lastUpdatedAt: compositionRows[0]?.timestamp || null,
    status: compositionRows.length > 0 ? 'RECONCILED' : 'NO_MOVEMENTS',
    rows: compositionRows,
  };
}

export function buildFinancialCompositions(input: FinancialTraceabilityInput) {
  const rows = buildFinancialLedgerRows(input);
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(input.movements);
  const bankIds = new Set(input.accounts.filter(account => account.kind !== 'cash' && account.active).map(account => account.id));
  const availableIds = new Set([MAIN_CASH_ACCOUNT_ID, ...bankIds]);
  const currentBalance = (accountId: string): number => resolveFinancialAccountBalance(
    input.accounts,
    input.movements,
    accountId,
  );
  const mainCashBalance = currentBalance(MAIN_CASH_ACCOUNT_ID);
  const layawayReserveBalance = currentBalance(LAYAWAY_RESERVE_ACCOUNT_ID);
  const banksBalance = [...bankIds].reduce((sum, accountId) => sum + currentBalance(accountId), 0);
  const totalAvailableBalance = mainCashBalance + banksBalance;

  return {
    mainCash: compositionForAccounts(
      'mainCash',
      'Caja Principal',
      rows,
      new Set([MAIN_CASH_ACCOUNT_ID]),
      compensatedOriginalIds,
      mainCashBalance,
    ),
    layawayReserve: compositionForAccounts(
      'layawayReserve',
      'Caja Separados',
      rows,
      new Set([LAYAWAY_RESERVE_ACCOUNT_ID]),
      compensatedOriginalIds,
      layawayReserveBalance,
    ),
    banks: compositionForAccounts(
      'banks',
      'Bancos',
      rows,
      bankIds,
      compensatedOriginalIds,
      banksBalance,
    ),
    totalAvailable: compositionForAccounts(
      'totalAvailable',
      'Total Disponible',
      rows,
      availableIds,
      compensatedOriginalIds,
      totalAvailableBalance,
    ),
  };
}

export function buildBankDetails(input: FinancialTraceabilityInput): FinancialBankDetail[] {
  const rows = buildFinancialLedgerRows(input);
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(input.movements);
  return input.accounts
    .filter(account => account.active && account.kind !== 'cash')
    .map(account => {
      const currentBalance = resolveFinancialAccountBalance(input.accounts, input.movements, account.id);
      const composition = compositionForAccounts(
        account.id,
        account.name,
        rows,
        new Set([account.id]),
        compensatedOriginalIds,
        currentBalance,
      );
      const accountRows = rows.filter(row => row.originAccountId === account.id || row.destinationAccountId === account.id);
      const participatingRows = accountRows.filter(row => participatesInNetFinancialFlow(row.movement, compensatedOriginalIds));
      return {
        accountId: account.id,
        name: account.name,
        balance: composition.total,
        entries: participatingRows.reduce((sum, row) => sum + row.income, 0),
        exits: participatingRows.reduce((sum, row) => sum + row.expense, 0),
        transfers: participatingRows.filter(row => row.code === 'BANK_TRANSFER').reduce((sum, row) => sum + row.value, 0),
        lastMovementAt: accountRows[0]?.timestamp || null,
        rows: composition.rows,
      };
    });
}

export function traceFinancialMovement(
  rows: FinancialLedgerRow[],
  movementId: string,
): FinancialLedgerRow[] {
  const seed = rows.find(row => row.movementId === movementId);
  if (!seed) return [];
  return rows.filter(row => (
    row.movementId === movementId
    || row.relatedMovementId === movementId
    || seed.relatedMovementId === row.movementId
    || (seed.referenceId && row.referenceId === seed.referenceId)
  ));
}

function reconstructBalances(input: FinancialTraceabilityInput): Map<string, number> {
  const balances = new Map<string, number>();
  calculateLedgerAccountBalances(input.accounts, input.movements).forEach(entry => {
    // A balance can only be independently audited when the account has an
    // opening ledger row. Legacy/system accounts without one remain explicit
    // materialized fallbacks instead of being reconstructed from an arbitrary
    // same-millisecond movement order.
    if (entry.source === 'ledger') balances.set(entry.accountId, entry.balance);
  });
  return balances;
}

export function auditFinancialLedger(input: FinancialTraceabilityInput): FinancialAuditResult {
  const issues: FinancialAuditIssue[] = [];
  const movementById = new Map(input.movements.map(movement => [movement.id, movement]));
  const signatures = new Map<string, FinancialMovement>();
  const reversalCodes = new Set<FinancialMovementCode>(['SALE_CANCEL', 'LAYAWAY_REFUND', 'REVERSAL']);

  input.movements.forEach(movement => {
    const code = resolveFinancialMovementCode(movement);
    if (movement.relatedMovementId && !movementById.has(movement.relatedMovementId)) {
      issues.push({
        id: `orphan-${movement.id}`,
        type: 'ORPHAN_MOVEMENT',
        severity: 'critical',
        title: 'Movimiento relacionado inexistente',
        detail: `${movement.id} referencia ${movement.relatedMovementId}, pero ese movimiento no existe.`,
        movementId: movement.id,
      });
    }
    const sourceIdentity = movement.relatedMovementId
      || movement.notes
      || [
        movement.originBalanceBefore,
        movement.originBalanceAfter,
        movement.destinationBalanceBefore,
        movement.destinationBalanceAfter,
      ].join('>');
    const signature = [
      code,
      movement.referenceId || movement.documentId,
      movement.originAccountId || '',
      movement.destinationAccountId || '',
      movement.amount,
      timestampOf(movement),
      movement.userId,
      movement.status || 'POSTED',
      sourceIdentity,
    ].join('|');
    const duplicate = signatures.get(signature);
    if (duplicate && isActiveFinancialMovement(duplicate) && isActiveFinancialMovement(movement)) {
      issues.push({
        id: `duplicate-${movement.id}`,
        type: 'DUPLICATE_MOVEMENT',
        severity: 'critical',
        title: 'Posible movimiento duplicado',
        detail: `${movement.id} coincide con ${duplicate.id}.`,
        movementId: movement.id,
      });
    } else {
      signatures.set(signature, movement);
    }
    if (!movement.referenceType || !movement.referenceId) {
      issues.push({
        id: `reference-${movement.id}`,
        type: 'MISSING_REFERENCE',
        severity: 'warning',
        title: 'Movimiento sin referencia normalizada',
        detail: `${movement.id} no tiene referenceType/referenceId completos.`,
        movementId: movement.id,
      });
    }
    if (!movement.documentId || !movement.reference) {
      issues.push({
        id: `document-${movement.id}`,
        type: 'MISSING_DOCUMENT',
        severity: 'warning',
        title: 'Movimiento sin documento identificable',
        detail: `${movement.id} no tiene documentId o número de referencia.`,
        movementId: movement.id,
      });
    }
    if (reversalCodes.has(code) && (!movement.relatedMovementId || !movementById.has(movement.relatedMovementId))) {
      issues.push({
        id: `reversal-${movement.id}`,
        type: 'INCOMPLETE_REVERSAL',
        severity: 'critical',
        title: 'Reversión incompleta',
        detail: `${movement.id} (${code}) no está vinculada a un movimiento original válido.`,
        movementId: movement.id,
      });
    }
    if (code === 'BANK_TRANSFER' && (!movement.originAccountId || !movement.destinationAccountId)) {
      issues.push({
        id: `transfer-${movement.id}`,
        type: 'INCOMPLETE_TRANSFER',
        severity: 'critical',
        title: 'Transferencia incompleta',
        detail: `${movement.id} no contiene cuenta de origen y destino.`,
        movementId: movement.id,
      });
    }
  });

  const reconstructedBalances = reconstructBalances(input);
  input.accounts.forEach(account => {
    if (!reconstructedBalances.has(account.id)) return;
    const expected = reconstructedBalances.get(account.id) || 0;
    const actual = Number(account.balance) || 0;
    if (Math.abs(expected - actual) > EPSILON) {
      issues.push({
        id: `balance-${account.id}`,
        type: 'BALANCE_MISMATCH',
        severity: 'critical',
        title: 'Diferencia entre ledger y saldo materializado',
        detail: `${account.name}: ledger ${expected} vs materializado ${actual}.`,
        accountId: account.id,
        expected,
        actual,
      });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    reconstructedBalances,
    issues,
    isBalanced: issues.every(issue => issue.type !== 'BALANCE_MISMATCH'),
  };
}
