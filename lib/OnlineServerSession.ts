export interface OnlineServerSession {
  sessionId: string;
  serverId: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  version: string;
  url: string;
  port: number;
  baseUrl: string;
  savedAt: string;
}

const STORAGE_KEY = 'joyacontrol_https_session';
export const HTTPS_CLIENT_VERSION = '3.0.0';

export const ONLINE_SESSION_INVALIDATING_ERRORS = new Set([
  'HTTPS_SESSION_EXPIRED',
  'HTTPS_SESSION_INVALID',
  'HTTPS_SESSION_REQUIRED',
  'HTTPS_SERVER_MISMATCH',
  'HTTPS_VERSION_INCOMPATIBLE',
]);

export function shouldClearOnlineServerSession(errorCode: string): boolean {
  return ONLINE_SESSION_INVALIDATING_ERRORS.has(String(errorCode || '').trim());
}

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function normalizeEndpoint(url: string, port: number): { url: string; port: number; baseUrl: string } {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error('HTTPS_SESSION_PORT_INVALID');
  }

  const parsed = new URL(String(url || '').trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('HTTPS_SESSION_URL_INVALID');
  }
  parsed.port = '';
  const normalizedUrl = parsed.origin;
  const base = new URL(normalizedUrl);
  base.port = numericPort === 443 ? '' : String(numericPort);
  return { url: normalizedUrl, port: numericPort, baseUrl: base.origin };
}

function sanitizeSession(session: OnlineServerSession): OnlineServerSession {
  const sessionId = String(session.sessionId || '').trim();
  const serverId = String(session.serverId || '').trim();
  const username = String(session.username || '').trim();
  const displayName = String(session.displayName || '').trim();
  const role = String(session.role || '').trim();
  const createdAt = String(session.createdAt || '').trim();
  const expiresAt = String(session.expiresAt || '').trim();
  const version = String(session.version || '').trim();
  const savedAt = String(session.savedAt || '').trim() || new Date().toISOString();
  const endpoint = normalizeEndpoint(session.url, Number(session.port));

  if (
    sessionId.length < 20
    || !serverId
    || !username
    || !displayName
    || !role
    || !version
    || !validDate(createdAt)
    || !validDate(expiresAt)
    || !validDate(savedAt)
  ) {
    throw new Error('HTTPS_SESSION_INVALID');
  }

  return {
    sessionId,
    serverId,
    username,
    displayName,
    role,
    createdAt,
    expiresAt,
    version,
    url: endpoint.url,
    port: endpoint.port,
    baseUrl: endpoint.baseUrl,
    savedAt,
  };
}

export function isOnlineServerSessionExpired(
  session: Pick<OnlineServerSession, 'expiresAt'>,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function loadOnlineServerSession(): OnlineServerSession | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = sanitizeSession(JSON.parse(raw) as OnlineServerSession);
    const normalized = JSON.stringify(session);
    if (raw !== normalized) window.localStorage.setItem(STORAGE_KEY, normalized);
    return session;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveOnlineServerSession(session: OnlineServerSession): OnlineServerSession {
  const sanitized = sanitizeSession(session);
  if (hasBrowserStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent('joyacontrol-https-session-changed', { detail: sanitized }));
  }
  return sanitized;
}

export function clearOnlineServerSession(): void {
  if (!hasBrowserStorage()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('joyacontrol-https-session-changed', { detail: null }));
}

export const ONLINE_SERVER_SESSION_STORAGE_KEY = STORAGE_KEY;
