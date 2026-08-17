import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const BACKUP_ROOT_DIRECTORY = 'JOYACONTROL BACKUPS';
export const BACKUP_CATEGORY_DIRECTORIES = Object.freeze({
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
  RESTORE_POINTS: 'RESTORE POINTS',
});

const STATE_FILENAME = 'joyacontrol-backup-runtime.json';
const AUTO_RETENTION_DAYS = 30;
const AUTO_RETENTION_LIMIT = 100;
const VALID_CATEGORY = new Set(Object.keys(BACKUP_CATEGORY_DIRECTORIES));

function asIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function formatBackupTimestamp(value) {
  const date = new Date(asIsoDate(value));
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function categoryFilenamePrefix(category) {
  if (category === 'AUTO') return 'joyacontrol_auto';
  if (category === 'MANUAL') return 'joyacontrol_manual';
  return 'joyacontrol_restore';
}

export function buildBackupFilename(category, createdAt) {
  if (!VALID_CATEGORY.has(category)) throw new Error(`BACKUP_CATEGORY_INVALID:${category}`);
  return `${categoryFilenamePrefix(category)}_${formatBackupTimestamp(createdAt)}.jcb`;
}

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function defaultRuntimeState() {
  return {
    configuredFolder: '',
    external: {
      status: 'not-configured',
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorAt: null,
      lastError: null,
      lastFilePath: null,
      lastChecksum: null,
      lastSize: 0,
    },
  };
}

function normalizeRuntimeState(value) {
  const fallback = defaultRuntimeState();
  if (!value || typeof value !== 'object') return fallback;
  const external = value.external && typeof value.external === 'object' ? value.external : {};
  return {
    configuredFolder: typeof value.configuredFolder === 'string' ? value.configuredFolder : '',
    external: {
      ...fallback.external,
      ...external,
      lastSize: Number.isFinite(Number(external.lastSize)) ? Number(external.lastSize) : 0,
    },
  };
}

function describeFsError(error, baseFolder) {
  const code = String(error?.code || 'BACKUP_EXTERNAL_WRITE_FAILED');
  if (code === 'ENOENT') {
    return { code: 'BACKUP_PATH_NOT_FOUND', message: `Ruta no encontrada: ${baseFolder}. Seleccione una nueva carpeta.` };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'BACKUP_PERMISSION_DENIED', message: `Permisos insuficientes para guardar en: ${baseFolder}.` };
  }
  if (code === 'ENOSPC') {
    return { code: 'BACKUP_DISK_FULL', message: `No hay espacio disponible en: ${baseFolder}.` };
  }
  if (code === 'EROFS') {
    return { code: 'BACKUP_READ_ONLY', message: `La ubicación es de solo lectura: ${baseFolder}.` };
  }
  if (code === 'ENOTDIR') {
    return { code: 'BACKUP_PATH_INVALID', message: `La ruta configurada no corresponde a una carpeta: ${baseFolder}.` };
  }
  if (code === 'EIO' || code === 'ENODEV') {
    return { code: 'BACKUP_DEVICE_UNAVAILABLE', message: `El disco o dispositivo no está disponible: ${baseFolder}.` };
  }
  if (code === 'ENETUNREACH' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return { code: 'BACKUP_NETWORK_UNAVAILABLE', message: `La ruta de red no está disponible: ${baseFolder}.` };
  }
  return {
    code,
    message: error instanceof Error ? error.message : 'No fue posible guardar la copia automática.',
  };
}

async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function assertDirectoryExists(baseFolder) {
  const stats = await fs.stat(baseFolder);
  if (!stats.isDirectory()) {
    const error = new Error(`La ruta configurada no es una carpeta: ${baseFolder}`);
    error.code = 'ENOTDIR';
    throw error;
  }
}

async function assertDirectoryWritable(baseFolder) {
  await assertDirectoryExists(baseFolder);
  await fs.access(baseFolder, fsConstants.R_OK | fsConstants.W_OK);

  const probePath = path.join(
    baseFolder,
    `.joyacontrol-write-probe-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  let probeHandle = null;
  try {
    probeHandle = await fs.open(probePath, 'wx', 0o600);
    await probeHandle.writeFile('JoyaControl backup path validation', 'utf8');
    await probeHandle.sync();
  } finally {
    await probeHandle?.close().catch(() => undefined);
    await fs.rm(probePath, { force: true }).catch(() => undefined);
  }
}

async function ensureBackupDirectories(baseFolder) {
  const rootPath = path.join(baseFolder, BACKUP_ROOT_DIRECTORY);
  await fs.mkdir(rootPath, { recursive: true });
  await Promise.all(Object.values(BACKUP_CATEGORY_DIRECTORIES).map(directory => (
    fs.mkdir(path.join(rootPath, directory), { recursive: true })
  )));
  return rootPath;
}

async function resolveAvailableBackupPath(categoryPath, category, createdAt) {
  const baseTime = new Date(asIsoDate(createdAt)).getTime();
  for (let offsetSeconds = 0; offsetSeconds < 1000; offsetSeconds += 1) {
    const candidateDate = new Date(baseTime + offsetSeconds * 1000).toISOString();
    const fileName = buildBackupFilename(category, candidateDate);
    const filePath = path.join(categoryPath, fileName);
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return { fileName, filePath };
      throw error;
    }
  }
  throw new Error('No fue posible asignar un nombre único al respaldo.');
}

export async function enforceAutomaticRetention(autoDirectory, now = Date.now()) {
  let entries;
  try {
    entries = await fs.readdir(autoDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: [] };
    throw error;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^joyacontrol_auto_.*\.jcb$/i.test(entry.name)) continue;
    const filePath = path.join(autoDirectory, entry.name);
    const stats = await fs.stat(filePath);
    candidates.push({ filePath, mtimeMs: stats.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const cutoff = now - AUTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toDelete = candidates.filter((entry, index) => index >= AUTO_RETENTION_LIMIT || entry.mtimeMs < cutoff);
  for (const entry of toDelete) await fs.unlink(entry.filePath).catch(() => undefined);
  return { deleted: toDelete.map(entry => entry.filePath) };
}

export class BackupFileService {
  constructor({ userDataPath }) {
    if (!userDataPath) throw new Error('BACKUP_USER_DATA_PATH_REQUIRED');
    this.userDataPath = userDataPath;
    this.statePath = path.join(userDataPath, STATE_FILENAME);
    this.state = defaultRuntimeState();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.getStatus();
    this.initialized = true;
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      this.state = normalizeRuntimeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('[Backup] No fue posible leer el estado persistente:', error);
    }
    return this.getStatus();
  }

  getStatus() {
    const configuredFolder = this.state.configuredFolder || '';
    return {
      configuredFolder,
      rootPath: configuredFolder ? path.join(configuredFolder, BACKUP_ROOT_DIRECTORY) : '',
      external: { ...this.state.external },
    };
  }

  async persistState() {
    await atomicWriteJson(this.statePath, this.state);
  }

  async setConfiguredFolder(baseFolder) {
    const normalized = String(baseFolder || '').trim();
    const previousState = this.state;

    try {
      if (normalized) {
        await assertDirectoryWritable(normalized);
        await ensureBackupDirectories(normalized);
      }
    } catch (error) {
      const described = describeFsError(error, normalized || '(sin configurar)');
      const failure = new Error(described.message);
      failure.code = described.code;
      throw failure;
    }

    this.state = {
      configuredFolder: normalized,
      external: {
        ...previousState.external,
        status: normalized ? 'ready' : 'not-configured',
        lastError: null,
        lastErrorAt: null,
      },
    };

    try {
      await this.persistState();
    } catch (error) {
      this.state = previousState;
      throw error;
    }
    return this.getStatus();
  }

  async validateFolder(baseFolder = this.state.configuredFolder) {
    const normalized = String(baseFolder || '').trim();
    if (!normalized) return { ok: false, code: 'BACKUP_FOLDER_NOT_CONFIGURED', message: 'Seleccione una carpeta para las copias externas.' };
    try {
      await assertDirectoryWritable(normalized);
      return { ok: true, baseFolder: normalized, rootPath: path.join(normalized, BACKUP_ROOT_DIRECTORY) };
    } catch (error) {
      const described = describeFsError(error, normalized);
      return { ok: false, ...described };
    }
  }

  async writeBackup({ baseFolder, category, createdAt, content, expectedSha256 }) {
    const normalizedFolder = String(baseFolder || this.state.configuredFolder || '').trim();
    const attemptAt = new Date().toISOString();
    this.state.external.lastAttemptAt = attemptAt;

    try {
      if (!VALID_CATEGORY.has(category)) throw new Error(`BACKUP_CATEGORY_INVALID:${category}`);
      if (!normalizedFolder) {
        const missing = new Error('Seleccione una carpeta para las copias externas.');
        missing.code = 'BACKUP_FOLDER_NOT_CONFIGURED';
        throw missing;
      }
      await assertDirectoryExists(normalizedFolder);
      if (typeof content !== 'string' || content.length === 0) throw new Error('El contenido del respaldo está vacío.');

      const parsed = JSON.parse(content);
      if (parsed?.data?.appName !== 'JoyaControl') throw new Error('El archivo no contiene un respaldo de JoyaControl.');
      const inputChecksum = sha256Buffer(Buffer.from(content, 'utf8'));
      if (expectedSha256 && inputChecksum !== expectedSha256) throw new Error('El checksum SHA-256 previo a la escritura no coincide.');

      const rootPath = await ensureBackupDirectories(normalizedFolder);
      const categoryPath = path.join(rootPath, BACKUP_CATEGORY_DIRECTORIES[category]);
      const { fileName, filePath } = await resolveAvailableBackupPath(categoryPath, category, createdAt);
      const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

      try {
        await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tempPath, filePath);
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }

      const written = await fs.readFile(filePath);
      if (written.byteLength <= 0) throw new Error('El archivo creado está vacío.');
      JSON.parse(written.toString('utf8'));
      const writtenChecksum = sha256Buffer(written);
      if (writtenChecksum !== inputChecksum) throw new Error('El checksum SHA-256 del archivo escrito no coincide.');

      if (category === 'AUTO') await enforceAutomaticRetention(categoryPath);

      this.state.configuredFolder = normalizedFolder;
      this.state.external = {
        status: 'success',
        lastSuccessAt: attemptAt,
        lastAttemptAt: attemptAt,
        lastErrorAt: null,
        lastError: null,
        lastFilePath: filePath,
        lastChecksum: writtenChecksum,
        lastSize: written.byteLength,
      };
      await this.persistState();

      return {
        ok: true,
        category,
        rootPath,
        directoryPath: categoryPath,
        filePath,
        fileName,
        size: written.byteLength,
        checksum: writtenChecksum,
        createdAt: attemptAt,
      };
    } catch (error) {
      const described = describeFsError(error, normalizedFolder || '(sin configurar)');
      this.state.configuredFolder = normalizedFolder;
      this.state.external = {
        ...this.state.external,
        status: 'error',
        lastAttemptAt: attemptAt,
        lastErrorAt: attemptAt,
        lastError: described.message,
      };
      await this.persistState().catch(stateError => console.error('[Backup] No fue posible persistir el error:', stateError));
      const failure = new Error(described.message);
      failure.code = described.code;
      throw failure;
    }
  }
}
