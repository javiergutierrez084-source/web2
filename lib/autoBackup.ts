// Compatibility facade for callers that still import the historical
// autoBackup.ts API. The old independent timer and JoyaControl-autosave.json
// writer were removed; all new automatic backups now use BackupScheduler and
// BackupManager, which produce the canonical V6 envelope.

import { BackupManager } from '@/lib/BackupManager';
import { BackupScheduler } from '@/lib/BackupScheduler';

export function startAutoBackup(): void {
  void BackupScheduler.init();
}

export function stopAutoBackup(): void {
  BackupScheduler.dispose();
}

export async function getAutoBackupInfo(): Promise<{ date: string; sizeKB: number } | null> {
  const info = await BackupManager.getBackupInfo();
  return info ? { date: info.date, sizeKB: info.sizeKB } : null;
}

// Historical name retained for source compatibility. LocalBackupProvider reads
// both joyacontrol-backup.json and JoyaControl-autosave.json and normalizes the
// result before it is returned.
export async function restoreFromOPFS() {
  const envelope = await BackupManager.peekLocalBackup();
  if (!envelope) throw new Error('No hay respaldo interno guardado.');
  return envelope;
}
