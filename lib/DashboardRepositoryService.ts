import { BackupManager } from '@/lib/BackupManager';
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
  type DashboardSnapshotInput,
} from '@/lib/DashboardMetricsService';
import type { IDataRepository } from '@/repositories/IDataRepository';
import { getActiveRepositoryMode, getDataRepository } from '@/repositories/RepositoryRegistry';

interface DashboardMetricsRemoteRepository {
  getDashboardMetrics?: () => Promise<DashboardSnapshot>;
}

const BACKUP_CACHE_MS = 60_000;
let backupCache: { checkedAt: number; lastSuccessfulBackupAt: string | null } | null = null;
let backupRequest: Promise<string | null> | null = null;

async function getLastSuccessfulBackupAt(): Promise<string | null> {
  const now = Date.now();
  if (backupCache && now - backupCache.checkedAt < BACKUP_CACHE_MS) {
    return backupCache.lastSuccessfulBackupAt;
  }
  if (backupRequest) return backupRequest;

  backupRequest = BackupManager.listHistory(20)
    .then(history => history.find(entry => entry.status === 'success')?.date ?? null)
    .catch(() => null)
    .then(lastSuccessfulBackupAt => {
      backupCache = { checkedAt: Date.now(), lastSuccessfulBackupAt };
      return lastSuccessfulBackupAt;
    })
    .finally(() => {
      backupRequest = null;
    });

  return backupRequest;
}

/**
 * Dashboard-specific read model.
 *
 * Local and Principal Server modes calculate from AppContext's Repository-backed
 * state. LAN clients make one summarized `getDashboardMetrics` request and never
 * request invoices, customers, cash sessions or layaways separately.
 */
export const DashboardRepositoryService = {
  async getDashboardMetrics(source?: DashboardSnapshotInput): Promise<DashboardSnapshot> {
    if (getActiveRepositoryMode() === 'lan') {
      const repository = getDataRepository() as IDataRepository & DashboardMetricsRemoteRepository;
      if (typeof repository.getDashboardMetrics !== 'function') {
        throw new Error('LAN_DASHBOARD_METRICS_NOT_AVAILABLE');
      }
      return repository.getDashboardMetrics();
    }

    if (!source) throw new Error('DASHBOARD_METRICS_SOURCE_REQUIRED');
    return this.buildServerMetrics(source);
  },

  async buildServerMetrics(source: DashboardSnapshotInput): Promise<DashboardSnapshot> {
    const lastSuccessfulBackupAt = await getLastSuccessfulBackupAt();
    return buildDashboardSnapshot({
      ...source,
      lastSuccessfulBackupAt,
      backupStatusAvailable: true,
    });
  },

  clearBackupStatusCache(): void {
    backupCache = null;
  },
};
