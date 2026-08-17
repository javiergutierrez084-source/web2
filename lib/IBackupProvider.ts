import type { BackupEnvelope, BackupInfo } from '@/types/backup';

// Common contract for any backup storage destination (local/OPFS today; USB,
// NETWORK, SERVER, NAS and CLOUD are prepared for future LAN/cloud support —
// see BackupDestination in @/types/backup). Only LocalBackupProvider exists
// right now; adding a new destination later means implementing this interface,
// not changing BackupManager or the UI.
//
// Providers store/load the full envelope (metadata + data), not just the raw
// data — this is what lets checksums and version info survive a save/load
// round-trip instead of only living in the local backup_history log.
export interface IBackupProvider {
  save(envelope: BackupEnvelope): Promise<void>;
  load(): Promise<BackupEnvelope | null>;
  list(): Promise<BackupInfo[]>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
}
