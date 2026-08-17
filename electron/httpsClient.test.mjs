import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyHttpsConnectionError,
  getHttpsServerSession,
  loginHttpsServer,
  logoutHttpsServer,
  normalizeHttpsServerEndpoint,
  readHttpsServerResource,
  testHttpsServerConnection,
} from "./httpsClient.js";
import { startHttpsServer, stopHttpsServer } from "./httpsServer.js";

async function loadTlsFixture() {
  const source = await fs.readFile(new URL("./httpsServer.test.mjs", import.meta.url), "utf8");
  const certificate = source.match(/const TEST_CERTIFICATE = `([\s\S]*?)`;/)?.[1];
  const privateKey = source.match(/const TEST_PRIVATE_KEY = `([\s\S]*?)`;/)?.[1];
  if (!certificate || !privateKey) throw new Error("HTTPS_TEST_TLS_FIXTURE_NOT_FOUND");
  return { certificate, privateKey };
}

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const HEALTH = {
  server: "active",
  active: true,
  date: "2026-07-28T20:00:00.000Z",
  uptime: 18,
  protocol: "HTTPS",
  version: "3.0.0",
};

const SERVER_INFO = {
  serverId: "0a9185df-4c1c-4af0-9567-dde2c7bf807d",
  serverName: "Servidor Principal Online",
  version: "3.0.0",
  hostname: "joya-principal",
  online: true,
  uptime: 18,
};

const LOGIN_SESSION = {
  sessionId: "a".repeat(43),
  serverId: SERVER_INFO.serverId,
  usuario: "admin",
  nombre: "Administrador Principal",
  rol: "admin",
  fecha: "2026-07-28T20:00:00.000Z",
  expiracion: "2026-07-29T08:00:00.000Z",
  version: "3.0.0",
};

const SESSION_STATUS = {
  usuario: "admin",
  nombre: "Administrador Principal",
  rol: "admin",
  hostname: "joya-principal",
  serverId: SERVER_INFO.serverId,
  version: "3.0.0",
  estado: "active",
  fecha: LOGIN_SESSION.fecha,
  expiracion: LOGIN_SESSION.expiracion,
};

test("normaliza dominio, IP pública y puerto HTTPS sin aceptar HTTP", () => {
  assert.deepEqual(normalizeHttpsServerEndpoint("midominio.com", ""), {
    url: "https://midominio.com",
    port: 443,
    baseUrl: "https://midominio.com",
  });
  assert.deepEqual(normalizeHttpsServerEndpoint("https://203.0.113.10:9443", undefined), {
    url: "https://203.0.113.10",
    port: 9443,
    baseUrl: "https://203.0.113.10:9443",
  });
  assert.throws(
    () => normalizeHttpsServerEndpoint("http://midominio.com", 80),
    (error) => error?.code === "HTTPS_TLS_INVALID",
  );
});

test("prueba primero health y luego server-info", async () => {
  const calls = [];
  const result = await testHttpsServerConnection({
    url: "https://midominio.com",
    port: 443,
  }, {
    requestJson: async (baseUrl, pathname, options) => {
      calls.push({ baseUrl, pathname, method: options.method || "GET" });
      return {
        statusCode: 200,
        body: pathname === "/health" ? HEALTH : SERVER_INFO,
        tlsProtocol: "TLSv1.3",
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { baseUrl: "https://midominio.com", pathname: "/health", method: "GET" },
    { baseUrl: "https://midominio.com", pathname: "/server-info", method: "GET" },
  ]);
  assert.deepEqual(result.serverInfo, SERVER_INFO);
});

test("cliente realiza login, consulta sesión y logout con una sesión opaca", async () => {
  const calls = [];
  const requestJson = async (baseUrl, pathname, options) => {
    calls.push({ baseUrl, pathname, options });
    if (pathname === "/login") return { statusCode: 200, body: LOGIN_SESSION, tlsProtocol: "TLSv1.3" };
    if (pathname === "/session") return { statusCode: 200, body: SESSION_STATUS, tlsProtocol: "TLSv1.3" };
    return { statusCode: 200, body: { success: true, estado: "closed" }, tlsProtocol: "TLSv1.3" };
  };

  const login = await loginHttpsServer({
    url: "https://midominio.com",
    port: 443,
    username: "admin",
    password: "correcta",
    clientVersion: "3.0.0",
    expectedServerId: SERVER_INFO.serverId,
    expectedVersion: "3.0.0",
  }, { requestJson });
  assert.deepEqual(login.session, LOGIN_SESSION);

  const session = await getHttpsServerSession({
    url: "https://midominio.com",
    port: 443,
    sessionId: LOGIN_SESSION.sessionId,
    expectedServerId: SERVER_INFO.serverId,
    expectedVersion: "3.0.0",
  }, { requestJson });
  assert.deepEqual(session.session, SESSION_STATUS);

  const logout = await logoutHttpsServer({
    url: "https://midominio.com",
    port: 443,
    sessionId: LOGIN_SESSION.sessionId,
  }, { requestJson });
  assert.equal(logout.sessionClosed, true);

  assert.equal(calls[0].pathname, "/login");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, {
    usuario: "admin",
    contrasena: "correcta",
    versionCliente: "3.0.0",
  });
  assert.equal(calls[1].pathname, "/session");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.sessionId, LOGIN_SESSION.sessionId);
  assert.equal(calls[2].pathname, "/logout");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.sessionId, LOGIN_SESSION.sessionId);
});

test("propaga credenciales incorrectas, sesión expirada y servidor incorrecto", async () => {
  await assert.rejects(
    loginHttpsServer({ url: "https://midominio.com", username: "admin", password: "mala", clientVersion: "3.0.0" }, {
      requestJson: async () => ({
        statusCode: 401,
        body: { error: "HTTPS_PASSWORD_INCORRECT", message: "Contraseña incorrecta" },
      }),
    }),
    (error) => error?.code === "HTTPS_PASSWORD_INCORRECT",
  );

  await assert.rejects(
    getHttpsServerSession({ url: "https://midominio.com", sessionId: LOGIN_SESSION.sessionId }, {
      requestJson: async () => ({
        statusCode: 401,
        body: { error: "HTTPS_SESSION_EXPIRED", message: "La sesión HTTPS expiró" },
      }),
    }),
    (error) => error?.code === "HTTPS_SESSION_EXPIRED",
  );

  await assert.rejects(
    loginHttpsServer({
      url: "https://midominio.com",
      username: "admin",
      password: "correcta",
      clientVersion: "3.0.0",
      expectedServerId: "otro-servidor",
    }, {
      requestJson: async () => ({ statusCode: 200, body: LOGIN_SESSION }),
    }),
    (error) => error?.code === "HTTPS_SERVER_MISMATCH",
  );
});

test("rechaza versiones incompatibles antes de guardar o usar el servidor", async () => {
  await assert.rejects(
    testHttpsServerConnection({ url: "https://midominio.com" }, {
      requestJson: async (_baseUrl, pathname) => ({
        statusCode: 200,
        body: pathname === "/health"
          ? { ...HEALTH, version: "4.0.0" }
          : { ...SERVER_INFO, version: "4.0.0" },
        tlsProtocol: "TLSv1.3",
      }),
    }),
    (error) => error?.code === "HTTPS_VERSION_INCOMPATIBLE",
  );

  await assert.rejects(
    loginHttpsServer({
      url: "https://midominio.com",
      username: "admin",
      password: "correcta",
      clientVersion: "3.0.0",
      expectedVersion: "3.1.0",
    }, {
      requestJson: async () => ({ statusCode: 200, body: LOGIN_SESSION }),
    }),
    (error) => error?.code === "HTTPS_VERSION_INCOMPATIBLE",
  );
});

test("autentica contra un servidor HTTPS real y no llama al Repository", async () => {
  const { certificate, privateKey } = await loadTlsFixture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "joyacontrol-https-client-v3-"));
  const certPath = path.join(directory, "cert.pem");
  const keyPath = path.join(directory, "key.pem");
  const port = await availablePort();
  let repositoryCalls = 0;
  let authenticationCalls = 0;
  await Promise.all([
    fs.writeFile(certPath, certificate, "utf8"),
    fs.writeFile(keyPath, privateKey, "utf8"),
  ]);

  try {
    const state = await startHttpsServer({
      userDataPath: path.join(directory, "user-data"),
      executeRepositoryCall: async () => { repositoryCalls += 1; },
      authenticateUser: async () => {
        authenticationCalls += 1;
        return {
          success: true,
          userId: "user-admin-1",
          username: "admin",
          displayName: "Administrador Principal",
          role: "admin",
        };
      },
      version: "3.0.0",
      serverName: "Servidor HTTPS real",
      hostname: "principal-real",
      env: {
        JOYACONTROL_HTTPS_ENABLED: "true",
        JOYACONTROL_HTTPS_HOST: "127.0.0.1",
        JOYACONTROL_HTTPS_PORT: String(port),
        JOYACONTROL_HTTPS_CERT_PATH: certPath,
        JOYACONTROL_HTTPS_KEY_PATH: keyPath,
      },
    });

    await assert.rejects(
      loginHttpsServer({
        url: "https://127.0.0.1",
        port,
        username: "admin",
        password: "correcta",
        clientVersion: "3.0.0",
      }),
      (error) => error?.code === "HTTPS_CERTIFICATE_INVALID",
    );

    const login = await loginHttpsServer({
      url: "https://127.0.0.1",
      port,
      username: "admin",
      password: "correcta",
      clientVersion: "3.0.0",
      expectedServerId: state.serverId,
      expectedVersion: "3.0.0",
    }, { ca: certificate });
    assert.equal(login.session.usuario, "admin");

    const restored = await getHttpsServerSession({
      url: "https://127.0.0.1",
      port,
      sessionId: login.session.sessionId,
      expectedServerId: state.serverId,
      expectedVersion: "3.0.0",
    }, { ca: certificate });
    assert.equal(restored.session.estado, "active");

    await logoutHttpsServer({
      url: "https://127.0.0.1",
      port,
      sessionId: login.session.sessionId,
    }, { ca: certificate });
    assert.equal(authenticationCalls, 1);
    assert.equal(repositoryCalls, 0);
  } finally {
    await stopHttpsServer().catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("reporta servidor apagado al intentar restaurar una sesión", async () => {
  const port = await availablePort();
  await assert.rejects(
    getHttpsServerSession({
      url: "https://127.0.0.1",
      port,
      sessionId: LOGIN_SESSION.sessionId,
      timeoutMs: 1_000,
    }),
    (error) => error?.code === "HTTPS_SERVER_NOT_FOUND",
  );
});

test("clasifica certificado, TLS, timeout y servidor apagado", () => {
  assert.equal(classifyHttpsConnectionError({ code: "CERT_HAS_EXPIRED" }).code, "HTTPS_CERTIFICATE_INVALID");
  assert.equal(classifyHttpsConnectionError({ code: "EPROTO" }).code, "HTTPS_TLS_INVALID");
  assert.equal(classifyHttpsConnectionError({ code: "ENOTFOUND" }).code, "HTTPS_SERVER_NOT_FOUND");
  assert.equal(classifyHttpsConnectionError(new Error("connection timeout")).code, "HTTPS_TIMEOUT");
});

test("la integración HTTPS permanece separada de LAN y operaciones comerciales", async () => {
  const [mainSource, preloadSource, appSource, pageSource, sessionSource, bridgeSource] = await Promise.all([
    fs.readFile(new URL("./main.js", import.meta.url), "utf8"),
    fs.readFile(new URL("./preload.cjs", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/pages/OnlineServerPage.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/lib/OnlineServerSession.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/components/HttpsAuthenticationBridge.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(mainSource, /https-server:login/);
  assert.match(mainSource, /https-server:session/);
  assert.match(mainSource, /https-server:logout/);
  assert.match(preloadSource, /https-auth:request/);
  assert.match(appSource, /HttpsAuthenticationBridge/);
  assert.match(appSource, /request\.resource === 'contacts'/);
  assert.match(appSource, /getDataRepository\(\)\.fetchContacts\(\)/);
  assert.doesNotMatch(appSource, /upsertContact|deleteContact|applyContactChanges/);
  assert.match(pageSource, /Iniciar sesión/);
  assert.match(pageSource, /Cerrar sesión/);
  assert.match(sessionSource, /localStorage/);
  assert.match(bridgeSource, /getDataRepository\(\)\.loginUser/);

  for (const source of [pageSource, sessionSource]) {
    assert.doesNotMatch(source, /RepositoryRegistry|DexieRepository|ApiRepository|localDb|executeRepositoryCall/);
  }
  assert.doesNotMatch(pageSource, /repository\/call|JWT|WebSocket|sincronizar/i);
});

test("lee únicamente me, company y permissions mediante GET autenticado", async () => {
  const calls = [];
  const payloads = {
    "/me": {
      id: "user-admin-1",
      usuario: "admin",
      nombre: "Administrador Principal",
      rol: "admin",
      permisos: ["view_reports", "manage_settings"],
    },
    "/company": {
      nombreEmpresa: "JoyaControl Principal",
      nit: "900123456-7",
      direccion: "Calle Principal 10",
      ciudad: "Bogotá",
      telefonos: ["3001234567"],
      correo: "contacto@joyacontrol.test",
      logo: "",
      configuracionImpresion: null,
    },
    "/permissions": { permisos: ["view_reports", "manage_settings"] },
  };
  let clock = Date.parse("2026-07-28T20:00:00.000Z");
  const requestJson = async (baseUrl, pathname, options) => {
    calls.push({ baseUrl, pathname, options });
    clock += 17;
    return { statusCode: 200, body: payloads[pathname], tlsProtocol: "TLSv1.3" };
  };

  for (const resource of ["me", "company", "permissions"]) {
    const result = await readHttpsServerResource({
      url: "https://midominio.com",
      port: 443,
      sessionId: LOGIN_SESSION.sessionId,
      resource,
    }, { requestJson, now: () => clock });
    assert.equal(result.ok, true);
    assert.equal(result.resource, resource);
    assert.deepEqual(result.data, payloads[`/${resource}`]);
    assert.equal(result.latencyMs, 17);
  }

  assert.deepEqual(calls.map(call => ({
    pathname: call.pathname,
    method: call.options.method,
    sessionId: call.options.sessionId,
  })), [
    { pathname: "/me", method: "GET", sessionId: LOGIN_SESSION.sessionId },
    { pathname: "/company", method: "GET", sessionId: LOGIN_SESSION.sessionId },
    { pathname: "/permissions", method: "GET", sessionId: LOGIN_SESSION.sessionId },
  ]);

  await assert.rejects(
    readHttpsServerResource({
      url: "https://midominio.com",
      sessionId: LOGIN_SESSION.sessionId,
      resource: "sales",
    }, { requestJson }),
    (error) => error?.code === "HTTPS_READ_RESOURCE_NOT_ALLOWED",
  );
});

test("propaga token inválido y expirado en lecturas protegidas", async () => {
  for (const errorCode of ["HTTPS_SESSION_INVALID", "HTTPS_SESSION_EXPIRED"]) {
    await assert.rejects(
      readHttpsServerResource({
        url: "https://midominio.com",
        sessionId: LOGIN_SESSION.sessionId,
        resource: "me",
      }, {
        requestJson: async () => ({
          statusCode: 401,
          body: { error: errorCode, message: "Sesión no disponible" },
        }),
      }),
      (error) => error?.code === errorCode,
    );
  }
});

test("consulta contactos completos, individuales y búsqueda únicamente mediante GET", async () => {
  const calls = [];
  const contacts = [
    {
      id: "client-1",
      type: "client",
      name: "Cliente Uno",
      document: "1001",
      phone: "3001001001",
      email: "cliente@correo.test",
      address: "Calle 1",
      notes: "",
      status: "active",
    },
    {
      id: "supplier-1",
      type: "supplier",
      name: "Proveedor Oro",
      document: "9001",
      phone: "3009001001",
      email: "proveedor@correo.test",
      address: "Carrera 2",
      notes: "",
      status: "active",
    },
  ];
  const headers = {
    "x-joyacontrol-server-id": SERVER_INFO.serverId,
    "x-joyacontrol-version": "3.0.0",
  };
  const requestJson = async (_baseUrl, pathname, options) => {
    calls.push({ pathname, options });
    if (pathname === "/contacts") return { statusCode: 200, body: contacts, headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/contacts/client-1") return { statusCode: 200, body: contacts[0], headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/contacts/search?q=oro") return { statusCode: 200, body: [contacts[1]], headers, tlsProtocol: "TLSv1.3" };
    throw new Error(`Ruta inesperada: ${pathname}`);
  };

  const common = {
    url: "https://midominio.com",
    port: 443,
    sessionId: LOGIN_SESSION.sessionId,
    expectedServerId: SERVER_INFO.serverId,
    expectedVersion: "3.0.0",
  };

  const all = await readHttpsServerResource({ ...common, resource: "contacts" }, { requestJson });
  const one = await readHttpsServerResource({ ...common, resource: "contact", args: { id: "client-1" } }, { requestJson });
  const search = await readHttpsServerResource({ ...common, resource: "contactsSearch", args: { query: "oro" } }, { requestJson });

  assert.equal(all.data.length, 2);
  assert.equal(one.data.id, "client-1");
  assert.deepEqual(search.data.map(contact => contact.id), ["supplier-1"]);
  assert.deepEqual(calls.map(call => ({ pathname: call.pathname, method: call.options.method })), [
    { pathname: "/contacts", method: "GET" },
    { pathname: "/contacts/client-1", method: "GET" },
    { pathname: "/contacts/search?q=oro", method: "GET" },
  ]);
});

test("rechaza contactos de un servidor o versión distintos", async () => {
  const contact = {
    id: "client-1",
    type: "client",
    name: "Cliente Uno",
    document: "1001",
    phone: "",
    email: "",
    address: "",
    notes: "",
    status: "active",
  };

  await assert.rejects(
    readHttpsServerResource({
      url: "https://midominio.com",
      sessionId: LOGIN_SESSION.sessionId,
      resource: "contacts",
      expectedServerId: SERVER_INFO.serverId,
      expectedVersion: "3.0.0",
    }, {
      requestJson: async () => ({
        statusCode: 200,
        body: [contact],
        headers: {
          "x-joyacontrol-server-id": "22222222-2222-4222-8222-222222222222",
          "x-joyacontrol-version": "3.0.0",
        },
      }),
    }),
    (error) => error?.code === "HTTPS_SERVER_MISMATCH",
  );

  await assert.rejects(
    readHttpsServerResource({
      url: "https://midominio.com",
      sessionId: LOGIN_SESSION.sessionId,
      resource: "contacts",
      expectedServerId: SERVER_INFO.serverId,
      expectedVersion: "3.0.0",
    }, {
      requestJson: async () => ({
        statusCode: 200,
        body: [contact],
        headers: {
          "x-joyacontrol-server-id": SERVER_INFO.serverId,
          "x-joyacontrol-version": "4.0.0",
        },
      }),
    }),
    (error) => error?.code === "HTTPS_VERSION_INCOMPATIBLE",
  );
});

test("propaga token inválido y expirado al consultar contactos", async () => {
  for (const errorCode of ["HTTPS_SESSION_INVALID", "HTTPS_SESSION_EXPIRED"]) {
    await assert.rejects(
      readHttpsServerResource({
        url: "https://midominio.com",
        sessionId: LOGIN_SESSION.sessionId,
        resource: "contacts",
        expectedServerId: SERVER_INFO.serverId,
        expectedVersion: "3.0.0",
      }, {
        requestJson: async () => ({
          statusCode: 401,
          body: { error: errorCode, message: "Sesión no disponible" },
          headers: {},
        }),
      }),
      (error) => error?.code === errorCode,
    );
  }
});

test("consulta productos e inventario únicamente mediante GET y valida identidad protegida", async () => {
  const calls = [];
  const products = [
    {
      id: "product-1",
      code: "ANI-001",
      name: "Anillo Oro",
      category: "Anillos",
      reference: "REF-001",
      description: "",
      weightGrams: 4.5,
      availableGrams: 13.5,
      salePrice: 950000,
      stock: 3,
      minStock: 1,
      status: "available",
    },
  ];
  const inventory = [
    {
      id: "product-1",
      code: "ANI-001",
      name: "Anillo Oro",
      category: "Anillos",
      stock: 3,
      availableGrams: 13.5,
      weightGrams: 4.5,
      minStock: 1,
      location: "Vitrina A",
      lastMovement: { date: "2026-07-28T19:00:00.000Z", type: "increase" },
      status: "available",
    },
  ];
  const headers = {
    "x-joyacontrol-server-id": SERVER_INFO.serverId,
    "x-joyacontrol-version": "3.0.0",
  };
  const requestJson = async (_baseUrl, pathname, options) => {
    calls.push({ pathname, method: options.method });
    if (pathname === "/products") return { statusCode: 200, body: products, headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/products/product-1") return { statusCode: 200, body: products[0], headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/products/search?q=oro") return { statusCode: 200, body: products, headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/inventory") return { statusCode: 200, body: inventory, headers, tlsProtocol: "TLSv1.3" };
    if (pathname === "/inventory/product-1") return { statusCode: 200, body: inventory[0], headers, tlsProtocol: "TLSv1.3" };
    throw new Error(`Ruta inesperada: ${pathname}`);
  };
  const common = {
    url: "https://midominio.com",
    port: 443,
    sessionId: LOGIN_SESSION.sessionId,
    expectedServerId: SERVER_INFO.serverId,
    expectedVersion: "3.0.0",
  };

  const allProducts = await readHttpsServerResource({ ...common, resource: "products" }, { requestJson });
  const product = await readHttpsServerResource({ ...common, resource: "product", args: { id: "product-1" } }, { requestJson });
  const search = await readHttpsServerResource({ ...common, resource: "productsSearch", args: { query: "oro" } }, { requestJson });
  const allInventory = await readHttpsServerResource({ ...common, resource: "inventory" }, { requestJson });
  const inventoryItem = await readHttpsServerResource({ ...common, resource: "inventoryItem", args: { id: "product-1" } }, { requestJson });

  assert.equal(allProducts.data.length, 1);
  assert.equal(product.data.salePrice, 950000);
  assert.equal(search.data[0].id, "product-1");
  assert.equal(allInventory.data[0].lastMovement.type, "increase");
  assert.equal(inventoryItem.data.location, "Vitrina A");
  assert.deepEqual(calls, [
    { pathname: "/products", method: "GET" },
    { pathname: "/products/product-1", method: "GET" },
    { pathname: "/products/search?q=oro", method: "GET" },
    { pathname: "/inventory", method: "GET" },
    { pathname: "/inventory/product-1", method: "GET" },
  ]);
});

test("propaga sesión inválida o expirada al leer productos e inventario", async () => {
  for (const resource of ["products", "inventory"]) {
    for (const errorCode of ["HTTPS_SESSION_INVALID", "HTTPS_SESSION_EXPIRED"]) {
      await assert.rejects(
        readHttpsServerResource({
          url: "https://midominio.com",
          sessionId: LOGIN_SESSION.sessionId,
          resource,
          expectedServerId: SERVER_INFO.serverId,
          expectedVersion: "3.0.0",
        }, {
          requestJson: async () => ({
            statusCode: 401,
            body: { error: errorCode, message: "Sesión no disponible" },
            headers: {},
          }),
        }),
        (error) => error?.code === errorCode,
      );
    }
  }
});

test("rechaza productos e inventario con identidad de servidor o versión incompatibles", async () => {
  const product = {
    id: "product-1",
    code: "ANI-001",
    name: "Anillo Oro",
    category: "Anillos",
    reference: "REF-001",
    description: "",
    weightGrams: 4.5,
    availableGrams: 13.5,
    salePrice: 950000,
    stock: 3,
    minStock: 1,
    status: "available",
  };
  await assert.rejects(
    readHttpsServerResource({
      url: "https://midominio.com",
      sessionId: LOGIN_SESSION.sessionId,
      resource: "products",
      expectedServerId: SERVER_INFO.serverId,
      expectedVersion: "3.0.0",
    }, {
      requestJson: async () => ({
        statusCode: 200,
        body: [product],
        headers: {
          "x-joyacontrol-server-id": "22222222-2222-4222-8222-222222222222",
          "x-joyacontrol-version": "3.0.0",
        },
      }),
    }),
    (error) => error?.code === "HTTPS_SERVER_MISMATCH",
  );

  await assert.rejects(
    readHttpsServerResource({
      url: "https://midominio.com",
      sessionId: LOGIN_SESSION.sessionId,
      resource: "products",
      expectedServerId: SERVER_INFO.serverId,
      expectedVersion: "3.0.0",
    }, {
      requestJson: async () => ({
        statusCode: 200,
        body: [product],
        headers: {
          "x-joyacontrol-server-id": SERVER_INFO.serverId,
          "x-joyacontrol-version": "4.0.0",
        },
      }),
    }),
    (error) => error?.code === "HTTPS_VERSION_INCOMPATIBLE",
  );
});

test("clasifica servidor apagado, timeout, TLS y certificado al leer productos", async () => {
  const cases = [
    [{ code: "ECONNREFUSED", message: "refused" }, "HTTPS_SERVER_NOT_FOUND"],
    [{ code: "ETIMEDOUT", message: "request timeout" }, "HTTPS_TIMEOUT"],
    [{ code: "EPROTO", message: "wrong version" }, "HTTPS_TLS_INVALID"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self signed" }, "HTTPS_CERTIFICATE_INVALID"],
  ];
  for (const [failure, expectedCode] of cases) {
    await assert.rejects(
      readHttpsServerResource({
        url: "https://midominio.com",
        sessionId: LOGIN_SESSION.sessionId,
        resource: "products",
        expectedServerId: SERVER_INFO.serverId,
        expectedVersion: "3.0.0",
      }, {
        requestJson: async () => { throw Object.assign(new Error(failure.message), { code: failure.code }); },
      }),
      (error) => error?.code === expectedCode,
    );
  }
});
