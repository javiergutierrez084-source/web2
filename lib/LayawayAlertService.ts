import type { Layaway } from '@/domain/models';

export const LAYAWAY_ALERTS_CHANGED_EVENT = 'joyacontrol:layaway-alerts-changed';
export const LAYAWAY_TERM_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export type LayawayTermOption = typeof LAYAWAY_TERM_OPTIONS[number];
export type LayawayDeadlineMode = 'term' | 'custom';
export type LayawayAlertTone = 'green' | 'yellow' | 'orange' | 'red' | 'neutral';
export type LayawayLifecycleFilter = 'all' | 'active' | 'upcoming' | 'overdue' | 'noRecentPayments' | 'completed' | 'cancelled';
export type LayawaySortKey = 'createdDate' | 'dueDate' | 'client' | 'value' | 'balance' | 'daysRemaining';

export interface LayawayAlertSettings {
  defaultTermDays: number;
  noRecentPaymentDays: number;
  updatedAt: string;
}

export interface LayawayDeadlineSelection {
  mode: LayawayDeadlineMode;
  termDays?: number;
  dueDate?: string;
}

export interface LayawayDeadlineRecord {
  layawayId: string;
  createdDate: string;
  dueDate: string;
  termDays: number;
  registeredAt: string;
  updatedAt?: string;
  source?: 'default' | 'individual' | 'custom';
}

export interface ArchivedLayawayRecord {
  layaway: Layaway;
  cancelledAt: string;
  resolution?: string;
}

export interface LayawayAlertInfo {
  layawayId: string;
  createdDate: string;
  dueDate: string;
  daysRemaining: number;
  tone: LayawayAlertTone;
  statusLabel: string;
  isUpcoming: boolean;
  isOverdue: boolean;
  hasNoRecentPayments: boolean;
  lastPaymentDate: string | null;
  totalPaid: number;
  balance: number;
  lifecycle: 'active' | 'completed' | 'cancelled';
}

export interface LayawayAlertSummary {
  active: number;
  upcoming: number;
  overdue: number;
  noRecentPayments: number;
  retainedValue: number;
  paymentsReceived: number;
  highestRetainedValue: number;
  nearestDueDate: string | null;
}

const SETTINGS_KEY = 'joyacontrol_layaway_alert_settings_v34';
const DEADLINES_KEY = 'joyacontrol_layaway_deadlines_v34';
const ARCHIVE_KEY = 'joyacontrol_layaway_cancelled_archive_v34';
const DEFAULT_TERM_DAYS = 30;
const DEFAULT_NO_PAYMENT_DAYS = 30;
const MAX_TERM_DAYS = 3650;
const VALID_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseIsoDate = (value: unknown): Date | null => {
  const normalized = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== normalized) return null;
  return parsed;
};

const dateAtNoon = (value: string): Date => parseIsoDate(value) || new Date();

export const isValidLayawayId = (value: unknown): value is string => (
  typeof value === 'string' && VALID_ID_PATTERN.test(value.trim())
);

export const isValidLayawayDate = (value: unknown): value is string => parseIsoDate(value) !== null;

export const addLayawayDays = (value: string, days: number): string => {
  const date = parseIsoDate(value);
  if (!date) throw new Error('LAYAWAY_CREATED_DATE_INVALID');
  date.setDate(date.getDate() + days);
  return isoDate(date);
};

const diffDays = (left: string, right: string): number => {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((dateAtNoon(left).getTime() - dateAtNoon(right).getTime()) / dayMs);
};

const clampDays = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_TERM_DAYS, Math.max(1, Math.round(parsed)));
};

const safeRead = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const safeWrite = (key: string, value: unknown): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const emitChanged = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LAYAWAY_ALERTS_CHANGED_EVENT));
};

export const loadLayawayAlertSettings = (): LayawayAlertSettings => {
  const candidate = safeRead<Partial<LayawayAlertSettings>>(SETTINGS_KEY, {});
  return {
    defaultTermDays: clampDays(candidate.defaultTermDays, DEFAULT_TERM_DAYS),
    noRecentPaymentDays: clampDays(candidate.noRecentPaymentDays, DEFAULT_NO_PAYMENT_DAYS),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
};

export const saveLayawayAlertSettings = (settings: LayawayAlertSettings): LayawayAlertSettings => {
  const normalized: LayawayAlertSettings = {
    defaultTermDays: clampDays(settings.defaultTermDays, DEFAULT_TERM_DAYS),
    noRecentPaymentDays: clampDays(settings.noRecentPaymentDays, DEFAULT_NO_PAYMENT_DAYS),
    updatedAt: new Date().toISOString(),
  };
  if (!safeWrite(SETTINGS_KEY, normalized)) throw new Error('LAYAWAY_SETTINGS_PERSIST_FAILED');
  emitChanged();
  return normalized;
};

export const loadLayawayDeadlineRegistry = (): Record<string, LayawayDeadlineRecord> =>
  safeRead<Record<string, LayawayDeadlineRecord>>(DEADLINES_KEY, {});

export const resolveLayawayDeadline = (
  createdDateValue: string,
  selection: LayawayDeadlineSelection,
): Pick<LayawayDeadlineRecord, 'createdDate' | 'dueDate' | 'termDays' | 'source'> => {
  const createdDate = String(createdDateValue || '').slice(0, 10);
  if (!isValidLayawayDate(createdDate)) throw new Error('LAYAWAY_CREATED_DATE_INVALID');

  if (selection.mode === 'custom') {
    const dueDate = String(selection.dueDate || '').slice(0, 10);
    if (!isValidLayawayDate(dueDate)) throw new Error('LAYAWAY_DUE_DATE_INVALID');
    const termDays = diffDays(dueDate, createdDate);
    if (termDays < 1) throw new Error('LAYAWAY_DUE_DATE_BEFORE_CREATION');
    if (termDays > MAX_TERM_DAYS) throw new Error('LAYAWAY_DUE_DATE_TOO_FAR');
    return { createdDate, dueDate, termDays, source: 'custom' };
  }

  const parsedTermDays = Number(selection.termDays);
  if (!Number.isFinite(parsedTermDays)) throw new Error('LAYAWAY_TERM_INVALID');
  const termDays = Math.round(parsedTermDays);
  if (termDays < 1 || termDays > MAX_TERM_DAYS) throw new Error('LAYAWAY_TERM_INVALID');
  return {
    createdDate,
    dueDate: addLayawayDays(createdDate, termDays),
    termDays,
    source: 'individual',
  };
};

export const saveLayawayDeadline = (
  layawayIdValue: string,
  createdDate: string,
  selection: LayawayDeadlineSelection,
): LayawayDeadlineRecord => {
  const layawayId = String(layawayIdValue || '').trim();
  if (!isValidLayawayId(layawayId)) throw new Error('LAYAWAY_ID_INVALID');

  const resolved = resolveLayawayDeadline(createdDate, selection);
  const registry = loadLayawayDeadlineRegistry();
  const existing = registry[layawayId];
  const now = new Date().toISOString();
  const record: LayawayDeadlineRecord = {
    layawayId,
    ...resolved,
    registeredAt: existing?.registeredAt || now,
    updatedAt: now,
  };
  registry[layawayId] = record;
  if (!safeWrite(DEADLINES_KEY, registry)) throw new Error('LAYAWAY_DEADLINE_PERSIST_FAILED');
  emitChanged();
  return record;
};

export const deleteLayawayDeadline = (layawayIdValue: string): void => {
  const layawayId = String(layawayIdValue || '').trim();
  if (!isValidLayawayId(layawayId)) return;
  const registry = loadLayawayDeadlineRegistry();
  if (!registry[layawayId]) return;
  delete registry[layawayId];
  if (safeWrite(DEADLINES_KEY, registry)) emitChanged();
};

/**
 * Assigns a deadline only once. Existing records are never recalculated when
 * the configured default changes, so the new term applies exclusively to new
 * layaways observed after the change.
 */
export const ensureLayawayDeadlines = (layaways: readonly Layaway[]): Record<string, LayawayDeadlineRecord> => {
  const registry = loadLayawayDeadlineRegistry();
  const settings = loadLayawayAlertSettings();
  let changed = false;

  layaways.forEach(layaway => {
    if (!isValidLayawayId(layaway.id) || registry[layaway.id]) return;
    const createdDate = String(layaway.invoice?.date || isoDate(new Date())).slice(0, 10);
    if (!isValidLayawayDate(createdDate)) return;
    registry[layaway.id] = {
      layawayId: layaway.id,
      createdDate,
      dueDate: addLayawayDays(createdDate, settings.defaultTermDays),
      termDays: settings.defaultTermDays,
      registeredAt: new Date().toISOString(),
      source: 'default',
    };
    changed = true;
  });

  if (changed && safeWrite(DEADLINES_KEY, registry)) emitChanged();
  return registry;
};

export const archiveCancelledLayaway = (layaway: Layaway, resolution?: string): void => {
  if (!isValidLayawayId(layaway.id)) return;
  const archive = safeRead<Record<string, ArchivedLayawayRecord>>(ARCHIVE_KEY, {});
  archive[layaway.id] = {
    layaway: JSON.parse(JSON.stringify(layaway)) as Layaway,
    cancelledAt: new Date().toISOString(),
    resolution,
  };
  if (safeWrite(ARCHIVE_KEY, archive)) emitChanged();
};

export const loadArchivedCancelledLayaways = (): ArchivedLayawayRecord[] =>
  Object.values(safeRead<Record<string, ArchivedLayawayRecord>>(ARCHIVE_KEY, {}))
    .sort((left, right) => right.cancelledAt.localeCompare(left.cancelledAt));

export const calculateLayawayAlertInfo = (
  layaway: Layaway,
  deadline: LayawayDeadlineRecord | undefined,
  now = new Date(),
  lifecycleOverride?: 'cancelled',
): LayawayAlertInfo => {
  const settings = loadLayawayAlertSettings();
  const today = isoDate(now);
  const createdDate = deadline?.createdDate || String(layaway.invoice?.date || today).slice(0, 10);
  const dueDate = deadline?.dueDate || addLayawayDays(createdDate, settings.defaultTermDays);
  const daysRemaining = diffDays(dueDate, today);
  const totalPaid = layaway.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const balance = Math.max(0, Number(layaway.invoice.total || 0) - totalPaid);
  const lastPaymentDate = layaway.payments
    .map(payment => String(payment.date || '').slice(0, 10))
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] || null;
  const referenceDate = lastPaymentDate || createdDate;
  const daysWithoutPayment = diffDays(today, referenceDate);
  const lifecycle = lifecycleOverride || (layaway.completed ? 'completed' : 'active');

  if (lifecycle === 'cancelled') {
    return {
      layawayId: layaway.id,
      createdDate,
      dueDate,
      daysRemaining,
      tone: 'neutral',
      statusLabel: 'Anulado',
      isUpcoming: false,
      isOverdue: false,
      hasNoRecentPayments: false,
      lastPaymentDate,
      totalPaid,
      balance,
      lifecycle,
    };
  }

  if (lifecycle === 'completed') {
    return {
      layawayId: layaway.id,
      createdDate,
      dueDate,
      daysRemaining,
      tone: 'neutral',
      statusLabel: 'Entregado',
      isUpcoming: false,
      isOverdue: false,
      hasNoRecentPayments: false,
      lastPaymentDate,
      totalPaid,
      balance,
      lifecycle,
    };
  }

  const isOverdue = daysRemaining < 0;
  const isUpcoming = daysRemaining >= 0 && daysRemaining <= 15;
  const hasNoRecentPayments = balance > 0 && daysWithoutPayment > settings.noRecentPaymentDays;
  let tone: LayawayAlertTone = 'green';
  let statusLabel = daysRemaining === 0
    ? 'Vence hoy'
    : `${daysRemaining} día${daysRemaining === 1 ? '' : 's'}`;

  if (isOverdue) {
    tone = 'red';
    const overdueDays = Math.abs(daysRemaining);
    statusLabel = `Vencido hace ${overdueDays} día${overdueDays === 1 ? '' : 's'}`;
  } else if (daysRemaining <= 6) {
    tone = 'orange';
  } else if (daysRemaining <= 15) {
    tone = 'yellow';
  }

  return {
    layawayId: layaway.id,
    createdDate,
    dueDate,
    daysRemaining,
    tone,
    statusLabel,
    isUpcoming,
    isOverdue,
    hasNoRecentPayments,
    lastPaymentDate,
    totalPaid,
    balance,
    lifecycle,
  };
};

export const buildLayawayAlertSummary = (
  layaways: readonly Layaway[],
  registry = ensureLayawayDeadlines(layaways),
  now = new Date(),
): LayawayAlertSummary => {
  const active = layaways.filter(layaway => !layaway.completed && layaway.invoice.status !== 'cancelled');
  const info = active.map(layaway => calculateLayawayAlertInfo(layaway, registry[layaway.id], now));
  return {
    active: active.length,
    upcoming: info.filter(item => item.isUpcoming).length,
    overdue: info.filter(item => item.isOverdue).length,
    noRecentPayments: info.filter(item => item.hasNoRecentPayments).length,
    retainedValue: info.reduce((sum, item) => sum + item.totalPaid, 0),
    paymentsReceived: active.flatMap(layaway => layaway.payments).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    highestRetainedValue: info.reduce((maximum, item) => Math.max(maximum, item.totalPaid), 0),
    nearestDueDate: info.filter(item => !item.isOverdue).sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate || null,
  };
};

export const formatLayawayStatusIcon = (tone: LayawayAlertTone): string => ({
  green: '🟢',
  yellow: '🟡',
  orange: '🟠',
  red: '🔴',
  neutral: '⚪',
})[tone];

export const layawayStatusClasses = (tone: LayawayAlertTone): string => ({
  green: 'border-success/30 bg-success/10 text-success',
  yellow: 'border-warning/30 bg-warning/10 text-warning',
  orange: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  red: 'border-destructive/30 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-secondary/40 text-muted-foreground',
})[tone];
