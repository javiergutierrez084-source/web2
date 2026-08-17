import {
  buildBackupEnvelope, downloadBackupFile, readBackupFromFile,
  isOPFSSupported as opfsApiSupported, isFileSystemAccessSupported as fsApiSupported,
  restoreBackupTables,
  type LegacyBackupData,
} from './backup';
import { verifyChecksum } from './checksum';
import { requirePermission } from '@/lib/authCore';
import {
  insertBackupHistoryEntry, fetchBackupHistory, deleteBackupHistoryEntry, clearBackupHistory,
  fetchSystemSettings, saveSystemSettings,
} from './database';
import { localDb } from './localDb';
import { LocalBackupProvider } from './LocalBackupProvider';
import { UsbBackupProvider } from './UsbBackupProvider';
import type { IBackupProvider } from './IBackupProvider';
import {
  BACKUP_TABLE_NAMES, CURRENT_BACKUP_VERSION, MIN_SUPPORTED_BACKUP_VERSION,
  BackupDestination, BackupType, getBackupChecksumInput, normalizeBackupSource,
  countBackupRecords,
  type BackupEnvelope, type BackupHistory,
  type BackupSettings, type BackupValidationResult, type BackupInfo,
} from '@/types/backup';

export type { BackupEnvelope } from '@/types/backup';

export interface RestoreBackupOptions {
  skipPreRestore?: boolean;
}

const DEFAULT_SETTINGS: BackupSettings = {
  backupEnabled: true,
  backupInterval: '15m',
  backupHour: 22,
  backupFolder: '',
  maxBackups: 100,
  deleteOldBackups: true,
  verifyChecksum: true,
  backupBeforeRestore: true,
  backupOnStartup: false,
  backupOnExit: true,
  backupOnImport: false,
  compressionEnabled: false,
  defaultDestination: BackupDestination.LOCAL,
};

const DEVICE_ID_KEY = 'joyacontrol_device_id';

function getDeviceId(): string {
  let id: string | null = null;
  try { id = localStorage.getItem(DEVICE_ID_KEY); } catch { /* localStorage unavailable */ }
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* best-effort persistence only */ }
  }
  return id;
}

class BackupManagerImpl {
  // Provider registry: the ONLY place that maps a BackupDestination to its
  // IBackupProvider implementation. createBackup()/restoreBackup() below never
  // branch on destination-specific I/O themselves — they just look up a
  // provider here and call the interface methods. Adding LanBackupProvider,
  // NasBackupProvider, or CloudBackupProvider later means implementing
  // IBackupProvider and adding one line here — nothing else in this file
  // changes. NETWORK/SERVER/NAS/CLOUD are intentionally absent for now (no
  // provider registered = "not implemented yet", handled explicitly below).
  private readonly providers: Partial<Record<BackupDestination, IBackupProvider>> = {
    [BackupDestination.LOCAL]: new LocalBackupProvider(),
    [BackupDestination.USB]: new UsbBackupProvider(),
  };

  private getProvider(destination: BackupDestination): IBackupProvider {
    const provider = this.providers[destination];
    if (!provider) {
      throw new Error(`El destino "${destination}" todavía no está implementado.`);
    }
    return provider;
  }

  // ── Concurrency guard (Fase 1.2) ──
  // A real logic-level lock, independent of anything the UI does. Only one of
  // createBackup/restoreBackup/importBackup/exportBackup/downloadBackup can run
  // at a time, from any caller. If a second one is attempted while the first is
  // still running, it fails immediately with a clear, catchable error instead
  // of silently racing against it.
  //
  // Internal composition (e.g. restoreBackup building a pre-restore snapshot)
  // goes through buildEnvelope() directly, NOT through the public locked
  // exportBackup()/createBackup() methods — so an operation that legitimately
  // calls into another internally never deadlocks against its own lock.
  private operationInProgress = false;

  private async withLock<T>(label: string, operation: () => Promise<T>): Promise<T> {
    if (this.operationInProgress) {
      throw new Error(`No se puede ${label}: ya hay otra operación de respaldo en curso. Espera a que termine.`);
    }
    this.operationInProgress = true;
    try {
      return await operation();
    } finally {
      this.operationInProgress = false;
    }
  }

  isBusy(): boolean {
    return this.operationInProgress;
  }

  // ── Settings ──
  async loadSettings(): Promise<BackupSettings> {
    const stored = await fetchSystemSettings();
    return stored ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: BackupSettings): Promise<void> {
    await requirePermission('manage_backup');
    await saveSystemSettings(settings);
  }

  // ── History ──
  async listHistory(limit = 20): Promise<BackupHistory[]> {
    return fetchBackupHistory(limit);
  }

  async clearHistory(): Promise<void> {
    await requirePermission('manage_backup');
    await clearBackupHistory();
  }

  private async logHistory(entry: BackupHistory): Promise<void> {
    await insertBackupHistoryEntry(entry);
  }

  // ── Validation — never throws, always returns a result ──
  async validateBackup(source: BackupEnvelope | LegacyBackupData | unknown): Promise<BackupValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    let envelope: BackupEnvelope;

    try {
      envelope = normalizeBackupSource(source);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'El archivo no contiene un respaldo válido.');
      return { valid: false, warnings, errors, metadata: null };
    }

    try {
      const { data, metadata, checksum } = envelope;
      const isLegacy = metadata.schemaVersion === 0 && metadata.checksumScope === 'none';

      if (data.appName !== 'JoyaControl') errors.push('El respaldo no pertenece a JoyaControl.');
      if (!Number.isInteger(envelope.version)) errors.push('La versión del respaldo es inválida.');
      if (!Number.isInteger(envelope.databaseVersion)) errors.push('La versión de base de datos es inválida.');
      if (envelope.version < MIN_SUPPORTED_BACKUP_VERSION) {
        errors.push(`La versión V${envelope.version} ya no es compatible. La versión mínima admitida es V${MIN_SUPPORTED_BACKUP_VERSION}.`);
      }
      if (envelope.version > CURRENT_BACKUP_VERSION) {
        errors.push(`El respaldo V${envelope.version} fue creado por una versión futura y no puede restaurarse de forma segura.`);
      }
      if (envelope.databaseVersion > localDb.verno) {
        errors.push(`El esquema Dexie V${envelope.databaseVersion} es más reciente que el esquema V${localDb.verno} instalado.`);
      }
      if (envelope.databaseVersion < MIN_SUPPORTED_BACKUP_VERSION) {
        errors.push('El respaldo no indica una versión de base de datos compatible.');
      }

      if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) {
        errors.push('El respaldo no contiene un objeto de tablas válido.');
      } else {
        for (const table of BACKUP_TABLE_NAMES) {
          const value = data.tables[table];
          if (value === undefined) {
            warnings.push(`La tabla "${table}" no está presente; los datos actuales de esa tabla se conservarán.`);
          } else if (!Array.isArray(value)) {
            errors.push(`La tabla "${table}" tiene un formato inválido; debe ser un arreglo.`);
          }
        }
        for (const table of Object.keys(data.tables)) {
          if (!(BACKUP_TABLE_NAMES as readonly string[]).includes(table)) {
            warnings.push(`La tabla desconocida "${table}" se conservará en el archivo pero esta versión no la restaurará.`);
          }
        }
      }

      const createdAtTime = Date.parse(envelope.createdAt);
      if (!envelope.createdAt || Number.isNaN(createdAtTime)) errors.push('La fecha createdAt es inválida o está ausente.');

      if (isLegacy) {
        warnings.push(`Respaldo heredado V${data.version}: no contiene envelope ni checksum. Se restaurarán únicamente las tablas presentes.`);
      } else {
        if (!metadata.version) errors.push('metadata.version está ausente.');
        if (!metadata.databaseVersion) errors.push('metadata.databaseVersion está ausente.');
        if (!metadata.createdAt) errors.push('metadata.createdAt está ausente.');
        if (!metadata.deviceId) errors.push('metadata.deviceId está ausente.');
        if (!metadata.appVersion) errors.push('metadata.appVersion está ausente.');
        if (!metadata.createdBy) errors.push('metadata.createdBy está ausente.');
        if (metadata.recordCount < 0) errors.push('metadata.recordCount está ausente o es inválido.');

        if (envelope.version !== metadata.version) errors.push('version no coincide con metadata.version.');
        if (envelope.version !== data.version) errors.push('version no coincide con data.version.');
        if (envelope.databaseVersion !== metadata.databaseVersion) errors.push('databaseVersion no coincide con metadata.databaseVersion.');
        if (metadata.schemaVersion !== envelope.databaseVersion) errors.push('metadata.schemaVersion no coincide con databaseVersion.');
        if (envelope.createdAt !== metadata.createdAt) errors.push('createdAt no coincide con metadata.createdAt.');
        if (envelope.createdAt !== data.createdAt) errors.push('createdAt no coincide con data.createdAt.');
        if (envelope.deviceId !== metadata.deviceId) errors.push('deviceId no coincide con metadata.deviceId.');
        if (envelope.appVersion !== metadata.appVersion) errors.push('appVersion no coincide con metadata.appVersion.');

        const actualRecordCount = countBackupRecords(data);
        if (metadata.recordCount !== actualRecordCount) {
          errors.push(`metadata.recordCount (${metadata.recordCount}) no coincide con los ${actualRecordCount} registros del archivo.`);
        }

        if (envelope.version !== envelope.databaseVersion) {
          warnings.push(`El formato de respaldo es V${envelope.version} y el esquema Dexie es V${envelope.databaseVersion}; se aplicará compatibilidad por tablas presentes.`);
        }

        if (!checksum) {
          errors.push('El envelope no incluye checksum.');
        } else if (!/^[a-f0-9]{64}$/i.test(checksum)) {
          errors.push('El checksum no tiene un formato SHA-256 válido.');
        } else {
          let checksumTarget: unknown;
          if (metadata.checksumScope === 'document-v1') checksumTarget = getBackupChecksumInput(envelope);
          else if (metadata.checksumScope === 'data-v1') checksumTarget = data;
          else {
            errors.push(`El alcance de checksum "${metadata.checksumScope}" no es válido para un envelope moderno.`);
            checksumTarget = null;
          }
          if (checksumTarget !== null && !(await verifyChecksum(checksumTarget, checksum))) {
            errors.push('El checksum no coincide. El archivo pudo haberse corrompido o modificado.');
          }
        }
      }

      return { valid: errors.length === 0, warnings, errors, metadata };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Error inesperado validando el respaldo.');
      return { valid: false, warnings, errors, metadata: envelope.metadata ?? null };
    }
  }

  // ── Internal, unlocked: builds the one canonical V6 envelope ──
  private async buildEnvelope(
    destination: BackupDestination,
    backupType: BackupType = BackupType.MANUAL,
  ): Promise<BackupEnvelope> {
    return buildBackupEnvelope({ destination, backupType, createdBy: 'local' });
  }

  // ── Public: build a fresh envelope from current data (no write, no history log) ──
  async exportBackup(destination: BackupDestination = BackupDestination.LOCAL): Promise<BackupEnvelope> {
    await requirePermission('manage_backup');
    return this.withLock('exportar', () => this.buildEnvelope(destination));
  }

  // ── Create + persist + log + rotate ──
  async createBackup(
    type: BackupType = BackupType.MANUAL,
    destination: BackupDestination = BackupDestination.LOCAL,
  ): Promise<BackupEnvelope> {
    await requirePermission('manage_backup');
    return this.withLock('crear el respaldo', async () => {
      const envelope = await this.buildEnvelope(destination, type);

      try {
        const provider = this.getProvider(destination);
        await provider.save(envelope);

        if (destination === BackupDestination.LOCAL) {
          const storedEnvelope = await provider.load();
          if (!storedEnvelope) throw new Error('El respaldo interno no pudo leerse después de guardarse.');
          const storedSize = new TextEncoder().encode(JSON.stringify(storedEnvelope)).byteLength;
          if (storedSize <= 0) throw new Error('El respaldo interno creado está vacío.');
          const storedValidation = await this.validateBackup(storedEnvelope);
          if (!storedValidation.valid) {
            throw new Error(`El respaldo interno no superó la validación: ${storedValidation.errors.join('; ')}`);
          }
        }

        await this.logHistory({
          id: crypto.randomUUID(), date: envelope.metadata.createdAt, type,
          destination, size: JSON.stringify(envelope).length, status: 'success',
          version: envelope.metadata.version, createdBy: envelope.metadata.createdBy,
          deviceId: envelope.metadata.deviceId,
        });
      } catch (err) {
        await this.logHistory({
          id: crypto.randomUUID(), date: new Date().toISOString(), type,
          destination, size: 0, status: 'failed',
          version: envelope.metadata.version, createdBy: envelope.metadata.createdBy,
          deviceId: envelope.metadata.deviceId,
          notes: err instanceof Error ? err.message : 'Error desconocido',
        });
        throw err;
      }

      await this.rotateBackups();
      return envelope;
    });
  }

  // Convenience wrapper for a plain file download (Downloads folder), the one
  // save path that isn't really a "destination" in the LAN-prep sense — it's a
  // one-off export, not a place we later read back from. Still logged to
  // history like every other save path. Downloads the full envelope, same as
  // every other destination, so a downloaded file restores with real checksum
  // verification if it's ever re-imported.
  async downloadBackup(): Promise<BackupEnvelope> {
    await requirePermission('manage_backup');
    return this.withLock('descargar el respaldo', async () => {
      const envelope = await this.buildEnvelope(BackupDestination.LOCAL);
      downloadBackupFile(envelope);
      await this.logHistory({
        id: crypto.randomUUID(), date: envelope.metadata.createdAt, type: BackupType.MANUAL,
        destination: BackupDestination.LOCAL, size: JSON.stringify(envelope).length,
        status: 'success', version: envelope.metadata.version, createdBy: envelope.metadata.createdBy,
        deviceId: envelope.metadata.deviceId, notes: 'Descarga manual de archivo',
      });
      return envelope;
    });
  }

  // ── Import from a file or a folder picker (read + normalize only) ──
  async importBackup(source?: File): Promise<BackupEnvelope> {
    await requirePermission('manage_backup');
    return this.withLock('importar el respaldo', async () => {
      if (source) return normalizeBackupSource(await readBackupFromFile(source));
      const loaded = await this.getProvider(BackupDestination.USB).load();
      if (!loaded) throw new Error('No se encontró un respaldo para importar.');
      return loaded;
    });
  }

  // ── Restore: validate → optional safety backup → one atomic table restore ──
  async restoreBackup(source?: BackupEnvelope | LegacyBackupData | unknown, options: RestoreBackupOptions = {}): Promise<void> {
    await requirePermission('manage_backup');
    return this.withLock('restaurar', async () => {
      let envelope: BackupEnvelope;
      if (source !== undefined) {
        envelope = normalizeBackupSource(source);
      } else {
        const local = await this.getProvider(BackupDestination.LOCAL).load();
        if (!local) throw new Error('No hay respaldo interno guardado para restaurar.');
        envelope = local;
      }

      const validation = await this.validateBackup(envelope);
      if (!validation.valid) {
        try {
          await this.logHistory({
            id: crypto.randomUUID(), date: new Date().toISOString(), type: 'validation_failed',
            destination: BackupDestination.LOCAL, size: 0, status: 'failed',
            version: envelope.version || 0, createdBy: 'local', deviceId: getDeviceId(),
            notes: validation.errors.join('; '),
          });
        } catch {
          // A validation failure must still be reported even if history logging fails.
        }
        throw new Error(`Respaldo inválido: ${validation.errors.join('; ')}`);
      }

      const settings = await this.loadSettings();
      if (settings.backupBeforeRestore && !options.skipPreRestore) {
        try {
          const preEnvelope = await this.buildEnvelope(BackupDestination.LOCAL, BackupType.PRE_RESTORE);
          downloadBackupFile(preEnvelope);
          await this.logHistory({
            id: crypto.randomUUID(), date: preEnvelope.createdAt, type: BackupType.PRE_RESTORE,
            destination: BackupDestination.LOCAL, size: JSON.stringify(preEnvelope).length, status: 'success',
            version: preEnvelope.version, createdBy: preEnvelope.metadata.createdBy,
            deviceId: preEnvelope.deviceId, notes: 'Respaldo automático previo a restauración',
          });
        } catch (err) {
          try {
            await this.logHistory({
              id: crypto.randomUUID(), date: new Date().toISOString(), type: BackupType.PRE_RESTORE,
              destination: BackupDestination.LOCAL, size: 0, status: 'failed',
              version: envelope.version, createdBy: 'local', deviceId: getDeviceId(),
              notes: `No se pudo crear el respaldo previo a la restauración: ${err instanceof Error ? err.message : 'error desconocido'}`,
            });
          } catch {
            // Best-effort audit only; restoration remains independently atomic.
          }
        }
      }

      try {
        // restoreBackupTables() clears and repopulates only tables that are
        // actually present in the file, all inside one Dexie transaction.
        await restoreBackupTables(envelope.data);
      } catch (err) {
        try {
          await this.logHistory({
            id: crypto.randomUUID(), date: new Date().toISOString(), type: 'restore_failed',
            destination: BackupDestination.LOCAL, size: 0, status: 'failed',
            version: envelope.version, createdBy: 'local', deviceId: getDeviceId(),
            notes: err instanceof Error ? err.message : 'Error desconocido',
          });
        } catch {
          // The business-table rollback already occurred inside IndexedDB.
        }
        throw err;
      }

      // Logging is intentionally after the committed restore. If backup_history
      // was present, it was replaced first and this new event is appended. A
      // logging failure must not falsely report that the atomic restore failed.
      try {
        await this.logHistory({
          id: crypto.randomUUID(), date: new Date().toISOString(), type: 'restore',
          destination: BackupDestination.LOCAL, size: JSON.stringify(envelope).length, status: 'success',
          version: envelope.version, createdBy: 'local', deviceId: getDeviceId(),
        });
      } catch (err) {
        console.warn('[BackupManager] Restore completed, but history logging failed:', err);
      }
    });
  }

  // ── Rotation: delete oldest successful backups beyond maxBackups, never the newest ──
  // NOTE: this rotates entries in the backup_history log only. It does not (and
  // currently cannot) delete actual files from OPFS's single slot or from a
  // user-chosen folder — real multi-file rotation needs the multi-slot storage
  // work planned for the LAN/NAS providers. Not lock-guarded: it's called
  // internally by createBackup() (already holding the lock) and only touches
  // backup_history, never business data.
  async rotateBackups(): Promise<void> {
    await requirePermission('manage_backup');
    const settings = await this.loadSettings();
    if (!settings.deleteOldBackups) return;

    const history = await fetchBackupHistory(1000);
    // La rotación automática nunca elimina registros manuales ni puntos de
    // restauración. Solo limita el historial generado por el programador.
    const successfulCreations = history
      .filter(h => h.status === 'success' && h.type === BackupType.AUTOMATIC)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (successfulCreations.length <= Math.max(settings.maxBackups, 1)) return;

    const toDelete = successfulCreations.slice(Math.max(settings.maxBackups, 1));
    for (const entry of toDelete) {
      await deleteBackupHistoryEntry(entry.id);
    }
  }

  // ── Status ──
  async getLastBackup(): Promise<BackupHistory | null> {
    const history = await fetchBackupHistory(1);
    return history[0] ?? null;
  }

  async getBackupInfo(): Promise<BackupInfo | null> {
    const list = await this.getProvider(BackupDestination.LOCAL).list();
    return list[0] ?? null;
  }

  async getDatabaseVersion(): Promise<number> {
    return localDb.verno;
  }

  // ── Capability checks — thin pass-throughs so the UI never imports backup.ts directly ──
  isOPFSSupported(): boolean {
    return opfsApiSupported();
  }

  isFileSystemAccessSupported(): boolean {
    return fsApiSupported();
  }

  // Reads the internal (OPFS) backup without restoring it — used to populate the
  // confirmation dialog before the user commits to "Restaurar desde interno".
  // Read-only, not lock-guarded (doesn't touch business data or write anything).
  async peekLocalBackup(): Promise<BackupEnvelope | null> {
    return this.getProvider(BackupDestination.LOCAL).load();
  }
}

// Single shared instance — this is the only object the UI (or anything else)
// should ever import from the Backup V2 module.
export const BackupManager = new BackupManagerImpl();
