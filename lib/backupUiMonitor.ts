import type { BackupEnvelope, BackupHistory } from '@/types/backup';
import { countBackupRecords } from '@/types/backup';

const STORAGE_KEY = 'joyacontrol_backup_ui_metrics_v1';

export interface BackupUiMetrics {
  historyId?: string;
  createdAt: string;
  durationMs: number;
  tableCount: number;
  recordCount: number;
  realSize: number;
  compressedSize: number | null;
  checksumValid: boolean | null;
  appVersion: string;
  databaseVersion: number;
  backupVersion: number;
  createdBy: string;
  deviceId: string;
}

function readAll(): BackupUiMetrics[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: BackupUiMetrics[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  } catch {
    // UI metrics are best-effort and never affect the backup itself.
  }
}

export function buildBackupUiMetrics(
  envelope: BackupEnvelope,
  durationMs: number,
  checksumValid: boolean | null,
): BackupUiMetrics {
  const tables = Object.values(envelope.data.tables).filter(Array.isArray);
  return {
    createdAt: envelope.createdAt,
    durationMs,
    tableCount: tables.length,
    recordCount: countBackupRecords(envelope.data),
    realSize: new Blob([JSON.stringify(envelope)]).size,
    compressedSize: null,
    checksumValid,
    appVersion: envelope.appVersion,
    databaseVersion: envelope.databaseVersion,
    backupVersion: envelope.version,
    createdBy: envelope.metadata.createdBy,
    deviceId: envelope.deviceId,
  };
}

export function saveBackupUiMetrics(metrics: BackupUiMetrics): void {
  const current = readAll().filter(item => item.createdAt !== metrics.createdAt);
  writeAll([metrics, ...current]);
}

export function getBackupUiMetrics(history: BackupHistory): BackupUiMetrics | null {
  const all = readAll();
  return all.find(item => item.historyId === history.id)
    ?? all.find(item => item.createdAt === history.date)
    ?? null;
}

export function linkBackupUiMetrics(history: BackupHistory): void {
  const all = readAll();
  const index = all.findIndex(item => item.createdAt === history.date);
  if (index < 0 || all[index].historyId === history.id) return;
  all[index] = { ...all[index], historyId: history.id };
  writeAll(all);
}

export function deleteBackupUiMetrics(historyId: string): void {
  writeAll(readAll().filter(item => item.historyId !== historyId));
}
