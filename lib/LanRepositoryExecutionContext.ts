import type { UserRole } from '@/lib/localDb';

export interface AuthorizedLanRepositorySession {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: string[];
}

let activeSession: AuthorizedLanRepositorySession | null = null;

export function getAuthorizedLanRepositorySession(): AuthorizedLanRepositorySession | null {
  return activeSession;
}

/**
 * Executes one Repository request that has already passed the authoritative
 * validation in electron/lanServer.js. The renderer bridge serializes these
 * calls, so the context cannot leak between concurrent LAN requests.
 */
export async function runWithAuthorizedLanRepositorySession<T>(
  session: AuthorizedLanRepositorySession | null | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!session?.id || !session.username || !session.role) {
    throw new Error('LAN_AUTH_CONTEXT_REQUIRED');
  }

  const previous = activeSession;
  activeSession = {
    id: String(session.id),
    username: String(session.username),
    displayName: String(session.displayName || session.username),
    role: session.role,
    permissions: Array.isArray(session.permissions)
      ? session.permissions.map(permission => String(permission))
      : [],
  };

  try {
    return await operation();
  } finally {
    activeSession = previous;
  }
}
