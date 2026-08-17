import {
  OnlineRepositoryReadError,
  type OnlineRepositoryReaderConnection,
} from './OnlineRepositoryReader';

export type OnlineContactType = 'client' | 'supplier';

export interface OnlineContact {
  id: string;
  type: OnlineContactType;
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: 'active';
}

export interface OnlineContactsSnapshot {
  contacts: OnlineContact[];
  totalClients: number;
  totalSuppliers: number;
  lastCommunication: string;
  latencyMs: number;
  fromCache: boolean;
  cacheExpiresAt: string;
}

type OnlineContactsResource = 'contacts' | 'contact' | 'contactsSearch';

interface ReadSuccess<T> {
  ok: true;
  resource: OnlineContactsResource;
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

type OnlineContactsTransport = <T>(options: {
  url: string;
  port: number;
  sessionId: string;
  resource: OnlineContactsResource;
  args?: Record<string, unknown>;
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

interface CachedRead<T> extends CacheEntry<T> {
  fromCache: boolean;
}

export interface OnlineContactsRepositoryDependencies {
  transport?: OnlineContactsTransport;
  now?: () => number;
  cacheTtlMs?: number;
}

export const ONLINE_CONTACTS_CACHE_TTL_MS = 60_000;

function defaultTransport<T>(options: Parameters<OnlineContactsTransport>[0]): Promise<ReadResult<T>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'Los contactos remotos están disponibles únicamente en la aplicación de escritorio.',
    ));
  }

  const bridge = (window as unknown as {
    joyaControlHttps?: { read?: OnlineContactsTransport };
  }).joyaControlHttps;
  if (!bridge?.read) {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'Los contactos remotos están disponibles únicamente en la aplicación de escritorio.',
    ));
  }
  return bridge.read<T>(options) as Promise<ReadResult<T>>;
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

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function validateContact(value: unknown): OnlineContact {
  const contact = value as Partial<OnlineContact> | null;
  const id = normalizeText(contact?.id);
  const name = normalizeText(contact?.name);
  const type = normalizeText(contact?.type) as OnlineContactType;
  if (!id || !name || !['client', 'supplier'].includes(type) || contact?.status !== 'active') {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor devolvió un contacto remoto incompleto.');
  }

  return {
    id,
    type,
    name,
    document: normalizeText(contact?.document),
    phone: normalizeText(contact?.phone),
    email: normalizeText(contact?.email),
    address: normalizeText(contact?.address),
    notes: normalizeText(contact?.notes),
    status: 'active',
  };
}

function validateContacts(value: unknown): OnlineContact[] {
  if (!Array.isArray(value)) {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor no devolvió una colección válida de contactos.');
  }
  return value.map(validateContact);
}

export class OnlineContactsRepository {
  private readonly connection: OnlineRepositoryReaderConnection;
  private readonly transport: OnlineContactsTransport;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<CachedRead<unknown>>>();

  constructor(
    connection: OnlineRepositoryReaderConnection,
    dependencies: OnlineContactsRepositoryDependencies = {},
  ) {
    this.connection = validConnection(connection);
    this.transport = dependencies.transport || defaultTransport;
    this.now = dependencies.now || Date.now;
    const ttl = Number(dependencies.cacheTtlMs ?? ONLINE_CONTACTS_CACHE_TTL_MS);
    this.cacheTtlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : ONLINE_CONTACTS_CACHE_TTL_MS;
  }

  clearCache(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async read<T>(
    cacheKey: string,
    resource: OnlineContactsResource,
    args: Record<string, unknown> | undefined,
    validate: (value: unknown) => T,
    force = false,
  ): Promise<CachedRead<T>> {
    const currentTime = this.now();
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (!force && cached && cached.expiresAtMs > currentTime) {
      return { ...cached, fromCache: true };
    }

    if (!force) {
      const existing = this.pending.get(cacheKey) as Promise<CachedRead<T>> | undefined;
      if (existing) return existing;
    }

    const operation = (async (): Promise<CachedRead<T>> => {
      const result = await this.transport<unknown>({
        url: this.connection.url,
        port: this.connection.port,
        sessionId: this.connection.sessionId,
        resource,
        args,
        expectedServerId: this.connection.serverId,
        expectedVersion: this.connection.version,
        timeoutMs: this.connection.timeoutMs,
      });
      if (result.ok !== true) {
        throw new OnlineRepositoryReadError(result.errorCode, result.errorMessage);
      }

      const completedAt = this.now();
      const entry: CacheEntry<T> = {
        data: validate(result.data),
        latencyMs: Math.max(0, Number(result.latencyMs) || 0),
        communicatedAt: result.communicatedAt || new Date(completedAt).toISOString(),
        expiresAtMs: completedAt + this.cacheTtlMs,
      };
      this.cache.set(cacheKey, entry);
      return { ...entry, fromCache: false };
    })();

    this.pending.set(cacheKey, operation as Promise<CachedRead<unknown>>);
    try {
      return await operation;
    } finally {
      if (this.pending.get(cacheKey) === operation) this.pending.delete(cacheKey);
    }
  }

  async getContacts(force = false): Promise<OnlineContactsSnapshot> {
    const result = await this.read('contacts', 'contacts', undefined, validateContacts, force);
    return {
      contacts: [...result.data],
      totalClients: result.data.filter(contact => contact.type === 'client').length,
      totalSuppliers: result.data.filter(contact => contact.type === 'supplier').length,
      lastCommunication: result.communicatedAt,
      latencyMs: result.latencyMs,
      fromCache: result.fromCache,
      cacheExpiresAt: new Date(result.expiresAtMs).toISOString(),
    };
  }

  async getContact(id: string, force = false): Promise<OnlineContact> {
    const contactId = normalizeText(id);
    if (!contactId) {
      throw new OnlineRepositoryReadError('HTTPS_CONTACT_ID_INVALID', 'El identificador del contacto es obligatorio.');
    }
    return (await this.read(
      `contact:${contactId}`,
      'contact',
      { id: contactId },
      validateContact,
      force,
    )).data;
  }

  async searchContacts(query: string, force = false): Promise<OnlineContact[]> {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return (await this.getContacts(force)).contacts;
    return (await this.read(
      `search:${normalizedQuery.toLocaleLowerCase()}`,
      'contactsSearch',
      { query: normalizedQuery },
      validateContacts,
      force,
    )).data;
  }
}
