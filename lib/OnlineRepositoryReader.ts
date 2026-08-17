export type OnlineReadResource = 'me' | 'company' | 'permissions';

export interface OnlineUserProfile {
  id: string;
  usuario: string;
  nombre: string;
  rol: string;
  permisos: string[];
}

export interface OnlineCompanyProfile {
  nombreEmpresa: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefonos: string[];
  correo: string;
  logo: string;
  configuracionImpresion: Record<string, unknown> | null;
}

export interface OnlinePermissionsProfile {
  permisos: string[];
}

export interface OnlineRepositorySnapshot {
  me: OnlineUserProfile;
  company: OnlineCompanyProfile;
  permissions: string[];
  lastCommunication: string;
  latencyMs: number;
  status: 'online';
  fromCache: boolean;
  cacheExpiresAt: string;
}

export interface OnlineRepositoryReaderConnection {
  url: string;
  port: number;
  sessionId: string;
  serverId: string;
  version: string;
  timeoutMs?: number;
}

interface ReadSuccess<T> {
  ok: true;
  resource: OnlineReadResource;
  data: T;
  latencyMs: number;
  communicatedAt: string;
}

interface ReadFailure {
  ok: false;
  errorCode: string;
  errorMessage: string;
}

type ReadResult<T> = ReadSuccess<T> | ReadFailure;

type OnlineReadTransport = <T>(options: {
  url: string;
  port: number;
  sessionId: string;
  resource: OnlineReadResource;
  expectedServerId: string;
  expectedVersion: string;
  timeoutMs?: number;
}) => Promise<ReadResult<T>>;

interface CacheEntry<T> {
  data: T;
  latencyMs: number;
  communicatedAt: string;
  expiresAtMs: number;
}

interface ResourceRead<T> extends CacheEntry<T> {
  fromCache: boolean;
}

export interface OnlineRepositoryReaderDependencies {
  transport?: OnlineReadTransport;
  now?: () => number;
  cacheTtlMs?: number;
}

export class OnlineRepositoryReadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OnlineRepositoryReadError';
    this.code = code;
  }
}

export const ONLINE_REPOSITORY_CACHE_TTL_MS = 60_000;

const RESOURCE_ORDER: OnlineReadResource[] = ['me', 'company', 'permissions'];

function defaultTransport<T>(options: Parameters<OnlineReadTransport>[0]): Promise<ReadResult<T>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'El lector HTTPS está disponible únicamente en la aplicación de escritorio.',
    ));
  }

  const bridge = (window as Window & { joyaControlHttps?: { read?: OnlineReadTransport } }).joyaControlHttps;
  if (!bridge?.read) {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'El lector HTTPS está disponible únicamente en la aplicación de escritorio.',
    ));
  }
  return bridge.read<T>(options);
}

function validConnection(connection: OnlineRepositoryReaderConnection): OnlineRepositoryReaderConnection {
  const url = String(connection.url || '').trim();
  const port = Number(connection.port);
  const sessionId = String(connection.sessionId || '').trim();
  const serverId = String(connection.serverId || '').trim();
  const version = String(connection.version || '').trim();
  if (!url || !Number.isInteger(port) || port < 1 || port > 65_535 || !sessionId || !serverId || !version) {
    throw new OnlineRepositoryReadError('HTTPS_SESSION_INVALID', 'La sesión HTTPS no contiene una conexión válida.');
  }
  return { ...connection, url, port, sessionId, serverId, version };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class OnlineRepositoryReader {
  private readonly connection: OnlineRepositoryReaderConnection;
  private readonly transport: OnlineReadTransport;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<OnlineReadResource, CacheEntry<unknown>>();
  private readonly pending = new Map<OnlineReadResource, Promise<ResourceRead<unknown>>>();

  constructor(
    connection: OnlineRepositoryReaderConnection,
    dependencies: OnlineRepositoryReaderDependencies = {},
  ) {
    this.connection = validConnection(connection);
    this.transport = dependencies.transport || defaultTransport;
    this.now = dependencies.now || Date.now;
    const ttl = Number(dependencies.cacheTtlMs ?? ONLINE_REPOSITORY_CACHE_TTL_MS);
    this.cacheTtlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : ONLINE_REPOSITORY_CACHE_TTL_MS;
  }

  clearCache(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async readResource<T>(resource: OnlineReadResource, force = false): Promise<ResourceRead<T>> {
    const currentTime = this.now();
    const cached = this.cache.get(resource) as CacheEntry<T> | undefined;
    if (!force && cached && cached.expiresAtMs > currentTime) {
      return { ...cached, fromCache: true };
    }

    if (!force) {
      const existing = this.pending.get(resource) as Promise<ResourceRead<T>> | undefined;
      if (existing) return existing;
    }

    const operation = (async (): Promise<ResourceRead<T>> => {
      const result = await this.transport<T>({
        url: this.connection.url,
        port: this.connection.port,
        sessionId: this.connection.sessionId,
        resource,
        expectedServerId: this.connection.serverId,
        expectedVersion: this.connection.version,
        timeoutMs: this.connection.timeoutMs,
      });
      if (result.ok !== true) {
        throw new OnlineRepositoryReadError(result.errorCode, result.errorMessage);
      }

      const completedAt = this.now();
      const entry: CacheEntry<T> = {
        data: result.data,
        latencyMs: Math.max(0, Number(result.latencyMs) || 0),
        communicatedAt: result.communicatedAt || new Date(completedAt).toISOString(),
        expiresAtMs: completedAt + this.cacheTtlMs,
      };
      this.cache.set(resource, entry);
      return { ...entry, fromCache: false };
    })();

    this.pending.set(resource, operation as Promise<ResourceRead<unknown>>);
    try {
      return await operation;
    } finally {
      if (this.pending.get(resource) === operation) this.pending.delete(resource);
    }
  }

  async getMe(force = false): Promise<OnlineUserProfile> {
    return (await this.readResource<OnlineUserProfile>('me', force)).data;
  }

  async getCompany(force = false): Promise<OnlineCompanyProfile> {
    return (await this.readResource<OnlineCompanyProfile>('company', force)).data;
  }

  async getPermissions(force = false): Promise<string[]> {
    return (await this.readResource<OnlinePermissionsProfile>('permissions', force)).data.permisos;
  }

  async getSnapshot(force = false): Promise<OnlineRepositorySnapshot> {
    const [me, company, permissions] = await Promise.all([
      this.readResource<OnlineUserProfile>('me', force),
      this.readResource<OnlineCompanyProfile>('company', force),
      this.readResource<OnlinePermissionsProfile>('permissions', force),
    ]);
    const reads = [me, company, permissions];
    const lastCommunication = reads
      .map(item => item.communicatedAt)
      .sort((left, right) => timestamp(right) - timestamp(left))[0] || new Date(this.now()).toISOString();
    const cacheExpiresAtMs = Math.min(...reads.map(item => item.expiresAtMs));

    return {
      me: me.data,
      company: company.data,
      permissions: [...permissions.data.permisos],
      lastCommunication,
      latencyMs: Math.max(...reads.map(item => item.latencyMs), 0),
      status: 'online',
      fromCache: reads.every(item => item.fromCache),
      cacheExpiresAt: new Date(cacheExpiresAtMs).toISOString(),
    };
  }
}

export function isOnlineRepositorySessionError(error: unknown): boolean {
  const code = error instanceof OnlineRepositoryReadError
    ? error.code
    : String((error as { code?: unknown } | null)?.code || '');
  return [
    'HTTPS_SESSION_REQUIRED',
    'HTTPS_SESSION_INVALID',
    'HTTPS_SESSION_EXPIRED',
    'HTTPS_SERVER_MISMATCH',
    'HTTPS_VERSION_INCOMPATIBLE',
  ].includes(code);
}

export { RESOURCE_ORDER as ONLINE_READ_ONLY_RESOURCES };
