import { localDb, type DbFinancialMovement } from '@/lib/localDb';
import { requirePermission, verifyPassword, type SessionUser } from '@/lib/authCore';

export type ExceptionalCashDirection = 'positive' | 'negative';

export interface ExceptionalCashAdjustmentInput {
  accountId: string;
  direction: ExceptionalCashDirection;
  amount: number;
  reason: string;
  observation: string;
  password: string;
  confirmed: boolean;
  date?: string;
}

export interface ExceptionalCashHistoryEntry {
  id: string;
  date: string;
  createdAt: string;
  userId: string;
  userName: string;
  accountId: string;
  direction: ExceptionalCashDirection;
  amount: number;
  reason: string;
  observation: string;
  balanceBefore: number;
  balanceAfter: number;
}

export interface ExceptionalCashHistoryFilter {
  from?: string;
  to?: string;
  userId?: string;
  reason?: string;
}

export interface InventoryFinancialRepairItem {
  movementId: string;
  adjustmentId: string;
  amount: number;
  status: 'corrected' | 'ignored' | 'inconsistent';
  message: string;
}

export interface InventoryFinancialRepairReport {
  generatedAt: string;
  corrected: number;
  ignored: number;
  inconsistencies: number;
  items: InventoryFinancialRepairItem[];
}

const DOCUMENT_TYPE = 'exceptional_cash_adjustment';

function normalizeText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

async function reauthenticate(password: string): Promise<SessionUser> {
  const session = await requirePermission('system_maintenance');
  const row = await localDb.users.get(session.id);
  if (!row || !row.active || !(await verifyPassword(password, row.password_hash))) {
    throw new Error('INVALID_REAUTHENTICATION');
  }
  return session;
}

export async function createExceptionalCashAdjustment(input: ExceptionalCashAdjustmentInput): Promise<ExceptionalCashHistoryEntry> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_EXCEPTIONAL_CASH_AMOUNT');
  if (!input.confirmed) throw new Error('EXCEPTIONAL_CASH_CONFIRMATION_REQUIRED');
  const reason = normalizeText(input.reason, 'EXCEPTIONAL_CASH_REASON_REQUIRED');
  const observation = normalizeText(input.observation, 'EXCEPTIONAL_CASH_OBSERVATION_REQUIRED');
  const user = await reauthenticate(input.password);

  return localDb.transaction('rw', localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    const account = await localDb.financial_accounts.get(input.accountId);
    if (!account || account.kind !== 'cash' || !account.active) throw new Error('ACTIVE_CASH_ACCOUNT_REQUIRED');

    const before = account.balance;
    const after = input.direction === 'positive' ? before + amount : before - amount;
    if (!Number.isFinite(after)) throw new Error('INVALID_EXCEPTIONAL_CASH_BALANCE');

    const now = new Date().toISOString();
    const date = input.date || now.slice(0, 10);
    const id = crypto.randomUUID();
    const detail = {
      direction: input.direction,
      reason,
      observation,
      balanceBefore: before,
      balanceAfter: after,
    };
    const movement: DbFinancialMovement = {
      id,
      type: 'adjustment',
      amount,
      origin_account_id: input.direction === 'negative' ? account.id : '',
      destination_account_id: input.direction === 'positive' ? account.id : '',
      origin_balance_before: input.direction === 'negative' ? before : 0,
      origin_balance_after: input.direction === 'negative' ? after : 0,
      destination_balance_before: input.direction === 'positive' ? before : 0,
      destination_balance_after: input.direction === 'positive' ? after : 0,
      reference: reason,
      document_type: DOCUMENT_TYPE,
      document_id: id,
      observation: JSON.stringify(detail),
      user_id: user.id,
      user_name: user.displayName,
      movement_date: date,
      created_at: now,
    };

    await localDb.financial_accounts.update(account.id, { balance: after, updated_at: now });
    await localDb.financial_movements.add(movement);
    await localDb.activity_log.add({
      user_id: user.id,
      user_name: user.displayName,
      action: 'EXCEPTIONAL_CASH_ADJUSTMENT',
      entity: DOCUMENT_TYPE,
      entity_id: id,
      detail: JSON.stringify({
        value: amount,
        type: input.direction,
        reason,
        observation,
        balanceBefore: before,
        balanceAfter: after,
        date,
        time: now,
      }),
      created_at: now,
    });

    return {
      id,
      date,
      createdAt: now,
      userId: user.id,
      userName: user.displayName,
      accountId: account.id,
      direction: input.direction,
      amount,
      reason,
      observation,
      balanceBefore: before,
      balanceAfter: after,
    };
  });
}

function parseHistory(row: DbFinancialMovement): ExceptionalCashHistoryEntry {
  let detail: Partial<{ direction: ExceptionalCashDirection; reason: string; observation: string }> = {};
  try { detail = JSON.parse(row.observation) as typeof detail; } catch { /* legacy-safe */ }
  const direction: ExceptionalCashDirection = row.destination_account_id ? 'positive' : 'negative';
  return {
    id: row.id,
    date: row.movement_date,
    createdAt: row.created_at,
    userId: row.user_id,
    userName: row.user_name,
    accountId: row.destination_account_id || row.origin_account_id,
    direction: detail.direction || direction,
    amount: row.amount,
    reason: detail.reason || row.reference,
    observation: detail.observation || row.observation,
    balanceBefore: direction === 'positive' ? row.destination_balance_before : row.origin_balance_before,
    balanceAfter: direction === 'positive' ? row.destination_balance_after : row.origin_balance_after,
  };
}

export async function fetchExceptionalCashHistory(filter: ExceptionalCashHistoryFilter = {}): Promise<ExceptionalCashHistoryEntry[]> {
  await requirePermission('system_maintenance');
  const rows = await localDb.financial_movements
    .filter(row => row.document_type === DOCUMENT_TYPE)
    .toArray();
  const reason = filter.reason?.trim().toLocaleLowerCase('es-CO');
  return rows.map(parseHistory).filter(row =>
    (!filter.from || row.date >= filter.from) &&
    (!filter.to || row.date <= filter.to) &&
    (!filter.userId || row.userId === filter.userId) &&
    (!reason || row.reason.toLocaleLowerCase('es-CO').includes(reason))
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function repairHistoricalInventoryFinancialMovements(password: string, confirmed: boolean): Promise<InventoryFinancialRepairReport> {
  if (!confirmed) throw new Error('INVENTORY_FINANCIAL_REPAIR_CONFIRMATION_REQUIRED');
  const user = await reauthenticate(password);
  const report: InventoryFinancialRepairReport = {
    generatedAt: new Date().toISOString(), corrected: 0, ignored: 0, inconsistencies: 0, items: [],
  };

  await localDb.transaction('rw', localDb.inventory_adjustments, localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    const rows = await localDb.financial_movements.filter(row => row.document_type === 'inventory_adjustment').toArray();
    for (const movement of rows) {
      if (!movement.document_id) {
        report.ignored += 1;
        report.items.push({ movementId: movement.id, adjustmentId: '', amount: movement.amount, status: 'ignored', message: 'Movimiento sin document_id.' });
        continue;
      }
      const adjustment = await localDb.inventory_adjustments.get(movement.document_id);
      if (!adjustment) {
        report.inconsistencies += 1;
        report.items.push({ movementId: movement.id, adjustmentId: movement.document_id, amount: movement.amount, status: 'inconsistent', message: 'No existe el ajuste referenciado; no se modificó.' });
        continue;
      }
      if (!Number.isFinite(movement.amount) || movement.amount <= 0 || (!movement.origin_account_id && !movement.destination_account_id)) {
        report.inconsistencies += 1;
        report.items.push({ movementId: movement.id, adjustmentId: movement.document_id, amount: movement.amount, status: 'inconsistent', message: 'Movimiento inválido o sin cuenta relacionada.' });
        continue;
      }

      const origin = movement.origin_account_id ? await localDb.financial_accounts.get(movement.origin_account_id) : undefined;
      const destination = movement.destination_account_id ? await localDb.financial_accounts.get(movement.destination_account_id) : undefined;
      if (movement.origin_account_id && !origin) {
        report.inconsistencies += 1;
        report.items.push({ movementId: movement.id, adjustmentId: movement.document_id, amount: movement.amount, status: 'inconsistent', message: 'Cuenta de origen inexistente.' });
        continue;
      }
      if (movement.destination_account_id && !destination) {
        report.inconsistencies += 1;
        report.items.push({ movementId: movement.id, adjustmentId: movement.document_id, amount: movement.amount, status: 'inconsistent', message: 'Cuenta de destino inexistente.' });
        continue;
      }
      const now = new Date().toISOString();
      if (origin) await localDb.financial_accounts.update(origin.id, { balance: origin.balance + movement.amount, updated_at: now });
      if (destination) await localDb.financial_accounts.update(destination.id, { balance: destination.balance - movement.amount, updated_at: now });
      await localDb.financial_movements.delete(movement.id);
      report.corrected += 1;
      report.items.push({ movementId: movement.id, adjustmentId: movement.document_id, amount: movement.amount, status: 'corrected', message: 'Movimiento revertido y eliminado por relación exacta.' });
    }

    await localDb.activity_log.add({
      user_id: user.id,
      user_name: user.displayName,
      action: 'INVENTORY_ADJUSTMENT_FINANCIAL_REPAIR',
      entity: 'system_maintenance',
      entity_id: crypto.randomUUID(),
      detail: JSON.stringify(report),
      created_at: new Date().toISOString(),
    });
  });
  return report;
}
