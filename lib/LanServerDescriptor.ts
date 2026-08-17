export type LanServerAddressMode = 'automatic' | 'remote';
export type LanServerIpSource = 'automatic' | 'persisted' | 'discovered' | 'manual' | 'unavailable';

export interface LanServerDescriptorData {
  serverId: string;
  companyId: string;
  serverName: string;
  ip: string;
  port: number;
  protocolVersion: string;
  baseUrl: string;
  enabled?: boolean;
  allowMultipleUserSessions?: boolean;
  addressMode?: LanServerAddressMode;
  lastLanIp?: string;
  ipSource?: LanServerIpSource;
  ipUpdatedAt?: string | null;
  networkAvailable?: boolean;
}

export type LanServerDescriptorPatch = Partial<LanServerDescriptorData>;

const DEFAULT_PORT = 47831;
const DEFAULT_PROTOCOL_VERSION = 'LAN-1';
const DESCRIPTOR_CHANGED_EVENT = 'joyacontrol-lan-server-descriptor-changed';

function emptyDescriptor(): LanServerDescriptorData {
  return {
    serverId: '', companyId: '', serverName: 'Servidor JoyaControl', ip: '', port: DEFAULT_PORT,
    protocolVersion: DEFAULT_PROTOCOL_VERSION, baseUrl: '', enabled: false, allowMultipleUserSessions: false,
    addressMode: 'remote', lastLanIp: '', ipSource: 'unavailable', ipUpdatedAt: null, networkAvailable: false,
  };
}

function isValidIpv4(value: string): boolean {
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function isValidLanIpv4(value: string): boolean {
  if (!isValidIpv4(value)) return false;
  const [first, second] = value.trim().split('.').map(Number);
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  return first === 172 && second >= 16 && second <= 31;
}

function normalizePort(value: number): number { return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : DEFAULT_PORT; }
function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function normalizeAddressMode(value: unknown, enabled: boolean): LanServerAddressMode {
  if (value === 'automatic' || value === 'remote') return value;
  return enabled ? 'automatic' : 'remote';
}
function normalizeIpSource(value: unknown, addressMode: LanServerAddressMode, ip: string, networkAvailable: boolean): LanServerIpSource {
  if (!ip || !networkAvailable) return 'unavailable';
  if (addressMode === 'automatic') return value === 'persisted' ? 'persisted' : 'automatic';
  return value === 'discovered' || value === 'manual' || value === 'persisted' ? value : 'persisted';
}

function normalize(input?: Partial<LanServerDescriptorData> | null): LanServerDescriptorData {
  const fallback = emptyDescriptor();
  const ip = typeof input?.ip === 'string' && isValidLanIpv4(input.ip) ? input.ip.trim() : '';
  const lastLanIp = typeof input?.lastLanIp === 'string' && isValidLanIpv4(input.lastLanIp) ? input.lastLanIp.trim() : ip;
  const port = normalizePort(Number(input?.port ?? fallback.port));
  const enabled = input?.enabled === true;
  const addressMode = normalizeAddressMode(input?.addressMode, enabled);
  const networkAvailable = typeof input?.networkAvailable === 'boolean' ? input.networkAvailable && Boolean(ip) : Boolean(ip);
  return {
    serverId: typeof input?.serverId === 'string' ? input.serverId.trim() : '',
    companyId: typeof input?.companyId === 'string' ? input.companyId.trim() : '',
    serverName: typeof input?.serverName === 'string' && input.serverName.trim() ? input.serverName.trim() : fallback.serverName,
    ip, port,
    protocolVersion: typeof input?.protocolVersion === 'string' && input.protocolVersion.trim() ? input.protocolVersion.trim() : fallback.protocolVersion,
    baseUrl: ip ? `http://${ip}:${port}` : '', enabled,
    allowMultipleUserSessions: input?.allowMultipleUserSessions === true,
    addressMode, lastLanIp,
    ipSource: normalizeIpSource(input?.ipSource, addressMode, ip, networkAvailable),
    ipUpdatedAt: normalizeTimestamp(input?.ipUpdatedAt), networkAvailable,
  };
}

function emitChanged(descriptor: LanServerDescriptorData): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DESCRIPTOR_CHANGED_EVENT, { detail: descriptor }));
}

let cachedDescriptor = emptyDescriptor();
let loaded = false;

export class LanServerDescriptor {
  static readonly changedEvent = DESCRIPTOR_CHANGED_EVENT;
  static load(): LanServerDescriptorData {
    if (typeof window === 'undefined') return { ...cachedDescriptor };
    try {
      const persisted = window.joyaControlLan?.getServerDescriptorSync?.();
      if (persisted) { cachedDescriptor = normalize(persisted); loaded = true; }
    } catch {}
    return { ...cachedDescriptor };
  }
  static async refresh(): Promise<LanServerDescriptorData> {
    if (typeof window === 'undefined') return this.load();
    const persisted = await window.joyaControlLan?.loadServerDescriptor?.();
    if (persisted) { cachedDescriptor = normalize(persisted); loaded = true; emitChanged(cachedDescriptor); }
    return { ...cachedDescriptor };
  }
  static getServerId(): string { return this.load().serverId; }
  static getCompanyId(): string { return this.load().companyId; }
  static getAddress(): string { const descriptor = this.load(); return descriptor.ip ? `${descriptor.ip}:${descriptor.port}` : ''; }
  static getBaseUrl(): string { const baseUrl = this.load().baseUrl; if (!baseUrl) throw new Error('LAN_SERVER_DESCRIPTOR_ADDRESS_NOT_AVAILABLE'); return baseUrl; }
  static hasAddress(): boolean { return Boolean(this.load().baseUrl); }
  static async updateIp(ip: string): Promise<LanServerDescriptorData> {
    if (!isValidLanIpv4(ip)) throw new Error('LAN_DESCRIPTOR_INVALID_IP');
    const current = this.load();
    return this.save({ ip, lastLanIp: ip, ipSource: current.addressMode === 'automatic' ? 'automatic' : 'manual', ipUpdatedAt: new Date().toISOString(), networkAvailable: true });
  }
  static saveSync(patch: LanServerDescriptorPatch = {}): LanServerDescriptorData {
    const current = loaded ? cachedDescriptor : this.load();
    cachedDescriptor = normalize({ ...current, ...patch }); loaded = true; emitChanged(cachedDescriptor);
    if (typeof window !== 'undefined' && window.joyaControlLan?.saveServerDescriptorSync) {
      cachedDescriptor = normalize(window.joyaControlLan.saveServerDescriptorSync(cachedDescriptor)); emitChanged(cachedDescriptor);
    }
    return { ...cachedDescriptor };
  }
  static async save(patch: LanServerDescriptorPatch = {}): Promise<LanServerDescriptorData> {
    const current = loaded ? cachedDescriptor : this.load();
    const next = normalize({ ...current, ...patch }); cachedDescriptor = next; loaded = true; emitChanged(next);
    if (typeof window !== 'undefined' && window.joyaControlLan?.saveServerDescriptor) {
      cachedDescriptor = normalize(await window.joyaControlLan.saveServerDescriptor(next)); emitChanged(cachedDescriptor);
    }
    return { ...cachedDescriptor };
  }
  static async rememberServer(server: { serverId: string; companyId: string; serverName: string; ip: string; port: number; protocolVersion: string }): Promise<LanServerDescriptorData> {
    const current = this.load();
    if (current.serverId && current.serverId !== server.serverId) throw new Error('LAN_SERVER_ID_MISMATCH');
    if (current.companyId && current.companyId !== server.companyId) throw new Error('LAN_COMPANY_MISMATCH');
    return this.save({ ...server, enabled: false, addressMode: 'remote', lastLanIp: server.ip, ipSource: 'discovered', ipUpdatedAt: new Date().toISOString(), networkAvailable: true });
  }
  static async reset(): Promise<LanServerDescriptorData> {
    cachedDescriptor = emptyDescriptor(); loaded = true; emitChanged(cachedDescriptor);
    if (typeof window !== 'undefined' && window.joyaControlLan?.resetServerDescriptor) {
      cachedDescriptor = normalize(await window.joyaControlLan.resetServerDescriptor()); emitChanged(cachedDescriptor);
    }
    return { ...cachedDescriptor };
  }
  static toJSON(): LanServerDescriptorData { return this.load(); }
}
