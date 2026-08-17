import { lanFetch, readLanJson } from '@/lib/LanFetchDiagnostics';
import { isValidLanIpv4, LanServerDescriptor, type LanServerDescriptorData } from '@/lib/LanServerDescriptor';

export type LanMode = 'local' | 'lan';
export type LanRole = 'server' | 'client';
export type LanConnectionState = 'disconnected' | 'connecting' | 'connected';
export type LanLogLevel = 'debug' | 'info' | 'error';

export interface LanConnectedDevice {
  clientId: string;
  machineId: string;
  name: string;
  ip: string;
  hostname: string;
  version: string;
  registeredAt: string;
  connectedAt: string;
  lastActivity: string;
  lastHeartbeat: string | null;
  currentLatencyMs: number | null;
  averageLatencyMs: number | null;
  activityCount: number;
  operatingSystem: string;
  createdAt?: string;
  expiresAt?: string;
  rememberDevice?: boolean;
  status: 'connected' | 'inactive' | 'disconnected' | 'expired';
}

export type LanDeviceMaintenanceAction = 'remove-disconnected' | 'remove-older-than' | 'remove-client';

export interface LanDeviceMaintenanceActor {
  userId: string;
  username: string;
  displayName: string;
  role: string;
}

export interface LanDeviceMaintenanceRequest {
  action: LanDeviceMaintenanceAction;
  clientId?: string;
  days?: 30 | 60 | 90 | 180;
  actor: LanDeviceMaintenanceActor;
}

export interface LanDeviceMaintenanceResult {
  success: boolean;
  action: LanDeviceMaintenanceAction;
  removedCount: number;
  removed: Array<LanConnectedDevice & { removedSessions: number }>;
  registeredClients: number;
  connectedClients: number;
}

export interface LanCommunicationConfig {
  mode: LanMode;
  role: LanRole;
  deviceName: string;
  sharedKey: string;
  timeoutMs: number;
  automaticRetries: number;
  syncIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  logLevel: LanLogLevel;
  lastConnection: string | null;
  serverStarted: boolean;
  clientId: string | null;
  sessionToken: string | null;
  authToken: string | null;
  rememberDevice: boolean;
  allowMultipleUserSessions: boolean;
  autoReconnect: boolean;
  machineId: string;
  /** @deprecated Compatibility alias. The canonical installation identity is machineId. */
  deviceInstanceId: string;
  /** @deprecated Compatibility-only input. Never persisted or read by production LAN transport. */
  serverName?: string;
  /** @deprecated Compatibility-only input. Never persisted or read by production LAN transport. */
  serverIp?: string;
  /** @deprecated Compatibility-only input. Never persisted or read by production LAN transport. */
  serverPort?: number;
  /** @deprecated Compatibility-only input. Never persisted or read by production LAN transport. */
  clientServerIp?: string;
  /** @deprecated Compatibility-only input. Never persisted or read by production LAN transport. */
  clientServerPort?: number;
  /** @deprecated Server identity belongs exclusively to LanServerDescriptor. */
  trustedCompanyId?: string | null;
  /** @deprecated Server identity belongs exclusively to LanServerDescriptor. */
  lastServerId?: string | null;
}

export interface LanHealthPayload {
  status: string;
  version: string;
  serverName: string;
  serverId: string;
  companyId?: string;
  ip?: string;
  port?: number;
  baseUrl?: string;
  database: string;
  time: string;
  mode: string;
  uptime?: number;
  memoryUsed?: number;
  connectedClients?: number;
  activeClients?: number;
  inactiveClients?: number;
  requestsHandled?: number;
  heartbeatsReceived?: number;
  averageResponseTimeMs?: number;
  protocolVersion?: string;
  sessionDurationDays?: number;
  lastLanIp?: string;
  ipSource?: 'automatic' | 'persisted' | 'discovered' | 'manual' | 'unavailable';
  ipUpdatedAt?: string | null;
  networkAvailable?: boolean;
}

export interface LanDiagnostics {
  ok: boolean;
  ping: string;
  latencyMs: number | null;
  serverStatus: string;
  serverTime: string | null;
  localTime: string;
  clockDifferenceMs: number | null;
  checkedAt: string;
  version?: string;
  serverName?: string;
  serverId?: string;
  companyId?: string;
  database?: string;
  mode?: string;
  uptimeSeconds?: number;
  memoryUsedBytes?: number;
  connectedClients?: number;
  requestsHandled?: number;
  activeClients?: number;
  inactiveClients?: number;
  heartbeatsReceived?: number;
  averageResponseTimeMs?: number;
  protocolVersion?: string;
  error?: string;
}

const STORAGE_KEY = 'system_network_config';
const MACHINE_ID_STORAGE_KEY = 'joyacontrol_machine_id';
const RUNTIME_CONNECTION_ID = crypto.randomUUID();
const DEFAULT_PORT = 47831;
const DEFAULT_LAN_REQUEST_TIMEOUT_MS = 3_000;
const PERSISTED_CONFIG_KEYS: Array<keyof LanCommunicationConfig> = [
  'mode', 'role', 'deviceName', 'sharedKey', 'timeoutMs', 'automaticRetries',
  'syncIntervalSeconds', 'heartbeatIntervalSeconds', 'logLevel', 'lastConnection', 'serverStarted', 'clientId',
  'sessionToken', 'authToken', 'rememberDevice', 'allowMultipleUserSessions', 'autoReconnect', 'machineId', 'deviceInstanceId',
];

export const MIN_HEARTBEAT_INTERVAL_SECONDS = 10;
export const MAX_HEARTBEAT_INTERVAL_SECONDS = 15;
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 12;

export function normalizeHeartbeatIntervalSeconds(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
  return Math.min(
    MAX_HEARTBEAT_INTERVAL_SECONDS,
    Math.max(MIN_HEARTBEAT_INTERVAL_SECONDS, Math.round(numeric)),
  );
}

function requestTimeout(config: Pick<LanCommunicationConfig, 'timeoutMs'>, timeoutError: string) {
  return {
    timeoutMs: Math.max(500, Number(config.timeoutMs) || DEFAULT_LAN_REQUEST_TIMEOUT_MS),
    timeoutError,
  };
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === 'string' && signal.reason ? signal.reason : 'LAN_OPERATION_ABORTED');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

async function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function randomSharedKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function getOrCreateMachineId(preferred?: string): string {
  const candidate = String(preferred || '').trim();
  try {
    const stored = String(localStorage.getItem(MACHINE_ID_STORAGE_KEY) || '').trim();
    const machineId = stored || candidate || crypto.randomUUID();
    if (stored !== machineId) localStorage.setItem(MACHINE_ID_STORAGE_KEY, machineId);
    return machineId;
  } catch {
    return candidate || crypto.randomUUID();
  }
}

export function getDetectedDeviceName(): string {
  const electronName = (window as Window & { joyaControl?: { deviceName?: string } }).joyaControl?.deviceName;
  if (electronName?.trim()) return electronName.trim();
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Equipo';
  return `JoyaControl-${platform.replace(/\s+/g, '-')}`;
}

export function createDefaultLanConfig(): LanCommunicationConfig {
  const machineId = getOrCreateMachineId();
  return {
    mode: 'local',
    role: 'client',
    deviceName: getDetectedDeviceName(),
    sharedKey: randomSharedKey(),
    timeoutMs: 3000,
    automaticRetries: 3,
    syncIntervalSeconds: 60,
    heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    logLevel: 'info',
    lastConnection: null,
    serverStarted: false,
    clientId: null,
    sessionToken: null,
    authToken: null,
    rememberDevice: true,
    allowMultipleUserSessions: false,
    autoReconnect: true,
    machineId,
    deviceInstanceId: machineId,
  };
}

export function isValidIpv4(value: string): boolean {
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function isValidHostname(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > 253) return false;
  return normalized.split('.').every(label => /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/.test(label));
}

export function isValidNetworkAddress(value: string): boolean {
  return isValidLanIpv4(value.trim());
}

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function pickPersistedConfig(config: LanCommunicationConfig): LanCommunicationConfig {
  const defaults = createDefaultLanConfig();
  const persisted = { ...defaults } as LanCommunicationConfig;
  for (const key of PERSISTED_CONFIG_KEYS) {
    if (config[key] !== undefined) (persisted as unknown as Record<string, unknown>)[key] = config[key];
  }
  persisted.mode = config.mode === 'lan' ? 'lan' : 'local';
  persisted.role = config.role === 'client' ? 'client' : 'server';
  const machineId = String(config.machineId || config.deviceInstanceId || defaults.machineId).trim() || defaults.machineId;
  const permanentMachineId = getOrCreateMachineId(machineId);
  persisted.machineId = permanentMachineId;
  persisted.deviceInstanceId = permanentMachineId;
  persisted.heartbeatIntervalSeconds = normalizeHeartbeatIntervalSeconds(config.heartbeatIntervalSeconds);
  return persisted;
}

function legacyDescriptorPatch(config: Partial<LanCommunicationConfig>): Partial<LanServerDescriptorData> {
  const ipCandidate = config.role === 'server' ? config.serverIp : config.clientServerIp;
  const portCandidate = config.role === 'server' ? config.serverPort : config.clientServerPort;
  return {
    ...(typeof config.serverName === 'string' && config.serverName.trim() ? { serverName: config.serverName.trim() } : {}),
    ...(typeof ipCandidate === 'string' && isValidLanIpv4(ipCandidate) ? { ip: ipCandidate.trim() } : {}),
    ...(typeof portCandidate === 'number' && isValidPort(portCandidate) ? { port: portCandidate } : {}),
    ...(typeof config.lastServerId === 'string' && config.lastServerId ? { serverId: config.lastServerId } : {}),
    ...(typeof config.trustedCompanyId === 'string' && config.trustedCompanyId ? { companyId: config.trustedCompanyId } : {}),
  };
}

function migrateLegacyDescriptor(config: Partial<LanCommunicationConfig>): LanServerDescriptorData {
  const patch = legacyDescriptorPatch(config);
  return Object.keys(patch).length > 0 ? LanServerDescriptor.saveSync(patch) : LanServerDescriptor.load();
}

export function validateLanConfig(config: LanCommunicationConfig, descriptorOverride?: LanServerDescriptorData): string[] {
  const errors: string[] = [];
  const descriptor = descriptorOverride ?? LanServerDescriptor.load();
  if (config.mode === 'lan' && config.role === 'client' && !isValidLanIpv4(descriptor.ip)) {
    errors.push('Seleccione una dirección IPv4 LAN válida para el servidor.');
  }
  if (!isValidPort(descriptor.port)) errors.push('El puerto debe estar entre 1 y 65535.');
  if (!descriptor.serverName.trim()) errors.push('El nombre del servidor es obligatorio.');
  if (!config.deviceName.trim()) errors.push('El nombre del equipo es obligatorio.');
  if (!config.sharedKey.trim()) errors.push('La clave compartida es obligatoria.');
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 500 || config.timeoutMs > 60000) errors.push('El tiempo de espera debe estar entre 500 y 60000 ms.');
  if (!Number.isInteger(config.automaticRetries) || config.automaticRetries < 0 || config.automaticRetries > 10) errors.push('Los reintentos deben estar entre 0 y 10.');
  if (
    !Number.isInteger(config.heartbeatIntervalSeconds)
    || config.heartbeatIntervalSeconds < MIN_HEARTBEAT_INTERVAL_SECONDS
    || config.heartbeatIntervalSeconds > MAX_HEARTBEAT_INTERVAL_SECONDS
  ) {
    errors.push(`El heartbeat debe estar entre ${MIN_HEARTBEAT_INTERVAL_SECONDS} y ${MAX_HEARTBEAT_INTERVAL_SECONDS} segundos.`);
  }
  if (!String(config.machineId || '').trim()) errors.push('El Machine ID es obligatorio.');
  return errors;
}

export function loadLanConfig(): LanCommunicationConfig {
  const defaults = createDefaultLanConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<LanCommunicationConfig> & { role?: unknown; mode?: unknown };
    migrateLegacyDescriptor(parsed);
    const mode: LanMode = parsed.mode === 'lan' ? 'lan' : 'local';
    const role: LanRole = parsed.role === 'client' ? 'client' : 'server';
    const legacyMachineId = typeof parsed.machineId === 'string' && parsed.machineId.trim()
      ? parsed.machineId.trim()
      : typeof parsed.deviceInstanceId === 'string' && parsed.deviceInstanceId.trim()
        ? parsed.deviceInstanceId.trim()
        : defaults.machineId;
    const machineId = getOrCreateMachineId(legacyMachineId);
    const merged = pickPersistedConfig({
      ...defaults,
      ...parsed,
      mode,
      role,
      heartbeatIntervalSeconds: normalizeHeartbeatIntervalSeconds(parsed.heartbeatIntervalSeconds),
      machineId,
      deviceInstanceId: machineId,
    } as LanCommunicationConfig);
    const sanitized = JSON.stringify(merged);
    if (raw !== sanitized) localStorage.setItem(STORAGE_KEY, sanitized);
    return merged;
  } catch {
    return defaults;
  }
}

export function saveLanConfig(config: LanCommunicationConfig): void {
  const descriptor = migrateLegacyDescriptor(config);
  const sanitized = pickPersistedConfig(config);
  const errors = validateLanConfig(sanitized, descriptor);
  if (errors.length) throw new Error(errors.join(' '));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  window.dispatchEvent(new CustomEvent('joyacontrol-lan-config-changed'));
}

export function resetLanConfig(): LanCommunicationConfig {
  localStorage.removeItem(STORAGE_KEY);
  const defaults = createDefaultLanConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

function lanEndpoint(pathname: string): string {
  const normalizedPath = pathname.replace(/^\/+/, '');
  return new URL(normalizedPath, `${LanServerDescriptor.getBaseUrl()}/`).toString();
}

/** @deprecated Kept only so untouched legacy tests compile. It delegates exclusively to LanServerDescriptor. */
export function buildHealthUrl(_config: LanCommunicationConfig): string {
  return lanEndpoint('/health');
}

export async function probeLanServer(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanDiagnostics> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await lanFetch(lanEndpoint('/health'), {
      method: 'GET',
      cache: 'no-store',
      signal,
      ...requestTimeout(config, 'LAN_HEALTH_TIMEOUT'),
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await readLanJson<Partial<LanHealthPayload>>(response, {});
    const ended = performance.now();
    const serverDate = payload.time ? new Date(payload.time) : null;
    const now = new Date();
    return {
      ok: true,
      ping: 'Respondió',
      latencyMs: Math.round(ended - started),
      serverStatus: payload.status || 'Disponible',
      serverTime: serverDate && !Number.isNaN(serverDate.getTime()) ? serverDate.toISOString() : null,
      localTime: now.toISOString(),
      clockDifferenceMs: serverDate && !Number.isNaN(serverDate.getTime()) ? serverDate.getTime() - now.getTime() : null,
      checkedAt,
      version: payload.version,
      serverName: payload.serverName,
      serverId: payload.serverId,
      companyId: payload.companyId,
      database: payload.database,
      mode: payload.mode,
      uptimeSeconds: payload.uptime,
      memoryUsedBytes: payload.memoryUsed,
      connectedClients: payload.connectedClients,
      requestsHandled: payload.requestsHandled,
      activeClients: payload.activeClients,
      inactiveClients: payload.inactiveClients,
      heartbeatsReceived: payload.heartbeatsReceived,
      averageResponseTimeMs: payload.averageResponseTimeMs,
      protocolVersion: payload.protocolVersion,
    };
  } catch (error) {
    return {
      ok: false,
      ping: 'Sin respuesta',
      latencyMs: null,
      serverStatus: 'No disponible',
      serverTime: null,
      localTime: new Date().toISOString(),
      clockDifferenceMs: null,
      checkedAt,
      error: error instanceof Error ? error.message : 'CONNECTION_FAILED',
    };
  }
}

export function serializeLanDiagnostic(config: LanCommunicationConfig, diagnostics: LanDiagnostics | null, version: string): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    version,
    descriptor: LanServerDescriptor.toJSON(),
    config: { ...pickPersistedConfig(config), sharedKey: '[PROTEGIDA]', sessionToken: config.sessionToken ? '[PROTEGIDO]' : null, authToken: config.authToken ? '[PROTEGIDO]' : null },
    diagnostics,
  }, null, 2);
}

export const LAN_CONFIG_STORAGE_KEY = STORAGE_KEY;

export interface LanRestoredUser {
  success?: boolean;
  userId?: string;
  username?: string;
  displayName?: string;
  role?: string;
  permissions?: string[];
  authToken?: string;
  createdAt?: string;
  lastActivity?: string;
  expiresAt?: string;
  rememberDevice?: boolean;
}

export interface LanDuplicateSessionDetails {
  userId: string;
  username: string;
  displayName: string;
  source: {
    clientId: string;
    machineId: string;
    deviceName: string;
    hostname: string;
    ip: string;
    lastHeartbeat: string | null;
    lastActivity: string | null;
    inactiveForMs: number | null;
  };
}

export interface LanLoginOptions {
  transferExistingSession?: boolean;
  expectedSourceClientId?: string;
  expectedSourceMachineId?: string;
}

export class LanDuplicateLoginError extends Error {
  readonly code = 'LAN_DUPLICATE_LOGIN_BLOCKED';
  readonly duplicateSession: LanDuplicateSessionDetails;
  readonly reason?: string;

  constructor(duplicateSession: LanDuplicateSessionDetails, reason?: string) {
    super('LAN_DUPLICATE_LOGIN_BLOCKED');
    this.name = 'LanDuplicateLoginError';
    this.duplicateSession = duplicateSession;
    this.reason = reason;
  }
}

export function isLanDuplicateLoginError(error: unknown): error is LanDuplicateLoginError {
  return error instanceof LanDuplicateLoginError
    || (error instanceof Error
      && error.name === 'LanDuplicateLoginError'
      && Boolean((error as LanDuplicateLoginError).duplicateSession));
}

let lanSessionPromise: Promise<LanCommunicationConfig> | null = null;
let lanSessionGeneration = 0;
let lanSessionAbortController: AbortController | null = null;
let lanAuthRevalidationPromise: Promise<LanRestoredUser | null> | null = null;

export const LAN_AUTH_SESSION_EXPIRED_EVENT = 'joyacontrol-lan-auth-session-expired';

const LAN_SESSION_EXPIRATION_ERRORS = new Set([
  'LAN_INVALID_SESSION',
  'LAN_SESSION_EXPIRED',
  'LAN_USER_SESSION_EXPIRED',
  'LAN_INVALID_AUTH_TOKEN',
]);

export function isLanSessionExpirationError(error: unknown): boolean {
  return error instanceof Error && LAN_SESSION_EXPIRATION_ERRORS.has(error.message);
}

function publishConfirmedLanSessionExpiration(reason: string): void {
  const current = loadLanConfig();
  saveLanConfig({ ...current, authToken: null });
  window.dispatchEvent(new CustomEvent(LAN_AUTH_SESSION_EXPIRED_EVENT, {
    detail: { reason, at: new Date().toISOString() },
  }));
}

function logLanSessionLifecycle(event: string, detail: Record<string, unknown> = {}): void {
  const config = loadLanConfig();
  if (config.logLevel !== 'debug') return;
  const safe = { ...detail };
  delete safe.sessionToken;
  delete safe.authToken;
  console.debug(`[LAN session] ${event}`, safe);
}

function validateReturnedServerId(serverId?: string): void {
  const expectedServerId = LanServerDescriptor.getServerId();
  if (expectedServerId && serverId && expectedServerId !== serverId) throw new Error('LAN_SERVER_ID_MISMATCH');
}

export async function ensureLanClientSession(version = '2.1', signal?: AbortSignal): Promise<LanCommunicationConfig> {
  const initial = loadLanConfig();
  if (initial.mode !== 'lan' || initial.role !== 'client') return initial;
  if (lanSessionPromise) {
    logLanSessionLifecycle('session lookup joined existing promise', { clientId: initial.clientId });
    if (signal) {
      const abortSharedSession = () => lanSessionAbortController?.abort(signal.reason);
      signal.addEventListener('abort', abortSharedSession, { once: true });
      try {
        return await waitForAbortable(lanSessionPromise, signal);
      } finally {
        signal.removeEventListener('abort', abortSharedSession);
      }
    }
    return lanSessionPromise;
  }

  const generation = lanSessionGeneration;
  const sessionController = new AbortController();
  lanSessionAbortController = sessionController;
  const abortSession = () => sessionController.abort(signal?.reason);
  if (signal?.aborted) abortSession();
  else signal?.addEventListener('abort', abortSession, { once: true });

  const sessionPromise = (async () => {
    let current = loadLanConfig();
    throwIfAborted(sessionController.signal);
    const identityPromise = window.joyaControlLan?.getSystemIdentity?.() ?? Promise.resolve({ hostname: current.deviceName, ip: '' });
    const identity = await waitForAbortable(identityPromise, sessionController.signal);
    logLanSessionLifecycle('session recovery started', { clientId: current.clientId, hasPersistedSession: Boolean(current.clientId && current.sessionToken) });

    const validated = await validateAndRememberLanServer(current, version, 'LAN-1', sessionController.signal);
    current = validated.config;
    const session = await reconnectOrRegisterLanClient(current, identity, version, sessionController.signal);
    if (generation !== lanSessionGeneration) throw new Error('LAN_SESSION_OPERATION_CANCELLED');
    throwIfAborted(sessionController.signal);

    const latest = loadLanConfig();
    const next: LanCommunicationConfig = {
      ...latest,
      clientId: session.clientId,
      sessionToken: session.sessionToken,
      machineId: session.machineId || latest.machineId,
      deviceInstanceId: session.machineId || latest.machineId,
      lastConnection: new Date().toISOString(),
    };
    saveLanConfig(next);
    logLanSessionLifecycle(session.reconnected ? 'session restored' : 'session created', { clientId: next.clientId, serverId: session.serverId });
    return next;
  })().finally(() => {
    signal?.removeEventListener('abort', abortSession);
    if (lanSessionAbortController === sessionController) lanSessionAbortController = null;
    if (lanSessionPromise === sessionPromise) lanSessionPromise = null;
  });
  lanSessionPromise = sessionPromise;
  return waitForAbortable(sessionPromise, signal);
}

export function invalidateLanClientSession(reason = 'manual', expectedClientId?: string | null): LanCommunicationConfig {
  const current = loadLanConfig();
  if (expectedClientId && current.clientId !== expectedClientId) {
    logLanSessionLifecycle('stale session destruction ignored', { expectedClientId, currentClientId: current.clientId, reason });
    return current;
  }
  lanSessionGeneration += 1;
  lanSessionAbortController?.abort(new Error('LAN_SESSION_OPERATION_CANCELLED'));
  lanSessionAbortController = null;
  lanSessionPromise = null;
  const next = { ...current, clientId: null, sessionToken: null, authToken: null };
  saveLanConfig(next);
  logLanSessionLifecycle('session destroyed', { clientId: current.clientId, reason });
  return next;
}

export async function fetchLanClients(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanConnectedDevice[]> {
  const response = await lanFetch(lanEndpoint('/clients'), {
    method: 'GET',
    cache: 'no-store',
    signal,
    ...requestTimeout(config, 'LAN_CLIENTS_TIMEOUT'),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json() as { clients?: LanConnectedDevice[] };
  return Array.isArray(payload.clients) ? payload.clients : [];
}

export async function maintainLanDevices(
  config: LanCommunicationConfig,
  request: LanDeviceMaintenanceRequest,
  signal?: AbortSignal,
): Promise<LanDeviceMaintenanceResult> {
  if (config.role !== 'server') throw new Error('LAN_DEVICE_MAINTENANCE_SERVER_ONLY');
  const response = await lanFetch(lanEndpoint('/clients/maintenance'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
    ...requestTimeout(config, 'LAN_DEVICE_MAINTENANCE_TIMEOUT'),
  });
  const payload = await readLanJson<Partial<LanDeviceMaintenanceResult> & { error?: string }>(response, {});
  if (!response.ok || !payload.success) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload as LanDeviceMaintenanceResult;
}

export async function registerLanClient(config: LanCommunicationConfig, identity: { hostname: string; ip: string }, version = '2.1', signal?: AbortSignal): Promise<{ clientId: string; sessionToken: string; serverId: string; machineId: string }> {
  const machineId = String(config.machineId || config.deviceInstanceId).trim();
  const response = await lanFetch(lanEndpoint('/client/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machineId,
      deviceInstanceId: machineId,
      connectionId: RUNTIME_CONNECTION_ID,
      name: config.deviceName,
      hostname: identity.hostname,
      ip: identity.ip,
      operatingSystem: navigator.userAgentData?.platform || navigator.platform || 'No disponible',
      version,
      localTime: new Date().toISOString(),
      rememberDevice: config.rememberDevice !== false,
    }),
    signal,
    ...requestTimeout(config, 'LAN_CLIENT_REGISTER_TIMEOUT'),
  });
  const payload = await readLanJson<{ success?: boolean; clientId?: string; sessionToken?: string; serverId?: string; machineId?: string; error?: string }>(response, {});
  if (!response.ok || !payload.clientId || !payload.sessionToken) throw new Error(payload.error || `HTTP_${response.status}`);
  validateReturnedServerId(payload.serverId);
  return { clientId: payload.clientId, sessionToken: payload.sessionToken, serverId: payload.serverId || '', machineId: payload.machineId || machineId };
}

export async function disconnectLanClient(config: LanCommunicationConfig, signal?: AbortSignal): Promise<void> {
  if (!config.clientId || !config.sessionToken) return;
  const response = await lanFetch(lanEndpoint('/client/disconnect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, sessionToken: config.sessionToken }),
    signal,
    ...requestTimeout(config, 'LAN_CLIENT_DISCONNECT_TIMEOUT'),
  });
  if (!response.ok) {
    const payload = await readLanJson<{ error?: string }>(response, {});
    throw new Error(payload.error || `HTTP_${response.status}`);
  }
}

export async function reconnectLanClient(config: LanCommunicationConfig, identity: { hostname: string; ip: string }, signal?: AbortSignal): Promise<{ clientId: string; sessionToken: string; serverId: string; machineId: string }> {
  if (!config.clientId || !config.sessionToken) throw new Error('LAN_SESSION_NOT_AVAILABLE');
  const machineId = String(config.machineId || config.deviceInstanceId).trim();
  const response = await lanFetch(lanEndpoint('/client/reconnect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: config.clientId,
      sessionToken: config.sessionToken,
      machineId,
      deviceInstanceId: machineId,
      connectionId: RUNTIME_CONNECTION_ID,
      ip: identity.ip,
      operatingSystem: navigator.userAgentData?.platform || navigator.platform || 'No disponible',
      rememberDevice: config.rememberDevice !== false,
    }),
    signal,
    ...requestTimeout(config, 'LAN_CLIENT_RECONNECT_TIMEOUT'),
  });
  const payload = await readLanJson<{ success?: boolean; clientId?: string; sessionToken?: string; serverId?: string; machineId?: string; error?: string }>(response, {});
  if (!response.ok || !payload.clientId || !payload.sessionToken) throw new Error(payload.error || `HTTP_${response.status}`);
  validateReturnedServerId(payload.serverId);
  return { clientId: payload.clientId, sessionToken: payload.sessionToken, serverId: payload.serverId || '', machineId: payload.machineId || machineId };
}

export async function sendLanHeartbeat(config: LanCommunicationConfig, lastEventSequence = 0, signal?: AbortSignal): Promise<{ latencyMs: number; lastSeen: string; activityCount: number; serverId: string; events: Array<{ sequence: number; type: string; createdAt: string }>; latestEventSequence: number }> {
  if (!config.clientId || !config.sessionToken) throw new Error('LAN_SESSION_NOT_AVAILABLE');
  const machineId = String(config.machineId || config.deviceInstanceId).trim();
  const response = await lanFetch(lanEndpoint('/client/ping'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: config.clientId,
      sessionToken: config.sessionToken,
      machineId,
      deviceInstanceId: machineId,
      connectionId: RUNTIME_CONNECTION_ID,
      timestamp: new Date().toISOString(),
      debug: config.logLevel === 'debug',
      lastEventSequence,
    }),
    signal,
    ...requestTimeout(config, 'LAN_HEARTBEAT_TIMEOUT'),
  });
  const payload = await readLanJson<{ latencyMs?: number; lastSeen?: string; activityCount?: number; serverId?: string; repositoryEvents?: Array<{ sequence: number; type: string; createdAt: string }>; latestEventSequence?: number; error?: string }>(response, {});
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  validateReturnedServerId(payload.serverId);
  return {
    latencyMs: payload.latencyMs || 0,
    lastSeen: payload.lastSeen || new Date().toISOString(),
    activityCount: payload.activityCount || 0,
    serverId: payload.serverId || '',
    events: payload.repositoryEvents || [],
    latestEventSequence: payload.latestEventSequence || 0,
  };
}

export async function reconnectOrRegisterLanClient(config: LanCommunicationConfig, identity: { hostname: string; ip: string }, version = '2.1', signal?: AbortSignal): Promise<{ clientId: string; sessionToken: string; serverId: string; machineId: string; reconnected: boolean }> {
  if (config.clientId && config.sessionToken) {
    try {
      const session = await reconnectLanClient(config, identity, signal);
      return { ...session, reconnected: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code !== 'LAN_SESSION_EXPIRED' && code !== 'LAN_INVALID_SESSION') throw error;
    }
  }
  const session = await registerLanClient(config, identity, version, signal);
  return { ...session, reconnected: false };
}

export interface LanServerInfo {
  serverId: string;
  serverName: string;
  companyId: string;
  company: string;
  version: string;
  protocolVersion: string;
  repository: string;
  mode: string;
  maxClients: number;
  connectedClients: number;
  features: { sales: boolean; inventory: boolean; reports: boolean; sync: boolean };
  ip?: string;
  port?: number;
  baseUrl?: string;
}

export interface LanDiscoveredServer extends LanServerInfo {
  ip: string;
  port: number;
  latencyMs: number;
}

export interface LanCompatibilityResult {
  compatible: boolean;
  errors: string[];
}

export function validateLanServerCompatibility(info: LanServerInfo, _config: LanCommunicationConfig, expectedVersion = '2.1', expectedProtocol = 'LAN-1'): LanCompatibilityResult {
  const errors: string[] = [];
  const descriptor = LanServerDescriptor.load();
  if (info.version !== expectedVersion) errors.push('LAN_INCOMPATIBLE_VERSION');
  if (info.protocolVersion !== expectedProtocol) errors.push('LAN_INCOMPATIBLE_PROTOCOL');
  if (info.repository !== 'Dexie' || info.mode !== 'desktop') errors.push('LAN_INCOMPATIBLE_SERVER_MODE');
  if (descriptor.serverId && info.serverId !== descriptor.serverId) errors.push('LAN_SERVER_ID_MISMATCH');
  if (descriptor.companyId && info.companyId !== descriptor.companyId) errors.push('LAN_COMPANY_MISMATCH');
  return { compatible: errors.length === 0, errors };
}

export async function fetchLanServerInfo(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanServerInfo> {
  const response = await lanFetch(lanEndpoint('/server-info'), {
    method: 'GET',
    cache: 'no-store',
    signal,
    ...requestTimeout(config, 'LAN_SERVER_INFO_TIMEOUT'),
  });
  const payload = await readLanJson<Partial<LanServerInfo> & { error?: string }>(response, {});
  if (!response.ok || !payload.serverId || !payload.companyId || !payload.version || !payload.protocolVersion) {
    throw new Error(payload.error || `HTTP_${response.status}`);
  }
  return payload as LanServerInfo;
}

export async function validateAndRememberLanServer(config: LanCommunicationConfig, expectedVersion = '2.1', expectedProtocol = 'LAN-1', signal?: AbortSignal): Promise<{ config: LanCommunicationConfig; info: LanServerInfo; diagnostics: LanDiagnostics }> {
  const diagnostics = await probeLanServer(config, signal);
  if (!diagnostics.ok) throw new Error(diagnostics.error || 'LAN_SERVER_UNAVAILABLE');
  const info = await fetchLanServerInfo(config, signal);
  const compatibility = validateLanServerCompatibility(info, config, expectedVersion, expectedProtocol);
  if (!compatibility.compatible) throw new Error(compatibility.errors[0]);
  const address = LanServerDescriptor.load();
  await waitForAbortable(LanServerDescriptor.rememberServer({
    serverId: info.serverId,
    companyId: info.companyId,
    serverName: info.serverName,
    ip: address.ip,
    port: address.port,
    protocolVersion: info.protocolVersion,
  }), signal);
  return { config, info, diagnostics };
}

export async function rediscoverTrustedLanServer(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanCommunicationConfig> {
  if (!config.autoReconnect || !window.joyaControlLan?.discoverServers) return config;
  const descriptor = LanServerDescriptor.load();
  const servers = await discoverLanServers(config, signal);
  const trusted = servers.find(server =>
    (!descriptor.serverId || server.serverId === descriptor.serverId) &&
    (!descriptor.companyId || server.companyId === descriptor.companyId)
  );
  if (!trusted) throw new Error('LAN_TRUSTED_SERVER_NOT_FOUND');
  if (trusted.ip !== descriptor.ip || trusted.port !== descriptor.port) {
    await waitForAbortable(LanServerDescriptor.rememberServer(trusted), signal);
    window.dispatchEvent(new CustomEvent('joyacontrol-lan-infrastructure-event', {
      detail: { type: 'LAN_SERVER_IP_CHANGED', previousIp: descriptor.ip, currentIp: trusted.ip, serverId: trusted.serverId },
    }));
  }
  return config;
}

export async function discoverLanServers(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanDiscoveredServer[]> {
  if (!window.joyaControlLan?.discoverServers) throw new Error('LAN_DISCOVERY_REQUIRES_ELECTRON');
  const descriptor = LanServerDescriptor.load();
  const servers = await waitForAbortable(window.joyaControlLan.discoverServers({
    port: descriptor.port || DEFAULT_PORT,
    timeoutMs: Math.min(config.timeoutMs, 1000),
    knownIp: descriptor.ip || undefined,
  }), signal);
  return servers.filter(server => server.version === '2.1' && server.protocolVersion === 'LAN-1');
}

export interface LanConnectedUser { userId: string; username: string; role: string; clientId: string; deviceName: string; ip: string; loginAt: string; createdAt?: string; lastActivity: string; expiresAt?: string; rememberDevice?: boolean; status: string; }

export async function fetchLanUsers(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanConnectedUser[]> {
  const response = await lanFetch(lanEndpoint('/users'), {
    method: 'GET',
    cache: 'no-store',
    signal,
    ...requestTimeout(config, 'LAN_USERS_TIMEOUT'),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json() as { users?: LanConnectedUser[] };
  return Array.isArray(payload.users) ? payload.users : [];
}

export async function loginLanUser(
  config: LanCommunicationConfig,
  username: string,
  password: string,
  options: LanLoginOptions = {},
  signal?: AbortSignal,
) {
  if (!config.clientId || !config.sessionToken) throw new Error('LAN_SESSION_NOT_AVAILABLE');
  const response = await lanFetch(lanEndpoint('/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      clientId: config.clientId,
      sessionToken: config.sessionToken,
      ...(config.rememberDevice === false ? { rememberDevice: false } : {}),
      ...(options.transferExistingSession ? { transferExistingSession: true } : {}),
      ...(options.expectedSourceClientId ? { expectedSourceClientId: options.expectedSourceClientId } : {}),
      ...(options.expectedSourceMachineId ? { expectedSourceMachineId: options.expectedSourceMachineId } : {}),
    }),
    signal,
    ...requestTimeout(config, 'LAN_LOGIN_TIMEOUT'),
  });
  const payload = await readLanJson<{
    success?: boolean;
    userId?: string;
    username?: string;
    displayName?: string;
    role?: string;
    permissions?: string[];
    authToken?: string;
    error?: string;
    reason?: string;
    duplicateSession?: LanDuplicateSessionDetails;
    transferred?: boolean;
    transferActivityId?: string | null;
  }>(response, {});
  if (response.status === 409 && payload.error === 'LAN_DUPLICATE_LOGIN_BLOCKED' && payload.duplicateSession) {
    throw new LanDuplicateLoginError(payload.duplicateSession, payload.reason);
  }
  if (!response.ok || !payload.success || !payload.authToken || !payload.userId || !payload.username || !payload.role) {
    throw new Error(payload.error || 'LOGIN_FAILED');
  }
  const next = { ...config, authToken: payload.authToken };
  saveLanConfig(next);
  return payload;
}

async function requestLanUserRestore(config: LanCommunicationConfig, signal?: AbortSignal): Promise<LanRestoredUser | null> {
  if (!config.clientId || !config.sessionToken || !config.authToken) return null;
  const response = await lanFetch(lanEndpoint('/auth/restore'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, sessionToken: config.sessionToken, authToken: config.authToken }),
    signal,
    ...requestTimeout(config, 'LAN_AUTH_RESTORE_TIMEOUT'),
  });
  const payload = await readLanJson<LanRestoredUser & { error?: string }>(response, {});
  if (!response.ok) throw new Error(payload.error || `LAN_AUTH_RESTORE_${response.status}`);
  if (!payload.success || !payload.userId || !payload.username || !payload.role) throw new Error('LAN_AUTH_RESTORE_INVALID_RESPONSE');
  return payload;
}

/**
 * Grace-period revalidation for an authenticated LAN session.
 *
 * The first explicit expiration response is treated as provisional. The
 * client reconnects/revalidates its device session and asks the same server to
 * restore the auth token once more. Authentication is cleared only when that
 * second server response also confirms expiration.
 */
export async function restoreLanUserWithGrace(
  config: LanCommunicationConfig,
  signal?: AbortSignal,
): Promise<LanRestoredUser | null> {
  if (!config.clientId || !config.sessionToken || !config.authToken) return null;
  if (lanAuthRevalidationPromise) return waitForAbortable(lanAuthRevalidationPromise, signal);

  const operation = (async () => {
    try {
      return await requestLanUserRestore(config, signal);
    } catch (firstError) {
      if (!isLanSessionExpirationError(firstError)) throw firstError;

      const refreshedConfig = await ensureLanClientSession('2.1', signal);
      try {
        return await requestLanUserRestore(refreshedConfig, signal);
      } catch (confirmationError) {
        if (!isLanSessionExpirationError(confirmationError)) throw confirmationError;
        const reason = confirmationError instanceof Error ? confirmationError.message : 'LAN_USER_SESSION_EXPIRED';
        publishConfirmedLanSessionExpiration(reason);
        throw new Error('LAN_AUTH_SESSION_CONFIRMED_EXPIRED');
      }
    }
  })().finally(() => {
    if (lanAuthRevalidationPromise === operation) lanAuthRevalidationPromise = null;
  });

  lanAuthRevalidationPromise = operation;
  return waitForAbortable(operation, signal);
}

/** Existing public API, now protected by the expiration grace period. */
export async function restoreLanUser(
  config: LanCommunicationConfig,
  signal?: AbortSignal,
): Promise<LanRestoredUser | null> {
  return restoreLanUserWithGrace(config, signal);
}

export async function logoutLanUser(config: LanCommunicationConfig, signal?: AbortSignal): Promise<void> {
  if (!config.clientId || !config.sessionToken || !config.authToken) return;
  await lanFetch(lanEndpoint('/logout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, sessionToken: config.sessionToken, authToken: config.authToken }),
    signal,
    ...requestTimeout(config, 'LAN_LOGOUT_TIMEOUT'),
  }).catch(() => undefined);
  saveLanConfig({ ...config, authToken: null });
}
