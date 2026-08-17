import type { FinancialAccount, FinancialMovement } from '@/data/mockData';
import type { Layaway } from '@/domain/models';
import {
  compensatedReversedFinancialMovementIds,
  financialMovementDateKey,
  neutralizedDirectSaleMovementIds,
  participatesInNetFinancialFlow,
  resolveFinancialMovementCode,
} from '@/lib/FinancialLedgerService';

const LAYAWAY_BANK_CODES = new Set([
  'LAYAWAY_PAYMENT',
  'LAYAWAY_COMPLETED',
  'LAYAWAY_REFUND',
]);

export interface LayawayBankFundsByAccount {
  accountId: string;
  accountName: string;
  amount: number;
}

export interface LayawayBankFundsSummary {
  total: number;
  byAccount: LayawayBankFundsByAccount[];
}

export interface BankMovementComposition {
  bankSales: number;
  otherIncome: number;
  transfers: number;
  layawayFunds: number;
  totalMovements: number;
}

const isWithinRange = (value: string, from?: string, to?: string): boolean => {
  const date = String(value || '').slice(0, 10);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const activeBankAccountMap = (accounts: FinancialAccount[]): Map<string, FinancialAccount> =>
  new Map(
    accounts
      .filter(account => account.active && account.kind !== 'cash')
      .map(account => [account.id, account]),
  );

/**
 * Returns the money from bank/wallet layaway payments that is still reserved.
 *
 * The value is reconstructed from active layaways and their persisted payment
 * allocation. It is informational only: it does not create a sale, alter bank
 * balances, or duplicate the Caja Separados ledger position.
 */
export function calculateActiveLayawayBankFunds(
  accounts: FinancialAccount[],
  layaways: Layaway[],
): LayawayBankFundsSummary {
  const bankById = activeBankAccountMap(accounts);
  const totals = new Map<string, number>();

  layaways
    .filter(layaway => !layaway.completed && layaway.invoice.status !== 'cancelled')
    .forEach(layaway => {
      layaway.payments.forEach(payment => {
        if (!payment.accountId || !bankById.has(payment.accountId)) return;
        const amount = Number(payment.amount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        totals.set(payment.accountId, (totals.get(payment.accountId) || 0) + amount);
      });
    });

  const byAccount = Array.from(totals.entries())
    .map(([accountId, amount]) => ({
      accountId,
      accountName: bankById.get(accountId)?.name || accountId,
      amount,
    }))
    .sort((left, right) => right.amount - left.amount || left.accountName.localeCompare(right.accountName));

  return {
    total: byAccount.reduce((sum, item) => sum + item.amount, 0),
    byAccount,
  };
}

/** Returns true when a movement belongs to the layaway advance/release flow. */
export function isLayawayBankFlow(movement: FinancialMovement): boolean {
  return LAYAWAY_BANK_CODES.has(resolveFinancialMovementCode(movement));
}

/**
 * Builds the informational bank composition for the selected period.
 *
 * Layaway funds are the current active reserve attributed to bank payments and
 * therefore remain separate from sales and other real bank income. Completion
 * transfers are intentionally excluded because they only reclassify money that
 * entered previously; they are not a second bank receipt.
 */
export function buildBankMovementComposition(input: {
  accounts: FinancialAccount[];
  movements: FinancialMovement[];
  layaways: Layaway[];
  dateFrom?: string;
  dateTo?: string;
}): BankMovementComposition {
  const bankIds = new Set(activeBankAccountMap(input.accounts).keys());
  const compensatedOriginalIds = compensatedReversedFinancialMovementIds(input.movements);
  const neutralizedSaleIds = neutralizedDirectSaleMovementIds(input.movements);
  let bankSales = 0;
  let otherIncome = 0;
  let transfers = 0;

  input.movements.forEach(movement => {
    if (!isWithinRange(financialMovementDateKey(movement), input.dateFrom, input.dateTo)) return;
    if (!participatesInNetFinancialFlow(movement, compensatedOriginalIds)) return;
    if (neutralizedSaleIds.has(movement.id)) return;

    const code = resolveFinancialMovementCode(movement);
    if (LAYAWAY_BANK_CODES.has(code) || code === 'OPENING_BALANCE' || code === 'REVERSAL') return;

    const originIsBank = Boolean(movement.originAccountId && bankIds.has(movement.originAccountId));
    const destinationIsBank = Boolean(movement.destinationAccountId && bankIds.has(movement.destinationAccountId));
    if (!originIsBank && !destinationIsBank) return;

    const amount = Number(movement.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    if (code === 'BANK_TRANSFER') {
      transfers += amount;
      return;
    }

    if (code === 'SALE_PAYMENT') {
      if (destinationIsBank && !originIsBank) bankSales += amount;
      else if (originIsBank && !destinationIsBank) bankSales -= amount;
      return;
    }

    if (destinationIsBank && !originIsBank) otherIncome += amount;
  });

  const layawayFunds = calculateActiveLayawayBankFunds(input.accounts, input.layaways).total;
  return {
    bankSales,
    otherIncome,
    transfers,
    layawayFunds,
    totalMovements: bankSales + otherIncome + transfers + layawayFunds,
  };
}
