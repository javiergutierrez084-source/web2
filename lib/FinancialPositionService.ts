import type { FinancialAccount, FinancialMovement } from '@/data/mockData';
import { calculateLedgerAccountBalances, getLedgerBalance } from '@/lib/FinancialLedgerService';
import type { Layaway } from '@/domain/models';

export const MAIN_CASH_ACCOUNT_ID = 'account-caja-principal';
export const LAYAWAY_RESERVE_ACCOUNT_ID = 'account-caja-separados';

const EPSILON = 0.01;

export interface FinancialPositionBankAccount {
  id: string;
  name: string;
  kind: FinancialAccount['kind'];
  balance: number;
}

export interface FinancialPosition {
  mainCash: number;
  layawayReserve: number;
  banks: number;
  totalAvailable: number;
  bankAccounts: FinancialPositionBankAccount[];
  legacyReservedByAccount: Record<string, number>;
}

const activeLayaways = (layaways: Layaway[]): Layaway[] =>
  layaways.filter(layaway => !layaway.completed && layaway.invoice.status !== 'cancelled');

/**
 * Detects pending payments created before the dedicated reserve account existed.
 *
 * Older versions credited the selected destination account immediately. New
 * versions credit account-caja-separados. During the transition, the oldest
 * payments without reserve coverage remain conceptually reserved and are
 * subtracted from their destination account when presenting available funds.
 */
export function calculateLegacyLayawayReserveByAccount(
  layaways: Layaway[],
  movements: FinancialMovement[],
  defaultCashAccountId = MAIN_CASH_ACCOUNT_ID,
): Map<string, number> {
  const reserveCoverageByLayaway = new Map<string, number>();
  movements.forEach(movement => {
    if (
      movement.documentType === 'layaway'
      && movement.destinationAccountId === LAYAWAY_RESERVE_ACCOUNT_ID
    ) {
      reserveCoverageByLayaway.set(
        movement.documentId,
        (reserveCoverageByLayaway.get(movement.documentId) || 0) + movement.amount,
      );
    }
  });

  const reservedByAccount = new Map<string, number>();
  activeLayaways(layaways).forEach(layaway => {
    const paidTotal = layaway.payments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
    let legacyAmount = Math.max(0, paidTotal - (reserveCoverageByLayaway.get(layaway.id) || 0));
    if (legacyAmount <= EPSILON) return;

    // Payments are persisted chronologically. Oldest payments are the legacy
    // portion when a layaway spans an application upgrade.
    for (const payment of layaway.payments) {
      if (legacyAmount <= EPSILON) break;
      const amount = Math.min(Math.max(0, payment.amount), legacyAmount);
      const accountId = payment.accountId || defaultCashAccountId;
      reservedByAccount.set(accountId, (reservedByAccount.get(accountId) || 0) + amount);
      legacyAmount -= amount;
    }
  });

  return reservedByAccount;
}

export function buildFinancialPosition(input: {
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  layaways: Layaway[];
}): FinancialPosition {
  const ledgerBalances = calculateLedgerAccountBalances(input.accounts, input.movements);
  const mainCashAccount = input.accounts.find(account => account.id === MAIN_CASH_ACCOUNT_ID)
    ?? input.accounts.find(account => account.active && account.kind === 'cash' && account.id !== LAYAWAY_RESERVE_ACCOUNT_ID);
  const legacyReserved = calculateLegacyLayawayReserveByAccount(
    input.layaways,
    input.movements,
    mainCashAccount?.id || MAIN_CASH_ACCOUNT_ID,
  );
  const adjustedBalance = (account: FinancialAccount): number =>
    Math.max(0, getLedgerBalance(ledgerBalances, account) - (legacyReserved.get(account.id) || 0));

  const reserveAccount = input.accounts.find(account => account.id === LAYAWAY_RESERVE_ACCOUNT_ID);
  const bankAccounts = input.accounts
    .filter(account => account.active && account.id !== LAYAWAY_RESERVE_ACCOUNT_ID && (account.kind === 'bank' || account.kind === 'wallet'))
    .map(account => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: adjustedBalance(account),
    }));

  const mainCash = mainCashAccount ? adjustedBalance(mainCashAccount) : 0;
  const legacyReserveTotal = Array.from(legacyReserved.values()).reduce((sum, amount) => sum + amount, 0);
  const layawayReserve = Math.max(
    0,
    (reserveAccount ? getLedgerBalance(ledgerBalances, reserveAccount) : 0) + legacyReserveTotal,
  );
  const banks = bankAccounts.reduce((sum, account) => sum + account.balance, 0);

  return {
    mainCash,
    layawayReserve,
    banks,
    totalAvailable: mainCash + banks,
    bankAccounts,
    legacyReservedByAccount: Object.fromEntries(legacyReserved),
  };
}
