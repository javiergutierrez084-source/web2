import https from "node:https";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_HTTPS_MAJOR_VERSION = 3;
const READ_ONLY_RESOURCE_PATHS = Object.freeze({
  me: () => "/me",
  company: () => "/company",
  permissions: () => "/permissions",
  contacts: () => "/contacts",
  contact: (args = {}) => {
    const id = String(args.id ?? "").trim();
    if (!id) throw connectionError("HTTPS_CONTACT_ID_INVALID", "El identificador del contacto es obligatorio");
    return `/contacts/${encodeURIComponent(id)}`;
  },
  contactsSearch: (args = {}) => {
    const query = String(args.query ?? args.q ?? "").trim();
    if (!query) throw connectionError("HTTPS_CONTACT_SEARCH_INVALID", "El texto de búsqueda es obligatorio");
    return `/contacts/search?q=${encodeURIComponent(query)}`;
  },
  products: () => "/products",
  product: (args = {}) => {
    const id = String(args.id ?? "").trim();
    if (!id) throw connectionError("HTTPS_PRODUCT_ID_INVALID", "El identificador del producto es obligatorio");
    return `/products/${encodeURIComponent(id)}`;
  },
  productsSearch: (args = {}) => {
    const query = String(args.query ?? args.q ?? "").trim();
    if (!query) throw connectionError("HTTPS_PRODUCT_SEARCH_INVALID", "El texto de búsqueda es obligatorio");
    return `/products/search?q=${encodeURIComponent(query)}`;
  },
  inventory: () => "/inventory",
  inventoryItem: (args = {}) => {
    const id = String(args.id ?? "").trim();
    if (!id) throw connectionError("HTTPS_INVENTORY_ID_INVALID", "El identificador de inventario es obligatorio");
    return `/inventory/${encodeURIComponent(id)}`;
  },
});

const CERTIFICATE_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const TLS_ERROR_CODES = new Set([
  "EPROTO",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_UNKNOWN_PROTOCOL",
  "ERR_SSL_WRONG_VERSION_NUMBER",
]);

const SERVER_NOT_FOUND_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);

export class HttpsServerConnectionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "HttpsServerConnectionError";
    this.code = code;
  }
}

function connectionError(code, message, cause) {
  return new HttpsServerConnectionError(code, message, cause);
}

function parsePort(portValue) {
  if (portValue === undefined || portValue === null || String(portValue).trim() === "") return null;
  const numericPort = Number(portValue);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw connectionError("HTTPS_URL_INVALID", "El puerto HTTPS debe estar entre 1 y 65535");
  }
  return numericPort;
}

export function normalizeHttpsServerEndpoint(urlValue, portValue) {
  const candidate = String(urlValue ?? "").trim();
  if (!candidate) throw connectionError("HTTPS_URL_INVALID", "La URL del servidor HTTPS es obligatoria");

  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch (error) {
    throw connectionError("HTTPS_URL_INVALID", "La URL del servidor HTTPS no es válida", error);
  }

  if (parsed.protocol !== "https:") {
    throw connectionError("HTTPS_TLS_INVALID", "El servidor debe utilizar el protocolo HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw connectionError("HTTPS_URL_INVALID", "La URL no debe contener credenciales");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw connectionError("HTTPS_URL_INVALID", "Ingrese únicamente el dominio o la IP pública del servidor");
  }

  const explicitPort = parsePort(portValue);
  const port = explicitPort ?? (parsed.port ? Number(parsed.port) : 443);
  parsed.port = port === 443 ? "" : String(port);
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";

  return {
    url: `https://${parsed.hostname}`,
    port,
    baseUrl: parsed.origin,
  };
}

function parseJsonResponse(text, pathname) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw connectionError("HTTPS_RESPONSE_INVALID", `La respuesta de ${pathname} no contiene JSON válido`, error);
  }
}

function requestHttpsJson(baseUrl, pathname, {
  method = "GET",
  body,
  sessionId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ca,
} = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, `${baseUrl}/`);
    const serializedBody = body === undefined ? null : JSON.stringify(body);
    const headers = {
      Accept: "application/json",
      "User-Agent": "JoyaControl-HTTPS-Client/3.0",
    };
    if (serializedBody !== null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(serializedBody);
    }
    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method,
      agent: false,
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
      headers,
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          request.destroy(connectionError("HTTPS_RESPONSE_INVALID", "La respuesta del servidor HTTPS excede el límite permitido"));
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: Number(response.statusCode || 0),
            body: parseJsonResponse(text, pathname),
            headers: response.headers,
            tlsProtocol: response.socket.getProtocol?.() || null,
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), () => {
      request.destroy(connectionError("HTTPS_TIMEOUT", "El servidor HTTPS no respondió dentro del tiempo permitido"));
    });
    request.on("error", reject);
    if (serializedBody !== null) request.write(serializedBody);
    request.end();
  });
}

function versionMajor(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}

function validateHealth(payload) {
  if (
    !payload
    || payload.active !== true
    || payload.server !== "active"
    || payload.protocol !== "HTTPS"
    || typeof payload.version !== "string"
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La respuesta de salud no corresponde a un servidor JoyaControl HTTPS");
  }
}

function validateServerInfo(payload, healthVersion) {
  if (
    !payload
    || payload.online !== true
    || typeof payload.serverId !== "string"
    || !payload.serverId.trim()
    || typeof payload.serverName !== "string"
    || !payload.serverName.trim()
    || typeof payload.version !== "string"
    || typeof payload.hostname !== "string"
    || !payload.hostname.trim()
    || typeof payload.uptime !== "number"
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información del servidor HTTPS está incompleta");
  }

  const healthMajor = versionMajor(healthVersion);
  const infoMajor = versionMajor(payload.version);
  if (
    healthMajor !== SUPPORTED_HTTPS_MAJOR_VERSION
    || infoMajor !== SUPPORTED_HTTPS_MAJOR_VERSION
    || String(healthVersion) !== String(payload.version)
  ) {
    throw connectionError("HTTPS_VERSION_INCOMPATIBLE", "La versión del servidor HTTPS no es compatible con JoyaControl v3");
  }
}

function ensureSuccessfulResponse(response, pathname) {
  if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
  const code = String(response.body?.error || "HTTPS_REQUEST_FAILED");
  const message = String(
    response.body?.message
    || `El servidor respondió ${response.statusCode || "sin estado"} en ${pathname}`,
  );
  throw connectionError(code, message);
}

function validateExpectedServer(serverId, expectedServerId) {
  if (expectedServerId && String(serverId) !== String(expectedServerId)) {
    throw connectionError("HTTPS_SERVER_MISMATCH", "El servidor respondió con una identidad diferente a la seleccionada");
  }
}

function validateExpectedVersion(version, expectedVersion) {
  if (versionMajor(version) !== SUPPORTED_HTTPS_MAJOR_VERSION) {
    throw connectionError("HTTPS_VERSION_INCOMPATIBLE", "La versión del servidor HTTPS no es compatible con JoyaControl v3");
  }
  if (expectedVersion && String(version) !== String(expectedVersion)) {
    throw connectionError("HTTPS_VERSION_INCOMPATIBLE", "La versión del servidor cambió desde que fue guardado");
  }
}

function validateLoginSession(payload, options) {
  if (
    !payload
    || typeof payload.sessionId !== "string"
    || !payload.sessionId.trim()
    || typeof payload.serverId !== "string"
    || typeof payload.usuario !== "string"
    || typeof payload.nombre !== "string"
    || typeof payload.rol !== "string"
    || typeof payload.fecha !== "string"
    || typeof payload.expiracion !== "string"
    || typeof payload.version !== "string"
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La sesión HTTPS devuelta por el servidor está incompleta");
  }
  validateExpectedServer(payload.serverId, options.expectedServerId);
  validateExpectedVersion(payload.version, options.expectedVersion);
  return payload;
}

function validateSessionStatus(payload, options) {
  if (
    !payload
    || payload.estado !== "active"
    || typeof payload.serverId !== "string"
    || typeof payload.usuario !== "string"
    || typeof payload.nombre !== "string"
    || typeof payload.rol !== "string"
    || typeof payload.hostname !== "string"
    || typeof payload.version !== "string"
    || typeof payload.fecha !== "string"
    || typeof payload.expiracion !== "string"
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "El estado de la sesión HTTPS está incompleto");
  }
  validateExpectedServer(payload.serverId, options.expectedServerId);
  validateExpectedVersion(payload.version, options.expectedVersion);
  return payload;
}

function validateMe(payload) {
  if (
    !payload
    || typeof payload.id !== "string"
    || !payload.id.trim()
    || typeof payload.usuario !== "string"
    || !payload.usuario.trim()
    || typeof payload.nombre !== "string"
    || !payload.nombre.trim()
    || typeof payload.rol !== "string"
    || !payload.rol.trim()
    || !Array.isArray(payload.permisos)
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información del usuario HTTPS está incompleta");
  }
  return {
    ...payload,
    permisos: payload.permisos.map((permission) => String(permission)).filter(Boolean),
  };
}

function validateCompany(payload) {
  if (
    !payload
    || typeof payload.nombreEmpresa !== "string"
    || typeof payload.nit !== "string"
    || typeof payload.direccion !== "string"
    || typeof payload.ciudad !== "string"
    || !Array.isArray(payload.telefonos)
    || typeof payload.correo !== "string"
    || typeof payload.logo !== "string"
    || !(payload.configuracionImpresion === null || typeof payload.configuracionImpresion === "object")
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información de la empresa HTTPS está incompleta");
  }
  return {
    ...payload,
    telefonos: payload.telefonos.map((phone) => String(phone)).filter(Boolean),
  };
}

function validatePermissions(payload) {
  if (!payload || !Array.isArray(payload.permisos)) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La lista de permisos HTTPS está incompleta");
  }
  return { permisos: payload.permisos.map((permission) => String(permission)).filter(Boolean) };
}

function validateContact(payload) {
  if (
    !payload
    || typeof payload.id !== "string"
    || !payload.id.trim()
    || !["client", "supplier"].includes(String(payload.type))
    || typeof payload.name !== "string"
    || !payload.name.trim()
    || typeof payload.document !== "string"
    || typeof payload.phone !== "string"
    || typeof payload.email !== "string"
    || typeof payload.address !== "string"
    || typeof payload.notes !== "string"
    || payload.status !== "active"
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información del contacto HTTPS está incompleta");
  }

  return {
    id: payload.id.trim(),
    type: payload.type,
    name: payload.name.trim(),
    document: payload.document,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    notes: payload.notes,
    status: "active",
  };
}

function validateContacts(payload) {
  if (!Array.isArray(payload)) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La colección de contactos HTTPS está incompleta");
  }
  return payload.map(validateContact);
}

function validateProduct(payload) {
  const numericFields = [
    "weightGrams", "availableGrams", "salePrice", "stock", "minStock",
  ];
  if (
    !payload
    || typeof payload.id !== "string"
    || !payload.id.trim()
    || typeof payload.code !== "string"
    || !payload.code.trim()
    || typeof payload.name !== "string"
    || !payload.name.trim()
    || typeof payload.category !== "string"
    || typeof payload.reference !== "string"
    || typeof payload.description !== "string"
    || !numericFields.every((field) => typeof payload[field] === "number" && Number.isFinite(payload[field]) && payload[field] >= 0)
    || !["available", "low_stock", "out_of_stock"].includes(String(payload.status))
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información del producto HTTPS está incompleta");
  }

  return {
    id: payload.id.trim(),
    code: payload.code.trim(),
    name: payload.name.trim(),
    category: payload.category.trim(),
    reference: payload.reference.trim(),
    description: payload.description.trim(),
    weightGrams: payload.weightGrams,
    availableGrams: payload.availableGrams,
    salePrice: payload.salePrice,
    stock: payload.stock,
    minStock: payload.minStock,
    status: payload.status,
  };
}

function validateProducts(payload) {
  if (!Array.isArray(payload)) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La colección de productos HTTPS está incompleta");
  }
  return payload.map(validateProduct);
}

function validateInventoryItem(payload) {
  if (
    !payload
    || typeof payload.id !== "string"
    || !payload.id.trim()
    || typeof payload.code !== "string"
    || !payload.code.trim()
    || typeof payload.name !== "string"
    || !payload.name.trim()
    || typeof payload.category !== "string"
    || typeof payload.location !== "string"
    || !["available", "low_stock", "out_of_stock"].includes(String(payload.status))
    || !["stock", "availableGrams", "weightGrams", "minStock"].every(
      (field) => typeof payload[field] === "number" && Number.isFinite(payload[field]) && payload[field] >= 0,
    )
    || !(
      payload.lastMovement === null
      || (
        typeof payload.lastMovement === "object"
        && typeof payload.lastMovement.date === "string"
        && payload.lastMovement.date.trim()
        && ["increase", "decrease"].includes(String(payload.lastMovement.type))
      )
    )
  ) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La información de inventario HTTPS está incompleta");
  }

  return {
    id: payload.id.trim(),
    code: payload.code.trim(),
    name: payload.name.trim(),
    category: payload.category.trim(),
    stock: payload.stock,
    availableGrams: payload.availableGrams,
    weightGrams: payload.weightGrams,
    minStock: payload.minStock,
    location: payload.location.trim(),
    lastMovement: payload.lastMovement === null
      ? null
      : { date: payload.lastMovement.date.trim(), type: payload.lastMovement.type },
    status: payload.status,
  };
}

function validateInventory(payload) {
  if (!Array.isArray(payload)) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La colección de inventario HTTPS está incompleta");
  }
  return payload.map(validateInventoryItem);
}

function resolveReadOnlyResourcePath(resource, args) {
  const resolver = READ_ONLY_RESOURCE_PATHS[resource];
  if (!resolver) {
    throw connectionError("HTTPS_READ_RESOURCE_NOT_ALLOWED", "El recurso HTTPS solicitado no está permitido");
  }
  return resolver(args);
}

function validateProtectedResponseIdentity(response, options) {
  const headers = response?.headers || {};
  const serverId = String(headers["x-joyacontrol-server-id"] || "").trim();
  const version = String(headers["x-joyacontrol-version"] || "").trim();
  if (!serverId || !version) {
    throw connectionError("HTTPS_RESPONSE_INVALID", "La respuesta protegida no contiene la identidad del servidor");
  }
  validateExpectedServer(serverId, options.expectedServerId);
  validateExpectedVersion(version, options.expectedVersion);
}

function validateReadOnlyResource(resource, payload) {
  if (resource === "me") return validateMe(payload);
  if (resource === "company") return validateCompany(payload);
  if (resource === "permissions") return validatePermissions(payload);
  if (resource === "contacts" || resource === "contactsSearch") return validateContacts(payload);
  if (resource === "contact") return validateContact(payload);
  if (resource === "products" || resource === "productsSearch") return validateProducts(payload);
  if (resource === "product") return validateProduct(payload);
  if (resource === "inventory") return validateInventory(payload);
  if (resource === "inventoryItem") return validateInventoryItem(payload);
  throw connectionError("HTTPS_READ_RESOURCE_NOT_ALLOWED", "El recurso HTTPS solicitado no está permitido");
}

export function classifyHttpsConnectionError(error) {
  if (error instanceof HttpsServerConnectionError) return error;
  const code = String(error?.code || "").trim();
  if (CERTIFICATE_ERROR_CODES.has(code)) {
    return connectionError("HTTPS_CERTIFICATE_INVALID", "El certificado HTTPS no es válido o no es confiable", error);
  }
  if (TLS_ERROR_CODES.has(code)) {
    return connectionError("HTTPS_TLS_INVALID", "El destino no está aceptando una conexión TLS válida", error);
  }
  if (SERVER_NOT_FOUND_ERROR_CODES.has(code)) {
    return connectionError("HTTPS_SERVER_NOT_FOUND", "No fue posible localizar el servidor HTTPS", error);
  }
  if (/timeout/i.test(String(error?.message || ""))) {
    return connectionError("HTTPS_TIMEOUT", "El servidor HTTPS no respondió dentro del tiempo permitido", error);
  }
  return connectionError("HTTPS_SERVER_NOT_FOUND", "No fue posible conectar con el servidor HTTPS", error);
}

export async function testHttpsServerConnection(options = {}, dependencies = {}) {
  let endpoint;
  try {
    endpoint = normalizeHttpsServerEndpoint(options.url, options.port);
    const requester = dependencies.requestJson || requestHttpsJson;
    const startedAt = Date.now();
    const healthResponse = await requester(endpoint.baseUrl, "/health", {
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const health = ensureSuccessfulResponse(healthResponse, "/health");
    validateHealth(health);

    const serverInfoResponse = await requester(endpoint.baseUrl, "/server-info", {
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const serverInfo = ensureSuccessfulResponse(serverInfoResponse, "/server-info");
    validateServerInfo(serverInfo, health.version);

    return {
      ok: true,
      endpoint,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tlsProtocol: serverInfoResponse.tlsProtocol || healthResponse.tlsProtocol || null,
      health,
      serverInfo,
    };
  } catch (error) {
    throw classifyHttpsConnectionError(error);
  }
}

export async function loginHttpsServer(options = {}, dependencies = {}) {
  try {
    const endpoint = normalizeHttpsServerEndpoint(options.url, options.port);
    const requester = dependencies.requestJson || requestHttpsJson;
    const response = await requester(endpoint.baseUrl, "/login", {
      method: "POST",
      body: {
        usuario: String(options.username ?? ""),
        contrasena: String(options.password ?? ""),
        versionCliente: String(options.clientVersion ?? ""),
      },
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const session = validateLoginSession(ensureSuccessfulResponse(response, "/login"), options);
    return { ok: true, endpoint, session };
  } catch (error) {
    throw classifyHttpsConnectionError(error);
  }
}

export async function getHttpsServerSession(options = {}, dependencies = {}) {
  try {
    const endpoint = normalizeHttpsServerEndpoint(options.url, options.port);
    const requester = dependencies.requestJson || requestHttpsJson;
    const response = await requester(endpoint.baseUrl, "/session", {
      method: "GET",
      sessionId: String(options.sessionId ?? ""),
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const session = validateSessionStatus(ensureSuccessfulResponse(response, "/session"), options);
    return { ok: true, endpoint, session };
  } catch (error) {
    throw classifyHttpsConnectionError(error);
  }
}

export async function readHttpsServerResource(options = {}, dependencies = {}) {
  try {
    const resource = String(options.resource ?? "").trim();
    const pathname = resolveReadOnlyResourcePath(resource, options.args);

    const endpoint = normalizeHttpsServerEndpoint(options.url, options.port);
    const requester = dependencies.requestJson || requestHttpsJson;
    const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
    const startedAt = now();
    const response = await requester(endpoint.baseUrl, pathname, {
      method: "GET",
      sessionId: String(options.sessionId ?? ""),
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const payload = ensureSuccessfulResponse(response, pathname);
    if ([
      "contacts", "contact", "contactsSearch",
      "products", "product", "productsSearch",
      "inventory", "inventoryItem",
    ].includes(resource)) {
      validateProtectedResponseIdentity(response, options);
    }
    const data = validateReadOnlyResource(resource, payload);
    const completedAt = now();
    return {
      ok: true,
      endpoint,
      resource,
      data,
      latencyMs: Math.max(0, completedAt - startedAt),
      communicatedAt: new Date(completedAt).toISOString(),
      tlsProtocol: response.tlsProtocol || null,
    };
  } catch (error) {
    throw classifyHttpsConnectionError(error);
  }
}

export async function logoutHttpsServer(options = {}, dependencies = {}) {
  try {
    const endpoint = normalizeHttpsServerEndpoint(options.url, options.port);
    const requester = dependencies.requestJson || requestHttpsJson;
    const response = await requester(endpoint.baseUrl, "/logout", {
      method: "POST",
      sessionId: String(options.sessionId ?? ""),
      timeoutMs: options.timeoutMs,
      ca: dependencies.ca,
    });
    const payload = ensureSuccessfulResponse(response, "/logout");
    if (!payload || payload.success !== true || payload.estado !== "closed") {
      throw connectionError("HTTPS_RESPONSE_INVALID", "El servidor no confirmó el cierre de la sesión HTTPS");
    }
    return { ok: true, endpoint, sessionClosed: true };
  } catch (error) {
    throw classifyHttpsConnectionError(error);
  }
}
