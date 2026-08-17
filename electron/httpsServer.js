import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import os from "node:os";

const APP_NAME = "JoyaControl";
const HTTPS_PROTOCOL = "HTTPS";
const SERVER_ID_FILE_NAME = ".joyacontrol-https-server-id";
const MAX_HEADER_SIZE_BYTES = 16 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const DEFAULT_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SUPPORTED_HTTPS_MAJOR_VERSION = 3;

let activeServer = null;
let startPromise = null;
let serverState = createInitialState();
const activeSessions = new Map();

function createInitialState() {
  return {
    enabled: false,
    running: false,
    host: null,
    port: null,
    protocol: HTTPS_PROTOCOL,
    version: null,
    serverId: null,
    startedAt: null,
    stoppedAt: null,
    lastError: null,
  };
}

function createConfigurationError(message) {
  const error = new Error(message);
  error.code = "HTTPS_CONFIGURATION_INVALID";
  return error;
}

function parseEnabled(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw createConfigurationError("JOYACONTROL_HTTPS_ENABLED debe ser true o false");
}

function requiredEnvironmentValue(env, name) {
  const value = String(env?.[name] ?? "").trim();
  if (!value) throw createConfigurationError(`${name} es obligatorio cuando HTTPS está habilitado`);
  return value;
}

function readHttpsConfiguration(env = process.env) {
  const enabled = parseEnabled(env?.JOYACONTROL_HTTPS_ENABLED);
  if (!enabled) return { enabled: false };

  const host = requiredEnvironmentValue(env, "JOYACONTROL_HTTPS_HOST");
  const portValue = requiredEnvironmentValue(env, "JOYACONTROL_HTTPS_PORT");
  if (!/^\d+$/.test(portValue)) {
    throw createConfigurationError("JOYACONTROL_HTTPS_PORT debe ser un número entero");
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw createConfigurationError("JOYACONTROL_HTTPS_PORT debe estar entre 1 y 65535");
  }

  return {
    enabled: true,
    host,
    port,
    certPath: path.resolve(requiredEnvironmentValue(env, "JOYACONTROL_HTTPS_CERT_PATH")),
    keyPath: path.resolve(requiredEnvironmentValue(env, "JOYACONTROL_HTTPS_KEY_PATH")),
  };
}

function createHttpsStartupError(code, message, cause = undefined) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  return error;
}

function startupErrorMessage(error, configuration = null) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "Error desconocido");
  const endpoint = configuration?.host && configuration?.port
    ? `${configuration.host}:${configuration.port}`
    : "el puerto configurado";

  if (code === "EADDRINUSE") return `puerto ocupado: ${endpoint}`;
  if (code === "EACCES" || code === "EPERM") {
    return `permisos insuficientes para abrir ${endpoint} o leer los archivos TLS: ${message}`;
  }
  if (code === "EADDRNOTAVAIL" || code === "ENOTFOUND") {
    return `host HTTPS incorrecto o no disponible (${configuration?.host || "sin host"}): ${message}`;
  }
  if (code === "HTTPS_CERTIFICATE_NOT_FOUND") return message;
  if (code === "HTTPS_PRIVATE_KEY_NOT_FOUND") return message;
  if (code === "HTTPS_TLS_PATH_INVALID") return message;
  if (code === "HTTPS_TLS_FILE_READ_FAILED") return message;
  if (code === "HTTPS_TLS_MATERIAL_INVALID" || code.startsWith("ERR_OSSL_") || code.startsWith("ERR_SSL_")) {
    return `certificado o clave privada inválidos: ${message}`;
  }
  if (code === "HTTPS_CONFIGURATION_INVALID") return `configuración HTTPS inválida: ${message}`;
  return `${message}${code ? ` [${code}]` : ""}`;
}

async function readTlsFile(filePath, kind) {
  const isCertificate = kind === "certificate";
  const label = isCertificate ? "certificado" : "clave privada";
  const missingCode = isCertificate ? "HTTPS_CERTIFICATE_NOT_FOUND" : "HTTPS_PRIVATE_KEY_NOT_FOUND";

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createHttpsStartupError(missingCode, `${label} inexistente: ${filePath}`, error);
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw createHttpsStartupError(error.code, `sin permisos para acceder al ${label}: ${filePath}`, error);
    }
    throw createHttpsStartupError(
      "HTTPS_TLS_PATH_INVALID",
      `ruta incorrecta para el ${label}: ${filePath}. ${error?.message || error}`,
      error,
    );
  }

  if (!stats.isFile()) {
    throw createHttpsStartupError(
      "HTTPS_TLS_PATH_INVALID",
      `ruta incorrecta para el ${label}; se esperaba un archivo: ${filePath}`,
    );
  }

  try {
    const contents = await fs.readFile(filePath);
    if (contents.length === 0) {
      throw createHttpsStartupError(
        "HTTPS_TLS_FILE_READ_FAILED",
        `el archivo del ${label} está vacío: ${filePath}`,
      );
    }
    return contents;
  } catch (error) {
    if (error?.code === "HTTPS_TLS_FILE_READ_FAILED") throw error;
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw createHttpsStartupError(error.code, `sin permisos para leer el ${label}: ${filePath}`, error);
    }
    throw createHttpsStartupError(
      "HTTPS_TLS_FILE_READ_FAILED",
      `error de lectura del ${label}: ${filePath}. ${error?.message || error}`,
      error,
    );
  }
}

function isValidServerId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readPersistentServerId(filePath) {
  const value = (await fs.readFile(filePath, "utf8")).trim();
  if (!isValidServerId(value)) {
    const error = new Error("La identidad persistente del servidor HTTPS no es válida");
    error.code = "HTTPS_SERVER_ID_INVALID";
    throw error;
  }
  return value;
}

async function loadOrCreateServerId(userDataPath) {
  const storageDirectory = String(userDataPath ?? "").trim();
  if (!storageDirectory) throw createConfigurationError("userDataPath es obligatorio para conservar el serverId HTTPS");

  await fs.mkdir(storageDirectory, { recursive: true });
  const filePath = path.join(storageDirectory, SERVER_ID_FILE_NAME);

  try {
    return await readPersistentServerId(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const generatedServerId = crypto.randomUUID();
  try {
    await fs.writeFile(filePath, `${generatedServerId}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return generatedServerId;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return readPersistentServerId(filePath);
  }
}

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, statusCode, payload, additionalHeaders = {}) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...securityHeaders(),
    ...additionalHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response, statusCode, error, message) {
  sendJson(response, statusCode, { error, message });
}

function versionMajor(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}

function isCompatibleClientVersion(clientVersion, serverVersion) {
  const clientMajor = versionMajor(clientVersion);
  const serverMajor = versionMajor(serverVersion);
  return clientMajor === SUPPORTED_HTTPS_MAJOR_VERSION && clientMajor === serverMajor;
}

function normalizeSessionDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SESSION_DURATION_MS;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;

    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
        const error = new Error("La solicitud HTTPS excede el límite permitido");
        error.code = "HTTPS_REQUEST_TOO_LARGE";
        request.destroy(error);
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("La solicitud debe utilizar application/json");
    error.code = "HTTPS_CONTENT_TYPE_INVALID";
    throw error;
  }

  const text = await readRequestBody(request);
  if (!text.trim()) {
    const error = new Error("El cuerpo JSON es obligatorio");
    error.code = "HTTPS_REQUEST_BODY_REQUIRED";
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error("El cuerpo de la solicitud no contiene JSON válido", { cause });
    error.code = "HTTPS_REQUEST_JSON_INVALID";
    throw error;
  }
}

function credentialsFromPayload(payload) {
  return {
    username: String(payload?.usuario ?? payload?.username ?? "").trim(),
    password: String(payload?.contrasena ?? payload?.["contraseña"] ?? payload?.password ?? ""),
    clientVersion: String(payload?.versionCliente ?? payload?.clientVersion ?? payload?.version ?? "").trim(),
  };
}

function authenticationFailure(error) {
  const message = String(error?.message || error || "");
  if (/usuario no encontrado/i.test(message)) {
    return { statusCode: 401, code: "HTTPS_USER_NOT_FOUND", message: "Usuario inexistente" };
  }
  if (/contraseña incorrecta|contrasena incorrecta/i.test(message)) {
    return { statusCode: 401, code: "HTTPS_PASSWORD_INCORRECT", message: "Contraseña incorrecta" };
  }
  if (/usuario desactivado/i.test(message)) {
    return { statusCode: 403, code: "HTTPS_USER_DISABLED", message: "Usuario desactivado" };
  }
  return { statusCode: 503, code: "HTTPS_AUTH_PROVIDER_UNAVAILABLE", message: "No fue posible validar el usuario" };
}

function sessionIdFromRequest(request) {
  const authorization = String(request.headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

function getActiveSession(request, now, serverVersion) {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) {
    return { error: { statusCode: 401, code: "HTTPS_SESSION_REQUIRED", message: "La sesión HTTPS es obligatoria" } };
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return { error: { statusCode: 401, code: "HTTPS_SESSION_INVALID", message: "La sesión HTTPS no es válida" } };
  }

  if (Date.parse(session.expiresAt) <= now()) {
    activeSessions.delete(sessionId);
    return { error: { statusCode: 401, code: "HTTPS_SESSION_EXPIRED", message: "La sesión HTTPS expiró" } };
  }

  if (session.userActive === false) {
    activeSessions.delete(sessionId);
    return { error: { statusCode: 403, code: "HTTPS_USER_DISABLED", message: "Usuario desactivado" } };
  }

  if (serverVersion && !isCompatibleClientVersion(session.version, serverVersion)) {
    activeSessions.delete(sessionId);
    return { error: { statusCode: 426, code: "HTTPS_VERSION_INCOMPATIBLE", message: "La versión de la sesión no es compatible con el servidor" } };
  }

  return { sessionId, session };
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((permission) => String(permission || "").trim()).filter(Boolean))];
}

async function resolveSessionPermissions(readServerData, authenticated) {
  const embedded = normalizePermissions(authenticated?.permissions);
  if (embedded.length > 0 || typeof readServerData !== "function") return embedded;

  const resolved = await readServerData("permissions", {
    userId: String(authenticated?.userId || ""),
    username: String(authenticated?.username || ""),
    role: String(authenticated?.role || ""),
  });
  return normalizePermissions(resolved?.permissions ?? resolved);
}

function publicLoginSession(session) {
  return {
    sessionId: session.sessionId,
    serverId: session.serverId,
    usuario: session.username,
    nombre: session.displayName,
    rol: session.role,
    fecha: session.createdAt,
    expiracion: session.expiresAt,
    version: session.version,
  };
}

function publicMe(session) {
  return {
    id: session.userId,
    usuario: session.username,
    nombre: session.displayName,
    rol: session.role,
    permisos: [...session.permissions],
  };
}

function publicPermissions(session) {
  return { permisos: [...session.permissions] };
}

function normalizeCompanyPayload(value) {
  const source = value?.company && typeof value.company === "object" ? value.company : value;
  if (!source || typeof source !== "object") {
    const error = new Error("El Repository no devolvió información válida de la empresa");
    error.code = "HTTPS_COMPANY_RESPONSE_INVALID";
    throw error;
  }

  const rawPhones = Array.isArray(source.phones)
    ? source.phones
    : String(source.phone ?? source.telefonos ?? "").split(/[;,\n]/);
  const phones = [...new Set(rawPhones.map((phone) => String(phone || "").trim()).filter(Boolean))];

  return {
    nombreEmpresa: String(source.name ?? source.nombreEmpresa ?? "").trim(),
    nit: String(source.nit ?? "").trim(),
    direccion: String(source.address ?? source.direccion ?? "").trim(),
    ciudad: String(source.city ?? source.ciudad ?? "").trim(),
    telefonos: phones,
    correo: String(source.email ?? source.correo ?? "").trim(),
    logo: String(source.logoUrl ?? source.logo ?? "").trim(),
    configuracionImpresion: value?.printConfiguration && typeof value.printConfiguration === "object"
      ? value.printConfiguration
      : null,
  };
}

function publicSessionStatus(session, hostname) {
  return {
    usuario: session.username,
    nombre: session.displayName,
    rol: session.role,
    hostname,
    serverId: session.serverId,
    version: session.version,
    estado: "active",
    fecha: session.createdAt,
    expiracion: session.expiresAt,
  };
}

function protectedResponseHeaders(serverId, version) {
  return {
    "X-JoyaControl-Server-Id": serverId,
    "X-JoyaControl-Version": version,
  };
}

function normalizeContactPayload(value) {
  const source = value?.contact && typeof value.contact === "object" ? value.contact : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("El Repository no devolvió un contacto válido");
    error.code = "HTTPS_CONTACT_RESPONSE_INVALID";
    throw error;
  }

  const id = String(source.id ?? "").trim();
  const type = String(source.type ?? "").trim().toLowerCase();
  const name = String(source.name ?? "").trim();
  if (!id || !name || !["client", "supplier"].includes(type)) {
    const error = new Error("El Repository devolvió un contacto incompleto");
    error.code = "HTTPS_CONTACT_RESPONSE_INVALID";
    throw error;
  }

  return {
    id,
    type,
    name,
    document: String(source.document ?? "").trim(),
    phone: String(source.phone ?? "").trim(),
    email: String(source.email ?? "").trim(),
    address: String(source.address ?? "").trim(),
    notes: String(source.notes ?? "").trim(),
    status: "active",
  };
}

function normalizeContactsPayload(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.contacts)
      ? value.contacts
      : null;
  if (!source) {
    const error = new Error("El Repository no devolvió una colección de contactos válida");
    error.code = "HTTPS_CONTACTS_RESPONSE_INVALID";
    throw error;
  }
  return source.map(normalizeContactPayload);
}

function finiteNonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function productAvailabilityStatus(stock, minStock) {
  if (stock <= 0) return "out_of_stock";
  if (minStock > 0 && stock <= minStock) return "low_stock";
  return "available";
}

function normalizeProductPayload(value) {
  const source = value?.product && typeof value.product === "object" ? value.product : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("El Repository no devolvió un producto válido");
    error.code = "HTTPS_PRODUCT_RESPONSE_INVALID";
    throw error;
  }

  const id = String(source.id ?? "").trim();
  const code = String(source.code ?? "").trim();
  const name = String(source.name ?? "").trim();
  const category = String(source.category ?? "").trim();
  if (!id || !code || !name) {
    const error = new Error("El Repository devolvió un producto incompleto");
    error.code = "HTTPS_PRODUCT_RESPONSE_INVALID";
    throw error;
  }

  const stock = finiteNonNegativeNumber(source.stock);
  const minStock = finiteNonNegativeNumber(source.minStock);
  const weightGrams = finiteNonNegativeNumber(source.weightGrams);
  const availableGrams = source.availableGrams === undefined
    ? finiteNonNegativeNumber(weightGrams * stock)
    : finiteNonNegativeNumber(source.availableGrams);

  return {
    id,
    code,
    name,
    category,
    reference: String(source.reference ?? code).trim(),
    description: String(source.description ?? "").trim(),
    weightGrams,
    availableGrams,
    salePrice: finiteNonNegativeNumber(source.salePrice),
    stock,
    minStock,
    status: productAvailabilityStatus(stock, minStock),
  };
}

function normalizeProductsPayload(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.products)
      ? value.products
      : null;
  if (!source) {
    const error = new Error("El Repository no devolvió una colección de productos válida");
    error.code = "HTTPS_PRODUCTS_RESPONSE_INVALID";
    throw error;
  }
  return source.map(normalizeProductPayload);
}

function normalizeInventoryMovement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const date = String(value.date ?? value.createdAt ?? "").trim();
  const type = String(value.type ?? "").trim().toLowerCase();
  if (!date || !["increase", "decrease"].includes(type)) return null;
  return { date, type };
}

function normalizeInventoryItemPayload(value) {
  const source = value?.inventoryItem && typeof value.inventoryItem === "object"
    ? value.inventoryItem
    : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("El Repository no devolvió una referencia de inventario válida");
    error.code = "HTTPS_INVENTORY_RESPONSE_INVALID";
    throw error;
  }

  const product = normalizeProductPayload(source.product ?? source);
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    category: product.category,
    stock: product.stock,
    availableGrams: product.availableGrams,
    weightGrams: product.weightGrams,
    minStock: product.minStock,
    location: String(source.location ?? "").trim(),
    lastMovement: normalizeInventoryMovement(source.lastMovement),
    status: product.status,
  };
}

function normalizeInventoryPayload(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.inventory)
      ? value.inventory
      : null;
  if (!source) {
    const error = new Error("El Repository no devolvió una colección de inventario válida");
    error.code = "HTTPS_INVENTORY_RESPONSE_INVALID";
    throw error;
  }
  return source.map(normalizeInventoryItemPayload);
}

function createRequestHandler({
  version,
  serverId,
  serverName,
  hostname,
  getStartedAt,
  authenticateUser,
  readServerData,
  sessionDurationMs,
  now,
}) {
  const handleRequest = async (request, response) => {
    let requestUrl;
    let pathname;
    try {
      requestUrl = new URL(request.url || "/", "https://joyacontrol.local");
      pathname = requestUrl.pathname;
    } catch {
      sendJson(response, 404, { error: "NOT_FOUND" });
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      const startedAt = getStartedAt();
      const uptime = startedAt ? Math.max(0, Math.floor((now() - startedAt) / 1000)) : 0;
      sendJson(response, 200, {
        server: "active",
        active: true,
        date: new Date(now()).toISOString(),
        uptime,
        protocol: HTTPS_PROTOCOL,
        version,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/version") {
      sendJson(response, 200, {
        app: APP_NAME,
        version,
        serverId,
        protocol: HTTPS_PROTOCOL,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/server-info") {
      const startedAt = getStartedAt();
      const uptime = startedAt ? Math.max(0, Math.floor((now() - startedAt) / 1000)) : 0;
      sendJson(response, 200, {
        serverId,
        serverName,
        version,
        hostname,
        online: true,
        uptime,
      });
      return;
    }

    if (request.method === "POST" && pathname === "/login") {
      let payload;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        const tooLarge = error?.code === "HTTPS_REQUEST_TOO_LARGE";
        sendError(
          response,
          tooLarge ? 413 : 400,
          error?.code || "HTTPS_REQUEST_INVALID",
          error?.message || "Solicitud inválida",
        );
        return;
      }

      const { username, password, clientVersion } = credentialsFromPayload(payload);
      if (!username || !password || !clientVersion) {
        sendError(response, 400, "HTTPS_LOGIN_FIELDS_REQUIRED", "Usuario, contraseña y versión cliente son obligatorios");
        return;
      }
      if (!isCompatibleClientVersion(clientVersion, version)) {
        sendError(response, 426, "HTTPS_VERSION_INCOMPATIBLE", "La versión del cliente no es compatible con el servidor");
        return;
      }

      let authenticated;
      try {
        authenticated = await authenticateUser(username, password);
        if (!authenticated?.success) throw new Error(authenticated?.error || "HTTPS_AUTH_FAILED");
      } catch (error) {
        const failure = authenticationFailure(error);
        sendError(response, failure.statusCode, failure.code, failure.message);
        return;
      }

      let permissions;
      try {
        permissions = await resolveSessionPermissions(readServerData, authenticated);
      } catch (error) {
        console.error("[HTTPS] No fue posible resolver los permisos del usuario:", error);
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar los permisos del usuario");
        return;
      }

      const createdAtMs = now();
      const session = {
        sessionId: crypto.randomBytes(32).toString("base64url"),
        serverId,
        userId: String(authenticated.userId || ""),
        username: String(authenticated.username || username),
        displayName: String(authenticated.displayName || authenticated.username || username),
        role: String(authenticated.role || ""),
        permissions,
        userActive: authenticated.active !== false,
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(createdAtMs + sessionDurationMs).toISOString(),
        version,
      };
      if (!session.userId || !session.username || !session.role) {
        sendError(response, 503, "HTTPS_AUTH_RESPONSE_INVALID", "El sistema actual de usuarios devolvió una respuesta incompleta");
        return;
      }

      activeSessions.set(session.sessionId, session);
      sendJson(response, 200, publicLoginSession(session));
      return;
    }

    if (request.method === "GET" && pathname === "/session") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      sendJson(response, 200, publicSessionStatus(resolved.session, hostname));
      return;
    }

    if (request.method === "GET" && pathname === "/me") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      sendJson(response, 200, publicMe(resolved.session));
      return;
    }

    if (request.method === "GET" && pathname === "/permissions") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      sendJson(response, 200, publicPermissions(resolved.session));
      return;
    }

    const isCompanyRoute = request.method === "GET" && (pathname === "/company" || pathname === "/company/");
    if (isCompanyRoute) {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const company = await readServerData("company", {
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeCompanyPayload(company));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar la empresa:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar la empresa");
      }
      return;
    }

    if (request.method === "GET" && pathname === "/contacts") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const contacts = await readServerData("contacts", {
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeContactsPayload(contacts), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar los contactos:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar los contactos");
      }
      return;
    }

    if (request.method === "GET" && pathname === "/contacts/search") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      const query = String(requestUrl.searchParams.get("q") ?? "").trim();
      if (!query || query.length > 200) {
        sendError(response, 400, "HTTPS_CONTACT_SEARCH_INVALID", "La búsqueda debe contener entre 1 y 200 caracteres");
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const contacts = await readServerData("contactsSearch", {
          query,
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeContactsPayload(contacts), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible buscar contactos:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible buscar contactos");
      }
      return;
    }

    const contactMatch = request.method === "GET" ? pathname.match(/^\/contacts\/([^/]+)$/) : null;
    if (contactMatch) {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      let contactId;
      try {
        contactId = decodeURIComponent(contactMatch[1]).trim();
      } catch {
        sendError(response, 400, "HTTPS_CONTACT_ID_INVALID", "El identificador del contacto no es válido");
        return;
      }
      if (!contactId || contactId.length > 200) {
        sendError(response, 400, "HTTPS_CONTACT_ID_INVALID", "El identificador del contacto no es válido");
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const contact = await readServerData("contact", {
          id: contactId,
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        if (!contact) {
          sendError(response, 404, "HTTPS_CONTACT_NOT_FOUND", "El contacto solicitado no existe");
          return;
        }
        sendJson(response, 200, normalizeContactPayload(contact), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar el contacto:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar el contacto");
      }
      return;
    }

    if (request.method === "GET" && pathname === "/products") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const products = await readServerData("products", {
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeProductsPayload(products), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar los productos:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar los productos");
      }
      return;
    }

    if (request.method === "GET" && pathname === "/products/search") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      const query = String(requestUrl.searchParams.get("q") ?? "").trim();
      if (!query || query.length > 200) {
        sendError(response, 400, "HTTPS_PRODUCT_SEARCH_INVALID", "La búsqueda debe contener entre 1 y 200 caracteres");
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const products = await readServerData("productsSearch", {
          query,
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeProductsPayload(products), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible buscar productos:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible buscar productos");
      }
      return;
    }

    const productMatch = request.method === "GET" ? pathname.match(/^\/products\/([^/]+)$/) : null;
    if (productMatch) {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      let productId;
      try {
        productId = decodeURIComponent(productMatch[1]).trim();
      } catch {
        sendError(response, 400, "HTTPS_PRODUCT_ID_INVALID", "El identificador del producto no es válido");
        return;
      }
      if (!productId || productId.length > 200) {
        sendError(response, 400, "HTTPS_PRODUCT_ID_INVALID", "El identificador del producto no es válido");
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const product = await readServerData("product", {
          id: productId,
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        if (!product) {
          sendError(response, 404, "HTTPS_PRODUCT_NOT_FOUND", "El producto solicitado no existe");
          return;
        }
        sendJson(response, 200, normalizeProductPayload(product), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar el producto:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar el producto");
      }
      return;
    }

    if (request.method === "GET" && pathname === "/inventory") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const inventory = await readServerData("inventory", {
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        sendJson(response, 200, normalizeInventoryPayload(inventory), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar el inventario:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar el inventario");
      }
      return;
    }

    const inventoryMatch = request.method === "GET" ? pathname.match(/^\/inventory\/([^/]+)$/) : null;
    if (inventoryMatch) {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      let inventoryId;
      try {
        inventoryId = decodeURIComponent(inventoryMatch[1]).trim();
      } catch {
        sendError(response, 400, "HTTPS_INVENTORY_ID_INVALID", "El identificador de inventario no es válido");
        return;
      }
      if (!inventoryId || inventoryId.length > 200) {
        sendError(response, 400, "HTTPS_INVENTORY_ID_INVALID", "El identificador de inventario no es válido");
        return;
      }
      if (typeof readServerData !== "function") {
        sendError(response, 503, "HTTPS_READ_PROVIDER_UNAVAILABLE", "La lectura protegida del Servidor Principal no está disponible");
        return;
      }
      try {
        const inventoryItem = await readServerData("inventoryItem", {
          id: inventoryId,
          userId: resolved.session.userId,
          username: resolved.session.username,
          role: resolved.session.role,
          permissions: [...resolved.session.permissions],
        });
        if (!inventoryItem) {
          sendError(response, 404, "HTTPS_INVENTORY_NOT_FOUND", "La referencia de inventario solicitada no existe");
          return;
        }
        sendJson(response, 200, normalizeInventoryItemPayload(inventoryItem), protectedResponseHeaders(serverId, version));
      } catch (error) {
        console.error("[HTTPS] No fue posible consultar la referencia de inventario:", error);
        sendError(response, 503, error?.code || "HTTPS_READ_PROVIDER_UNAVAILABLE", "No fue posible consultar la referencia de inventario");
      }
      return;
    }

    if (request.method === "POST" && pathname === "/logout") {
      const resolved = getActiveSession(request, now, version);
      if (resolved.error) {
        sendError(response, resolved.error.statusCode, resolved.error.code, resolved.error.message);
        return;
      }
      activeSessions.delete(resolved.sessionId);
      sendJson(response, 200, { success: true, estado: "closed" });
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND" });
  };

  return (request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error("[HTTPS] Error procesando solicitud:", error);
      sendError(response, 500, "HTTPS_INTERNAL_ERROR", "No fue posible procesar la solicitud HTTPS");
    });
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

async function startHttpsServerInternal({
  userDataPath,
  executeRepositoryCall,
  authenticateUser,
  readServerData,
  version = "3.0.0",
  serverName = "Servidor JoyaControl",
  hostname = os.hostname(),
  sessionDurationMs = DEFAULT_SESSION_DURATION_MS,
  now = Date.now,
  env = process.env,
} = {}) {
  const configuration = readHttpsConfiguration(env);
  if (!configuration.enabled) {
    activeSessions.clear();
    serverState = {
      ...createInitialState(),
      enabled: false,
      version,
    };
    return getHttpsServerState();
  }

  if (typeof executeRepositoryCall !== "function") {
    throw createConfigurationError("executeRepositoryCall debe inyectarse en el servidor HTTPS");
  }
  if (typeof authenticateUser !== "function") {
    throw createConfigurationError("authenticateUser debe inyectarse en el servidor HTTPS");
  }
  if (typeof now !== "function") {
    throw createConfigurationError("now debe ser una función válida");
  }

  const serverId = await loadOrCreateServerId(userDataPath);
  const [certificate, privateKey] = await Promise.all([
    readTlsFile(configuration.certPath, "certificate"),
    readTlsFile(configuration.keyPath, "privateKey"),
  ]);

  let startedAt = null;
  let server;
  try {
    const normalizedSessionDuration = normalizeSessionDuration(sessionDurationMs);
    activeSessions.clear();
    try {
      server = https.createServer({
        cert: certificate,
        key: privateKey,
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.3",
        honorCipherOrder: true,
        maxHeaderSize: MAX_HEADER_SIZE_BYTES,
      }, createRequestHandler({
        version,
        serverId,
        serverName: String(serverName || "Servidor JoyaControl").trim() || "Servidor JoyaControl",
        hostname: String(hostname || os.hostname()).trim() || os.hostname(),
        getStartedAt: () => startedAt,
        authenticateUser,
        readServerData,
        sessionDurationMs: normalizedSessionDuration,
        now,
      }));
    } catch (error) {
      throw createHttpsStartupError(
        "HTTPS_TLS_MATERIAL_INVALID",
        error?.message || "No fue posible crear el contexto TLS",
        error,
      );
    }

    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.on("tlsClientError", () => undefined);

    await listen(server, configuration.host, configuration.port);
    startedAt = now();
    activeServer = server;
    server.on("error", (error) => {
      serverState = {
        ...serverState,
        lastError: error?.message || String(error),
      };
      console.error("[HTTPS] Error del servidor:", error);
    });

    const address = server.address();
    serverState = {
      enabled: true,
      running: true,
      host: configuration.host,
      port: typeof address === "object" && address ? address.port : configuration.port,
      protocol: HTTPS_PROTOCOL,
      version,
      serverId,
      startedAt: new Date(startedAt).toISOString(),
      stoppedAt: null,
      lastError: null,
    };
    console.log(`HTTPS iniciado en puerto ${serverState.port}`);
    return getHttpsServerState();
  } catch (error) {
    activeSessions.clear();
    if (server?.listening) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    activeServer = null;
    const detailedMessage = startupErrorMessage(error, configuration);
    serverState = {
      enabled: true,
      running: false,
      host: configuration.host,
      port: configuration.port,
      protocol: HTTPS_PROTOCOL,
      version,
      serverId,
      startedAt: null,
      stoppedAt: null,
      lastError: detailedMessage,
    };
    if (error && typeof error === "object") {
      error.httpsStartupMessage = detailedMessage;
    }
    throw error;
  }
}

export function getHttpsServerState() {
  return { ...serverState };
}

export function startHttpsServer(options = {}) {
  if (activeServer?.listening) return Promise.resolve(getHttpsServerState());
  if (startPromise) return startPromise;

  startPromise = startHttpsServerInternal(options)
    .catch((error) => {
      const detailedMessage = error?.httpsStartupMessage || startupErrorMessage(error);
      console.error("Error iniciando HTTPS:", detailedMessage);
      if (error && typeof error === "object") error.httpsStartupLogged = true;
      throw error;
    })
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

export async function stopHttpsServer() {
  if (startPromise) await startPromise.catch(() => undefined);
  const server = activeServer;
  activeSessions.clear();
  if (!server) {
    serverState = {
      ...serverState,
      running: false,
    };
    return getHttpsServerState();
  }

  activeServer = null;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });

  serverState = {
    ...serverState,
    running: false,
    stoppedAt: new Date().toISOString(),
  };
  return getHttpsServerState();
}
