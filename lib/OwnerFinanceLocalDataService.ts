import {
  localDb,
  type DbFinancialMovement,
  type DbOwnerWithdrawalConcept,
  type DbSystemSettings,
} from '@/lib/localDb';
import { requirePermission, type SessionUser } from '@/lib/authCore';
import { getAuthorizedLanRepositorySession } from '@/lib/LanRepositoryExecutionContext';
import {
  DEFAULT_OWNER_FINANCE_PERIOD,
  DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
  DEFAULT_OWNER_MONTHLY_PROFIT_GOAL,
  DEFAULT_OWNER_WITHDRAWAL_PERCENTAGE,
  calculateOwnerFinanceDashboard,
  createDefaultOwnerWithdrawalConcepts,
  currentOwnerFinancePeriodKey,
  filterOwnerWithdrawals,
  formatOwnerFinancePeriodLabel,
  normalizeMonthlyProfitGoal,
  normalizeOwnerConceptName,
  normalizeOwnerFinancePeriod,
  normalizeOwnerFinancePeriodKey,
  normalizeOwnerFinancePeriodStatus,
  normalizeProjectedWithdrawalPercentage,
  isFutureOwnerFinancePeriod,
  ownerFinanceMonthKey,
  validateOwnerWithdrawalAmount,
  type OwnerFinanceFilters,
  type OwnerFinancePeriodConfiguration,
  type OwnerFinancePeriodOption,
  type OwnerFinanceSettings,
  type OwnerFinanceWorkspace,
  type OwnerWithdrawal,
  type OwnerWithdrawalConcept,
} from '@/lib/OwnerFinanceService';
import type { CreateOwnerWithdrawalInput } from '@/services/OwnerFinanceRepositoryService';


interface DbOwnerFinancePeriodConfiguration {
  period_key?: string;
  projected_withdrawal_percentage?: number;
  monthly_profit_goal?: number;
  financial_period?: 'MONTHLY' | 'FORTNIGHTLY';
  status?: 'OPEN' | 'CLOSED';
  updated_at?: string;
  closed_at?: string | null;
  closed_by?: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
}

type OwnerFinanceSystemSettingsRow = DbSystemSettings & {
  owner_finance_periods?: DbOwnerFinancePeriodConfiguration[];
};

const OWNER_FINANCE_SETTINGS_ID = 'owner-finance';
const OWNER_WITHDRAWAL_DOCUMENT_TYPE = 'owner_withdrawal';
const OWNER_WITHDRAWAL_CANCELLATION_DOCUMENT_TYPE = 'owner_withdrawal_cancellation';

const requireOwnerFinancePermission = async (): Promise<SessionUser> => {
  const authorizedLanSession = getAuthorizedLanRepositorySession();
  if (authorizedLanSession) {
    // The Principal Server already validated manage_finances before entering
    // this Repository execution context. Do not consult its local UI session.
    return {
      id: authorizedLanSession.id,
      username: authorizedLanSession.username,
      displayName: authorizedLanSession.displayName,
      role: authorizedLanSession.role,
      permissions: [...authorizedLanSession.permissions],
    };
  }

  return requirePermission('manage_finances');
};

interface OwnerWithdrawalMovementMetadata {
  kind: 'owner_withdrawal';
  withdrawalId: string;
  withdrawalDate: string;
  periodKey?: string;
  conceptId: string;
  conceptName: string;
  paymentMethod: string;
  observations: string;
}

interface OwnerWithdrawalCancellationMetadata {
  kind: 'owner_withdrawal_cancellation';
  withdrawalId: string;
  reason: string;
  cancelledAt: string;
  cancelledBy: string;
}

function baseSettingsRow(): OwnerFinanceSystemSettingsRow {
  return {
    id: OWNER_FINANCE_SETTINGS_ID,
    backup_enabled: false,
    backup_interval: 'daily',
    backup_hour: 0,
    backup_folder: '',
    max_backups: 0,
    delete_old_backups: false,
    verify_checksum: false,
    backup_before_restore: false,
    backup_on_startup: false,
    backup_on_exit: false,
    backup_on_import: false,
    compression_enabled: false,
    default_destination: 'local',
  };
}

function mapConcept(row: DbOwnerWithdrawalConcept): OwnerWithdrawalConcept {
  const id = String(row?.id || '').trim();
  const normalized = normalizeOwnerConceptName(String(row?.name || ''));
  if (!id) throw new Error('OWNER_CONCEPT_NOT_FOUND');
  const now = new Date().toISOString();
  return {
    id,
    name: normalized.name,
    nameKey: String(row?.name_key || normalized.nameKey).trim() || normalized.nameKey,
    active: row?.active !== false,
    isDefault: row?.is_default === true,
    createdAt: String(row?.created_at || now),
    updatedAt: String(row?.updated_at || row?.created_at || now),
  };
}

function mapConceptToDb(concept: OwnerWithdrawalConcept): DbOwnerWithdrawalConcept {
  return {
    id: concept.id,
    name: concept.name,
    name_key: concept.nameKey,
    active: concept.active,
    is_default: concept.isDefault,
    created_at: concept.createdAt,
    updated_at: concept.updatedAt,
  };
}

function mapPeriodConfiguration(
  row: DbOwnerFinancePeriodConfiguration,
  defaults: ReturnType<typeof normalizeLegacySettings>,
  now: string,
): OwnerFinancePeriodConfiguration {
  const safePercentage = (() => {
    try {
      return normalizeProjectedWithdrawalPercentage(
        row.projected_withdrawal_percentage ?? defaults.percentage,
      );
    } catch {
      return defaults.percentage;
    }
  })();
  const safeGoal = (() => {
    try {
      return normalizeMonthlyProfitGoal(row.monthly_profit_goal ?? defaults.monthlyProfitGoal);
    } catch {
      return defaults.monthlyProfitGoal;
    }
  })();
  const safeFinancialPeriod = (() => {
    try {
      return normalizeOwnerFinancePeriod(row.financial_period ?? defaults.financialPeriod);
    } catch {
      return defaults.financialPeriod;
    }
  })();
  const safeStatus = (() => {
    try {
      return normalizeOwnerFinancePeriodStatus(row.status ?? DEFAULT_OWNER_FINANCE_PERIOD_STATUS);
    } catch {
      return DEFAULT_OWNER_FINANCE_PERIOD_STATUS;
    }
  })();
  const auditValue = (value: unknown): string | null => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
  };

  return {
    periodKey: normalizeOwnerFinancePeriodKey(String(row.period_key || '')),
    projectedWithdrawalPercentage: safePercentage,
    monthlyProfitGoal: safeGoal,
    financialPeriod: safeFinancialPeriod,
    status: safeStatus,
    updatedAt: auditValue(row.updated_at) || now,
    closedAt: auditValue(row.closed_at),
    closedBy: auditValue(row.closed_by),
    reopenedAt: auditValue(row.reopened_at),
    reopenedBy: auditValue(row.reopened_by),
  };
}

function mapPeriodConfigurationToDb(
  configuration: OwnerFinancePeriodConfiguration,
): DbOwnerFinancePeriodConfiguration {
  return {
    period_key: configuration.periodKey,
    projected_withdrawal_percentage: configuration.projectedWithdrawalPercentage,
    monthly_profit_goal: configuration.monthlyProfitGoal,
    financial_period: configuration.financialPeriod,
    status: configuration.status,
    updated_at: configuration.updatedAt,
    closed_at: configuration.closedAt ?? null,
    closed_by: configuration.closedBy ?? null,
    reopened_at: configuration.reopenedAt ?? null,
    reopened_by: configuration.reopenedBy ?? null,
  };
}

async function logOwnerFinanceActivity(
  session: SessionUser,
  action: string,
  entity: string,
  entityId: string,
  detail: string,
): Promise<void> {
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

function normalizeLegacySettings(current?: DbSystemSettings | null) {
  const percentage = (() => {
    try {
      return normalizeProjectedWithdrawalPercentage(
        current?.owner_projected_withdrawal_percentage ?? DEFAULT_OWNER_WITHDRAWAL_PERCENTAGE,
      );
    } catch {
      return DEFAULT_OWNER_WITHDRAWAL_PERCENTAGE;
    }
  })();
  const monthlyProfitGoal = (() => {
    try {
      return normalizeMonthlyProfitGoal(
        current?.owner_monthly_profit_goal ?? DEFAULT_OWNER_MONTHLY_PROFIT_GOAL,
      );
    } catch {
      return DEFAULT_OWNER_MONTHLY_PROFIT_GOAL;
    }
  })();
  const financialPeriod = (() => {
    try {
      return normalizeOwnerFinancePeriod(
        current?.owner_financial_period ?? DEFAULT_OWNER_FINANCE_PERIOD,
      );
    } catch {
      return DEFAULT_OWNER_FINANCE_PERIOD;
    }
  })();
  return { percentage, monthlyProfitGoal, financialPeriod };
}

function defaultPeriodConfiguration(
  periodKey: string,
  now: string,
  values?: {
    projectedWithdrawalPercentage?: number;
    monthlyProfitGoal?: number;
    financialPeriod?: string;
  },
): OwnerFinancePeriodConfiguration {
  return {
    periodKey: normalizeOwnerFinancePeriodKey(periodKey),
    projectedWithdrawalPercentage: normalizeProjectedWithdrawalPercentage(
      values?.projectedWithdrawalPercentage ?? DEFAULT_OWNER_WITHDRAWAL_PERCENTAGE,
    ),
    monthlyProfitGoal: normalizeMonthlyProfitGoal(
      values?.monthlyProfitGoal ?? DEFAULT_OWNER_MONTHLY_PROFIT_GOAL,
    ),
    financialPeriod: normalizeOwnerFinancePeriod(
      values?.financialPeriod ?? DEFAULT_OWNER_FINANCE_PERIOD,
    ),
    status: DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
    updatedAt: now,
    closedAt: null,
    closedBy: null,
    reopenedAt: null,
    reopenedBy: null,
  };
}

function normalizeStoredPeriodConfigurations(
  current: OwnerFinanceSystemSettingsRow | null | undefined,
): OwnerFinancePeriodConfiguration[] {
  const configurations: OwnerFinancePeriodConfiguration[] = [];
  const seen = new Set<string>();
  const rows = Array.isArray(current?.owner_finance_periods)
    ? current.owner_finance_periods
    : [];
  const defaults = normalizeLegacySettings(current);
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    try {
      const mapped = mapPeriodConfiguration(row, defaults, now);
      if (seen.has(mapped.periodKey)) continue;
      seen.add(mapped.periodKey);
      configurations.push(mapped);
    } catch {
      // Rows without a valid YYYY-MM key cannot be recovered safely.
    }
  }
  return configurations;
}

async function ensureOwnerFinanceSettingsRow(): Promise<OwnerFinanceSystemSettingsRow> {
  const current = await localDb.system_settings.get(OWNER_FINANCE_SETTINGS_ID) as OwnerFinanceSystemSettingsRow | undefined;
  const now = new Date().toISOString();
  const defaults = createDefaultOwnerWithdrawalConcepts(now);
  const rawConcepts = Array.isArray(current?.owner_withdrawal_concepts)
    ? current.owner_withdrawal_concepts
    : [];
  const existingConcepts = rawConcepts.flatMap((concept) => {
    try {
      return [mapConcept(concept)];
    } catch {
      return [];
    }
  });
  const byId = new Map(existingConcepts.map(concept => [concept.id, concept]));
  const usedNameKeys = new Set(existingConcepts.map(concept => concept.nameKey));
  defaults.forEach(concept => {
    // Default concept IDs are stable. Keeping an existing ID allows the owner
    // to rename or deactivate an initial concept without it being recreated.
    if (byId.has(concept.id)) return;
    if (usedNameKeys.has(concept.nameKey)) return;
    byId.set(concept.id, concept);
    usedNameKeys.add(concept.nameKey);
  });
  const concepts = [...byId.values()].map(mapConceptToDb);
  const legacy = normalizeLegacySettings(current);
  const periodConfigurations = normalizeStoredPeriodConfigurations(current);
  const currentPeriodKey = currentOwnerFinancePeriodKey();
  if (!periodConfigurations.some(item => item.periodKey === currentPeriodKey)) {
    periodConfigurations.push(defaultPeriodConfiguration(currentPeriodKey, now, {
      projectedWithdrawalPercentage: legacy.percentage,
      monthlyProfitGoal: legacy.monthlyProfitGoal,
      financialPeriod: legacy.financialPeriod,
    }));
  }
  periodConfigurations.sort((left, right) => right.periodKey.localeCompare(left.periodKey));

  const next: OwnerFinanceSystemSettingsRow = {
    ...(current || baseSettingsRow()),
    id: OWNER_FINANCE_SETTINGS_ID,
    owner_projected_withdrawal_percentage: legacy.percentage,
    owner_monthly_profit_goal: legacy.monthlyProfitGoal,
    owner_financial_period: legacy.financialPeriod,
    owner_withdrawal_concepts: concepts,
    owner_finance_periods: periodConfigurations.map(mapPeriodConfigurationToDb),
  };

  const requiresWrite = !current
    || current.owner_projected_withdrawal_percentage !== legacy.percentage
    || current.owner_monthly_profit_goal !== legacy.monthlyProfitGoal
    || current.owner_financial_period !== legacy.financialPeriod
    || JSON.stringify(current.owner_withdrawal_concepts || []) !== JSON.stringify(concepts)
    || JSON.stringify(current.owner_finance_periods || []) !== JSON.stringify(next.owner_finance_periods || []);
  if (requiresWrite) await localDb.system_settings.put(next);
  return next;
}

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function withdrawalMetadata(movement: DbFinancialMovement): OwnerWithdrawalMovementMetadata {
  const parsed = parseJson<OwnerWithdrawalMovementMetadata>(movement.notes);
  if (parsed?.kind === 'owner_withdrawal') {
    return {
      ...parsed,
      periodKey: parsed.periodKey || ownerFinanceMonthKey(parsed.withdrawalDate),
    };
  }
  const withdrawalDate = movement.movement_date || movement.created_at;
  return {
    kind: 'owner_withdrawal',
    withdrawalId: movement.document_id,
    withdrawalDate,
    periodKey: ownerFinanceMonthKey(withdrawalDate),
    conceptId: movement.reference_id || '',
    conceptName: movement.reference || 'Retiro del propietario',
    paymentMethod: '',
    observations: movement.observation || '',
  };
}

function cancellationMetadata(movement?: DbFinancialMovement): OwnerWithdrawalCancellationMetadata | null {
  if (!movement) return null;
  const parsed = parseJson<OwnerWithdrawalCancellationMetadata>(movement.notes);
  if (parsed?.kind === 'owner_withdrawal_cancellation') return parsed;
  return {
    kind: 'owner_withdrawal_cancellation',
    withdrawalId: movement.document_id,
    reason: movement.observation || '',
    cancelledAt: movement.created_at,
    cancelledBy: movement.user_name,
  };
}

function mapWithdrawals(
  movements: DbFinancialMovement[],
  accountNames: Map<string, string>,
): OwnerWithdrawal[] {
  const reversals = new Map<string, DbFinancialMovement>();
  movements
    .filter(movement => movement.related_movement_id && movement.movement_code === 'REVERSAL')
    .forEach(movement => reversals.set(movement.related_movement_id!, movement));

  return movements
    .filter(movement => movement.document_type === OWNER_WITHDRAWAL_DOCUMENT_TYPE && movement.movement_code === 'CASH_OUT')
    .map(movement => {
      const metadata = withdrawalMetadata(movement);
      const reversal = reversals.get(movement.id);
      const cancellation = cancellationMetadata(reversal);
      const cancelled = movement.status === 'REVERSED' || movement.status === 'CANCELLED' || Boolean(reversal);
      return {
        id: metadata.withdrawalId || movement.document_id,
        withdrawalDate: metadata.withdrawalDate || movement.movement_date || movement.created_at,
        periodKey: metadata.periodKey || ownerFinanceMonthKey(metadata.withdrawalDate || movement.created_at),
        userId: movement.user_id,
        userName: movement.user_name,
        conceptId: metadata.conceptId || movement.reference_id || '',
        conceptName: metadata.conceptName || movement.reference,
        amount: Number(movement.amount) || 0,
        observations: metadata.observations || movement.observation || '',
        accountId: movement.origin_account_id,
        accountName: accountNames.get(movement.origin_account_id) || movement.origin_account_id,
        paymentMethod: metadata.paymentMethod || '',
        status: cancelled ? 'ANULADO' : 'ACTIVE',
        financialMovementId: movement.id,
        createdAt: movement.created_at,
        cancelledAt: cancellation?.cancelledAt || null,
        cancelledBy: cancellation?.cancelledBy || null,
        cancellationReason: cancellation?.reason || null,
        reversalMovementId: reversal?.id || null,
      } satisfies OwnerWithdrawal;
    })
    .sort((left, right) => right.withdrawalDate.localeCompare(left.withdrawalDate));
}

async function loadOwnerFinanceSettings(periodKey?: string): Promise<{
  row: OwnerFinanceSystemSettingsRow;
  settings: OwnerFinanceSettings;
  concepts: OwnerWithdrawalConcept[];
  periodConfigurations: OwnerFinancePeriodConfiguration[];
}> {
  let row = await ensureOwnerFinanceSettingsRow();
  const selectedPeriodKey = normalizeOwnerFinancePeriodKey(
    periodKey || currentOwnerFinancePeriodKey(),
  );
  let periodConfigurations = normalizeStoredPeriodConfigurations(row);
  const legacy = normalizeLegacySettings(row);
  let configuration = periodConfigurations.find(item => item.periodKey === selectedPeriodKey);

  if (!configuration) {
    configuration = defaultPeriodConfiguration(
      selectedPeriodKey,
      new Date().toISOString(),
      selectedPeriodKey === currentOwnerFinancePeriodKey()
        ? {
          projectedWithdrawalPercentage: legacy.percentage,
          monthlyProfitGoal: legacy.monthlyProfitGoal,
          financialPeriod: legacy.financialPeriod,
        }
        : undefined,
    );
    periodConfigurations = [...periodConfigurations, configuration]
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey));
    row = {
      ...row,
      owner_finance_periods: periodConfigurations.map(mapPeriodConfigurationToDb),
    };
    // Transparent forward compatibility: legacy installations are normalized
    // the first time a month is opened, without creating financial movements.
    await localDb.system_settings.put(row);
  }

  return {
    row,
    settings: {
      projectedWithdrawalPercentage: configuration.projectedWithdrawalPercentage,
      monthlyProfitGoal: configuration.monthlyProfitGoal,
      financialPeriod: configuration.financialPeriod,
      periodKey: selectedPeriodKey,
      periodStatus: configuration.status,
      closedAt: configuration.closedAt ?? null,
      closedBy: configuration.closedBy ?? null,
      reopenedAt: configuration.reopenedAt ?? null,
      reopenedBy: configuration.reopenedBy ?? null,
    },
    concepts: (Array.isArray(row.owner_withdrawal_concepts) ? row.owner_withdrawal_concepts : [])
      .flatMap((concept) => {
        try {
          return [mapConcept(concept)];
        } catch {
          return [];
        }
      }),
    periodConfigurations,
  };
}

function buildPeriodOptions(input: {
  selectedPeriod: string;
  invoiceDates: string[];
  expenseDates: string[];
  withdrawals: OwnerWithdrawal[];
  configurations: OwnerFinancePeriodConfiguration[];
}): OwnerFinancePeriodOption[] {
  const financialDataKeys = new Set<string>();
  [...input.invoiceDates, ...input.expenseDates].forEach(value => {
    const key = ownerFinanceMonthKey(value);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) financialDataKeys.add(key);
  });
  input.withdrawals.forEach(withdrawal => {
    const key = withdrawal.periodKey || ownerFinanceMonthKey(withdrawal.withdrawalDate || withdrawal.createdAt);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) financialDataKeys.add(key);
  });

  const statusByKey = new Map(input.configurations.map(item => [item.periodKey, item.status]));
  const keys = new Set<string>([
    currentOwnerFinancePeriodKey(),
    input.selectedPeriod,
    ...financialDataKeys,
    ...input.configurations.map(item => item.periodKey),
  ]);

  return [...keys]
    .sort((left, right) => right.localeCompare(left))
    .map(key => ({
      key,
      label: formatOwnerFinancePeriodLabel(key),
      status: statusByKey.get(key) || DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
      hasFinancialData: financialDataKeys.has(key),
    }));
}

export async function fetchOwnerFinanceWorkspaceLocal(
  filters: OwnerFinanceFilters = {},
): Promise<OwnerFinanceWorkspace> {
  await requireOwnerFinancePermission();
  const selectedPeriod = normalizeOwnerFinancePeriodKey(
    filters.periodKey || currentOwnerFinancePeriodKey(),
  );
  const { settings, concepts, periodConfigurations } = await loadOwnerFinanceSettings(selectedPeriod);
  const [invoiceRows, invoiceItemRows, expenseRows, productRows, movementRows, accountRows, userRows] = await Promise.all([
    localDb.invoices.toArray(),
    localDb.invoice_items.toArray(),
    localDb.expenses.toArray(),
    localDb.products.toArray(),
    localDb.financial_movements.toArray(),
    localDb.financial_accounts.toArray(),
    localDb.users.toArray(),
  ]);

  const itemsByInvoice = new Map<string, typeof invoiceItemRows>();
  invoiceItemRows.forEach(item => {
    const current = itemsByInvoice.get(item.invoice_id) || [];
    current.push(item);
    itemsByInvoice.set(item.invoice_id, current);
  });
  const productCostById = new Map(productRows.map(product => [
    product.id,
    Number(product.average_purchase_price ?? product.purchase_price) || 0,
  ]));

  const invoices = invoiceRows.map(invoice => {
    const totalCost = (itemsByInvoice.get(invoice.id) || []).reduce((sum, item) => {
      const unitCost = Number(item.cost_price ?? productCostById.get(item.product_id) ?? 0) || 0;
      return sum + unitCost * (Number(item.quantity) || 0);
    }, 0);
    return {
      id: invoice.id,
      date: invoice.date,
      status: invoice.status,
      tipoDocumento: (invoice.tipo_documento || 'factura') as 'factura' | 'cotizacion',
      total: Number(invoice.total) || 0,
      totalCost,
    };
  });
  const expenses = expenseRows.map(expense => ({
    id: expense.id,
    date: expense.date,
    status: expense.status,
    total: Number(expense.total) || 0,
  }));
  const accountNames = new Map(accountRows.map(account => [account.id, account.name]));
  const allWithdrawals = mapWithdrawals(movementRows, accountNames);
  const selectedPeriodWithdrawals = filterOwnerWithdrawals(allWithdrawals, {
    ...filters,
    periodKey: selectedPeriod,
  });

  return {
    selectedPeriod,
    periods: buildPeriodOptions({
      selectedPeriod,
      invoiceDates: invoiceRows.map(row => row.date),
      expenseDates: expenseRows.map(row => row.date),
      withdrawals: allWithdrawals,
      configurations: periodConfigurations,
    }),
    dashboard: calculateOwnerFinanceDashboard({
      invoices,
      expenses,
      withdrawals: allWithdrawals,
      projectedWithdrawalPercentage: settings.projectedWithdrawalPercentage,
      monthlyProfitGoal: settings.monthlyProfitGoal,
      periodKey: selectedPeriod,
    }),
    withdrawals: selectedPeriodWithdrawals,
    concepts: concepts.sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, 'es')),
    settings,
    accounts: accountRows
      .filter(account => account.active)
      .map(account => ({ id: account.id, name: account.name, balance: Number(account.balance) || 0 }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es')),
    users: userRows
      .filter(user => user.active)
      .map(user => ({ id: user.id, displayName: user.display_name }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'es')),
    paymentMethods: ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'NEQUI', 'OTRO'],
  };
}

function periodConfigurationFromSettings(
  settings: OwnerFinanceSettings,
  current: OwnerFinanceSettings,
  session: SessionUser,
  now: string,
): OwnerFinancePeriodConfiguration {
  const periodKey = normalizeOwnerFinancePeriodKey(
    settings.periodKey || current.periodKey || currentOwnerFinancePeriodKey(),
  );
  const status = normalizeOwnerFinancePeriodStatus(
    settings.periodStatus || current.periodStatus || DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
  );
  const previousStatus = normalizeOwnerFinancePeriodStatus(
    current.periodStatus || DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
  );

  const configuration: OwnerFinancePeriodConfiguration = {
    periodKey,
    projectedWithdrawalPercentage: normalizeProjectedWithdrawalPercentage(
      settings.projectedWithdrawalPercentage,
    ),
    monthlyProfitGoal: normalizeMonthlyProfitGoal(settings.monthlyProfitGoal),
    financialPeriod: normalizeOwnerFinancePeriod(settings.financialPeriod),
    status,
    updatedAt: now,
    closedAt: current.closedAt ?? null,
    closedBy: current.closedBy ?? null,
    reopenedAt: current.reopenedAt ?? null,
    reopenedBy: current.reopenedBy ?? null,
  };

  if (status === 'CLOSED' && previousStatus !== 'CLOSED') {
    configuration.closedAt = now;
    configuration.closedBy = session.displayName;
  }
  if (status === 'OPEN' && previousStatus === 'CLOSED') {
    configuration.reopenedAt = now;
    configuration.reopenedBy = session.displayName;
  }
  return configuration;
}

export async function saveOwnerFinanceSettingsLocal(
  settings: OwnerFinanceSettings,
): Promise<OwnerFinanceSettings> {
  const session = await requireOwnerFinancePermission();
  const periodKey = normalizeOwnerFinancePeriodKey(
    settings.periodKey || currentOwnerFinancePeriodKey(),
  );
  const loaded = await loadOwnerFinanceSettings(periodKey);
  const currentSettings = loaded.settings;
  const requestedStatus = normalizeOwnerFinancePeriodStatus(
    settings.periodStatus || currentSettings.periodStatus || DEFAULT_OWNER_FINANCE_PERIOD_STATUS,
  );
  if (requestedStatus === 'CLOSED' && isFutureOwnerFinancePeriod(periodKey)) {
    throw new Error('OWNER_FINANCE_FUTURE_PERIOD_CLOSE_NOT_ALLOWED');
  }
  const valuesChanged = normalizeProjectedWithdrawalPercentage(settings.projectedWithdrawalPercentage)
      !== currentSettings.projectedWithdrawalPercentage
    || normalizeMonthlyProfitGoal(settings.monthlyProfitGoal) !== currentSettings.monthlyProfitGoal
    || normalizeOwnerFinancePeriod(settings.financialPeriod) !== currentSettings.financialPeriod;

  if (currentSettings.periodStatus === 'CLOSED') {
    if (requestedStatus === 'CLOSED' && valuesChanged) throw new Error('OWNER_FINANCE_PERIOD_CLOSED');
    if (requestedStatus === 'OPEN' && valuesChanged) throw new Error('OWNER_FINANCE_PERIOD_REOPEN_VALUES_CHANGED');
  }

  if (currentSettings.periodStatus === 'CLOSED' && requestedStatus === 'CLOSED' && !valuesChanged) {
    return currentSettings;
  }

  const now = new Date().toISOString();
  const nextConfiguration = periodConfigurationFromSettings(
    { ...settings, periodKey, periodStatus: requestedStatus },
    currentSettings,
    session,
    now,
  );
  const previousConfiguration = loaded.periodConfigurations.find(item => item.periodKey === periodKey);
  if (previousConfiguration) {
    nextConfiguration.closedAt = nextConfiguration.closedAt ?? previousConfiguration.closedAt ?? null;
    nextConfiguration.closedBy = nextConfiguration.closedBy ?? previousConfiguration.closedBy ?? null;
    nextConfiguration.reopenedAt = nextConfiguration.reopenedAt ?? previousConfiguration.reopenedAt ?? null;
    nextConfiguration.reopenedBy = nextConfiguration.reopenedBy ?? previousConfiguration.reopenedBy ?? null;
  }

  const periodConfigurations = [
    ...loaded.periodConfigurations.filter(item => item.periodKey !== periodKey),
    nextConfiguration,
  ].sort((left, right) => right.periodKey.localeCompare(left.periodKey));

  const currentPeriod = periodKey === currentOwnerFinancePeriodKey();
  const nextRow: OwnerFinanceSystemSettingsRow = {
    ...loaded.row,
    owner_finance_periods: periodConfigurations.map(mapPeriodConfigurationToDb),
    ...(currentPeriod ? {
      owner_projected_withdrawal_percentage: nextConfiguration.projectedWithdrawalPercentage,
      owner_monthly_profit_goal: nextConfiguration.monthlyProfitGoal,
      owner_financial_period: nextConfiguration.financialPeriod,
    } : {}),
  };

  const action = currentSettings.periodStatus !== requestedStatus
    ? requestedStatus === 'CLOSED'
      ? 'OWNER_FINANCE_PERIOD_CLOSED'
      : 'OWNER_FINANCE_PERIOD_REOPENED'
    : 'OWNER_FINANCE_SETTINGS_UPDATED';

  await localDb.transaction('rw', localDb.system_settings, localDb.activity_log, async () => {
    await localDb.system_settings.put(nextRow);
    await logOwnerFinanceActivity(
      session,
      action,
      'owner_finance_period',
      periodKey,
      JSON.stringify(nextConfiguration),
    );
  });

  return {
    projectedWithdrawalPercentage: nextConfiguration.projectedWithdrawalPercentage,
    monthlyProfitGoal: nextConfiguration.monthlyProfitGoal,
    financialPeriod: nextConfiguration.financialPeriod,
    periodKey,
    periodStatus: nextConfiguration.status,
    closedAt: nextConfiguration.closedAt ?? null,
    closedBy: nextConfiguration.closedBy ?? null,
    reopenedAt: nextConfiguration.reopenedAt ?? null,
    reopenedBy: nextConfiguration.reopenedBy ?? null,
  };
}

export async function createOwnerWithdrawalConceptLocal(name: string): Promise<OwnerWithdrawalConcept> {
  const session = await requireOwnerFinancePermission();
  const normalized = normalizeOwnerConceptName(name);
  const { row, concepts } = await loadOwnerFinanceSettings();
  if (concepts.some(concept => concept.nameKey === normalized.nameKey)) {
    throw new Error('OWNER_CONCEPT_ALREADY_EXISTS');
  }
  const now = new Date().toISOString();
  const concept: OwnerWithdrawalConcept = {
    id: crypto.randomUUID(),
    name: normalized.name,
    nameKey: normalized.nameKey,
    active: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  await localDb.transaction('rw', localDb.system_settings, localDb.activity_log, async () => {
    await localDb.system_settings.put({
      ...row,
      owner_withdrawal_concepts: [...concepts, concept].map(mapConceptToDb),
    });
    await logOwnerFinanceActivity(session, 'OWNER_WITHDRAWAL_CONCEPT_CREATED', 'owner_withdrawal_concept', concept.id, concept.name);
  });
  return concept;
}

export async function updateOwnerWithdrawalConceptLocal(
  conceptId: string,
  changes: { name?: string; active?: boolean },
): Promise<OwnerWithdrawalConcept> {
  const session = await requireOwnerFinancePermission();
  const { row, concepts } = await loadOwnerFinanceSettings();
  const current = concepts.find(concept => concept.id === conceptId);
  if (!current) throw new Error('OWNER_CONCEPT_NOT_FOUND');

  const normalized = changes.name === undefined
    ? { name: current.name, nameKey: current.nameKey }
    : normalizeOwnerConceptName(changes.name);
  if (concepts.some(concept => concept.id !== conceptId && concept.nameKey === normalized.nameKey)) {
    throw new Error('OWNER_CONCEPT_ALREADY_EXISTS');
  }

  const updated: OwnerWithdrawalConcept = {
    ...current,
    name: normalized.name,
    nameKey: normalized.nameKey,
    active: changes.active ?? current.active,
    updatedAt: new Date().toISOString(),
  };
  const next = concepts.map(concept => concept.id === conceptId ? updated : concept);
  await localDb.transaction('rw', localDb.system_settings, localDb.activity_log, async () => {
    await localDb.system_settings.put({ ...row, owner_withdrawal_concepts: next.map(mapConceptToDb) });
    await logOwnerFinanceActivity(
      session,
      'OWNER_WITHDRAWAL_CONCEPT_UPDATED',
      'owner_withdrawal_concept',
      conceptId,
      JSON.stringify({ name: updated.name, active: updated.active }),
    );
  });
  return updated;
}

export async function createOwnerWithdrawalLocal(
  input: CreateOwnerWithdrawalInput,
): Promise<OwnerWithdrawal> {
  const session = await requireOwnerFinancePermission();
  const rawWithdrawalDate = String(input.withdrawalDate || '').trim();
  const withdrawalDate = new Date(rawWithdrawalDate);
  if (Number.isNaN(withdrawalDate.getTime())) throw new Error('OWNER_WITHDRAWAL_DATE_INVALID');
  const datePeriodKey = normalizeOwnerFinancePeriodKey(ownerFinanceMonthKey(rawWithdrawalDate));
  const requestedPeriodKey = (input as CreateOwnerWithdrawalInput & { periodKey?: string }).periodKey;
  const periodKey = requestedPeriodKey
    ? normalizeOwnerFinancePeriodKey(requestedPeriodKey)
    : datePeriodKey;
  if (datePeriodKey !== periodKey) {
    throw new Error('OWNER_WITHDRAWAL_PERIOD_MISMATCH');
  }
  const { settings, concepts } = await loadOwnerFinanceSettings(periodKey);
  if (settings.periodStatus === 'CLOSED') throw new Error('OWNER_FINANCE_PERIOD_CLOSED');

  const concept = concepts.find(item => item.id === input.conceptId);
  if (!concept) throw new Error('OWNER_CONCEPT_NOT_FOUND');
  if (!concept.active) throw new Error('OWNER_CONCEPT_INACTIVE');
  if (!input.accountId) throw new Error('OWNER_WITHDRAWAL_ACCOUNT_REQUIRED');

  const account = await localDb.financial_accounts.get(input.accountId);
  if (!account || !account.active) throw new Error('OWNER_WITHDRAWAL_ACCOUNT_NOT_FOUND');
  const amount = Number(input.amount);
  validateOwnerWithdrawalAmount(amount, Number(account.balance) || 0);

  const withdrawalId = crypto.randomUUID();
  const movementId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const observations = String(input.observations || '').trim();
  const paymentMethod = String(input.paymentMethod || '').trim();
  if (!paymentMethod) throw new Error('OWNER_WITHDRAWAL_PAYMENT_METHOD_REQUIRED');
  const balanceBefore = Number(account.balance) || 0;
  const balanceAfter = balanceBefore - amount;
  const metadata: OwnerWithdrawalMovementMetadata = {
    kind: 'owner_withdrawal',
    withdrawalId,
    withdrawalDate: withdrawalDate.toISOString(),
    periodKey,
    conceptId: concept.id,
    conceptName: concept.name,
    paymentMethod,
    observations,
  };

  const movement: DbFinancialMovement = {
    id: movementId,
    type: 'adjustment',
    amount,
    origin_account_id: account.id,
    destination_account_id: '',
    origin_balance_before: balanceBefore,
    origin_balance_after: balanceAfter,
    destination_balance_before: 0,
    destination_balance_after: 0,
    reference: concept.name,
    document_type: OWNER_WITHDRAWAL_DOCUMENT_TYPE,
    document_id: withdrawalId,
    observation: observations,
    user_id: session.id,
    user_name: session.displayName,
    movement_date: withdrawalDate.toISOString(),
    created_at: createdAt,
    movement_code: 'CASH_OUT',
    related_movement_id: '',
    reference_type: 'MANUAL',
    reference_id: concept.id,
    status: 'POSTED',
    updated_at: createdAt,
    notes: JSON.stringify(metadata),
    customer_id: '',
  };

  await localDb.transaction('rw', localDb.financial_accounts, localDb.financial_movements, localDb.activity_log, async () => {
    await localDb.financial_accounts.update(account.id, { balance: balanceAfter, updated_at: createdAt });
    await localDb.financial_movements.add(movement);
    await logOwnerFinanceActivity(
      session,
      'OWNER_WITHDRAWAL_CREATED',
      'owner_withdrawal',
      withdrawalId,
      JSON.stringify({ periodKey, conceptId: concept.id, conceptName: concept.name, amount, accountId: account.id }),
    );
  });

  return {
    id: withdrawalId,
    withdrawalDate: withdrawalDate.toISOString(),
    periodKey,
    userId: session.id,
    userName: session.displayName,
    conceptId: concept.id,
    conceptName: concept.name,
    amount,
    observations,
    accountId: account.id,
    accountName: account.name,
    paymentMethod,
    status: 'ACTIVE',
    financialMovementId: movementId,
    createdAt,
  };
}

export async function cancelOwnerWithdrawalLocal(
  withdrawalId: string,
  reason: string,
): Promise<OwnerWithdrawal> {
  const session = await requireOwnerFinancePermission();
  const cancellationReason = String(reason || '').trim();
  if (!cancellationReason) throw new Error('OWNER_WITHDRAWAL_CANCELLATION_REASON_REQUIRED');

  const initialOriginal = await localDb.financial_movements
    .filter(movement => movement.document_type === OWNER_WITHDRAWAL_DOCUMENT_TYPE && movement.document_id === withdrawalId)
    .first();
  if (!initialOriginal) throw new Error('OWNER_WITHDRAWAL_NOT_FOUND');

  const initialMetadata = withdrawalMetadata(initialOriginal);
  const periodKey = normalizeOwnerFinancePeriodKey(
    initialMetadata.periodKey || ownerFinanceMonthKey(initialMetadata.withdrawalDate || initialOriginal.created_at),
  );
  const { settings } = await loadOwnerFinanceSettings(periodKey);
  if (settings.periodStatus === 'CLOSED') throw new Error('OWNER_FINANCE_PERIOD_CLOSED');

  return localDb.transaction(
    'rw',
    localDb.financial_accounts,
    localDb.financial_movements,
    localDb.activity_log,
    async () => {
      // Re-read inside the write transaction so two cancellation requests cannot
      // both pass the idempotency checks and credit the account twice.
      const original = await localDb.financial_movements
        .filter(movement => movement.document_type === OWNER_WITHDRAWAL_DOCUMENT_TYPE && movement.document_id === withdrawalId)
        .first();
      if (!original) throw new Error('OWNER_WITHDRAWAL_NOT_FOUND');

      const existingReversal = await localDb.financial_movements
        .filter(movement => movement.related_movement_id === original.id && movement.movement_code === 'REVERSAL')
        .first();
      if (existingReversal || original.status === 'REVERSED' || original.status === 'CANCELLED') {
        throw new Error('OWNER_WITHDRAWAL_ALREADY_CANCELLED');
      }

      const metadata = withdrawalMetadata(original);
      const account = await localDb.financial_accounts.get(original.origin_account_id);
      if (!account) throw new Error('OWNER_WITHDRAWAL_ACCOUNT_NOT_FOUND');

      const amount = Number(original.amount) || 0;
      const balanceBefore = Number(account.balance) || 0;
      const balanceAfter = balanceBefore + amount;
      const cancelledAt = new Date().toISOString();
      const reversalId = crypto.randomUUID();
      const cancellation: OwnerWithdrawalCancellationMetadata = {
        kind: 'owner_withdrawal_cancellation',
        withdrawalId,
        reason: cancellationReason,
        cancelledAt,
        cancelledBy: session.displayName,
      };
      const reversal: DbFinancialMovement = {
        id: reversalId,
        type: 'adjustment',
        amount,
        origin_account_id: '',
        destination_account_id: account.id,
        origin_balance_before: 0,
        origin_balance_after: 0,
        destination_balance_before: balanceBefore,
        destination_balance_after: balanceAfter,
        reference: original.reference,
        document_type: OWNER_WITHDRAWAL_CANCELLATION_DOCUMENT_TYPE,
        document_id: withdrawalId,
        observation: cancellationReason,
        user_id: session.id,
        user_name: session.displayName,
        movement_date: cancelledAt,
        created_at: cancelledAt,
        movement_code: 'REVERSAL',
        related_movement_id: original.id,
        reference_type: 'MANUAL',
        reference_id: metadata.conceptId || original.reference_id,
        status: 'POSTED',
        updated_at: cancelledAt,
        notes: JSON.stringify(cancellation),
        customer_id: '',
      };

      await localDb.financial_accounts.update(account.id, { balance: balanceAfter, updated_at: cancelledAt });

      // The original CASH_OUT must remain POSTED in the immutable ledger. The
      // linked REVERSAL neutralizes it exactly once. The domain withdrawal is
      // still presented as ANULADO because mapWithdrawals detects the reversal.
      await localDb.financial_movements.update(original.id, { updated_at: cancelledAt });
      await localDb.financial_movements.add(reversal);
      await logOwnerFinanceActivity(
        session,
        'OWNER_WITHDRAWAL_CANCELLED',
        'owner_withdrawal',
        withdrawalId,
        JSON.stringify({ periodKey, reason: cancellationReason, reversalMovementId: reversalId }),
      );

      return {
        id: withdrawalId,
        withdrawalDate: metadata.withdrawalDate,
        periodKey,
        userId: original.user_id,
        userName: original.user_name,
        conceptId: metadata.conceptId,
        conceptName: metadata.conceptName,
        amount,
        observations: metadata.observations,
        accountId: account.id,
        accountName: account.name,
        paymentMethod: metadata.paymentMethod,
        status: 'ANULADO',
        financialMovementId: original.id,
        createdAt: original.created_at,
        cancelledAt,
        cancelledBy: session.displayName,
        cancellationReason,
        reversalMovementId: reversalId,
      };
    },
  );
}
