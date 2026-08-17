import type { UserRecord, UserRole } from '@/domain/models';
import { getDataRepository } from '@/repositories/RepositoryRegistry';
import {
  clearSession as clearStoredSession,
  setSession,
  type SessionUser,
} from '@/lib/authCore';
import {
  ensureLanClientSession,
  invalidateLanClientSession,
  isLanSessionExpirationError,
  loadLanConfig,
  loginLanUser,
  restoreLanUserWithGrace,
  logoutLanUser,
  type LanLoginOptions,
} from '@/lib/LanCommunicationConfig';

export {
  LanDuplicateLoginError,
  isLanDuplicateLoginError,
  type LanDuplicateSessionDetails,
  type LanLoginOptions,
} from '@/lib/LanCommunicationConfig';

export {
  hashPassword,
  verifyPassword,
  getSession,
  setSession,
  clearSession,
  hasPermission,
  hasSessionPermission,
  requirePermission,
  isPermissionDeniedError,
  PERMISSION_DENIED_MESSAGE,
  PermissionDeniedError,
  canAccess,
  hasRouteAccess,
  type SessionUser,
  type Permission,
} from '@/lib/authCore';

export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: UserRole,
): Promise<UserRecord> {
  return getDataRepository().createUser(username, displayName, password, role);
}

export async function loginUser(
  username: string,
  password: string,
  options: LanLoginOptions = {},
): Promise<SessionUser> {
  let config = loadLanConfig();
  let session: SessionUser;

  if (config.mode === 'lan' && config.role === 'client') {
    if (!config.clientId || !config.sessionToken) config = await ensureLanClientSession();

    const attempt = async () => {
      const remote = await loginLanUser(config, username, password, options);
      return {
        id: remote.userId!,
        username: remote.username!,
        displayName: remote.displayName || remote.username!,
        role: remote.role as UserRole,
        permissions: Array.isArray(remote.permissions) ? [...remote.permissions] : [],
      } satisfies SessionUser;
    };

    try {
      session = await attempt();
    } catch (error) {
      if (!isLanSessionExpirationError(error)) throw error;
      invalidateLanClientSession(error instanceof Error ? error.message : 'LAN_INVALID_SESSION', config.clientId);
      config = await ensureLanClientSession();
      session = await attempt();
    }
  } else {
    session = await getDataRepository().loginUser(username, password);
  }

  setSession(session);
  return session;
}

export async function restoreLanSession(): Promise<SessionUser | null> {
  let config = loadLanConfig();
  if (config.mode !== 'lan' || config.role !== 'client') return null;
  // A fresh client has no authenticated user to restore. Starting device
  // registration here would issue /health and /server-info before Login is
  // visible and could block first-run access when the server is unavailable.
  if (!config.authToken) return null;
  try {
    config = await ensureLanClientSession();
    const remote = await restoreLanUserWithGrace(config);
    if (!remote) return null;
    const session: SessionUser = {
      id: remote.userId!,
      username: remote.username!,
      displayName: remote.displayName || remote.username!,
      role: remote.role as UserRole,
      permissions: Array.isArray(remote.permissions) ? [...remote.permissions] : [],
    };
    setSession(session);
    return session;
  } catch (error) {
    if (error instanceof Error && error.message === 'LAN_AUTH_SESSION_CONFIRMED_EXPIRED') {
      clearStoredSession();
    }
    console.error('[LAN auth] session restoration failed', {
      at: new Date().toISOString(),
      error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  const config = loadLanConfig();
  if (config.mode === 'lan' && config.role === 'client') await logoutLanUser(config);
}


export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await getDataRepository().changePassword(userId, currentPassword, newPassword);
}

export async function getMasterExists(): Promise<boolean> {
  return getDataRepository().getMasterExists();
}

export async function logActivity(
  session: SessionUser,
  action: string,
  entity: string,
  entityId: string,
  detail = '',
): Promise<void> {
  await getDataRepository().logActivity(session, action, entity, entityId, detail);
}

export async function fetchUsers(): Promise<UserRecord[]> {
  return getDataRepository().fetchUsers();
}

export async function updateUser(
  userId: string,
  changes: Partial<Pick<UserRecord, 'active' | 'password_hash' | 'display_name' | 'role'>>,
): Promise<void> {
  await getDataRepository().updateUser(userId, changes);
}

export async function fetchActivityLog(limit = 500) {
  return getDataRepository().fetchActivityLog(limit);
}
