import { localDb } from '@/lib/localDb';
import { computeChecksum } from '@/lib/checksum';
import { APP_VERSION } from '@/config/appVersion';
import {
  BACKUP_TABLE_NAMES,
  CURRENT_BACKUP_VERSION,
  BackupDestination,
  BackupType,
  getBackupChecksumInput,
  normalizeBackupSource,
  type BackupEnvelope,
  type BackupMetadata,
  type BackupTableName,
  type BackupTables,
  type LegacyBackupData,
} from '@/types/backup';

export type { BackupData, BackupEnvelope, LegacyBackupData } from '@/types/backup';
export { BACKUP_TABLE_NAMES, CURRENT_BACKUP_VERSION } from '@/types/backup';

const DEVICE_ID_KEY = 'joyacontrol_device_id';
const PRIMARY_OPFS_BACKUP_FILENAME = 'joyacontrol-backup.json';
const LEGACY_OPFS_BACKUP_FILENAME = 'JoyaControl-autosave.json';
const OPFS_BACKUP_FILENAMES = [PRIMARY_OPFS_BACKUP_FILENAME, LEGACY_OPFS_BACKUP_FILENAME] as const;

function getDeviceId(): string {
  let id = '';
  try {
    if (typeof localStorage !== 'undefined') id = localStorage.getItem(DEVICE_ID_KEY) || '';
  } catch {
    // Storage can be unavailable in hardened Electron/browser contexts.
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // Best-effort persistence only.
    }
  }
  return id;
}

export async function exportAllData(): Promise<LegacyBackupData> {
  const entries = await Promise.all(
    BACKUP_TABLE_NAMES.map(async tableName => {
      const rows = await localDb.table(tableName).toArray();
      return [tableName, rows] as const;
    }),
  );

  return {
    version: CURRENT_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appName: 'JoyaControl',
    tables: Object.fromEntries(entries) as BackupTables,
  };
}

export interface BuildBackupEnvelopeOptions {
  destination?: BackupDestination;
  backupType?: BackupType;
  createdBy?: string;
  deviceId?: string;
  appVersion?: string;
}

// Single exporter for every new backup path. All providers receive this exact
// canonical shape, so a file written by the exporter is accepted unchanged by
// the importer.
export async function buildBackupEnvelope(
  options: BuildBackupEnvelopeOptions = {},
): Promise<BackupEnvelope> {
  const data = await exportAllData();
  const destination = options.destination ?? BackupDestination.LOCAL;
  const backupType = options.backupType ?? BackupType.MANUAL;
  const deviceId = options.deviceId || getDeviceId();
  const appVersion = options.appVersion || APP_VERSION;
  const metadata: BackupMetadata = {
    version: CURRENT_BACKUP_VERSION,
    schemaVersion: localDb.verno,
    databaseVersion: localDb.verno,
    appVersion,
    buildVersion: appVersion,
    createdAt: data.createdAt,
    createdBy: options.createdBy || 'local',
    deviceId,
    recordCount: Object.values(data.tables).reduce(
      (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
      0,
    ),
    backupType,
    destination,
    checksumScope: 'document-v1',
  };

  const unsigned: Omit<BackupEnvelope, 'checksum'> = {
    metadata,
    data,
    version: CURRENT_BACKUP_VERSION,
    databaseVersion: localDb.verno,
    createdAt: data.createdAt,
    deviceId,
    appVersion,
  };
  const checksum = await computeChecksum(getBackupChecksumInput(unsigned));
  return {
    metadata: unsigned.metadata,
    checksum,
    data: unsigned.data,
    version: unsigned.version,
    databaseVersion: unsigned.databaseVersion,
    createdAt: unsigned.createdAt,
    deviceId: unsigned.deviceId,
    appVersion: unsigned.appVersion,
  };
}

// Replaces only tables explicitly present as arrays. Missing tables from V2-V5
// remain intact, while present empty arrays intentionally clear their table.
export async function restoreBackupTables(data: LegacyBackupData): Promise<void> {
  const presentTables = BACKUP_TABLE_NAMES.filter(
    (name): name is BackupTableName => Array.isArray(data.tables[name]),
  );
  if (presentTables.length === 0) return;

  const dexieTables = presentTables.map(name => localDb.table(name));
  await localDb.transaction('rw', dexieTables, async () => {
    for (const name of presentTables) await localDb.table(name).clear();
    for (const name of presentTables) {
      const rows = data.tables[name] || [];
      if (rows.length > 0) await localDb.table(name).bulkPut(rows);
    }
  });
}

// Compatibility entry point retained for old callers. It now uses the same
// normalizer and atomic restore implementation as BackupManager.
export async function importAllData(source: BackupEnvelope | LegacyBackupData): Promise<void> {
  const envelope = normalizeBackupSource(source);
  await restoreBackupTables(envelope.data);
}

function parseBackupText(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no contiene JSON válido');
  }
  // Recognizable raw/envelope shape is checked here; detailed integrity and
  // version validation remains in BackupManager.validateBackup().
  normalizeBackupSource(parsed);
  return parsed;
}

// ── File System Access API ──
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined'
    && 'showDirectoryPicker' in window
    && 'showOpenFilePicker' in window;
}

export async function saveToFolder(): Promise<string> {
  const envelope = await buildBackupEnvelope({ destination: BackupDestination.USB });
  return writeBackupDataToFolder(envelope);
}

export async function readFromFolder(): Promise<unknown> {
  const [fileHandle] = await (window as any).showOpenFilePicker({
    types: [{ description: 'Respaldo JoyaControl', accept: { 'application/json': ['.json', '.jcb'] } }],
  });
  const file = await fileHandle.getFile();
  return parseBackupText(await file.text());
}

export function downloadBackupFile(payload: unknown): void {
  const envelope = normalizeBackupSource(payload);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const timestamp = envelope.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  anchor.href = url;
  anchor.download = `JoyaControl-backup-V${envelope.version}-${timestamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFromFile(file: File): Promise<unknown> {
  return parseBackupText(await file.text());
}

export function isOPFSSupported(): boolean {
  return typeof navigator !== 'undefined'
    && 'storage' in navigator
    && !!navigator.storage
    && 'getDirectory' in navigator.storage;
}

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOPFSSupported()) throw new Error('OPFS no soportado en este navegador');
  return (navigator.storage as any).getDirectory();
}

async function listOPFSBackupCandidates(): Promise<Array<{ handle: FileSystemFileHandle; fileName: string; file: File }>> {
  const root = await getOPFSRoot();
  const candidates: Array<{ handle: FileSystemFileHandle; fileName: string; file: File }> = [];

  for (const fileName of OPFS_BACKUP_FILENAMES) {
    try {
      const handle = await root.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      candidates.push({ handle, fileName, file });
    } catch {
      // Missing legacy/current slot is expected.
    }
  }

  return candidates.sort((a, b) => b.file.lastModified - a.file.lastModified);
}

async function findValidOPFSBackup(): Promise<{ handle: FileSystemFileHandle; fileName: string; file: File; payload: unknown } | null> {
  let lastError: unknown = null;
  for (const candidate of await listOPFSBackupCandidates()) {
    try {
      const payload = parseBackupText(await candidate.file.text());
      return { ...candidate, payload };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function getPrimaryOPFSFileHandle(create = false): Promise<FileSystemFileHandle> {
  const root = await getOPFSRoot();
  return root.getFileHandle(PRIMARY_OPFS_BACKUP_FILENAME, { create });
}

export async function saveToOPFS(): Promise<void> {
  const envelope = await buildBackupEnvelope({ destination: BackupDestination.LOCAL });
  await writeBackupDataToOPFS(envelope);
}

// Reads both the current joyacontrol-backup.json slot and the historical
// JoyaControl-autosave.json slot, selecting the most recently modified valid
// file. Detailed validation is performed by BackupManager before restore.
export async function readFromOPFS(): Promise<unknown> {
  const candidate = await findValidOPFSBackup();
  if (!candidate) throw new Error('No hay respaldo interno guardado.');
  return candidate.payload;
}

export async function getOPFSBackupInfo(): Promise<{ date: string; sizeKB: number; fileName: string } | null> {
  if (!isOPFSSupported()) return null;
  try {
    const candidate = await findValidOPFSBackup();
    if (!candidate) return null;
    return {
      date: new Date(candidate.file.lastModified).toLocaleString(),
      sizeKB: Math.round((candidate.file.size / 1024) * 10) / 10,
      fileName: candidate.fileName,
    };
  } catch {
    return null;
  }
}

export async function writeBackupDataToOPFS(payload: unknown): Promise<void> {
  normalizeBackupSource(payload);
  const handle = await getPrimaryOPFSFileHandle(true);
  const writable = await (handle as any).createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

export async function deleteOPFSBackup(): Promise<void> {
  if (!isOPFSSupported()) return;
  try {
    const root = await getOPFSRoot();
    for (const fileName of OPFS_BACKUP_FILENAMES) {
      try {
        await (root as any).removeEntry(fileName);
      } catch {
        // Idempotent when a slot does not exist.
      }
    }
  } catch {
    // No-op when OPFS becomes unavailable.
  }
}

export async function writeBackupDataToFolder(payload: unknown): Promise<string> {
  const envelope = normalizeBackupSource(payload);
  const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  const timestamp = envelope.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `JoyaControl-backup-V${envelope.version}-${timestamp}.json`;
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
  return fileName;
}
