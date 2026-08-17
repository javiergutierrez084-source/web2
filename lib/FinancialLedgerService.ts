import type {
  FinancialAccount,
  FinancialMovement,
  FinancialMovementCode,
  FinancialMovementStatus,
  FinancialReferenceType,
} from '@/data/mockData';

const ACTIVE_FINANCIAL_STATUSES = new Set<FinancialMovementStatus>(['POSTED', 'COMPLETED']);
const INCOME_MOVEMENT_CODES = new Set<FinancialMovementCode>([
  'SALE_PAYMENT',
  'CASH_IN',
  'BANK_IN',
  'LAYAWAY_COMPLETED',
  'CUSTOMER_CREDIT_USED',
]);
const INCOME_REVERSAL_CODES = new Set<FinancialMovementCode>([
  'SALE_CANCEL',
  'LAYAWAY_REFUND',
  'REVERSAL',
]);
const DIRECT_SALE_REVERSAL_EPSILON = 0.01;

export function isActiveFinancialMovement(
  movement: Pick<FinancialMovement, 'status'>,
): boolean {
  return !movement.status || ACTIVE_FINANCIAL_STATUSES.has(movement.status);
}

export const financialMovementDateKey = (
  movement: Pick<FinancialMovement, 'date'>,
): string => String(movement.date || '').slice(0, 10);

export const isIncomeReversalMovement = (movement: FinancialMovement): boolean => {
  const code = resolveFinancialMovementCode(movement);
  if (INCOME_REVERSAL_CODES.has(code)) return true;
  const documentType = movement.documentType.toLowerCase();
  return documentType.includes('cancel')
    || documentType.includes('refund')
    || documentType.includes('reversal');
};

const movementTimestamp = (movement: FinancialMovement): string =>
  movement.updatedAt || movement.createdAt || `${financialMovementDateKey(movement)}T00:00:00.000Z`;

const movementReferenceIdentity = (movement: FinancialMovement): string =>
  String(movement.referenceId || movement.documentId || '').trim();

const isDirectSaleCancellation = (movement: FinancialMovement): boolean =>
  resolveFinancialMovementCode(movement) === 'SALE_CANCEL'
  && resolveFinancialReferenceType(movement) === 'SALE';

const isDirectSalePayment = (movement: FinancialMovement): boolean =>
  resolveFinancialMovementCode(movement) === 'SALE_PAYMENT'
  && resolveFinancialReferenceType(movement) === 'SALE';

/**
 * Identifies the immutable SALE_PAYMENT + SALE_CANCEL pair as one neutral
 * commercial event. Both rows remain in the raw Ledger for audit, but neither
 * may be counted as a new daily income or a commercial expense.
 *
 * The direct relatedMovementId link is authoritative. A conservative fallback
 * by invoice/account/amount keeps legacy rows readable when that link is absent.
 * An unpaired SALE_CANCEL is still reporting-neutral so it can never create a
 * negative Banco Hoy, Caja Hoy or an artificial commercial expense.
 */
export function neutralizedDirectSaleMovementIds(
  movements: FinancialMovement[],
): Set<string> {
  const movementById = new Map(movements.map(movement => [movement.id, movement]));
  const originals = movements.filter(isDirectSalePayment);
  const claimedOriginalIds = new Set<string>();
  const neutralizedIds = new Set<string>();
  const reversals = movements
    .filter(movement => isActiveFinancialMovement(movement) && isDirectSaleCancellation(movement))
    .sort((left, right) => (
      movementTimestamp(left).localeCompare(movementTimestamp(right))
      || left.id.localeCompare(right.id)
    ));

  reversals.forEach(reversal => {
    const linkedOriginal = reversal.relatedMovementId
      ? movementById.get(reversal.relatedMovementId)
      : undefined;

    // A SALE_CANCEL linked to LAYAWAY_COMPLETED belongs to the separated flow,
    // whose existing debit/credit semantics must remain untouched.
    if (linkedOriginal && !isDirectSalePayment(linkedOriginal)) return;

    let original = linkedOriginal;
    if (!original) {
      const referenceIdentity = movementReferenceIdentity(reversal);
      original = originals
        .filter(candidate => {
          if (claimedOriginalIds.has(candidate.id)) return false;
          if (candidate.destinationAccountId !== reversal.originAccountId) return false;
          if (Math.abs((Number(candidate.amount) || 0) - (Number(reversal.amount) || 0)) > DIRECT_SALE_REVERSAL_EPSILON) return false;
          if (referenceIdentity && movementReferenceIdentity(candidate) !== referenceIdentity) return false;
          return movementTimestamp(candidate) <= movementTimestamp(reversal);
        })
        .sort((left, right) => (
          movementTimestamp(right).localeCompare(movementTimestamp(left))
          || right.id.localeCompare(left.id)
        ))[0];
    }

    neutralizedIds.add(reversal.id);
    if (original) {
      claimedOriginalIds.add(original.id);
      neutralizedIds.add(original.id);
    }
  });

  return neutralizedIds;
}

/**
 * Returns inactive originals that must still participate in net calculations
 * because an active linked reversal exists. This preserves immutable
 * original+reversal arithmetic for flows such as customer-credit cancellation,
 * where the source usage is marked REVERSED to restore credit availability.
 */
export function compensatedReversedFinancialMovementIds(
  movements: FinancialMovement[],
): Set<string> {
  const movementById = new Map(movements.map(movement => [movement.id, movement]));
  return new Set(
    movements
      .filter(movement => {
        if (!isActiveFinancialMovement(movement) || !movement.relatedMovementId) return false;
        if (!INCOME_REVERSAL_CODES.has(resolveFinancialMovementCode(movement))) return false;
        const original = movementById.get(movement.relatedMovementId);
        return Boolean(original && !isActiveFinancialMovement(original));
      })
      .map(movement => movement.relatedMovementId!),
  );
}

export function participatesInNetFinancialFlow(
  movement: FinancialMovement,
  compensatedOriginalIds: Set<string>,
): boolean {
  return isActiveFinancialMovement(movement) || compensatedOriginalIds.has(movement.id);
}

/**
 * Calculates reportable income affecting one financial account on a date.
 * Direct sale cancellations are neutralized with their original payment; they
 * are never represented as a negative income or a new expense.
 */
export function calculateAccountIncomeForDate(
  movements: FinancialMovement[],
  accountId: string,
  date: string,
): number {
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(movements);
  const neutralizedSaleIds = neutralizedDirectSaleMovementIds(movements);
  return movements.reduce((total, movement) => {
    if (financialMovementDateKey(movement) !== date) return total;
    if (!participatesInNetFinancialFlow(movement, compensatedOriginalIds)) return total;
    if (neutralizedSaleIds.has(movement.id)) return total;
    const code = resolveFinancialMovementCode(movement);
    if (
      movement.destinationAccountId === accountId
      && INCOME_MOVEMENT_CODES.has(code)
    ) {
      return total + movement.amount;
    }
    if (
      movement.originAccountId === accountId
      && isIncomeReversalMovement(movement)
    ) {
      return total - movement.amount;
    }
    return total;
  }, 0);
}

export interface FinancialSaleAccountFlow {
  movement: FinancialMovement;
  code: FinancialMovementCode;
  signedAmount: number;
}

const SALE_ACCOUNT_INCOME_CODES = new Set<FinancialMovementCode>([
  'SALE_PAYMENT',
  'LAYAWAY_COMPLETED',
  'CUSTOMER_CREDIT_USED',
]);

/**
 * Returns the commercial-sale ledger rows affecting one account on one date.
 * A direct SALE_PAYMENT cancelled by SALE_CANCEL is omitted as one neutral
 * event. Layaway and customer-credit flows retain their existing semantics.
 */
export function getSaleAccountFlowsForDate(
  movements: FinancialMovement[],
  accountId: string,
  date: string,
): FinancialSaleAccountFlow[] {
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(movements);
  const neutralizedSaleIds = neutralizedDirectSaleMovementIds(movements);
  return movements.flatMap<FinancialSaleAccountFlow>(movement => {
    if (financialMovementDateKey(movement) !== date) return [];
    if (!participatesInNetFinancialFlow(movement, compensatedOriginalIds)) return [];
    if (neutralizedSaleIds.has(movement.id)) return [];
    const code = resolveFinancialMovementCode(movement);
    if (movement.destinationAccountId === accountId && SALE_ACCOUNT_INCOME_CODES.has(code)) {
      return [{ movement, code, signedAmount: Number(movement.amount) || 0 }];
    }
    const saleReversal = code === 'SALE_CANCEL'
      || (code === 'REVERSAL' && resolveFinancialReferenceType(movement) === 'SALE');
    if (movement.originAccountId === accountId && saleReversal) {
      return [{ movement, code, signedAmount: -(Number(movement.amount) || 0) }];
    }
    return [];
  });
}

/**
 * Returns only commercial-sale cash flow for one account and date.
 * Manual cash-ins, layaway reserve movements and other income sources are
 * intentionally excluded so Caja Hoy cannot treat a bank or mixed payment as
 * cash revenue.
 */
export function calculateSaleAccountIncomeForDate(
  movements: FinancialMovement[],
  accountId: string,
  date: string,
): number {
  return getSaleAccountFlowsForDate(movements, accountId, date)
    .reduce((total, flow) => total + flow.signedAmount, 0);
}

export interface FinancialLedgerAccountBalance {
  accountId: string;
  balance: number;
  source: 'ledger' | 'materialized-fallback';
  lastMovementId?: string;
  updatedAt?: string;
}

const timestamp = (movement: FinancialMovement): string =>
  movement.updatedAt || movement.createdAt || `${movement.date}T00:00:00.000Z`;

/**
 * Resolves the semantic business event represented by a legacy movement.
 * New movements persist movementCode explicitly; old records remain readable.
 */
export function resolveFinancialMovementCode(
  movement: Pick<
    FinancialMovement,
    'movementCode' | 'type' | 'documentType' | 'originAccountId' | 'destinationAccountId'
  >,
): FinancialMovementCode {
  if (movement.movementCode) return movement.movementCode;
  if (movement.documentType === 'invoice_cancellation') return 'SALE_CANCEL';
  if (movement.documentType === 'layaway_completion') return 'LAYAWAY_COMPLETED';
  if (movement.documentType === 'layaway_refund') return 'LAYAWAY_REFUND';
  if (movement.documentType === 'layaway_credit') return 'CUSTOMER_CREDIT';
  if (movement.documentType === 'customer_credit_used') return 'CUSTOMER_CREDIT_USED';
  if (movement.documentType === 'layaway') return 'LAYAWAY_PAYMENT';
  if (movement.documentType === 'invoice' && movement.type === 'sale_income') return 'SALE_PAYMENT';
  if (movement.type === 'opening_balance') return 'OPENING_BALANCE';
  if (movement.type === 'expense') return 'EXPENSE';
  if (movement.type === 'inventory_purchase') return 'PURCHASE_PAYMENT';
  if (movement.type === 'supplier_payment') return 'SUPPLIER_PAYMENT';
  if (movement.type === 'transfer' || movement.type === 'transfer_in' || movement.type === 'transfer_out') {
    return 'BANK_TRANSFER';
  }
  if (movement.type === 'adjustment') {
    if (movement.originAccountId && !movement.destinationAccountId) return 'CASH_OUT';
    if (!movement.originAccountId && movement.destinationAccountId) return 'CASH_IN';
    return 'ADJUSTMENT';
  }
  return 'ADJUSTMENT';
}

export function resolveFinancialReferenceType(
  movement: Pick<FinancialMovement, 'referenceType' | 'documentType'>,
): FinancialReferenceType {
  if (movement.referenceType) return movement.referenceType;
  switch (movement.documentType) {
    case 'invoice':
    case 'invoice_cancellation':
      return 'SALE';
    case 'layaway':
    case 'layaway_completion':
    case 'layaway_refund':
      return 'LAYAWAY';
    case 'layaway_credit':
      return 'CUSTOMER';
    case 'customer_credit_used':
      return 'SALE';
    case 'quotation':
      return 'QUOTATION';
    case 'expense':
      return 'EXPENSE';
    case 'purchase_invoice':
      return 'PURCHASE';
    case 'supplier_invoice':
      return 'SUPPLIER_INVOICE';
    case 'financial_account':
      return 'FINANCIAL_ACCOUNT';
    case 'transfer':
      return 'TRANSFER';
    default:
      return 'MANUAL';
  }
}

/**
 * Reconstructs the latest account position from the immutable movement ledger.
 * financial_accounts.balance is retained only as a materialized aggregate and
 * legacy fallback for accounts that still have no movement history.
 */
export function calculateLedgerAccountBalances(
  accounts: FinancialAccount[],
  movements: FinancialMovement[],
): Map<string, FinancialLedgerAccountBalance> {
  const result = new Map<string, FinancialLedgerAccountBalance>();
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(movements);

  accounts.forEach(account => {
    const materializedBalance = Number(account.balance) || 0;
    const related = movements.filter(movement => (
      participatesInNetFinancialFlow(movement, compensatedOriginalIds)
      && (movement.originAccountId === account.id || movement.destinationAccountId === account.id)
    ));
    const opening = related
      .filter(movement => resolveFinancialMovementCode(movement) === 'OPENING_BALANCE')
      .sort((left, right) => {
        const timeCompare = timestamp(left).localeCompare(timestamp(right));
        return timeCompare !== 0 ? timeCompare : left.id.localeCompare(right.id);
      })[0];

    // Legacy and system-created zero-balance accounts may not have an opening
    // ledger row. Their materialized balance remains the explicit fallback.
    if (!opening) {
      result.set(account.id, {
        accountId: account.id,
        balance: materializedBalance,
        source: 'materialized-fallback',
        updatedAt: account.updatedAt,
      });
      return;
    }

    const openingBefore = opening.destinationAccountId === account.id
      ? Number(opening.destinationBalanceBefore) || 0
      : Number(opening.originBalanceBefore) || 0;
    const balance = related.reduce((current, movement) => {
      const inflow = movement.destinationAccountId === account.id ? Number(movement.amount) || 0 : 0;
      const outflow = movement.originAccountId === account.id ? Number(movement.amount) || 0 : 0;
      return current + inflow - outflow;
    }, openingBefore);
    const latest = [...related].sort((left, right) => {
      const timeCompare = timestamp(right).localeCompare(timestamp(left));
      return timeCompare !== 0 ? timeCompare : right.id.localeCompare(left.id);
    })[0];

    result.set(account.id, {
      accountId: account.id,
      balance,
      source: 'ledger',
      lastMovementId: latest?.id,
      updatedAt: latest ? timestamp(latest) : account.updatedAt,
    });
  });

  return result;
}

export function getLedgerBalance(
  balances: Map<string, FinancialLedgerAccountBalance>,
  account: FinancialAccount,
): number {
  return balances.get(account.id)?.balance ?? (Number(account.balance) || 0);
}

/**
 * Returns the current balance exposed by financial screens for one account.
 *
 * Every consumer (Dashboard, Reports and Exceptional Cash Maintenance) must
 * resolve balances through this function so they share the exact same ledger
 * semantics: only POSTED/COMPLETED movements participate and the latest active
 * balance snapshot wins, with the materialized account balance used solely as
 * the legacy fallback when the account has no movement history.
 */
export function resolveFinancialAccountBalance(
  accounts: FinancialAccount[],
  movements: FinancialMovement[],
  accountId: string,
): number {
  const account = accounts.find(item => item.id === accountId);
  if (!account) return 0;
  return getLedgerBalance(calculateLedgerAccountBalances(accounts, movements), account);
}
