import type { IBackupProvider } from './IBackupProvider';
import {
  isOPFSSupported,
  readFromOPFS,
  getOPFSBackupInfo,
  writeBackupDataToOPFS,
  deleteOPFSBackup,
} from './backup';
import {
  BackupDestination,
  type BackupInfo,
  type BackupEnvelope,
  normalizeBackupSource,
} from '@/types/backup';

// OPFS keeps the current slot and can also read the two historical single-file
// names. Every loaded shape is normalized to the canonical envelope before it
// reaches BackupManager.
export class LocalBackupProvider implements IBackupProvider {
  readonly destination = BackupDestination.LOCAL;

  async save(envelope: BackupEnvelope): Promise<void> {
    await writeBackupDataToOPFS(envelope);
  }

  async load(): Promise<BackupEnvelope | null> {
    if (!(await this.exists())) return null;
    return normalizeBackupSource(await readFromOPFS());
  }

  async list(): Promise<BackupInfo[]> {
    const envelope = await this.load();
    if (!envelope) return [];
    const info = await getOPFSBackupInfo();
    return [{
      date: info?.date ?? envelope.createdAt,
      sizeKB: info?.sizeKB ?? 0,
      version: envelope.version,
      destination: BackupDestination.LOCAL,
      recordCount: envelope.metadata.recordCount,
    }];
  }

  async delete(): Promise<void> {
    await deleteOPFSBackup();
  }

  async exists(): Promise<boolean> {
    if (!isOPFSSupported()) return false;
    return (await getOPFSBackupInfo()) !== null;
  }
}
