import {
  OnlineRepositoryReadError,
  type OnlineRepositoryReaderConnection,
} from './OnlineRepositoryReader';

export type OnlineStockStatus = 'available' | 'low_stock' | 'out_of_stock';

export interface OnlineProduct {
  id: string;
  code: string;
  name: string;
  category: string;
  reference: string;
  description: string;
  weightGrams: number;
  availableGrams: number;
  salePrice: number;
  stock: number;
  minStock: number;
  status: OnlineStockStatus;
}

export interface OnlineInventoryMovement {
  date: string;
  type: 'increase' | 'decrease';
}

export interface OnlineInventoryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
  availableGrams: number;
  weightGrams: number;
  minStock: number;
  location: string;
  lastMovement: OnlineInventoryMovement | null;
  status: OnlineStockStatus;
}

export interface OnlineProductsSnapshot {
  products: OnlineProduct[];
  totalProducts: number;
  lastCommunication: string;
  latencyMs: number;
  fromCache: boolean;
  cacheExpiresAt: string;
}

export interface OnlineInventorySnapshot {
  items: OnlineInventoryItem[];
  totalReferences: number;
  totalExistences: number;
  totalAvailableGrams: number;
  lastCommunication: string;
  latencyMs: number;
  fromCache: boolean;
  cacheExpiresAt: string;
}

type OnlineProductsResource =
  | 'products'
  | 'product'
  | 'productsSearch'
  | 'inventory'
  | 'inventoryItem';

interface ReadSuccess<T> {
  ok: true;
  resource: OnlineProductsResource;
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

type OnlineProductsTransport = <T>(options: {
  url: string;
  port: number;
  sessionId: string;
  resource: OnlineProductsResource;
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

export interface OnlineProductsRepositoryDependencies {
  transport?: OnlineProductsTransport;
  now?: () => number;
  cacheTtlMs?: number;
}

export const ONLINE_PRODUCTS_CACHE_TTL_MS = 60_000;

function defaultTransport<T>(options: Parameters<OnlineProductsTransport>[0]): Promise<ReadResult<T>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'Los productos remotos están disponibles únicamente en la aplicación de escritorio.',
    ));
  }

  const bridge = (window as unknown as {
    joyaControlHttps?: { read?: OnlineProductsTransport };
  }).joyaControlHttps;
  if (!bridge?.read) {
    return Promise.reject(new OnlineRepositoryReadError(
      'HTTPS_CLIENT_UNAVAILABLE',
      'Los productos remotos están disponibles únicamente en la aplicación de escritorio.',
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

function normalizeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : Number.NaN;
}

function validStatus(value: unknown): value is OnlineStockStatus {
  return ['available', 'low_stock', 'out_of_stock'].includes(String(value));
}

function validateProduct(value: unknown): OnlineProduct {
  const product = value as Partial<OnlineProduct> | null;
  const id = normalizeText(product?.id);
  const code = normalizeText(product?.code);
  const name = normalizeText(product?.name);
  const status = product?.status;
  const weightGrams = normalizeNumber(product?.weightGrams);
  const availableGrams = normalizeNumber(product?.availableGrams);
  const salePrice = normalizeNumber(product?.salePrice);
  const stock = normalizeNumber(product?.stock);
  const minStock = normalizeNumber(product?.minStock);

  if (
    !id
    || !code
    || !name
    || !validStatus(status)
    || [weightGrams, availableGrams, salePrice, stock, minStock].some(Number.isNaN)
  ) {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor devolvió un producto remoto incompleto.');
  }

  return {
    id,
    code,
    name,
    category: normalizeText(product?.category),
    reference: normalizeText(product?.reference),
    description: normalizeText(product?.description),
    weightGrams,
    availableGrams,
    salePrice,
    stock,
    minStock,
    status,
  };
}

function validateProducts(value: unknown): OnlineProduct[] {
  if (!Array.isArray(value)) {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor no devolvió una colección válida de productos.');
  }
  return value.map(validateProduct);
}

function validateInventoryItem(value: unknown): OnlineInventoryItem {
  const item = value as Partial<OnlineInventoryItem> | null;
  const id = normalizeText(item?.id);
  const code = normalizeText(item?.code);
  const name = normalizeText(item?.name);
  const status = item?.status;
  const stock = normalizeNumber(item?.stock);
  const availableGrams = normalizeNumber(item?.availableGrams);
  const weightGrams = normalizeNumber(item?.weightGrams);
  const minStock = normalizeNumber(item?.minStock);

  let lastMovement: OnlineInventoryMovement | null = null;
  if (item?.lastMovement !== null && item?.lastMovement !== undefined) {
    const date = normalizeText(item.lastMovement.date);
    const type = item.lastMovement.type;
    if (!date || !['increase', 'decrease'].includes(String(type))) {
      throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El último movimiento remoto no es válido.');
    }
    lastMovement = { date, type: type as OnlineInventoryMovement['type'] };
  }

  if (
    !id
    || !code
    || !name
    || !validStatus(status)
    || [stock, availableGrams, weightGrams, minStock].some(Number.isNaN)
  ) {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor devolvió una referencia de inventario incompleta.');
  }

  return {
    id,
    code,
    name,
    category: normalizeText(item?.category),
    stock,
    availableGrams,
    weightGrams,
    minStock,
    location: normalizeText(item?.location),
    lastMovement,
    status,
  };
}

function validateInventory(value: unknown): OnlineInventoryItem[] {
  if (!Array.isArray(value)) {
    throw new OnlineRepositoryReadError('HTTPS_RESPONSE_INVALID', 'El servidor no devolvió una colección válida de inventario.');
  }
  return value.map(validateInventoryItem);
}

export class OnlineProductsRepository {
  private readonly connection: OnlineRepositoryReaderConnection;
  private readonly transport: OnlineProductsTransport;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<CachedRead<unknown>>>();

  constructor(
    connection: OnlineRepositoryReaderConnection,
    dependencies: OnlineProductsRepositoryDependencies = {},
  ) {
    this.connection = validConnection(connection);
    this.transport = dependencies.transport || defaultTransport;
    this.now = dependencies.now || Date.now;
    const ttl = Number(dependencies.cacheTtlMs ?? ONLINE_PRODUCTS_CACHE_TTL_MS);
    this.cacheTtlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : ONLINE_PRODUCTS_CACHE_TTL_MS;
  }

  clearCache(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async read<T>(
    cacheKey: string,
    resource: OnlineProductsResource,
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

  async getProducts(force = false): Promise<OnlineProductsSnapshot> {
    const result = await this.read('products', 'products', undefined, validateProducts, force);
    return {
      products: [...result.data],
      totalProducts: result.data.length,
      lastCommunication: result.communicatedAt,
      latencyMs: result.latencyMs,
      fromCache: result.fromCache,
      cacheExpiresAt: new Date(result.expiresAtMs).toISOString(),
    };
  }

  async getProduct(id: string, force = false): Promise<OnlineProduct> {
    const productId = normalizeText(id);
    if (!productId) {
      throw new OnlineRepositoryReadError('HTTPS_PRODUCT_ID_INVALID', 'El identificador del producto es obligatorio.');
    }
    return (await this.read(
      `product:${productId}`,
      'product',
      { id: productId },
      validateProduct,
      force,
    )).data;
  }

  async searchProducts(query: string, force = false): Promise<OnlineProduct[]> {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return (await this.getProducts(force)).products;
    return (await this.read(
      `products-search:${normalizedQuery.toLocaleLowerCase()}`,
      'productsSearch',
      { query: normalizedQuery },
      validateProducts,
      force,
    )).data;
  }

  async getInventory(force = false): Promise<OnlineInventorySnapshot> {
    const result = await this.read('inventory', 'inventory', undefined, validateInventory, force);
    return {
      items: [...result.data],
      totalReferences: result.data.length,
      totalExistences: result.data.reduce((sum, item) => sum + item.stock, 0),
      totalAvailableGrams: result.data.reduce((sum, item) => sum + item.availableGrams, 0),
      lastCommunication: result.communicatedAt,
      latencyMs: result.latencyMs,
      fromCache: result.fromCache,
      cacheExpiresAt: new Date(result.expiresAtMs).toISOString(),
    };
  }

  async getInventoryItem(id: string, force = false): Promise<OnlineInventoryItem> {
    const inventoryId = normalizeText(id);
    if (!inventoryId) {
      throw new OnlineRepositoryReadError('HTTPS_INVENTORY_ID_INVALID', 'El identificador de inventario es obligatorio.');
    }
    return (await this.read(
      `inventory:${inventoryId}`,
      'inventoryItem',
      { id: inventoryId },
      validateInventoryItem,
      force,
    )).data;
  }
}
