import { localDb, type UserRole } from '@/lib/localDb';
import { toast } from '@/hooks/use-toast';

// Password hashing remains client-side in Local mode. In LAN mode the server
// will own credential verification; ApiRepository never sends stored hashes.
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'joyacontrol_v2_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await hashPassword(password)) === hash;
}

const SESSION_KEY = 'joyacontrol_session';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** Permission snapshot issued by the Principal Server for LAN sessions. */
  permissions?: string[];
}

export function getSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as SessionUser : null;
  } catch {
    return null;
  }
}

export function setSession(user: SessionUser): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export type Permission =
  | 'view_reports'
  | 'view_purchases'
  | 'manage_inventory'
  | 'manage_products'
  | 'manage_contacts'
  | 'manage_users'
  | 'manage_settings'
  | 'create_sales'
  | 'edit_sales'
  | 'cancel_invoices'
  | 'manage_purchases'
  | 'manage_quotations'
  | 'manage_layaways'
  | 'manage_cash'
  | 'manage_expenses'
  | 'manage_finances'
  | 'manage_accounts_payable'
  | 'apply_discount_high'
  | 'view_activity_log'
  | 'write_activity_log'
  | 'manage_backup'
  | 'view_accounts_payable'
  | 'change_own_password'
  | 'system_maintenance';

const ALL_PERMISSIONS: Permission[] = [
  'view_reports',
  'view_purchases',
  'manage_inventory',
  'manage_products',
  'manage_contacts',
  'manage_users',
  'manage_settings',
  'create_sales',
  'edit_sales',
  'cancel_invoices',
  'manage_purchases',
  'manage_quotations',
  'manage_layaways',
  'manage_cash',
  'manage_expenses',
  'manage_finances',
  'manage_accounts_payable',
  'apply_discount_high',
  'view_activity_log',
  'write_activity_log',
  'manage_backup',
  'view_accounts_payable',
  'change_own_password',
  'system_maintenance',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  master: ALL_PERMISSIONS,
  admin: [
    'view_reports', 'view_purchases', 'manage_inventory', 'manage_products',
    'manage_contacts', 'create_sales', 'edit_sales', 'cancel_invoices',
    'manage_purchases', 'manage_quotations', 'manage_layaways', 'manage_cash',
    'manage_expenses', 'manage_finances', 'manage_accounts_payable',
    'apply_discount_high', 'view_activity_log', 'write_activity_log',
    'manage_backup', 'view_accounts_payable', 'change_own_password',
    'system_maintenance',
  ],
  vendedor: [
    'view_purchases', 'manage_contacts', 'create_sales', 'manage_purchases',
    'manage_quotations', 'manage_layaways', 'write_activity_log',
    'change_own_password', 'system_maintenance',
  ],
  cajero: [
    'create_sales', 'cancel_invoices', 'manage_layaways', 'manage_cash',
    'write_activity_log', 'change_own_password', 'system_maintenance',
  ],
};

export function getRolePermissions(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * UI authorization helper. LAN sessions use the exact permission snapshot
 * issued by the Principal Server; local sessions retain the existing role map.
 */
export function hasSessionPermission(
  user: SessionUser | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  return hasPermission(user.role, permission);
}

export const PERMISSION_DENIED_MESSAGE = 'No tiene permisos para realizar esta operación.';

export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(PERMISSION_DENIED_MESSAGE);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
  }
}

export function isPermissionDeniedError(error: unknown): error is PermissionDeniedError {
  return error instanceof PermissionDeniedError || (
    error instanceof Error && error.message === PERMISSION_DENIED_MESSAGE
  );
}

const denyPermission = (permission: Permission): never => {
  // Schedule the canonical message after any caller-level catch/toast so a
  // generic error cannot replace the permission explanation.
  setTimeout(() => {
    toast({
      title: PERMISSION_DENIED_MESSAGE,
      variant: 'destructive',
    });
  }, 0);
  throw new PermissionDeniedError(permission);
};

/**
 * Authoritative write guard for Local/Desktop mode.
 *
 * The role stored in sessionStorage is never trusted by itself. Every check
 * reloads the user from Dexie, verifies that the account is active and uses
 * the persisted role. Callers must await this function before opening a Dexie
 * write transaction or changing application state.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = getSession();
  if (!session?.id) return denyPermission(permission);

  const persistedUser = await localDb.users.get(session.id);
  if (
    !persistedUser ||
    !persistedUser.active ||
    persistedUser.username !== session.username ||
    !hasPermission(persistedUser.role, permission)
  ) {
    return denyPermission(permission);
  }

  const authoritativeSession: SessionUser = {
    id: persistedUser.id,
    username: persistedUser.username,
    displayName: persistedUser.display_name,
    role: persistedUser.role,
    permissions: session.permissions,
  };

  if (
    session.displayName !== authoritativeSession.displayName ||
    session.role !== authoritativeSession.role
  ) {
    setSession(authoritativeSession);
  }

  return authoritativeSession;
}


const ROUTE_PERMISSIONS: Record<string, Permission[]> = {
  '/reportes': ['view_reports'],
  '/compras': ['view_purchases'],
  '/cuentas-por-pagar/nueva': ['manage_purchases'],
  '/cuentas-por-pagar/editar': ['manage_purchases'],
  '/inventario': ['manage_inventory', 'manage_products'],
  '/inventario/nuevo': ['manage_products'],
  '/inventario/ajustes': ['manage_inventory'],
  '/contactos': ['manage_contacts'],
  '/cotizaciones': ['manage_quotations'],
  '/cotizaciones/nueva': ['manage_quotations'],
  '/cuentas-por-pagar': ['view_accounts_payable', 'manage_accounts_payable'],
  '/configuracion': ['manage_settings'],
  '/configuracion/lan': ['manage_settings'],
  '/respaldos': ['manage_backup'],
  '/usuarios': ['manage_users'],
  '/actividad': ['view_activity_log'],
  '/finanzas': ['manage_finances'],
};

export function hasRouteAccess(
  user: SessionUser | null | undefined,
  path: string,
): boolean {
  if (!user) return false;

  const required = ROUTE_PERMISSIONS[path];

  if (Array.isArray(user.permissions)) {
    if (!required) return true;
    return required.some(permission => user.permissions?.includes(permission));
  }

  // Legacy local installations without a permission snapshot.
  return canAccess(user.role, path);
}

export function canAccess(role: UserRole, path: string): boolean {
  const rules: Record<string, UserRole[]> = {
    '/reportes': ['master', 'admin'],
    '/compras': ['master', 'admin', 'vendedor'],
    '/cuentas-por-pagar/nueva': ['master', 'admin', 'vendedor'],
    '/cuentas-por-pagar/editar': ['master', 'admin', 'vendedor'],
    '/inventario': ['master', 'admin', 'vendedor'],
    '/inventario/nuevo': ['master', 'admin'],
    '/inventario/ajustes': ['master', 'admin'],
    '/contactos': ['master', 'admin', 'vendedor'],
    '/cotizaciones': ['master', 'admin', 'vendedor'],
    '/cotizaciones/nueva': ['master', 'admin', 'vendedor'],
    '/cuentas-por-pagar': ['master', 'admin'],
    '/configuracion': ['master'],
    '/configuracion/lan': ['master'],
    '/respaldos': ['master', 'admin'],
    '/usuarios': ['master'],
    '/actividad': ['master', 'admin'],
  };
  const allowed = rules[path];
  return allowed ? allowed.includes(role) : true;
}
