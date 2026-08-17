export interface OnlineServerSelection {
  url: string;
  port: number;
  baseUrl: string;
  serverId: string;
  serverName: string;
  version: string;
  hostname: string;
  savedAt: string;
}

const STORAGE_KEY = 'joyacontrol_https_selected_server';

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function normalizeBaseUrl(url: string, port: number): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('HTTPS_SERVER_URL_INVALID');
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('HTTPS_SERVER_URL_INVALID');
  }
  parsed.port = port === 443 ? '' : String(port);
  return parsed.origin;
}

function sanitizeSelection(selection: OnlineServerSelection): OnlineServerSelection {
  const url = String(selection.url || '').trim();
  const port = Number(selection.port);
  const serverId = String(selection.serverId || '').trim();
  const serverName = String(selection.serverName || '').trim();
  const version = String(selection.version || '').trim();
  const hostname = String(selection.hostname || '').trim();
  const savedAt = String(selection.savedAt || '').trim() || new Date().toISOString();

  if (!url || !isValidPort(port) || !serverId || !serverName || !version || !hostname) {
    throw new Error('HTTPS_SERVER_CONFIG_INVALID');
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') throw new Error('HTTPS_SERVER_URL_INVALID');
  parsedUrl.port = '';
  parsedUrl.pathname = '/';
  parsedUrl.search = '';
  parsedUrl.hash = '';
  const normalizedUrl = parsedUrl.origin;

  return {
    url: normalizedUrl,
    port,
    baseUrl: normalizeBaseUrl(normalizedUrl, port),
    serverId,
    serverName,
    version,
    hostname,
    savedAt,
  };
}

export function loadOnlineServerSelection(): OnlineServerSelection | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const selection = sanitizeSelection(JSON.parse(raw) as OnlineServerSelection);
    const normalized = JSON.stringify(selection);
    if (raw !== normalized) window.localStorage.setItem(STORAGE_KEY, normalized);
    return selection;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveOnlineServerSelection(selection: OnlineServerSelection): OnlineServerSelection {
  const sanitized = sanitizeSelection(selection);
  if (hasBrowserStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent('joyacontrol-https-server-changed', { detail: sanitized }));
  }
  return sanitized;
}

export function clearOnlineServerSelection(): void {
  if (!hasBrowserStorage()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('joyacontrol-https-server-changed', { detail: null }));
}

export const ONLINE_SERVER_STORAGE_KEY = STORAGE_KEY;
