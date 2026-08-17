import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LAN_PORT = 47831;
export const DEFAULT_LAN_PROTOCOL_VERSION = 'LAN-1';
export const LAN_SERVER_DESCRIPTOR_FILENAME = 'lan-server-descriptor.json';

const AUTOMATIC_ADDRESS_MODE = 'automatic';
const REMOTE_ADDRESS_MODE = 'remote';
const AUTOMATIC_IP_SOURCE = 'automatic';
const PERSISTED_IP_SOURCE = 'persisted';
const UNAVAILABLE_IP_SOURCE = 'unavailable';

function isIpv4(value) {
  const parts = String(value || '').trim().split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function isLanIpv4(value) {
  if (!isIpv4(value)) return false;
  const [a, b] = String(value).split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

function isRejectedInterfaceName(name) {
  const normalized = String(name || '').toLowerCase();
  return /(virtual|vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|loopback|tailscale|zerotier|hamachi|wireguard|\bvpn\b|\btun\d*\b|\btap\d*\b|host-only|default switch|internal switch|local area connection\*|bridge|\bbr[-_])/i.test(normalized);
}

function interfacePreference(name) {
  const normalized = String(name || '').toLowerCase();
  if (/(^|\b)(ethernet|eth\d*|en\d+|enp\w*|eno\w*)(\b|$)/.test(normalized)) return 300;
  if (/(wi-?fi|wireless|wlan|wl\w*)/.test(normalized)) return 200;
  return 100;
}

function candidateScore(candidate) {
  let score = interfacePreference(candidate.name);
  if (candidate.address.startsWith('192.168.')) score += 40;
  else if (candidate.address.startsWith('10.')) score += 30;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(candidate.address)) score += 20;
  return score;
}

export function detectLanIpv4(networkInterfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces || {})) {
    if (isRejectedInterfaceName(name)) continue;
    for (const item of addresses || []) {
      const ipv4 = item.family === 'IPv4' || item.family === 4;
      if (!ipv4 || item.internal || !isLanIpv4(item.address)) continue;
      candidates.push({ name, address: item.address });
    }
  }
  candidates.sort((left, right) => candidateScore(right) - candidateScore(left));
  return candidates[0]?.address || '';
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_LAN_PORT;
}

function normalizeLanIp(value) {
  const ip = String(value || '').trim();
  return isLanIpv4(ip) ? ip : '';
}

function normalizeAddressMode(value, enabled = false) {
  if (value === AUTOMATIC_ADDRESS_MODE || value === REMOTE_ADDRESS_MODE) return value;
  return enabled ? AUTOMATIC_ADDRESS_MODE : REMOTE_ADDRESS_MODE;
}

function normalizeIpSource(value, addressMode, ip, networkAvailable) {
  if (!networkAvailable || !ip) return UNAVAILABLE_IP_SOURCE;
  if (addressMode === AUTOMATIC_ADDRESS_MODE) return value === PERSISTED_IP_SOURCE ? PERSISTED_IP_SOURCE : AUTOMATIC_IP_SOURCE;
  return ['discovered', 'manual', PERSISTED_IP_SOURCE].includes(value) ? value : PERSISTED_IP_SOURCE;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildBaseUrl(ip, port) {
  return ip ? `http://${ip}:${port}` : '';
}

function removeLegacyFile(file) {
  try { fs.rmSync(file, { force: true }); } catch {}
}

function addressChanged(left, right) {
  return left.ip !== right.ip
    || left.baseUrl !== right.baseUrl
    || left.lastLanIp !== right.lastLanIp
    || left.ipSource !== right.ipSource
    || left.ipUpdatedAt !== right.ipUpdatedAt
    || left.networkAvailable !== right.networkAvailable;
}

export class LanServerDescriptor {
  constructor(userDataPath) {
    if (!userDataPath) throw new Error('LAN_DESCRIPTOR_USER_DATA_PATH_REQUIRED');
    this.userDataPath = userDataPath;
    this.filePath = path.join(userDataPath, LAN_SERVER_DESCRIPTOR_FILENAME);
    this.data = null;
  }

  createDefault() {
    return {
      serverId: '', companyId: '', serverName: 'Servidor JoyaControl', ip: '',
      port: DEFAULT_LAN_PORT, protocolVersion: DEFAULT_LAN_PROTOCOL_VERSION, baseUrl: '',
      enabled: false, allowMultipleUserSessions: false, addressMode: REMOTE_ADDRESS_MODE,
      lastLanIp: '', ipSource: UNAVAILABLE_IP_SOURCE, ipUpdatedAt: null, networkAvailable: false,
    };
  }

  migrateLegacy(defaults) {
    const legacyServerConfigPath = path.join(this.userDataPath, 'lan-server-config.json');
    const legacyConfig = readJson(legacyServerConfigPath) || {};
    const legacyServerIdPath = path.join(this.userDataPath, 'lan-server-id.txt');
    const legacyCompanyIdPath = path.join(this.userDataPath, 'lan-company-id.txt');
    const candidateIp = normalizeLanIp(legacyConfig.host) || defaults.ip;
    const enabled = legacyConfig.enabled === true;
    const migrated = {
      ...defaults,
      serverId: readText(legacyServerIdPath),
      companyId: readText(legacyCompanyIdPath),
      serverName: String(legacyConfig.serverName || defaults.serverName).trim() || defaults.serverName,
      ip: candidateIp,
      port: normalizePort(legacyConfig.port),
      enabled,
      allowMultipleUserSessions: legacyConfig.allowMultipleUserSessions === true,
      addressMode: enabled ? AUTOMATIC_ADDRESS_MODE : REMOTE_ADDRESS_MODE,
      lastLanIp: candidateIp,
      ipSource: candidateIp ? PERSISTED_IP_SOURCE : UNAVAILABLE_IP_SOURCE,
      ipUpdatedAt: candidateIp ? new Date().toISOString() : null,
      networkAvailable: Boolean(candidateIp),
    };
    migrated.baseUrl = buildBaseUrl(migrated.ip, migrated.port);
    removeLegacyFile(legacyServerIdPath);
    removeLegacyFile(legacyCompanyIdPath);
    removeLegacyFile(legacyServerConfigPath);
    return migrated;
  }

  normalize(input = {}, defaults = this.createDefault()) {
    const enabled = input.enabled === true;
    const addressMode = normalizeAddressMode(input.addressMode, enabled);
    const hasExplicitIp = Object.prototype.hasOwnProperty.call(input, 'ip');
    const ip = hasExplicitIp ? normalizeLanIp(input.ip) : normalizeLanIp(defaults.ip);
    const port = normalizePort(input.port ?? defaults.port);
    const hasExplicitLastLanIp = Object.prototype.hasOwnProperty.call(input, 'lastLanIp');
    const lastLanIp = hasExplicitLastLanIp ? normalizeLanIp(input.lastLanIp) : ip || normalizeLanIp(defaults.lastLanIp);
    const networkAvailable = typeof input.networkAvailable === 'boolean' ? input.networkAvailable && Boolean(ip) : Boolean(ip);
    return {
      serverId: typeof input.serverId === 'string' ? input.serverId.trim() : defaults.serverId,
      companyId: typeof input.companyId === 'string' ? input.companyId.trim() : defaults.companyId,
      serverName: String(input.serverName || defaults.serverName).trim() || defaults.serverName,
      ip, port,
      protocolVersion: String(input.protocolVersion || defaults.protocolVersion).trim() || DEFAULT_LAN_PROTOCOL_VERSION,
      baseUrl: buildBaseUrl(ip, port),
      enabled,
      allowMultipleUserSessions: input.allowMultipleUserSessions === true,
      addressMode,
      lastLanIp,
      ipSource: normalizeIpSource(input.ipSource, addressMode, ip, networkAvailable),
      ipUpdatedAt: normalizeTimestamp(input.ipUpdatedAt) || (ip ? normalizeTimestamp(defaults.ipUpdatedAt) : null),
      networkAvailable,
    };
  }

  load() {
    if (this.data) return this.toJSON();
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const defaults = this.createDefault();
    const existing = readJson(this.filePath);
    this.data = existing ? this.normalize(existing, defaults) : this.migrateLegacy(defaults);
    this.save();
    return this.toJSON();
  }

  refreshDetectedIp(detectedIp = detectLanIpv4()) {
    this.load();
    if (this.data.addressMode !== AUTOMATIC_ADDRESS_MODE && this.data.enabled !== true) return this.toJSON();
    const previous = this.toJSON();
    const normalizedDetectedIp = normalizeLanIp(detectedIp);
    const now = new Date().toISOString();
    if (normalizedDetectedIp) {
      this.data.ip = normalizedDetectedIp;
      this.data.lastLanIp = normalizedDetectedIp;
      this.data.ipSource = AUTOMATIC_IP_SOURCE;
      this.data.networkAvailable = true;
      if (previous.ip !== normalizedDetectedIp || previous.ipSource !== AUTOMATIC_IP_SOURCE || previous.networkAvailable !== true) this.data.ipUpdatedAt = now;
    } else {
      this.data.ip = '';
      this.data.ipSource = UNAVAILABLE_IP_SOURCE;
      this.data.networkAvailable = false;
      if (previous.ip || previous.networkAvailable !== false || previous.ipSource !== UNAVAILABLE_IP_SOURCE) this.data.ipUpdatedAt = now;
    }
    this.data.baseUrl = buildBaseUrl(this.data.ip, this.data.port);
    if (addressChanged(previous, this.data)) this.save();
    return this.toJSON();
  }

  ensureServerIdentity() {
    this.load();
    let changed = false;
    if (!this.data.serverId) { this.data.serverId = crypto.randomUUID(); changed = true; }
    if (!this.data.companyId) { this.data.companyId = crypto.randomUUID(); changed = true; }
    if (changed) this.save();
    return this.refreshDetectedIp();
  }

  getServerId() { return this.load().serverId; }
  getCompanyId() { return this.load().companyId; }
  getAddress() { const current = this.load(); return current.ip ? `${current.ip}:${current.port}` : ''; }
  getBaseUrl() { return this.load().baseUrl; }

  updateIp(ip) {
    this.load();
    const normalized = normalizeLanIp(ip);
    if (!normalized) throw new Error('LAN_DESCRIPTOR_INVALID_IP');
    this.data.ip = normalized;
    this.data.lastLanIp = normalized;
    this.data.ipSource = this.data.addressMode === AUTOMATIC_ADDRESS_MODE ? AUTOMATIC_IP_SOURCE : PERSISTED_IP_SOURCE;
    this.data.ipUpdatedAt = new Date().toISOString();
    this.data.networkAvailable = true;
    this.data.baseUrl = buildBaseUrl(this.data.ip, this.data.port);
    this.save();
    return this.toJSON();
  }

  update(patch = {}) {
    const current = this.load();
    const switchingToAutomatic = patch.addressMode === AUTOMATIC_ADDRESS_MODE && current.addressMode !== AUTOMATIC_ADDRESS_MODE;
    const normalizedPatch = switchingToAutomatic
      ? { ...patch, ip: '', lastLanIp: '', ipSource: UNAVAILABLE_IP_SOURCE, ipUpdatedAt: null, networkAvailable: false }
      : patch;
    this.data = this.normalize({ ...current, ...normalizedPatch }, current);
    this.save();
    return this.toJSON();
  }

  reset() { this.data = this.createDefault(); this.save(); return this.toJSON(); }

  save() {
    if (!this.data) this.data = this.createDefault();
    this.data.baseUrl = buildBaseUrl(this.data.ip, this.data.port);
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
    return this.toJSON();
  }

  toJSON() { if (!this.data) this.load(); return { ...this.data }; }
}
