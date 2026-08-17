import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LanServerDescriptor } from './lanServerDescriptor.js';

const APP_VERSION = '2.1';
const MAX_CLIENTS = 5;
const DEFAULT_INACTIVE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETENTION_MS = 10 * 60_000;
const DEFAULT_SESSION_DURATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_JSON_PAYLOAD_BYTES = 32 * 1024;
const MAX_REPOSITORY_PAYLOAD_BYTES = 16 * 1024 * 1024;
const AUTHORIZED_SESSION_ARGUMENT = '__joyaControlAuthorizedLanSession';

const AUTHENTICATED_REPOSITORY_PERMISSIONS = Object.freeze([
  'view_reports', 'view_purchases', 'manage_inventory',
  'manage_products', 'manage_contacts', 'manage_settings', 'create_sales',
  'edit_sales', 'cancel_invoices', 'manage_purchases',
  'manage_quotations', 'manage_layaways', 'manage_cash', 'manage_expenses',
  'manage_finances', 'manage_accounts_payable', 'view_accounts_payable',
  'view_activity_log', 'write_activity_log', 'system_maintenance',
]);

const SALES_READ_PERMISSIONS = Object.freeze([
  'create_sales', 'edit_sales', 'cancel_invoices',
  'manage_quotations', 'manage_layaways', 'manage_cash',
  'view_reports',
]);

const PRODUCT_READ_PERMISSIONS = Object.freeze([
  'manage_products', 'manage_inventory', 'manage_purchases', 'view_purchases',
  ...SALES_READ_PERMISSIONS,
]);

const CONTACT_READ_PERMISSIONS = Object.freeze([
  'manage_contacts', 'manage_purchases', 'view_purchases',
  ...SALES_READ_PERMISSIONS,
]);

const REPORT_READ_PERMISSIONS = Object.freeze([
  'view_reports', 'view_activity_log',
]);

/**
 * Exact server-side authorization for the existing Repository contract.
 * Each entry is an any-of list. Roles are deliberately absent: the only
 * authority is the permission snapshot issued by the Principal Server login.
 */
const REPOSITORY_METHOD_PERMISSIONS = Object.freeze({
  getProducts: PRODUCT_READ_PERMISSIONS,
  searchProducts: PRODUCT_READ_PERMISSIONS,
  getProductById: PRODUCT_READ_PERMISSIONS,
  getCategories: PRODUCT_READ_PERMISSIONS,
  getDashboardMetrics: AUTHENTICATED_REPOSITORY_PERMISSIONS,
  getSalesWorkspace: SALES_READ_PERMISSIONS,
  getSalesClients: CONTACT_READ_PERMISSIONS,
  searchSalesClients: CONTACT_READ_PERMISSIONS,
  getSalesClientById: CONTACT_READ_PERMISSIONS,
  createSalesClient: ['manage_contacts'],
  updateSalesClient: ['manage_contacts'],
  deleteSalesClient: ['manage_contacts'],
  querySales: SALES_READ_PERMISSIONS,
  getSaleById: SALES_READ_PERMISSIONS,
  createSale: ['create_sales'],
  updateSaleStatus: ['edit_sales'],
  cancelSale: ['cancel_invoices'],
  applySalesContactChanges: ['manage_contacts'],
  createSalesQuotation: ['manage_quotations'],
  updateSalesQuotationStatus: ['manage_quotations'],
  createSalesLayaway: ['manage_layaways'],
  updateSalesLayaway: ['manage_layaways'],
  deleteSalesLayaway: ['manage_layaways'],
  addSalesLayawayPayment: ['manage_layaways'],
  completeSalesLayaway: ['manage_layaways'],

  fetchUsers: ['manage_users'],
  createUser: ['manage_users'],
  updateUser: ['manage_users'],
  changePassword: ['manage_users'],
  logActivity: AUTHENTICATED_REPOSITORY_PERMISSIONS,
  fetchCompany: AUTHENTICATED_REPOSITORY_PERMISSIONS,
  saveCompany: ['manage_settings'],
  upsertProduct: ['manage_products'],
  deleteProduct: ['manage_products'],
  applyProductChanges: ['manage_products'],
  fetchContacts: CONTACT_READ_PERMISSIONS,
  insertInvoice: ['create_sales', 'edit_sales'],
  upsertContact: ['manage_contacts'],
  deleteContact: ['manage_contacts'],
  applyContactChanges: ['manage_contacts'],
  fetchPurchaseInvoices: ['view_purchases', 'manage_purchases', 'view_reports'],
  createPurchaseWithInventory: ['manage_purchases'],
  updatePurchaseWithInventory: ['manage_purchases'],
  deletePurchaseWithInventory: ['manage_purchases'],
  markPurchaseAsPaid: ['manage_purchases'],
  fetchExpenses: ['manage_expenses', 'manage_cash', 'view_reports'],
  insertExpense: ['manage_expenses', 'manage_cash'],
  insertExpenseWithFinancials: ['manage_expenses', 'manage_cash'],
  updateExpenseWithFinancialAdjustment: ['manage_expenses', 'manage_cash'],
  fetchLayawayPayments: SALES_READ_PERMISSIONS,
  fetchCashSessions: ['manage_cash', 'view_reports'],
  insertCashSession: ['manage_cash'],
  closeCashSession: ['manage_cash'],
  fetchInventoryAdjustments: ['manage_inventory', 'view_reports'],
  applyInventoryAdjustment: ['manage_inventory'],
  fetchSupplierInvoices: ['manage_accounts_payable', 'view_accounts_payable', 'manage_purchases', 'view_purchases', 'view_reports'],
  insertSupplierInvoice: ['manage_accounts_payable', 'manage_purchases'],
  addSupplierInvoicePayment: ['manage_accounts_payable', 'manage_purchases'],
  updateSupplierInvoiceStatus: ['manage_accounts_payable', 'manage_purchases'],
  updateSupplierInvoiceSafe: ['manage_accounts_payable', 'manage_purchases'],
  deleteSupplierInvoiceSafe: ['manage_accounts_payable', 'manage_purchases'],
  fetchSupplierPaymentsForReports: ['view_reports', 'manage_accounts_payable', 'view_accounts_payable'],
  ensureDefaultFinancialAccounts: ['manage_cash', 'manage_finances'],
  fetchFinancialAccounts: ['create_sales', 'manage_cash', 'manage_finances', 'manage_purchases', 'manage_expenses'],
  createFinancialAccount: ['manage_cash', 'manage_finances'],
  transferBetweenAccounts: ['manage_cash', 'manage_finances'],
  fetchFinancialMovements: ['manage_cash', 'manage_finances', 'view_reports'],
  createInventoryPayable: ['manage_inventory', 'manage_purchases', 'manage_accounts_payable'],
  postPaidInventoryPurchase: ['manage_inventory', 'manage_purchases'],
  addSupplierPaymentWithAccount: ['manage_accounts_payable', 'manage_purchases'],
  fetchFinancialSummary: ['manage_cash', 'manage_finances', 'view_reports'],
  fetchOwnerFinanceWorkspace: ['manage_finances'],
  createOwnerWithdrawal: ['manage_finances'],
  cancelOwnerWithdrawal: ['manage_finances'],
  createOwnerWithdrawalConcept: ['manage_finances'],
  updateOwnerWithdrawalConcept: ['manage_finances'],
  saveOwnerFinanceSettings: ['manage_finances'],
  fetchActivityLog: REPORT_READ_PERMISSIONS,
  bulkPutCategories: ['manage_products'],
  findCategoryByKey: PRODUCT_READ_PERMISSIONS,
  putCategory: ['manage_products'],
  deleteCategory: ['manage_products'],
  bulkPutProducts: ['manage_products'],
});

function repositoryMethodAllowed(method, permissions) {
  const required = REPOSITORY_METHOD_PERMISSIONS[method];
  if (!required) return { known: false, allowed: false };
  const granted = new Set(Array.isArray(permissions) ? permissions.map(permission => String(permission)) : []);
  return { known: true, allowed: required.some(permission => granted.has(permission)) };
}

let server = null;
let requestCount = 0;
let heartbeatCount = 0;
let totalResponseTimeMs = 0;
let timedMaintenance = null;
const clients = new Map();
const activityEvents = [];
const userSessions = new Map();
const repositoryEvents = [];
let repositoryEventSequence = 0;
let authenticateUserProvider = null;
let repositoryCallProvider = null;
let allowMultipleUserSessions = true;
let state = { running: false, port: null, host: null, serverName: null, serverId: null, companyId: null, ip: null, baseUrl: null, protocolVersion: null, startedAt: null, lastLanIp: null, ipSource: 'unavailable', ipUpdatedAt: null, networkAvailable: false };
let policy = {
  inactiveMs: DEFAULT_INACTIVE_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retentionMs: DEFAULT_RETENTION_MS,
  sessionDurationDays: DEFAULT_SESSION_DURATION_DAYS,
  sessionDurationMs: DEFAULT_SESSION_DURATION_DAYS * DAY_MS,
};
let clientStorePath = null;
let runtimeStorePath = null;
let stateChangeListener = null;
let activeDescriptorStore = null;
let lastDescriptorIpCheckAt = 0;

export function setLanServerStateChangeListener(listener) {
  stateChangeListener = typeof listener === 'function' ? listener : null;
}

export function publishLanRepositoryEvent(type) {
  const normalizedType = String(type || '').trim();
  if (!normalizedType) return null;
  const event = { sequence: ++repositoryEventSequence, type: normalizedType, createdAt: new Date().toISOString() };
  repositoryEvents.push(event);
  if (repositoryEvents.length > 200) repositoryEvents.splice(0, repositoryEvents.length - 200);
  notifyStateChanged('repository-changed', normalizedType, { sequence: event.sequence });
  return { ...event };
}

function notifyStateChanged(reason, eventType = null, details = {}) {
  try { stateChangeListener?.({ reason, eventType, details, state: getLanServerState() }); } catch (error) { console.error('[LAN] No fue posible publicar el estado:', error); }
}

export function refreshLanServerNetworkAddress(detectedIp) {
  if (!server || !activeDescriptorStore) return null;
  const now = Date.now();
  if (detectedIp === undefined && now - lastDescriptorIpCheckAt < 1000) return activeDescriptorStore.toJSON();
  lastDescriptorIpCheckAt = now;
  const previousDescriptor = activeDescriptorStore.toJSON();
  const descriptor = activeDescriptorStore.refreshDetectedIp(detectedIp);
  const changed = previousDescriptor.ip !== descriptor.ip
    || previousDescriptor.baseUrl !== descriptor.baseUrl
    || previousDescriptor.lastLanIp !== descriptor.lastLanIp
    || previousDescriptor.ipSource !== descriptor.ipSource
    || previousDescriptor.ipUpdatedAt !== descriptor.ipUpdatedAt
    || previousDescriptor.networkAvailable !== descriptor.networkAvailable;
  state = {
    ...state,
    ip: descriptor.ip || null,
    baseUrl: descriptor.baseUrl || null,
    lastLanIp: descriptor.lastLanIp || null,
    ipSource: descriptor.ipSource,
    ipUpdatedAt: descriptor.ipUpdatedAt,
    networkAvailable: descriptor.networkAvailable,
  };
  if (changed) notifyStateChanged('server-ip-changed', 'SERVER_IP_CHANGED', {
    serverId: descriptor.serverId,
    previousIp: previousDescriptor.ip || null,
    currentIp: descriptor.ip || null,
    lastLanIp: descriptor.lastLanIp || null,
    ipSource: descriptor.ipSource,
    ipUpdatedAt: descriptor.ipUpdatedAt,
    networkAvailable: descriptor.networkAvailable,
  });
  return descriptor;
}

function refreshActiveDescriptorAddress() {
  return Boolean(refreshLanServerNetworkAddress());
}

function queueActivity(action, details) {
  activityEvents.push({ id: crypto.randomUUID(), action, createdAt: new Date().toISOString(), details });
}

function persistRuntimeState() {
  if (!runtimeStorePath) return;
  try {
    fs.mkdirSync(path.dirname(runtimeStorePath), { recursive: true });
    const payload = {
      clients: Array.from(clients.values()).map(client => ({ ...client })),
      userSessions: Array.from(userSessions.values()).map(session => ({ ...session })),
      counters: { requestCount, heartbeatCount, totalResponseTimeMs },
      savedAt: new Date().toISOString(),
    };
    const temporary = `${runtimeStorePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload), 'utf8');
    fs.renameSync(temporary, runtimeStorePath);
    if (clientStorePath) fs.writeFileSync(clientStorePath, JSON.stringify(payload.clients), 'utf8');
  } catch (error) {
    console.error('[LAN] No fue posible persistir el estado LAN:', error);
  }
}

function persistClients() { persistRuntimeState(); }

function dateMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionTiming(record = {}, now = Date.now()) {
  const createdAtMs = dateMs(record.createdAt || record.loginAt || record.connectedAt || record.lastActivity) || now;
  const expiresAtMs = dateMs(record.expiresAt) || createdAtMs + policy.sessionDurationMs;
  return {
    createdAt: new Date(createdAtMs).toISOString(),
    lastActivity: new Date(dateMs(record.lastActivity) || createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    rememberDevice: record.rememberDevice !== false,
  };
}

function sessionExpired(record, now = Date.now()) {
  return dateMs(record?.expiresAt) <= now;
}

function normalizeClientSession(client, now = Date.now()) {
  const timing = sessionTiming(client, now);
  const machineId = String(client.machineId || client.deviceInstanceId || client.clientId || '').trim();
  const registeredAt = client.registeredAt || client.createdAt || client.connectedAt || timing.createdAt;
  return {
    ...client,
    ...timing,
    machineId,
    deviceInstanceId: machineId,
    registeredAt,
    connectedAt: client.connectedAt || timing.createdAt,
  };
}

function normalizeUserSession(session, now = Date.now()) {
  const timing = sessionTiming(session, now);
  return {
    ...session,
    ...timing,
    loginAt: session.loginAt || timing.createdAt,
  };
}

function createSessionTiming(rememberDevice = true, now = Date.now()) {
  return {
    createdAt: new Date(now).toISOString(),
    lastActivity: new Date(now).toISOString(),
    expiresAt: new Date(now + policy.sessionDurationMs).toISOString(),
    rememberDevice: rememberDevice !== false,
  };
}

function restoreRuntimeState() {
  clients.clear();
  userSessions.clear();
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(runtimeStorePath, 'utf8')); } catch {}
  if (!payload) {
    try { payload = { clients: JSON.parse(fs.readFileSync(clientStorePath, 'utf8')), userSessions: [], counters: {} }; } catch { payload = { clients: [], userSessions: [], counters: {} }; }
  }
  const byDevice = new Map();
  for (const client of Array.isArray(payload.clients) ? payload.clients : []) {
    if (!client?.clientId || !client?.sessionToken) continue;
    const key = String(client.machineId || client.deviceInstanceId || client.clientId);
    const current = byDevice.get(key);
    const candidateTime = new Date(client.lastActivity || client.connectedAt || 0).getTime();
    const currentTime = current ? new Date(current.lastActivity || current.connectedAt || 0).getTime() : -1;
    if (!current || candidateTime >= currentTime) byDevice.set(key, client);
  }
  for (const storedClient of byDevice.values()) {
    const client = normalizeClientSession(storedClient);
    if (!client.rememberDevice) continue;
    const expired = sessionExpired(client);
    clients.set(client.clientId, {
      ...client,
      status: expired ? 'expired' : 'inactive',
      disconnectedAt: null,
      expiredAt: expired ? (client.expiredAt || client.expiresAt) : null,
      sessionEndReason: expired ? 'session_expired' : null,
    });
  }
  for (const storedSession of Array.isArray(payload.userSessions) ? payload.userSessions : []) {
    if (!storedSession?.authToken || !storedSession?.clientId || !clients.has(storedSession.clientId) || storedSession.endReason === 'logout') continue;
    const session = normalizeUserSession(storedSession);
    if (!session.rememberDevice) continue;
    const expired = sessionExpired(session);
    userSessions.set(session.authToken, {
      ...session,
      status: expired ? 'expired' : 'inactive',
      endReason: expired ? 'session_expired' : null,
    });
  }
  requestCount = Number(payload.counters?.requestCount) || 0;
  heartbeatCount = Number(payload.counters?.heartbeatCount) || 0;
  totalResponseTimeMs = Number(payload.counters?.totalResponseTimeMs) || 0;
  persistRuntimeState();
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJson(req, maxBytes = DEFAULT_JSON_PAYLOAD_BYTES) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const buffer = Buffer.concat(chunks);
  if (buffer.length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return JSON.parse(buffer.toString('utf8'));
}

function remoteIp(req, suppliedIp) {
  const socketIp = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return String(suppliedIp || socketIp || 'unknown').trim();
}

function normalizedSocketAddress(value) {
  return String(value || '').replace(/^::ffff:/, '').trim().toLowerCase();
}

function isLoopbackAddress(value) {
  const address = normalizedSocketAddress(value);
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

/**
 * Device registry maintenance is intentionally restricted to the Principal
 * Server UI. It is not a remote-client capability and never participates in
 * the Repository protocol.
 */
function isLocalServerRequest(req) {
  const remoteAddress = normalizedSocketAddress(req.socket.remoteAddress);
  const localAddress = normalizedSocketAddress(req.socket.localAddress);
  return isLoopbackAddress(remoteAddress) || Boolean(remoteAddress && localAddress && remoteAddress === localAddress);
}

function normalizeStatus(client, now = Date.now()) {
  if (client.status === 'disconnected' || client.status === 'expired') return client.status;
  const elapsed = now - new Date(client.lastHeartbeat || client.lastActivity).getTime();
  if (elapsed >= policy.timeoutMs) return 'disconnected';
  if (elapsed >= policy.inactiveMs) return 'inactive';
  return 'connected';
}

function maintainUserSessions(now = Date.now()) {
  let changed = false;
  for (const session of userSessions.values()) {
    if (session.endReason === 'logout') continue;
    if (sessionExpired(session, now)) {
      if (session.status !== 'expired' || session.endReason !== 'session_expired') changed = true;
      session.status = 'expired';
      session.endReason = 'session_expired';
      continue;
    }
    const client = clients.get(session.clientId);
    const previousStatus = session.status;
    const previousReason = session.endReason;
    // A replacement runtime owns the same registered equipment record but the
    // previous authenticated UI session must remain inactive until the new
    // runtime explicitly restores it through /auth/restore.
    if (session.endReason === 'client_replaced') {
      session.status = 'inactive';
    } else if (!client) {
      session.status = 'disconnected';
      session.endReason = 'client_missing';
    } else if (client.status === 'disconnected' || client.status === 'expired') {
      session.status = 'disconnected';
      session.endReason = client.sessionEndReason || 'client_disconnected';
    } else if (client.status === 'inactive') {
      session.status = 'inactive';
      session.endReason = null;
    } else {
      session.status = 'connected';
      session.endReason = null;
    }
    if (previousStatus !== session.status || previousReason !== session.endReason) changed = true;
  }
  if (changed) persistRuntimeState();
}

function cleanupOrphanSessions(now = Date.now()) {
  let changed = false;
  const latestClientByMachine = new Map();

  for (const client of clients.values()) {
    const machineId = String(client.machineId || client.deviceInstanceId || client.clientId || '').trim();
    client.machineId = machineId;
    client.deviceInstanceId = machineId;
    const current = latestClientByMachine.get(machineId);
    const candidateTime = dateMs(client.lastActivity || client.connectedAt || client.registeredAt);
    const currentTime = current ? dateMs(current.lastActivity || current.connectedAt || current.registeredAt) : -1;
    if (!current || candidateTime >= currentTime) latestClientByMachine.set(machineId, client);
  }

  for (const [clientId, client] of clients.entries()) {
    const canonical = latestClientByMachine.get(client.machineId);
    if (canonical && canonical.clientId !== clientId) {
      clients.delete(clientId);
      for (const [token, session] of userSessions.entries()) {
        if (session.clientId === clientId) userSessions.delete(token);
      }
      changed = true;
    }
  }

  for (const [token, session] of userSessions.entries()) {
    const client = clients.get(session.clientId);
    const terminal = session.status === 'expired'
      || session.status === 'disconnected'
      || session.endReason === 'logout'
      || !client;
    const lastActivity = dateMs(session.lastActivity || session.loginAt || session.createdAt);
    if (terminal && now - lastActivity >= policy.retentionMs) {
      userSessions.delete(token);
      changed = true;
    }
  }

  if (changed) persistRuntimeState();
}

function runMaintenance(now = Date.now()) {
  maintainClients(now);
  maintainUserSessions(now);
  cleanupOrphanSessions(now);
}

function maintainClients(now = Date.now()) {
  let changed = false;
  for (const client of clients.values()) {
    if (sessionExpired(client, now)) {
      if (client.status !== 'expired') changed = true;
      client.status = 'expired';
      client.expiredAt = client.expiredAt || new Date(now).toISOString();
      client.sessionEndReason = 'session_expired';
      continue;
    }
    const next = normalizeStatus(client, now);
    if (next === 'disconnected' && client.status !== 'disconnected') {
      client.status = 'disconnected';
      client.disconnectedAt = new Date(now).toISOString();
      client.sessionEndReason = 'heartbeat_timeout';
      changed = true;
      queueActivity('LAN_CLIENT_TIMEOUT', {
        clientId: client.clientId,
        machineId: client.machineId,
        name: client.name,
        hostname: client.hostname,
        ip: client.ip,
        lastHeartbeat: client.lastHeartbeat,
      });
      notifyStateChanged('client-timeout', 'CLIENT_TIMEOUT', { clientId: client.clientId });
    } else if (next === 'inactive' && client.status === 'connected') {
      client.status = 'inactive';
      changed = true;
    } else if (next === 'connected' && client.status === 'inactive') {
      client.status = 'connected';
      changed = true;
    }

    const terminalAt = client.expiredAt || client.disconnectedAt;
    if (!client.rememberDevice && terminalAt && now - new Date(terminalAt).getTime() >= policy.retentionMs) {
      clients.delete(client.clientId);
      changed = true;
    }
  }
  if (changed) persistClients();
}

function connectedClientSlots() {
  runMaintenance();
  const connectedMachines = new Set();
  for (const client of clients.values()) {
    if (client.status !== 'connected') continue;
    const machineId = String(client.machineId || client.deviceInstanceId || client.clientId || '').trim();
    connectedMachines.add(machineId || client.clientId);
  }
  return connectedMachines.size;
}

function statusCounts() {
  runMaintenance();
  const counts = { connected: 0, inactive: 0, disconnected: 0, expired: 0 };
  for (const client of clients.values()) if (Object.hasOwn(counts, client.status)) counts[client.status] += 1;
  return counts;
}

function publicClient(client) {
  return {
    clientId: client.clientId,
    machineId: client.machineId || client.deviceInstanceId || client.clientId,
    name: client.name,
    ip: client.ip,
    hostname: client.hostname,
    version: client.version,
    operatingSystem: client.operatingSystem || 'No disponible',
    registeredAt: client.registeredAt || client.createdAt || client.connectedAt,
    connectedAt: client.connectedAt,
    lastActivity: client.lastActivity,
    lastHeartbeat: client.lastHeartbeat || null,
    currentLatencyMs: client.currentLatencyMs ?? null,
    averageLatencyMs: client.heartbeatCount ? Math.round(client.totalLatencyMs / client.heartbeatCount) : null,
    activityCount: client.activityCount || 0,
    status: normalizeStatus(client),
    createdAt: client.createdAt,
    expiresAt: client.expiresAt,
    rememberDevice: client.rememberDevice !== false,
  };
}

function clientMaintenanceStatus(client) {
  const status = normalizeStatus(client);
  const machineId = String(client.machineId || client.deviceInstanceId || '').trim();
  const orphan = !machineId || !String(client.sessionToken || '').trim() || status === 'orphan';
  return orphan && status !== 'connected' ? 'orphan' : status;
}

function clientMaintenanceLastSeenMs(client) {
  const activityOrHeartbeat = Math.max(
    dateMs(client.lastActivity),
    dateMs(client.lastHeartbeat),
  );
  if (activityOrHeartbeat > 0) return activityOrHeartbeat;
  return Math.max(
    dateMs(client.connectedAt),
    dateMs(client.registeredAt || client.createdAt),
  );
}

function removeRegisteredClient(client, actor, removalMode) {
  const snapshot = publicClient(client);
  clients.delete(client.clientId);
  let removedSessions = 0;
  for (const [token, session] of userSessions.entries()) {
    if (session.clientId !== client.clientId) continue;
    userSessions.delete(token);
    removedSessions += 1;
  }
  queueActivity('LAN_DEVICE_REMOVED', {
    clientId: snapshot.clientId,
    machineId: snapshot.machineId,
    hostname: snapshot.hostname,
    name: snapshot.name,
    ip: snapshot.ip,
    previousStatus: clientMaintenanceStatus(client),
    removalMode,
    removedSessions,
    userId: String(actor.userId || ''),
    username: String(actor.username || ''),
    displayName: String(actor.displayName || actor.username || ''),
    role: 'master',
    removedAt: new Date().toISOString(),
  });
  return { ...snapshot, removedSessions };
}

function executeClientMaintenance(body = {}) {
  runMaintenance();
  const actor = body.actor && typeof body.actor === 'object' ? body.actor : {};
  if (String(actor.role || '').toLowerCase() !== 'master') {
    return { ok: false, statusCode: 403, error: 'LAN_DEVICE_MAINTENANCE_MASTER_REQUIRED' };
  }

  const action = String(body.action || '');
  const removable = [];

  if (action === 'remove-client') {
    const client = clients.get(String(body.clientId || ''));
    if (!client) return { ok: false, statusCode: 404, error: 'LAN_DEVICE_NOT_FOUND' };
    const status = clientMaintenanceStatus(client);
    if (status === 'connected') {
      return { ok: false, statusCode: 409, error: 'LAN_CONNECTED_DEVICE_CANNOT_BE_REMOVED' };
    }
    removable.push(client);
  } else if (action === 'remove-disconnected') {
    for (const client of clients.values()) {
      const status = clientMaintenanceStatus(client);
      if (status === 'disconnected' || status === 'expired' || status === 'orphan') removable.push(client);
    }
  } else if (action === 'remove-older-than') {
    const days = Number(body.days);
    if (![30, 60, 90, 180].includes(days)) {
      return { ok: false, statusCode: 400, error: 'LAN_DEVICE_MAINTENANCE_INVALID_DAYS' };
    }
    const threshold = Date.now() - days * DAY_MS;
    for (const client of clients.values()) {
      const status = clientMaintenanceStatus(client);
      if (status === 'connected') continue;
      if (clientMaintenanceLastSeenMs(client) <= threshold) removable.push(client);
    }
  } else {
    return { ok: false, statusCode: 400, error: 'LAN_DEVICE_MAINTENANCE_INVALID_ACTION' };
  }

  const removed = removable.map(client => removeRegisteredClient(client, actor, action));
  if (removed.length) {
    persistRuntimeState();
    notifyStateChanged('client-registry-maintenance', 'CLIENT_LIST_UPDATED', {
      action,
      removedCount: removed.length,
      removedClientIds: removed.map(client => client.clientId),
    });
  }

  return {
    ok: true,
    statusCode: 200,
    result: {
      success: true,
      action,
      removedCount: removed.length,
      removed,
      registeredClients: clients.size,
      connectedClients: connectedClientSlots(),
    },
  };
}


function publicUserSession(session) {
  const client = clients.get(session.clientId);
  return {
    userId: session.userId,
    username: session.username,
    role: session.role,
    clientId: session.clientId,
    deviceName: client?.name || 'Equipo no disponible',
    ip: client?.ip || 'unknown',
    loginAt: session.loginAt,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    expiresAt: session.expiresAt,
    rememberDevice: session.rememberDevice !== false,
    status: session.status,
  };
}

function activeUserSessions() {
  maintainUserSessions();
  return Array.from(userSessions.values()).filter(session => session.status === 'connected');
}

function duplicateLoginPayload(session, now = Date.now()) {
  const client = clients.get(session.clientId);
  const lastActivity = session.lastActivity || client?.lastActivity || session.loginAt || session.createdAt || null;
  const lastActivityMs = dateMs(lastActivity);
  return {
    userId: session.userId,
    username: session.username,
    displayName: session.displayName || session.username,
    source: {
      clientId: session.clientId,
      machineId: client?.machineId || client?.deviceInstanceId || client?.clientId || '',
      deviceName: client?.name || 'Equipo no disponible',
      hostname: client?.hostname || 'No disponible',
      ip: client?.ip || 'No disponible',
      lastHeartbeat: client?.lastHeartbeat || null,
      lastActivity,
      inactiveForMs: lastActivityMs > 0 ? Math.max(0, now - lastActivityMs) : null,
    },
  };
}

async function recordSessionTransferActivity(session, details) {
  const eventId = crypto.randomUUID();
  let persisted = false;

  if (repositoryCallProvider) {
    try {
      await repositoryCallProvider('logActivity', {
        session: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName || session.username,
          role: session.role,
          permissions: Array.isArray(session.permissions) ? [...session.permissions] : [],
        },
        action: 'SESSION_TRANSFER',
        entity: 'lan_auth_session',
        entityId: eventId,
        detail: JSON.stringify(details),
      });
      persisted = true;
    } catch (error) {
      console.error('[LAN auth] No fue posible registrar SESSION_TRANSFER en Activity Log:', error);
    }
  }

  if (!persisted) {
    // Fallback compatible with the existing Principal Server activity queue.
    // LanCommunicationPanel persists queued events through the current
    // authenticated local user when the direct renderer bridge is unavailable.
    queueActivity('SESSION_TRANSFER', { ...details, eventId, activityLogPending: true });
  }

  return { eventId, persisted };
}

function healthPayload(version) {
  runMaintenance();
  const started = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
  const counts = statusCounts();
  return {
    status: 'online', version, serverName: state.serverName, serverId: state.serverId, companyId: state.companyId,
    ip: state.ip, port: state.port, baseUrl: state.baseUrl,
    lastLanIp: state.lastLanIp, ipSource: state.ipSource, ipUpdatedAt: state.ipUpdatedAt, networkAvailable: state.networkAvailable,
    database: 'ready', time: new Date().toISOString(), mode: 'desktop',
    uptime: Math.max(0, Math.floor((Date.now() - started) / 1000)),
    memoryUsed: process.memoryUsage().heapUsed,
    connectedClients: counts.connected + counts.inactive,
    activeClients: counts.connected,
    inactiveClients: counts.inactive,
    requestsHandled: requestCount,
    heartbeatsReceived: heartbeatCount,
    averageResponseTimeMs: requestCount ? Math.round(totalResponseTimeMs / requestCount) : 0,
    protocolVersion: state.protocolVersion,
    sessionDurationDays: policy.sessionDurationDays,
    connectedUsers: activeUserSessions().length,
    activeUserSessions: activeUserSessions().length,
    averageUserSessionSeconds: activeUserSessions().length ? Math.round(activeUserSessions().reduce((sum, item) => sum + (Date.now() - new Date(item.loginAt).getTime()) / 1000, 0) / activeUserSessions().length) : 0,
  };
}

function validateSession(clientId, sessionToken) {
  runMaintenance();
  const client = clients.get(String(clientId || ''));
  if (!client || client.sessionToken !== sessionToken) return { ok: false, error: 'LAN_INVALID_SESSION' };
  if (sessionExpired(client)) return { ok: false, error: 'LAN_SESSION_EXPIRED', client };
  return { ok: true, client };
}

function validateUserSession(authToken, clientId) {
  maintainUserSessions();
  const session = userSessions.get(String(authToken || ''));
  if (!session || session.clientId !== clientId || session.endReason === 'logout') {
    return { ok: false, error: 'LAN_INVALID_AUTH_TOKEN' };
  }
  if (sessionExpired(session) || session.status === 'expired') {
    session.status = 'expired';
    session.endReason = 'session_expired';
    persistRuntimeState();
    return { ok: false, error: 'LAN_USER_SESSION_EXPIRED', session };
  }
  return { ok: true, session };
}

export function getLanServerState() {
  refreshActiveDescriptorAddress();
  const counts = statusCounts();
  return {
    ...state,
    connectedClients: counts.connected + counts.inactive,
    activeClients: counts.connected,
    inactiveClients: counts.inactive,
    requestsHandled: requestCount,
    heartbeatsReceived: heartbeatCount,
    averageResponseTimeMs: requestCount ? Math.round(totalResponseTimeMs / requestCount) : 0,
    protocolVersion: state.protocolVersion,
    sessionDurationDays: policy.sessionDurationDays,
    connectedUsers: activeUserSessions().length,
    activeUserSessions: activeUserSessions().length,
    averageUserSessionSeconds: activeUserSessions().length ? Math.round(activeUserSessions().reduce((sum, item) => sum + (Date.now() - new Date(item.loginAt).getTime()) / 1000, 0) / activeUserSessions().length) : 0,
  };

}

export function drainLanActivityEvents() {
  return activityEvents.splice(0, activityEvents.length);
}

export async function startLanServer({ host, port, serverName, descriptor: suppliedDescriptor, userDataPath, version = APP_VERSION, sessionPolicy = {}, authenticateUser, executeRepositoryCall, allowMultipleUserSessions: allowMultiple = true }) {
  if (server) return getLanServerState();
  const descriptorStore = suppliedDescriptor || new LanServerDescriptor(userDataPath);
  activeDescriptorStore = descriptorStore;
  lastDescriptorIpCheckAt = 0;
  const previousDescriptor = descriptorStore.load();
  descriptorStore.update({
    serverName: String(serverName || previousDescriptor.serverName || 'Servidor JoyaControl'),
    port: Number(port || previousDescriptor.port),
    enabled: true,
    addressMode: 'automatic',
    allowMultipleUserSessions: allowMultiple !== false,
  });
  const descriptor = descriptorStore.ensureServerIdentity();
  const { serverId, companyId } = descriptor;
  port = descriptor.port;
  serverName = descriptor.serverName;
  host = host || '0.0.0.0';
  clientStorePath = path.join(userDataPath, 'lan-clients.json');
  runtimeStorePath = path.join(userDataPath, 'lan-runtime-state.json');
  const configuredDurationDays = Number(sessionPolicy.sessionDurationDays);
  const sessionDurationDays = Number.isFinite(configuredDurationDays) && configuredDurationDays > 0
    ? configuredDurationDays
    : DEFAULT_SESSION_DURATION_DAYS;
  policy = {
    inactiveMs: Number(sessionPolicy.inactiveMs) || DEFAULT_INACTIVE_MS,
    timeoutMs: Number(sessionPolicy.timeoutMs) || DEFAULT_TIMEOUT_MS,
    retentionMs: Number(sessionPolicy.retentionMs) || DEFAULT_RETENTION_MS,
    sessionDurationDays,
    sessionDurationMs: sessionDurationDays * DAY_MS,
  };
  restoreRuntimeState();
  authenticateUserProvider = authenticateUser || null;
  repositoryCallProvider = executeRepositoryCall || null;
  allowMultipleUserSessions = allowMultiple !== false;
  // Counters and persistent sessions are restored from disk so restarts do not reset LAN history.
  state = { running: false, port, host, serverName, serverId, companyId, ip: descriptor.ip || null, baseUrl: descriptor.baseUrl || null, protocolVersion: descriptor.protocolVersion, startedAt: null, lastLanIp: descriptor.lastLanIp || null, ipSource: descriptor.ipSource, ipUpdatedAt: descriptor.ipUpdatedAt, networkAvailable: descriptor.networkAvailable };

  server = http.createServer(async (req, res) => {
    const requestStarted = performance.now();
    requestCount += 1;
    res.once('finish', () => { totalResponseTimeMs += performance.now() - requestStarted; });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

    try {
      refreshActiveDescriptorAddress();
      runMaintenance();
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, healthPayload(version));
      if (req.method === 'GET' && req.url === '/server-info') {
        return json(res, 200, {
          serverId, serverName, companyId: state.companyId, company: 'JoyaControl', version,
          protocolVersion: state.protocolVersion, repository: 'Dexie', mode: 'desktop',
          ip: state.ip, port: state.port, baseUrl: state.baseUrl,
          lastLanIp: state.lastLanIp, ipSource: state.ipSource, ipUpdatedAt: state.ipUpdatedAt, networkAvailable: state.networkAvailable,
          maxClients: MAX_CLIENTS, connectedClients: connectedClientSlots(),
          features: { sales: true, inventory: true, reports: true, sync: false },
        });
      }
      if (req.method === 'GET' && req.url === '/clients') {
        const registeredClients = Array.from(clients.values()).map(publicClient);
        const connectedClients = registeredClients.filter(client => client.status === 'connected');
        return json(res, 200, {
          success: true,
          clients: registeredClients,
          registeredClients,
          connectedClients,
        });
      }
      if (req.method === 'POST' && req.url === '/clients/maintenance') {
        if (!isLocalServerRequest(req)) {
          return json(res, 403, { success: false, error: 'LAN_DEVICE_MAINTENANCE_SERVER_ONLY' });
        }
        const maintenance = executeClientMaintenance(await readJson(req));
        if (!maintenance.ok) {
          return json(res, maintenance.statusCode, { success: false, error: maintenance.error });
        }
        return json(res, maintenance.statusCode, maintenance.result);
      }
      if (req.method === 'GET' && req.url === '/users') {
        return json(res, 200, { success: true, users: Array.from(userSessions.values()).map(publicUserSession) });
      }
      if (req.method === 'POST' && req.url === '/repository/call') {
        const body = await readJson(req, MAX_REPOSITORY_PAYLOAD_BYTES);
        // Validation order is contractual: sessionToken -> clientId -> authToken -> permissions -> Repository.
        const sessionToken = String(body.sessionToken || '');
        if (!sessionToken) return json(res, 401, { success: false, error: 'LAN_SESSION_TOKEN_REQUIRED' });
        const clientId = String(body.clientId || '');
        if (!clientId) return json(res, 401, { success: false, error: 'LAN_CLIENT_ID_REQUIRED' });
        const clientValidation = validateSession(clientId, sessionToken);
        if (!clientValidation.ok) return json(res, 401, { success: false, error: clientValidation.error });
        const client = clientValidation.client;
        const authToken = String(body.authToken || '');
        if (!authToken) return json(res, 401, { success: false, error: 'LAN_AUTH_TOKEN_REQUIRED' });
        const authValidation = validateUserSession(authToken, clientId);
        if (!authValidation.ok) return json(res, 401, { success: false, error: authValidation.error });
        const userSession = authValidation.session;
        const method = String(body.method || '');
        const authorization = repositoryMethodAllowed(method, userSession.permissions);
        if (!authorization.known) return json(res, 403, { success: false, error: 'LAN_REPOSITORY_METHOD_NOT_ALLOWED' });
        if (!authorization.allowed) return json(res, 403, { success: false, error: 'LAN_PERMISSION_DENIED' });
        if (!repositoryCallProvider) return json(res, 503, { success: false, error: 'LAN_REPOSITORY_PROVIDER_UNAVAILABLE' });
        const repositoryArgs = body.args && typeof body.args === 'object'
          ? { ...body.args }
          : {};
        repositoryArgs[AUTHORIZED_SESSION_ARGUMENT] = {
          id: String(userSession.userId || ''),
          username: String(userSession.username || ''),
          displayName: String(userSession.displayName || userSession.username || ''),
          role: String(userSession.role || ''),
          permissions: Array.isArray(userSession.permissions) ? [...userSession.permissions] : [],
        };
        const result = await repositoryCallProvider(method, repositoryArgs);
        userSession.lastActivity = new Date().toISOString();
        client.lastActivity = userSession.lastActivity;
        client.activityCount = Number(client.activityCount || 0) + 1;
        persistRuntimeState();
        return json(res, 200, { success: true, data: result });
      }
      if (req.method === 'POST' && req.url === '/login') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) return json(res, 401, { success: false, error: validation.error });
        if (!authenticateUserProvider) return json(res, 503, { success: false, error: 'LAN_AUTH_PROVIDER_UNAVAILABLE' });
        const auth = await authenticateUserProvider(String(body.username || ''), String(body.password || ''));
        if (!auth?.success) return json(res, 401, { success: false, error: 'INVALID_CREDENTIALS' });
        const duplicate = activeUserSessions().find(item => item.userId === auth.userId && item.clientId !== validation.client.clientId);
        const transferRequested = body.transferExistingSession === true;
        const duplicateDetails = duplicate ? duplicateLoginPayload(duplicate) : null;
        if (duplicate && !allowMultipleUserSessions) {
          const expectedSourceClientId = String(body.expectedSourceClientId || '').trim();
          const expectedSourceMachineId = String(body.expectedSourceMachineId || '').trim();
          const sourceMachineId = String(duplicateDetails?.source?.machineId || '').trim();
          const sourceChanged = transferRequested && (
            (expectedSourceClientId && expectedSourceClientId !== duplicate.clientId)
            || (expectedSourceMachineId && expectedSourceMachineId !== sourceMachineId)
          );

          if (!transferRequested || sourceChanged) {
            queueActivity('LAN_DUPLICATE_LOGIN_BLOCKED', {
              userId: auth.userId,
              username: auth.username,
              clientId: validation.client.clientId,
              duplicateSession: duplicateDetails,
              reason: sourceChanged ? 'LAN_DUPLICATE_SESSION_CHANGED' : 'LAN_DUPLICATE_LOGIN_BLOCKED',
            });
            return json(res, 409, {
              success: false,
              error: 'LAN_DUPLICATE_LOGIN_BLOCKED',
              reason: sourceChanged ? 'LAN_DUPLICATE_SESSION_CHANGED' : undefined,
              duplicateSession: duplicateDetails,
            });
          }
        }
        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const authToken = crypto.randomBytes(32).toString('hex');
        const rememberDevice = body.rememberDevice !== false;
        const transferredSessions = [];
        if (duplicate && !allowMultipleUserSessions && transferRequested) {
          const sourceClient = clients.get(duplicate.clientId);
          transferredSessions.push({
            session: { ...duplicate },
            client: sourceClient ? { ...sourceClient } : null,
          });
        }
        if (!allowMultipleUserSessions) {
          for (const [token, existingSession] of userSessions.entries()) {
            if (existingSession.userId !== auth.userId || existingSession.clientId === validation.client.clientId) continue;
            userSessions.delete(token);
          }
        }
        for (const [token, existingSession] of userSessions.entries()) {
          if (existingSession.clientId === validation.client.clientId && existingSession.userId === auth.userId) userSessions.delete(token);
        }
        const session = {
          authToken,
          userId: auth.userId,
          username: auth.username,
          displayName: auth.displayName || auth.username,
          role: auth.role,
          permissions: auth.permissions || [],
          clientId: validation.client.clientId,
          loginAt: now,
          ...createSessionTiming(rememberDevice, nowMs),
          status: 'connected',
          endReason: null,
        };
        userSessions.set(authToken, session);
        validation.client.lastActivity = now;
        queueActivity('LAN_USER_LOGIN', { userId: session.userId, username: session.username, role: session.role, clientId: session.clientId });
        persistRuntimeState();

        let transferAudit = null;
        if (transferredSessions.length) {
          const origin = transferredSessions[0];
          const originClient = origin.client;
          const destinationClient = validation.client;
          const transferDetails = {
            user: {
              userId: session.userId,
              username: session.username,
              displayName: session.displayName,
            },
            sourceDevice: originClient?.name || 'Equipo no disponible',
            destinationDevice: destinationClient.name || 'Equipo no disponible',
            sourceHostname: originClient?.hostname || 'No disponible',
            destinationHostname: destinationClient.hostname || 'No disponible',
            sourceIp: originClient?.ip || 'No disponible',
            destinationIp: destinationClient.ip || 'No disponible',
            sourceMachineId: originClient?.machineId || originClient?.deviceInstanceId || originClient?.clientId || '',
            destinationMachineId: destinationClient.machineId || destinationClient.deviceInstanceId || destinationClient.clientId || '',
            sourceClientId: origin.session.clientId,
            destinationClientId: session.clientId,
            sourceLastHeartbeat: originClient?.lastHeartbeat || null,
            sourceLastActivity: origin.session.lastActivity || originClient?.lastActivity || null,
            date: now,
          };
          transferAudit = await recordSessionTransferActivity(session, transferDetails);
          notifyStateChanged('session-transfer', 'SESSION_TRANSFER', {
            ...transferDetails,
            activityLogPersisted: transferAudit.persisted,
          });
        } else {
          notifyStateChanged('user-login', 'USER_CONNECTED', { clientId: session.clientId, userId: session.userId });
        }
        return json(res, 200, {
          success: true,
          userId: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
          permissions: session.permissions,
          authToken,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          expiresAt: session.expiresAt,
          rememberDevice: session.rememberDevice,
          transferred: transferredSessions.length > 0,
          transferActivityId: transferAudit?.eventId || null,
        });
      }
      if (req.method === 'POST' && req.url === '/auth/restore') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) return json(res, 401, { success: false, error: validation.error });
        const authValidation = validateUserSession(body.authToken, validation.client.clientId);
        if (!authValidation.ok) return json(res, 401, { success: false, error: authValidation.error });
        const session = authValidation.session;
        session.status = 'connected'; session.lastActivity = new Date().toISOString(); session.endReason = null;
        queueActivity('LAN_USER_SESSION_RESTORED', { userId: session.userId, username: session.username, clientId: session.clientId });
        notifyStateChanged('user-restored', 'USER_RECONNECTED', { clientId: session.clientId, userId: session.userId }); persistRuntimeState();
        return json(res, 200, {
          success: true,
          userId: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
          permissions: session.permissions,
          authToken: session.authToken,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          expiresAt: session.expiresAt,
          rememberDevice: session.rememberDevice,
        });
      }
      if (req.method === 'POST' && req.url === '/logout') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) return json(res, 401, { success: false, error: validation.error });
        const session = userSessions.get(String(body.authToken || ''));
        if (!session || session.clientId !== validation.client.clientId) return json(res, 401, { success: false, error: 'LAN_INVALID_AUTH_TOKEN' });
        session.status = 'disconnected';
        session.lastActivity = new Date().toISOString();
        session.endReason = 'logout';
        queueActivity('LAN_USER_LOGOUT', { userId: session.userId, username: session.username, clientId: session.clientId });
        notifyStateChanged('user-logout', 'USER_DISCONNECTED', { clientId: session.clientId, userId: session.userId }); persistRuntimeState();
        return json(res, 200, { success: true });
      }
      if (req.method === 'POST' && req.url === '/client/register') {
        const body = await readJson(req);
        const name = String(body.name || body.deviceName || '').trim();
        const hostname = String(body.hostname || '').trim();
        const clientVersion = String(body.version || '').trim();
        const ip = remoteIp(req, body.ip);
        if (!name || !hostname || !clientVersion || !body.localTime) {
          queueActivity('LAN_CLIENT_REJECTED', { reason: 'INVALID_CLIENT_DATA', name, hostname, ip });
          return json(res, 400, { success: false, error: 'LAN_INVALID_CLIENT_DATA' });
        }
        if (clientVersion !== version) {
          queueActivity('LAN_CLIENT_REJECTED', { reason: 'INCOMPATIBLE_VERSION', name, hostname, ip, version: clientVersion });
          return json(res, 409, { success: false, error: 'LAN_INCOMPATIBLE_VERSION' });
        }
        const machineId = String(body.machineId || body.deviceInstanceId || '').trim() || crypto.randomUUID();
        const connectionId = String(body.connectionId || '').trim();
        const existing = Array.from(clients.values()).find(item => String(item.machineId || item.deviceInstanceId || '') === machineId) || null;
        if (existing) {
          const nowMs = Date.now();
          const now = new Date(nowMs).toISOString();
          const persistentSessionExpired = sessionExpired(existing, nowMs);
          const replacingActiveConnection = Boolean(connectionId && existing.activeConnectionId && existing.activeConnectionId !== connectionId);
          const previousSessionToken = existing.sessionToken;
          if (persistentSessionExpired || replacingActiveConnection) {
            existing.sessionToken = crypto.randomBytes(32).toString('hex');
          }
          if (persistentSessionExpired) {
            Object.assign(existing, createSessionTiming(body.rememberDevice !== false, nowMs));
          } else {
            existing.rememberDevice = body.rememberDevice !== false;
          }
          existing.machineId = machineId;
          existing.deviceInstanceId = machineId;
          existing.activeConnectionId = connectionId || existing.activeConnectionId || null;
          existing.name = name; existing.hostname = hostname; existing.ip = ip; existing.version = clientVersion;
          existing.operatingSystem = String(body.operatingSystem || existing.operatingSystem || 'No disponible');
          existing.status = 'connected'; existing.connectedAt = now; existing.lastActivity = now; existing.lastHeartbeat = now;
          existing.disconnectedAt = null; existing.expiredAt = null; existing.sessionEndReason = null;
          let restoredUsers = 0;
          if (replacingActiveConnection) {
            for (const session of userSessions.values()) {
              if (session.clientId !== existing.clientId || session.endReason === 'logout') continue;
              session.status = 'inactive';
              session.endReason = 'client_replaced';
              restoredUsers += 1;
            }
          }
          // Remove stale duplicates that may exist from older builds.
          for (const [id, item] of clients.entries()) {
            if (id !== existing.clientId && String(item.machineId || item.deviceInstanceId || '') === machineId) clients.delete(id);
          }
          persistClients();
          if (replacingActiveConnection) {
            queueActivity('LAN_CLIENT_SESSION_REPLACED', { ...publicClient(existing), previousSessionToken: previousSessionToken ? '[REPLACED]' : null });
          }
          queueActivity('LAN_AUTO_RECONNECTED', publicClient(existing));
          notifyStateChanged('client-reused', 'CLIENT_RECONNECTED', { clientId: existing.clientId });
          return json(res, 200, { success: true, clientId: existing.clientId, sessionToken: existing.sessionToken, machineId, serverId, reused: true, restoredUsers });
        }
        const connectedSlots = connectedClientSlots();
        if (connectedSlots >= MAX_CLIENTS) {
          queueActivity('LAN_MAX_CLIENTS_REACHED', { name, hostname, ip, maxClients: MAX_CLIENTS, connectedClients: connectedSlots });
          return json(res, 403, { success: false, error: 'LAN_MAX_CLIENTS_REACHED' });
        }
        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const client = {
          clientId: crypto.randomUUID(), sessionToken: crypto.randomBytes(32).toString('hex'), machineId, deviceInstanceId: machineId,
          activeConnectionId: connectionId || null,
          name, hostname, ip, version: clientVersion, operatingSystem: String(body.operatingSystem || 'No disponible'),
          registeredAt: now, connectedAt: now, lastActivity: now, lastHeartbeat: now, status: 'connected',
          heartbeatCount: 0, activityCount: 0, totalLatencyMs: 0, currentLatencyMs: null,
          disconnectedAt: null, expiredAt: null, sessionEndReason: null,
          ...createSessionTiming(body.rememberDevice !== false, nowMs),
        };
        clients.set(client.clientId, client);
        persistClients();
        queueActivity('LAN_CLIENT_REGISTERED', publicClient(client));
        notifyStateChanged('client-registered', 'CLIENT_CONNECTED', { clientId: client.clientId });
        return json(res, 201, { success: true, clientId: client.clientId, sessionToken: client.sessionToken, machineId, serverId });
      }
      if (req.method === 'POST' && req.url === '/client/reconnect') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) {
          queueActivity('LAN_RECONNECT_FAILED', { clientId: body.clientId, reason: validation.error });
          return json(res, 401, { success: false, error: validation.error });
        }
        const client = validation.client;
        const machineId = String(body.machineId || body.deviceInstanceId || '').trim();
        const connectionId = String(body.connectionId || '').trim();
        if (machineId && client.machineId && client.machineId !== machineId) {
          queueActivity('LAN_RECONNECT_FAILED', { clientId: body.clientId, reason: 'LAN_INVALID_SESSION' });
          return json(res, 401, { success: false, error: 'LAN_INVALID_SESSION' });
        }
        const now = new Date().toISOString();
        const replacingActiveConnection = Boolean(connectionId && client.activeConnectionId && client.activeConnectionId !== connectionId);
        if (replacingActiveConnection) client.sessionToken = crypto.randomBytes(32).toString('hex');
        client.machineId = machineId || client.machineId || client.deviceInstanceId || client.clientId;
        client.deviceInstanceId = client.machineId;
        client.activeConnectionId = connectionId || client.activeConnectionId || null;
        client.status = 'connected';
        client.connectedAt = now;
        client.lastActivity = now;
        client.lastHeartbeat = now;
        client.disconnectedAt = null;
        client.ip = remoteIp(req, body.ip || client.ip);
        client.operatingSystem = String(body.operatingSystem || client.operatingSystem || 'No disponible');
        let restoredUsers = 0;
        if (replacingActiveConnection) {
          for (const session of userSessions.values()) {
            if (session.clientId !== client.clientId || session.endReason === 'logout') continue;
            session.status = 'inactive';
            session.endReason = 'client_replaced';
            restoredUsers += 1;
          }
        }
        persistClients();
        queueActivity('LAN_AUTO_RECONNECTED', { ...publicClient(client), restoredUsers });
        queueActivity('LAN_HEARTBEAT_RESTARTED', { clientId: client.clientId, lastHeartbeat: client.lastHeartbeat });
        queueActivity('LAN_CLIENT_RECONNECTED', publicClient(client));
        notifyStateChanged('client-reconnected', 'CLIENT_RECONNECTED', { clientId: client.clientId });
        return json(res, 200, { success: true, clientId: client.clientId, sessionToken: client.sessionToken, machineId: client.machineId, serverId, restoredUsers });
      }
      if (req.method === 'POST' && req.url === '/client/ping') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) {
          if (validation.error === 'LAN_SESSION_EXPIRED') queueActivity('LAN_SESSION_EXPIRED', { clientId: body.clientId });
          return json(res, 401, { success: false, error: validation.error });
        }
        const client = validation.client;
        const machineId = String(body.machineId || body.deviceInstanceId || '').trim();
        const connectionId = String(body.connectionId || '').trim();
        if (machineId && client.machineId && machineId !== client.machineId) {
          return json(res, 401, { success: false, error: 'LAN_INVALID_SESSION' });
        }
        if (connectionId && client.activeConnectionId && connectionId !== client.activeConnectionId) {
          return json(res, 401, { success: false, error: 'LAN_SESSION_REPLACED' });
        }
        const nowMs = Date.now();
        const sentAt = new Date(body.timestamp).getTime();
        const latencyMs = Number.isFinite(sentAt) ? Math.max(0, nowMs - sentAt) : 0;
        const now = new Date(nowMs).toISOString();
        client.status = 'connected';
        client.lastHeartbeat = now;
        client.currentLatencyMs = latencyMs;
        client.totalLatencyMs += latencyMs;
        client.heartbeatCount += 1;
        heartbeatCount += 1;
        persistClients();
        notifyStateChanged('heartbeat', 'CLIENT_LIST_UPDATED', { clientId: client.clientId });
        if (body.debug === true) queueActivity('LAN_HEARTBEAT_RECEIVED', { clientId: client.clientId, latencyMs, timestamp: now });
        const lastEventSequence = Number(body.lastEventSequence) || 0;
        const pendingRepositoryEvents = repositoryEvents.filter(event => event.sequence > lastEventSequence);
        return json(res, 200, {
          success: true,
          status: client.status,
          serverTime: now,
          latencyMs,
          lastSeen: client.lastHeartbeat,
          activityCount: client.activityCount,
          serverId: state.serverId,
          repositoryEvents: pendingRepositoryEvents,
          latestEventSequence: repositoryEventSequence,
        });
      }
      if (req.method === 'POST' && req.url === '/client/disconnect') {
        const body = await readJson(req);
        const validation = validateSession(body.clientId, body.sessionToken);
        if (!validation.ok) return json(res, 401, { success: false, error: validation.error });
        const client = validation.client;
        const now = new Date().toISOString();
        client.status = 'disconnected';
        client.lastActivity = now;
        client.disconnectedAt = now;
        persistClients();
        queueActivity('LAN_CLIENT_DISCONNECTED', publicClient(client));
        notifyStateChanged('client-disconnected', 'CLIENT_DISCONNECTED', { clientId: client.clientId });
        return json(res, 200, { success: true });
      }
      return json(res, 404, { status: 'not_found' });
    } catch (error) {
      return json(res, 400, { success: false, error: error instanceof Error ? error.message : 'LAN_BAD_REQUEST' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  state = { running: true, port, host, serverName, serverId, companyId, ip: descriptor.ip || null, baseUrl: descriptor.baseUrl || null, protocolVersion: descriptor.protocolVersion, startedAt: new Date().toISOString(), lastLanIp: descriptor.lastLanIp || null, ipSource: descriptor.ipSource, ipUpdatedAt: descriptor.ipUpdatedAt, networkAvailable: descriptor.networkAvailable };
  timedMaintenance = setInterval(() => runMaintenance(), Math.min(5_000, Math.max(250, Math.floor(policy.inactiveMs / 2))));
  timedMaintenance.unref?.();
  notifyStateChanged('server-started', 'CLIENT_LIST_UPDATED');
  return getLanServerState();
}

export async function stopLanServer() {
  persistClients();
  if (!server) return getLanServerState();
  if (timedMaintenance) clearInterval(timedMaintenance);
  timedMaintenance = null;
  // Preserve client and user sessions across a server process restart.
  for (const client of clients.values()) if (client.status === 'connected') client.status = 'inactive';
  for (const session of userSessions.values()) if (session.status === 'connected') { session.status = 'inactive'; session.endReason = null; }
  persistRuntimeState();
  const active = server;
  server = null;
  await new Promise((resolve, reject) => active.close(error => error ? reject(error) : resolve()));
  state = { ...state, running: false, startedAt: null, connectedClients: 0 };
  notifyStateChanged('server-stopped', 'CLIENT_LIST_UPDATED');
  return getLanServerState();
}
