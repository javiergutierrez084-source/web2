import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { startLanServer, stopLanServer, getLanServerState, drainLanActivityEvents, publishLanRepositoryEvent, refreshLanServerNetworkAddress, setLanServerStateChangeListener } from "./lanServer.js";
import { discoverLanServers } from "./lanDiscovery.js";
import { detectLanIpv4, LanServerDescriptor } from "./lanServerDescriptor.js";
import { startHttpsServer, stopHttpsServer } from "./httpsServer.js";
import { getHttpsServerSession, loginHttpsServer, logoutHttpsServer, readHttpsServerResource, testHttpsServerConnection } from "./httpsClient.js";
import { BACKUP_ROOT_DIRECTORY, BackupFileService } from "./backupFileService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ID = "com.joyacontrol.desktop";
const APP_NAME = "JoyaControl";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const PRODUCTION_INDEX_PATH = path.join(__dirname, "..", "dist", "index.html");
const DEVELOPMENT_HTTPS_HOST = "0.0.0.0";
const DEVELOPMENT_HTTPS_PORT = "8443";
const DEVELOPMENT_HTTPS_DIRECTORY = "https-development";
const DEVELOPMENT_HTTPS_CERTIFICATE = String.raw`-----BEGIN CERTIFICATE-----
MIIDfjCCAmagAwIBAgIUPrij5QKEkdjWHczCmk4IgTH+DZUwDQYJKoZIhvcNAQEL
BQAwNjESMBAGA1UEAwwJbG9jYWxob3N0MSAwHgYDVQQKDBdKb3lhQ29udHJvbCBE
ZXZlbG9wbWVudDAeFw0yNjA3MjkwMTM4MTNaFw0zNjA3MjYwMTM4MTNaMDYxEjAQ
BgNVBAMMCWxvY2FsaG9zdDEgMB4GA1UECgwXSm95YUNvbnRyb2wgRGV2ZWxvcG1l
bnQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCw9+v7MGHLIUgTsfaL
PUVvQtZtVdRJotppC7g8AkMMb0AIPnRC3kxTPBKiYgb0tdiwVw+d71aMaphCanS6
RmHokdvySlTmm9UKzcEFemu/q2j4v+l/UUpg3+XmHfxQTrU/Zkllf9ZClaixrb/a
rrpgS+e8wpbSS12+1kWDRxUxVglvero9fIr4zi85T2aGz4WP5DHAdL8WXS3zx6LS
ASlDRcyay3qOZJdXw84QPtjxBaYlUB7pjMJ/WXZaM0k/ao14bAElSDp7xRN7iapf
gBAuO+XNrxaPG/SIR+jDcdvMPgfpIag+FaFboo/Tfd2la9EcgiTcRCmRfbdhlDJG
4kw1AgMBAAGjgYMwgYAwLAYDVR0RBCUwI4IJbG9jYWxob3N0hwR/AAABhxAAAAAA
AAAAAAAAAAAAAAABMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAKBggrBgEFBQcD
ATAMBgNVHRMBAf8EAjAAMB0GA1UdDgQWBBTbzugI3B0gVY+myyrjcebV2VkDNTAN
BgkqhkiG9w0BAQsFAAOCAQEAANpzA7QtprjWEvTUajMT267/K2XMQv0W3QtfABGC
nWjMDUJoRMa/NHh4R4DoHOEwjCslabrbsz3ABuMuSI0ViOKMNeOjiRDSVgRNXCYB
AtSXTILsHVl0DmCNdq/T4ulESk2bbQKdK9/EvajDqGlqyKItkZL1K2nSSXNICxcx
D4cqAc9S4JMwGG/o+0xMl0MrIbC3CVou0SQiPwzOy4p1p4DE3r6EVXH+xxgYEaNJ
BNMo+OZATHwGPDZ6HwaIOW7l0yp+ZQBfvPZ5G2RUlUeR5CEymPc+uMW5PQ3EdcUK
5Xh1CFO/NbKCk34hEnhqioujbuKslL2T7GARZb2hv8KH4A==
-----END CERTIFICATE-----`;
const DEVELOPMENT_HTTPS_PRIVATE_KEY = String.raw`-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCw9+v7MGHLIUgT
sfaLPUVvQtZtVdRJotppC7g8AkMMb0AIPnRC3kxTPBKiYgb0tdiwVw+d71aMaphC
anS6RmHokdvySlTmm9UKzcEFemu/q2j4v+l/UUpg3+XmHfxQTrU/Zkllf9ZClaix
rb/arrpgS+e8wpbSS12+1kWDRxUxVglvero9fIr4zi85T2aGz4WP5DHAdL8WXS3z
x6LSASlDRcyay3qOZJdXw84QPtjxBaYlUB7pjMJ/WXZaM0k/ao14bAElSDp7xRN7
iapfgBAuO+XNrxaPG/SIR+jDcdvMPgfpIag+FaFboo/Tfd2la9EcgiTcRCmRfbdh
lDJG4kw1AgMBAAECggEACVbEBsj6WDBk79kj5BwzJlh2HWX6onosIYADVHNgG29h
hy3Yj9DQYVIZv6UBrfdMvJ2Tjuea/yT+7P5WM6BUOWQ9Ia+nhFXz67KI/aOEvSQs
EXh7N4NQNAWMydSKRKiqqvJYbDlPUss4EExVhBJVdpB65by1HdrpUxFWsMNXDHfh
q0WE2q0WHOEdpczrA8xI6FfsZJuv4gE3w0xc0pa7gldoZMJnm1417blPbprwExj3
5sbVA5VlAUnvu935NCObAac/SppfE1xdOHVa3btMkiuOlpGC2PIRkj5Syyw9YKtN
qXohQjcgJYnsva2bTokYitjEwzd7fNwtXR6FIDfvEQKBgQD1+m/2imz3gLdVUI5c
Szsac4UHfzKTwUcaO6VN87jBtR8c0XS7rFQFaDwwrPWmLDlXZehAI3MQcyAUbYty
baoxZA8NLyI/KleFxu4nadCrR8mQNqrDWRJYVchxsKz1RfAREBOKXfD+b+yQEwLA
WeVwEywi3T+7jbqB40p1/+69GQKBgQC4LbWYMq036IJwI9rGmVdygN37UtUZxnpt
1owZEDSiP4KtQeVuG0JTsHJShbcRh+m7GHjfmCPw1zFZgCnG5YdtWBwwaQ2doL7S
clp/XQFsamD1GElRgwZtD2IKCpZf9kjCH98FrqtAweJRDkmrelmgvEHwrSti7Fwe
afpeCAePfQKBgQDAIFWVdve3tjT8kUgwtJ48geB1Q5fIqt2TkuUB5wz3WDYt9zg7
YlXaR1lEF8RjgAVly3ZFqqq0PYfgDNQvk5Kss1/CR39zYOot1nysEk1ni1HXr6tf
m9HlZ1OB4aKmjXL+kNUCbW/P/LIEsqSig1TfXkpKDRA7uW7lBxhg5H+f+QKBgAuS
o7R6irPWokuVlSuhewMw4cHnBIjoFc1NC+SPRh9jyjxExbvTbql/js9so4IwfhlJ
gl7aWnfJrcon6Xgb+BSA0tSf5UEgVp02nkUefPZpAMqlygWbLA4yR0DGRYimGxBH
nGXpAc3B4QyizzI9L+CPs70BxJYkr+0hT6AU9RSpAoGBAO6awr01BrkaLA0FWTov
3EDG/R1MjmYOSQb5hNIQgC/gcbW7NpB4jGcNewsv1novE3Ua7fehfilgNyHm1Xf/
7DTvI6+tQ9y3U6Cq7Sl0UtzgswPJKVbOJWWoFq4PzkTCWMOMufKSyVaYZDkM3UDL
p8cXO+3AloGS9ep+E3N1INNO
-----END PRIVATE KEY-----`;

let mainWindow = null;
let closeWaitWindow = null;
let closeWaitPhase = null;
let serverDescriptor = null;
let lanNetworkMonitor = null;
let backupFileService = null;
let closeFlowInProgress = false;
let allowWindowClose = false;
let allowUnsavedUnload = false;
let allowAppQuit = false;
let shutdownPromise = null;
let rendererSessionState = { authenticated: false, mode: "local" };
let sessionPreparedForClose = false;
const pendingClosePreparationRequests = new Map();
const pendingBackupQuitRequests = new Map();
const CLOSE_PREPARATION_WATCHDOG_MS = 15_000;

function getServerDescriptor() {
  if (!serverDescriptor) serverDescriptor = new LanServerDescriptor(app.getPath("userData"));
  serverDescriptor.load();
  return serverDescriptor;
}


ipcMain.on("app-session:state", (_event, payload = {}) => {
  rendererSessionState = {
    authenticated: Boolean(payload.authenticated),
    mode: ["server", "client", "local"].includes(payload.mode) ? payload.mode : "local",
  };
  if (rendererSessionState.authenticated) sessionPreparedForClose = false;
});

ipcMain.on("app-close:prepare-response", (_event, payload = {}) => {
  const pending = pendingClosePreparationRequests.get(payload.requestId);
  if (!pending) return;
  pendingClosePreparationRequests.delete(payload.requestId);
  clearTimeout(pending.timer);
  pending.resolve(payload.result);
});

function requestRendererClosePreparation(options = {}, timeoutMs = CLOSE_PREPARATION_WATCHDOG_MS) {
  return new Promise(resolve => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      resolve({ completed: false, reason: "CLOSE_RENDERER_UNAVAILABLE" });
      return;
    }
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingClosePreparationRequests.delete(requestId);
      resolve({ completed: false, reason: "CLOSE_PREPARATION_TIMEOUT" });
    }, timeoutMs);
    pendingClosePreparationRequests.set(requestId, { resolve, timer });
    mainWindow.webContents.send("app-close:prepare", { requestId, ...options });
  });
}

const pendingLanAuth = new Map();
ipcMain.on("lan-auth:response", (_event, payload) => {
  const pending = pendingLanAuth.get(payload?.requestId);
  if (!pending) return;
  pendingLanAuth.delete(payload.requestId);
  clearTimeout(pending.timer);
  pending.resolve(payload.result);
});

const pendingHttpsAuth = new Map();
ipcMain.on("https-auth:response", (_event, payload) => {
  const pending = pendingHttpsAuth.get(payload?.requestId);
  if (!pending) return;
  pendingHttpsAuth.delete(payload.requestId);
  clearTimeout(pending.timer);
  pending.resolve(payload.result);
});

const pendingHttpsReads = new Map();
ipcMain.on("https-read:response", (_event, payload) => {
  const pending = pendingHttpsReads.get(payload?.requestId);
  if (!pending) return;
  pendingHttpsReads.delete(payload.requestId);
  clearTimeout(pending.timer);
  if (payload.result?.success) pending.resolve(payload.result.data);
  else pending.reject(new Error(payload.result?.error || "HTTPS_READ_PROVIDER_FAILED"));
});


function armBackupQuitWatchdog(requestId, pending, timeoutMs = CLOSE_PREPARATION_WATCHDOG_MS) {
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    pendingBackupQuitRequests.delete(requestId);
    pending.resolve({ completed: false, reason: "BACKUP_BEFORE_QUIT_TIMEOUT" });
  }, timeoutMs);
}

ipcMain.on("backup:before-quit-progress", (_event, payload) => {
  const pending = pendingBackupQuitRequests.get(payload?.requestId);
  if (!pending) return;
  armBackupQuitWatchdog(payload.requestId, pending);
  void showCloseWaitWindow(payload?.phase === "finalizing" ? "finalizing" : "backup");
});

ipcMain.on("backup:before-quit-response", (_event, payload) => {
  const pending = pendingBackupQuitRequests.get(payload?.requestId);
  if (!pending) return;
  pendingBackupQuitRequests.delete(payload.requestId);
  clearTimeout(pending.timer);
  pending.resolve(payload.result || { completed: false, reason: "BACKUP_QUIT_RESPONSE_EMPTY" });
});

const pendingRepositoryCalls = new Map();
ipcMain.on("lan-repository:response", (_event, payload) => {
  const pending = pendingRepositoryCalls.get(payload?.requestId);
  if (!pending) return;
  pendingRepositoryCalls.delete(payload.requestId);
  clearTimeout(pending.timer);
  if (payload.result?.success) pending.resolve(payload.result.data);
  else pending.reject(new Error(payload.result?.error || "LAN_REPOSITORY_CALL_FAILED"));
});

function executeRepositoryCall(method, args) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error("LAN_REPOSITORY_PROVIDER_UNAVAILABLE"));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingRepositoryCalls.delete(requestId); reject(new Error("LAN_REPOSITORY_TIMEOUT")); }, 15000);
    pendingRepositoryCalls.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("lan-repository:request", { requestId, method, args });
  });
}

function authenticateLanUser(username, password) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error("LAN_AUTH_PROVIDER_UNAVAILABLE"));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingLanAuth.delete(requestId); reject(new Error("LAN_AUTH_TIMEOUT")); }, 10000);
    pendingLanAuth.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("lan-auth:request", { requestId, username, password });
  });
}

function authenticateHttpsUser(username, password) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error("HTTPS_AUTH_PROVIDER_UNAVAILABLE"));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingHttpsAuth.delete(requestId); reject(new Error("HTTPS_AUTH_TIMEOUT")); }, 10000);
    pendingHttpsAuth.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("https-auth:request", { requestId, username, password });
  });
}

function requestHttpsRendererRead(resource, args = {}) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error("HTTPS_READ_PROVIDER_UNAVAILABLE"));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingHttpsReads.delete(requestId);
      reject(new Error("HTTPS_READ_PROVIDER_TIMEOUT"));
    }, 10_000);
    pendingHttpsReads.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("https-read:request", { requestId, resource, args });
  });
}

async function readStoredPrintConfiguration() {
  const userDataPath = app.getPath("userData");
  const candidates = [
    { filename: "joyacontrol-print-queue.json", select: (value) => value?.configuration },
    { filename: "print-settings.json", select: (value) => value },
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(path.join(userDataPath, candidate.filename), "utf8");
      const parsed = JSON.parse(raw);
      const configuration = candidate.select(parsed);
      if (configuration && typeof configuration === "object" && !Array.isArray(configuration)) {
        return configuration;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(`[HTTPS] No fue posible leer ${candidate.filename}:`, error?.message || error);
      }
    }
  }
  return null;
}

async function readHttpsServerData(resource, args = {}) {
  if (resource === "permissions") {
    const permissions = await requestHttpsRendererRead("permissions", args);
    return { permissions: Array.isArray(permissions) ? permissions : [] };
  }
  if (resource === "company") {
    const company = await requestHttpsRendererRead("company", args);
    return { company, printConfiguration: await readStoredPrintConfiguration() };
  }
  if ([
    "contacts", "contact", "contactsSearch",
    "products", "product", "productsSearch",
    "inventory", "inventoryItem",
  ].includes(resource)) {
    return requestHttpsRendererRead(resource, args);
  }
  throw new Error("HTTPS_READ_RESOURCE_NOT_ALLOWED");
}

async function startConfiguredLanServer(config = {}) {
  const descriptor = getServerDescriptor();
  const current = descriptor.load();
  descriptor.update({
    serverName: String(config.serverName || current.serverName || "Servidor JoyaControl"),
    port: Number(config.port || current.port),
    protocolVersion: current.protocolVersion || "LAN-1",
    enabled: true,
    addressMode: 'automatic',
    allowMultipleUserSessions: config.allowMultipleUserSessions ?? current.allowMultipleUserSessions,
  });
  const activeDescriptor = descriptor.ensureServerIdentity();
  const configuredSessionDurationDays = Number(
    config.sessionDurationDays ?? process.env.JOYACONTROL_SESSION_DURATION_DAYS ?? 30,
  );
  return startLanServer({
    host: "0.0.0.0",
    port: activeDescriptor.port,
    serverName: activeDescriptor.serverName,
    descriptor,
    userDataPath: app.getPath("userData"),
    version: "2.1",
    sessionPolicy: {
      sessionDurationDays: Number.isFinite(configuredSessionDurationDays) && configuredSessionDurationDays > 0
        ? configuredSessionDurationDays
        : 30,
    },
    allowMultipleUserSessions: activeDescriptor.allowMultipleUserSessions !== false,
    authenticateUser: authenticateLanUser,
    executeRepositoryCall,
  });
}

const LAN_IPC_CHANNELS = Object.freeze({
  start: ["lan-server-start", "lan-server:start"],
  stop: ["lan-server-stop", "lan-server:stop"],
  status: ["lan-server-status", "lan-server:status"],
  activityEvents: ["lan-server-activity-events", "lan-server:activity-events"],
  discover: ["lan-network-discover", "lan-network:discover"],
  identity: ["lan-system-identity", "lan-system:identity"],
});

function registerHandleAliases(channels, handler) {
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}

function publishLanServerState(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('lan-server-state-changed', payload);
  if (payload?.eventType) mainWindow.webContents.send('lan-server-event', payload);
}

function descriptorStateSnapshot(descriptor) {
  return { ...getLanServerState(), ip: descriptor.ip || null, baseUrl: descriptor.baseUrl || null, lastLanIp: descriptor.lastLanIp || null, ipSource: descriptor.ipSource, ipUpdatedAt: descriptor.ipUpdatedAt, networkAvailable: descriptor.networkAvailable };
}

function refreshPrincipalServerAddress() {
  const descriptorStore = getServerDescriptor();
  const current = descriptorStore.load();
  if (current.addressMode !== 'automatic' && current.enabled !== true) return current;
  if (getLanServerState().running) return refreshLanServerNetworkAddress() || descriptorStore.toJSON();
  const next = descriptorStore.refreshDetectedIp();
  const changed = current.ip !== next.ip || current.baseUrl !== next.baseUrl || current.lastLanIp !== next.lastLanIp || current.ipSource !== next.ipSource || current.ipUpdatedAt !== next.ipUpdatedAt || current.networkAvailable !== next.networkAvailable;
  if (changed) publishLanServerState({
    reason: 'server-ip-changed', eventType: 'SERVER_IP_CHANGED',
    details: { serverId: next.serverId, previousIp: current.ip || null, currentIp: next.ip || null, lastLanIp: next.lastLanIp || null, ipSource: next.ipSource, ipUpdatedAt: next.ipUpdatedAt, networkAvailable: next.networkAvailable },
    state: descriptorStateSnapshot(next),
  });
  return next;
}

function startLanNetworkMonitor() {
  if (lanNetworkMonitor) return;
  lanNetworkMonitor = setInterval(() => {
    try { refreshPrincipalServerAddress(); }
    catch (error) { console.error('[LAN] No fue posible actualizar la IPv4 LAN:', error); }
  }, 1500);
  lanNetworkMonitor.unref?.();
}

function stopLanNetworkMonitor() {
  if (!lanNetworkMonitor) return;
  clearInterval(lanNetworkMonitor);
  lanNetworkMonitor = null;
}

function saveDescriptorPatch(descriptor, patch = {}) {
  const saved = descriptor.update(patch);
  return saved.addressMode === 'automatic' ? descriptor.refreshDetectedIp() : saved;
}

function httpsClientFailure(error) {
  return {
    ok: false,
    errorCode: error?.code || "HTTPS_SERVER_NOT_FOUND",
    errorMessage: error?.message || "No fue posible conectar con el servidor HTTPS",
  };
}

function registerHttpsClientIpcHandlers() {
  ipcMain.removeHandler("https-server:test-connection");
  ipcMain.handle("https-server:test-connection", async (_event, options = {}) => {
    try { return await testHttpsServerConnection(options); }
    catch (error) { return httpsClientFailure(error); }
  });

  ipcMain.removeHandler("https-server:login");
  ipcMain.handle("https-server:login", async (_event, options = {}) => {
    try { return await loginHttpsServer(options); }
    catch (error) { return httpsClientFailure(error); }
  });

  ipcMain.removeHandler("https-server:session");
  ipcMain.handle("https-server:session", async (_event, options = {}) => {
    try { return await getHttpsServerSession(options); }
    catch (error) { return httpsClientFailure(error); }
  });

  ipcMain.removeHandler("https-server:logout");
  ipcMain.handle("https-server:logout", async (_event, options = {}) => {
    try { return await logoutHttpsServer(options); }
    catch (error) { return httpsClientFailure(error); }
  });

  ipcMain.removeHandler("https-server:read");
  ipcMain.handle("https-server:read", async (_event, options = {}) => {
    try { return await readHttpsServerResource(options); }
    catch (error) { return httpsClientFailure(error); }
  });
}


function getBackupFileService() {
  if (!backupFileService) {
    backupFileService = new BackupFileService({ userDataPath: app.getPath("userData") });
  }
  return backupFileService;
}

async function registerBackupIpcHandlers() {
  const service = getBackupFileService();
  await service.initialize();

  ipcMain.removeHandler("backup:select-folder");
  ipcMain.handle("backup:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Seleccionar carpeta para copias de JoyaControl",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const folderPath = result.filePaths[0];
    const validation = await service.validateFolder(folderPath);
    if (!validation.ok) {
      const error = new Error(validation.message);
      error.code = validation.code;
      throw error;
    }
    return { canceled: false, folderPath };
  });

  ipcMain.removeHandler("backup:set-folder");
  ipcMain.handle("backup:set-folder", async (_event, folderPath = "") => service.setConfiguredFolder(folderPath));

  ipcMain.removeHandler("backup:get-status");
  ipcMain.handle("backup:get-status", async () => {
    await service.initialize();
    return service.getStatus();
  });

  ipcMain.removeHandler("backup:validate-folder");
  ipcMain.handle("backup:validate-folder", async (_event, folderPath = "") => service.validateFolder(folderPath));

  ipcMain.removeHandler("backup:write-file");
  ipcMain.handle("backup:write-file", async (_event, payload = {}) => service.writeBackup(payload));

  ipcMain.removeHandler("backup:open-folder");
  ipcMain.handle("backup:open-folder", async (_event, folderPath = "") => {
    const normalized = String(folderPath || service.getStatus().configuredFolder || "").trim();
    if (!normalized) throw new Error("Seleccione una carpeta para las copias externas.");
    const validation = await service.validateFolder(normalized);
    if (!validation.ok) {
      const error = new Error(validation.message);
      error.code = validation.code;
      throw error;
    }
    const rootPath = path.join(normalized, BACKUP_ROOT_DIRECTORY);
    await fs.mkdir(rootPath, { recursive: true });
    const result = await shell.openPath(rootPath);
    if (result) throw new Error(result);
    return { opened: true, rootPath };
  });
}

function requestRendererBackupBeforeQuit(timeoutMs = CLOSE_PREPARATION_WATCHDOG_MS) {
  return new Promise(resolve => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      resolve({ completed: true, waitedForBackup: false, reason: "BACKUP_RENDERER_UNAVAILABLE" });
      return;
    }
    const requestId = crypto.randomUUID();
    const pending = { resolve, timer: null };
    pendingBackupQuitRequests.set(requestId, pending);
    armBackupQuitWatchdog(requestId, pending, timeoutMs);
    mainWindow.webContents.send("backup:before-quit", { requestId });
  });
}

function closeWaitHtml(phase) {
  const finalizing = phase === "finalizing";
  const title = finalizing ? "Finalizando respaldo..." : "Guardando copia de seguridad...";
  const status = finalizing
    ? "La copia terminó correctamente. JoyaControl se cerrará automáticamente."
    : "Por favor espere unos segundos. No cierre el programa ni apague el computador.";
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Segoe UI", Arial, sans-serif; background: #f8fafc; color: #172033; }
    main { width: 100%; padding: 34px 38px 30px; text-align: center; border: 1px solid #d9e1ec; background: #ffffff; }
    .spinner { width: 46px; height: 46px; margin: 0 auto 20px; border: 5px solid #dce6f3; border-top-color: #2563eb; border-radius: 50%; animation: spin .9s linear infinite; }
    h1 { margin: 0 0 12px; font-size: 22px; font-weight: 700; }
    .message { margin: 0 auto 12px; max-width: 430px; font-size: 15px; line-height: 1.5; font-weight: 600; }
    .status { margin: 0 auto; max-width: 430px; color: #526174; font-size: 13px; line-height: 1.5; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <h1>${title}</h1>
    <p class="message">JoyaControl está terminando una copia de seguridad para proteger la información antes de cerrar.</p>
    <p class="status">${status}</p>
  </main>
</body>
</html>`;
}

async function showCloseWaitWindow(phase = "backup") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (closeWaitWindow && !closeWaitWindow.isDestroyed() && closeWaitPhase === phase) {
    if (!closeWaitWindow.isVisible()) closeWaitWindow.show();
    return;
  }
  closeWaitPhase = phase;
  if (!closeWaitWindow || closeWaitWindow.isDestroyed()) {
    closeWaitWindow = new BrowserWindow({
      width: 540,
      height: 290,
      parent: mainWindow,
      modal: false,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    closeWaitWindow.setMenuBarVisibility(false);
    closeWaitWindow.on("closed", () => { closeWaitWindow = null; });
  }
  const target = closeWaitWindow;
  try {
    await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(closeWaitHtml(phase))}`);
    if (!target.isDestroyed()) {
      target.center();
      target.show();
      target.focus();
    }
  } catch (error) {
    console.error("[Cierre] No fue posible mostrar la espera del respaldo:", error);
  }
}

function destroyCloseWaitWindow() {
  if (closeWaitWindow && !closeWaitWindow.isDestroyed()) closeWaitWindow.destroy();
  closeWaitWindow = null;
  closeWaitPhase = null;
}

function resetCloseFlow() {
  closeFlowInProgress = false;
  allowWindowClose = false;
  allowUnsavedUnload = false;
  destroyCloseWaitWindow();
}

async function rendererHasUnsavedChanges() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  try {
    return Boolean(await mainWindow.webContents.executeJavaScript(`(() => {
      const event = new Event("beforeunload", { cancelable: true });
      return !window.dispatchEvent(event) || event.defaultPrevented;
    })()`, true));
  } catch (error) {
    console.error("[Cierre] No fue posible consultar cambios sin guardar:", error);
    return false;
  }
}

async function confirmUnsavedChangesBeforeClose() {
  if (!await rendererHasUnsavedChanges()) return true;
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Confirmar salida",
    message: "Existen cambios sin guardar.",
    detail: "¿Desea salir?",
    buttons: ["Salir", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (choice.response !== 0) return false;
  allowUnsavedUnload = true;
  return true;
}

async function waitForBackupWithUserConsent() {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Copia de seguridad en curso",
    message: "Se está realizando una copia de seguridad automática.",
    detail: "Espere unos segundos para evitar dañar el respaldo.",
    buttons: ["Esperar (recomendado)", "Cancelar salida"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (choice.response !== 0) return false;
  const result = await requestRendererBackupBeforeQuit();
  return Boolean(result?.completed);
}

async function prepareSessionForClose({ logout = false } = {}) {
  const preparation = await requestRendererClosePreparation({ logout });
  if (!preparation?.completed) return { completed: false, cancelled: false };
  if (preparation.backupActive) {
    const waited = await waitForBackupWithUserConsent();
    if (!waited) return { completed: false, cancelled: true };
  }
  stopLanNetworkMonitor();
  await Promise.allSettled([stopLanServer(), stopHttpsServer()]);
  rendererSessionState = { authenticated: false, mode: preparation.mode || rendererSessionState.mode };
  sessionPreparedForClose = true;
  return { completed: true, cancelled: false };
}

ipcMain.handle("app-session:logout", async () => prepareSessionForClose({ logout: true }));

function finalizeApplicationQuit() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    stopLanNetworkMonitor();
    await Promise.allSettled([stopLanServer(), stopHttpsServer()]);
    allowAppQuit = true;
    app.quit();
  })();
  return shutdownPromise;
}

async function beginApplicationClose() {
  if (allowAppQuit || closeFlowInProgress) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    await finalizeApplicationQuit();
    return;
  }

  closeFlowInProgress = true;
  if (!await confirmUnsavedChangesBeforeClose()) {
    resetCloseFlow();
    return;
  }

  if (rendererSessionState.authenticated && !sessionPreparedForClose) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Cerrar JoyaControl de forma segura",
      message: "Primero cierre la sesión para salir de JoyaControl de forma segura.",
      detail: "Se cerrará la sesión, se liberarán las conexiones y luego la aplicación se cerrará automáticamente.",
      buttons: ["Cerrar sesión y salir", "Cancelar"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) {
      resetCloseFlow();
      return;
    }
    const prepared = await prepareSessionForClose({ logout: true });
    if (!prepared.completed) {
      resetCloseFlow();
      return;
    }
  } else if (!sessionPreparedForClose) {
    const prepared = await prepareSessionForClose({ logout: false });
    if (!prepared.completed && !prepared.cancelled) {
      resetCloseFlow();
      return;
    }
    if (prepared.cancelled) {
      resetCloseFlow();
      return;
    }
  }

  destroyCloseWaitWindow();
  allowWindowClose = true;
  mainWindow.close();
}

function registerLanIpcHandlers() {
  const descriptor = getServerDescriptor();
  setLanServerStateChangeListener(publishLanServerState);

  ipcMain.removeAllListeners('lan-server-descriptor:get-sync');
  ipcMain.on('lan-server-descriptor:get-sync', event => { event.returnValue = descriptor.toJSON(); });
  ipcMain.removeAllListeners('lan-server-descriptor:save-sync');
  ipcMain.on('lan-server-descriptor:save-sync', (event, patch = {}) => { event.returnValue = saveDescriptorPatch(descriptor, patch); });
  registerHandleAliases(['lan-server-descriptor:load'], async () => descriptor.load());
  registerHandleAliases(['lan-server-descriptor:save'], async (_event, patch = {}) => saveDescriptorPatch(descriptor, patch));
  registerHandleAliases(['lan-server-descriptor:reset'], async () => descriptor.reset());
  registerHandleAliases(['lan-network-detect-ip'], async () => ({ hostname: os.hostname(), ip: detectLanIpv4() }));
  registerHandleAliases(['lan-repository-event:publish'], async (_event, type) => publishLanRepositoryEvent(type));

  registerHandleAliases(LAN_IPC_CHANNELS.start, async (_event, config = {}) => startConfiguredLanServer(config));
  registerHandleAliases(LAN_IPC_CHANNELS.stop, async () => {
    descriptor.update({ enabled: false });
    return stopLanServer();
  });
  registerHandleAliases(LAN_IPC_CHANNELS.status, async () => getLanServerState());
  registerHandleAliases(LAN_IPC_CHANNELS.activityEvents, async () => drainLanActivityEvents());
  registerHandleAliases(LAN_IPC_CHANNELS.discover, async (_event, options = {}) => {
    const current = descriptor.load();
    return discoverLanServers({
      port: current.port,
      timeoutMs: options.timeoutMs,
      knownIp: current.ip,
    });
  });
  registerHandleAliases(LAN_IPC_CHANNELS.identity, async () => ({ hostname: os.hostname(), ip: detectLanIpv4() }));
}

function getWindowIconPath() {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, "build", iconFile)
    : path.join(__dirname, "..", "build", iconFile);
}

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

async function prepareDevelopmentHttpsConfiguration() {
  if (app.isPackaged) return;

  // En Electron + Vite HTTPS siempre está habilitado. La aplicación empaquetada
  // conserva exactamente la política basada en JOYACONTROL_HTTPS_ENABLED.
  process.env.JOYACONTROL_HTTPS_ENABLED = "true";
  process.env.JOYACONTROL_HTTPS_HOST = String(
    process.env.JOYACONTROL_HTTPS_HOST || DEVELOPMENT_HTTPS_HOST,
  ).trim() || DEVELOPMENT_HTTPS_HOST;
  process.env.JOYACONTROL_HTTPS_PORT = String(
    process.env.JOYACONTROL_HTTPS_PORT || DEVELOPMENT_HTTPS_PORT,
  ).trim() || DEVELOPMENT_HTTPS_PORT;

  const developmentTlsDirectory = path.join(
    app.getPath("userData"),
    DEVELOPMENT_HTTPS_DIRECTORY,
  );
  const configuredCertificatePath = String(
    process.env.JOYACONTROL_HTTPS_CERT_PATH || "",
  ).trim();
  const configuredPrivateKeyPath = String(
    process.env.JOYACONTROL_HTTPS_KEY_PATH || "",
  ).trim();

  await fs.mkdir(developmentTlsDirectory, { recursive: true });

  if (!configuredCertificatePath) {
    const certificatePath = path.join(developmentTlsDirectory, "localhost-cert.pem");
    await fs.writeFile(certificatePath, `${DEVELOPMENT_HTTPS_CERTIFICATE}
`, {
      encoding: "utf8",
      mode: 0o600,
    });
    process.env.JOYACONTROL_HTTPS_CERT_PATH = certificatePath;
  }

  if (!configuredPrivateKeyPath) {
    const privateKeyPath = path.join(developmentTlsDirectory, "localhost-key.pem");
    await fs.writeFile(privateKeyPath, `${DEVELOPMENT_HTTPS_PRIVATE_KEY}
`, {
      encoding: "utf8",
      mode: 0o600,
    });
    process.env.JOYACONTROL_HTTPS_KEY_PATH = privateKeyPath;
  }
}

async function startConfiguredHttpsServer() {
  try {
    const state = await startHttpsServer({
      userDataPath: app.getPath("userData"),
      version: "3.0.0",
      executeRepositoryCall,
      authenticateUser: authenticateHttpsUser,
      readServerData: readHttpsServerData,
    });

    if (!state?.enabled) {
      console.error(
        "Error iniciando HTTPS:",
        "servidor deshabilitado; JOYACONTROL_HTTPS_ENABLED debe estar definido como true en el proceso de Electron",
      );
      return state;
    }

    if (!state?.running) {
      console.error(
        "Error iniciando HTTPS:",
        state?.lastError || "el servidor no quedó escuchando en el puerto configurado",
      );
    }
    return state;
  } catch (error) {
    if (!error?.httpsStartupLogged) {
      console.error(
        "Error iniciando HTTPS:",
        error?.httpsStartupMessage || error?.message || error,
      );
    }
    return null;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    title: APP_NAME,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("close", event => {
    if (process.platform === "darwin" || allowWindowClose) return;
    event.preventDefault();
    void beginApplicationClose();
  });
  mainWindow.webContents.on("will-prevent-unload", event => {
    if (allowUnsavedUnload) {
      event.preventDefault();
      return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      title: "Confirmar salida",
      message: "Existen cambios sin guardar.",
      detail: "¿Desea salir?",
      buttons: ["Salir", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) {
      allowUnsavedUnload = true;
      event.preventDefault();
      return;
    }
    resetCloseFlow();
  });
  mainWindow.on("closed", () => {
    const shouldQuitApplication = process.platform !== "darwin" || closeFlowInProgress || allowWindowClose;
    destroyCloseWaitWindow();
    mainWindow = null;
    if (shouldQuitApplication) void finalizeApplicationQuit();
  });
  if (app.isPackaged) await mainWindow.loadFile(PRODUCTION_INDEX_PATH);
  else await mainWindow.loadURL(DEV_SERVER_URL);
  return mainWindow;
}

app.whenReady().then(async () => {
  registerLanIpcHandlers();
  registerHttpsClientIpcHandlers();
  await registerBackupIpcHandlers();

  // En desarrollo prepara host, puerto y material TLS sin requerir variables.
  // En la aplicación empaquetada no cambia ninguna variable ni política existente.
  try {
    await prepareDevelopmentHttpsConfiguration();
  } catch (error) {
    console.error(
      "Error iniciando HTTPS:",
      `no fue posible preparar la configuración automática de desarrollo: ${error?.message || error}`,
    );
  }

  // Dispara HTTPS antes del renderer y sin depender de LAN. Aunque la ventana falle,
  // el intento de abrir el puerto ya fue iniciado y registrará el resultado exacto.
  const httpsStartup = startConfiguredHttpsServer();

  const descriptorStore = getServerDescriptor();
  const loadedDescriptor = descriptorStore.load();
  if (loadedDescriptor.addressMode === 'automatic' || loadedDescriptor.enabled === true) descriptorStore.refreshDetectedIp();
  await createWindow();
  startLanNetworkMonitor();
  const descriptor = descriptorStore.load();
  if (descriptor.enabled) {
    try { await startConfiguredLanServer(descriptor); }
    catch (error) { console.error("[LAN] No fue posible restaurar el Servidor Principal:", error); }
  }
  await httpsStartup;

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch((error) => {
  console.error("No fue posible iniciar JoyaControl:", error);
  app.quit();
});

app.on("before-quit", event => {
  if (allowAppQuit) return;
  event.preventDefault();
  void beginApplicationClose();
});
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (allowAppQuit) app.quit();
  else void finalizeApplicationQuit();
});
