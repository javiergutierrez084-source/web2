import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  getHttpsServerState,
  startHttpsServer,
  stopHttpsServer,
} from "./httpsServer.js";
import { startLanServer, stopLanServer } from "./lanServer.js";

const TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUB9Wg9C/EmNxYwFNEZ1JBxJRLfOowDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcyODEzNTk0OFoXDTM2MDcy
NTEzNTk0OFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA6EKOUkJkv9XPdyQRwdNQDdPpF4JV0Ockact7FQRN3pmZ
mcJfZe5jyLx0uZw2PPBAfMnLVwUcZZakCWMiCYO7tq624iQB3HGRIL9ssKX2D9GW
e4I7gmPEjJwLM6DD3wHpJN3P+0zYOMcLdcxNBbqtuAOMngSI2AvDsj0gCLMEEiOi
kFU67cai2xgQI1yBUQ0H1B48C24mGACOfONKYG+G4NXJoOgsIU3VkOSv6DDdsOKr
Di1mkP/xoyzmfAsF8pnKRLGvtl38yx7mrLj7MCHoHOeQwK0zlxROZE3u6iQT2xtX
EK/wDnL0Ybl15B1xCLbAds2/lzdYuDLdpL/kLwO3rwIDAQABo28wbTAdBgNVHQ4E
FgQUAG56rS7Iw08Q3T7sgVJOo0QLZ8cwHwYDVR0jBBgwFoAUAG56rS7Iw08Q3T7s
gVJOo0QLZ8cwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAJp5yceVajlaUKmmKd9Fyu8ljKeimZiw
Z64hP24sXyQYWpBGAA9gs249YBGAMHmXboM0R8pJY2XoIAjWCq7jifEngwIwSfyX
nJ6KMRIFuJ0MuQELWgRtLlsPZsyKiv0uDqDk0NbOlzH/0VLyp9VttjQxUwcMJFiH
IAzYiHAJrfagW8EbSnjTsVGhpgrrD886mD7rPGZ3TmHpyLnMTuvbBHd+QNz5ATMW
+6AxhC4okiawXVgWR4vH/kbvlEeAiVmDXXv31gJcbFxBpv/belKdU72LYCFxM/1H
X3a6gRQySjRKfZ/yCRFPuBSP0udeV2ewEXY/le1I1taeC8JPZaTxGLQ=
-----END CERTIFICATE-----`;

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDoQo5SQmS/1c93
JBHB01AN0+kXglXQ5yRpy3sVBE3emZmZwl9l7mPIvHS5nDY88EB8yctXBRxllqQJ
YyIJg7u2rrbiJAHccZEgv2ywpfYP0ZZ7gjuCY8SMnAszoMPfAekk3c/7TNg4xwt1
zE0Fuq24A4yeBIjYC8OyPSAIswQSI6KQVTrtxqLbGBAjXIFRDQfUHjwLbiYYAI58
40pgb4bg1cmg6CwhTdWQ5K/oMN2w4qsOLWaQ//GjLOZ8CwXymcpEsa+2XfzLHuas
uPswIegc55DArTOXFE5kTe7qJBPbG1cQr/AOcvRhuXXkHXEItsB2zb+XN1i4Mt2k
v+QvA7evAgMBAAECggEAX+eXqAzlWDdb9xjMQkpU3Jjbv4rgj6XaKdtNZBTGaLvp
Ko4R4V+qEWoMEtaXqNsV7dFPpwujuakV7BBkriQYv2rudnuizxmP8UNKCLlG3SpQ
pohUtVcoAl2u3G8uYigCUuhKqLyG7g72wvoM9egrMng4uMkrjnZxJOjLkPwGmswV
uxYaeOQpcGyuiAckF/yk/da4UwfznVczgLOKiukQUzk06+wN3/bis6wUiPaEJCWp
VlhL3Zy8v38+6yvyuBunThxEUg2eDbQeShNmeuSnHJJwBclVTWRLeaE67977x/Ih
xllfq4Q+RK0ST6UDXei0K37pOZUATs496dhlUy+S9QKBgQD4iFapHkSRB8WR3y1+
6X5i6nqDR5e/Lcv9fVXTOCbAtGuztGNkGG/O1IrvxDpsok43WdmB8Wwtw58MnEZA
+1uT+05M6T+xxp/GT9WOvHrYk/cS4AFikRj8fAdCr5q5s8RvHqQe9kvtY/boJe1G
WgJK420Qzsm9xnwmEczkglYiSwKBgQDvPQ1RKootq4OBbIm/eDRVy26VcHDbkm7e
lIDqH9hSV+WM88nzGc68y93v3Y1ItXNERHtNGFFu8v/CSVoqm4aCqx0HQSKzSpfT
jRNS0ASjZ98rb9k/Or5bTnXYFrP7XtsdsTmscpXj61fO00HQap8A3w+kYvMFDami
+9B7iFzBrQKBgQCQ1WMrSyhKHG1WhOjOfOPaYSrkNmSIVPf70X6iiKaMxpe9MfJ5
8oO11Mbi00f45t0OBJ5sy3RvdwDJKIkIdXL42grXZ1ZnE4ko2H1roQs2C4SAy2oD
NuuIt/7DLfLNJaXj28dpA79bqFXLE88ioHGVktOMZ/XJUlInHVh6Ejp/4QKBgQDn
2ok/cjS8Eg6+rYvJ7hr6Us93MKOPiJi+SbmuLPKeyuSC9/luCkLbodATGOpF3uQ4
8w10J+8z0XiguCoUROnVVTQqxat1iwMdWQmzJjp4isAz/o/SwYGeR6nZpBcFtGYy
noFAaURuwLQ2k3KjI9G5LHSiYesXqKgQdm8UaZFLeQKBgQC4xksa/F4BZO2dXEDX
f6dIXxO1dKp8QRDhMV9Bvf6bcC2IIEETekArCmKNP6VWzUhRd4zgp9U8uqVz8k2C
+4IG6n5h4ZHEtfuItqx8mYtBIvUTowCjyIeyLalIXkNQTK/8E70OQquAZS696O4F
dcDq0V6rfjtBaQqm2Uu4Rny1qg==
-----END PRIVATE KEY-----`;

const temporaryDirectories = new Set();

afterEach(async () => {
  await stopHttpsServer().catch(() => undefined);
  await stopLanServer().catch(() => undefined);
  await Promise.all([...temporaryDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

async function createFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "joyacontrol-https-v3-"));
  temporaryDirectories.add(directory);
  const certPath = path.join(directory, "cert.pem");
  const keyPath = path.join(directory, "key.pem");
  await Promise.all([
    fs.writeFile(certPath, TEST_CERTIFICATE, "utf8"),
    fs.writeFile(keyPath, TEST_PRIVATE_KEY, { encoding: "utf8", mode: 0o600 }),
  ]);
  return {
    directory,
    userDataPath: path.join(directory, "user-data"),
    certPath,
    keyPath,
  };
}

function createEnvironment({ port, certPath, keyPath, enabled = "true" }) {
  return {
    JOYACONTROL_HTTPS_ENABLED: enabled,
    JOYACONTROL_HTTPS_HOST: "127.0.0.1",
    JOYACONTROL_HTTPS_PORT: String(port),
    JOYACONTROL_HTTPS_CERT_PATH: certPath,
    JOYACONTROL_HTTPS_KEY_PATH: keyPath,
  };
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function requestHttps(port, pathname, { method = "GET", body, sessionId } = {}) {
  return new Promise((resolve, reject) => {
    const serializedBody = body === undefined ? null : JSON.stringify(body);
    const headers = { Accept: "application/json" };
    if (serializedBody !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(serializedBody);
    }
    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

    const request = https.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers,
      rejectUnauthorized: false,
      agent: false,
      timeout: 2_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
          tlsProtocol: response.socket.getProtocol(),
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("HTTPS_TEST_TIMEOUT")));
    request.on("error", reject);
    if (serializedBody !== null) request.write(serializedBody);
    request.end();
  });
}

function requestHttp(port, pathname = "/health") {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      agent: false,
      timeout: 2_000,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("timeout", () => request.destroy(new Error("HTTP_TEST_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

function requestLan(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 2_000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("timeout", () => request.destroy(new Error("LAN_TEST_TIMEOUT")));
    request.on("error", reject);
  });
}

const AUTHENTICATED_USER = {
  success: true,
  userId: "user-admin-1",
  username: "admin",
  displayName: "Administrador Principal",
  role: "admin",
};

test("permanece deshabilitado cuando JOYACONTROL_HTTPS_ENABLED es false", async () => {
  const state = await startHttpsServer({
    env: { JOYACONTROL_HTTPS_ENABLED: "false" },
    version: "3.0.0",
  });
  assert.equal(state.enabled, false);
  assert.equal(state.running, false);
  assert.equal(getHttpsServerState().running, false);
});

test("autentica, consulta y cierra una sesión HTTPS sin afectar LAN ni Repository", async () => {
  const fixture = await createFixture();
  let repositoryCalls = 0;
  let authenticationCalls = 0;
  const executeRepositoryCall = async () => {
    repositoryCalls += 1;
    throw new Error("REPOSITORY_MUST_NOT_BE_CALLED_IN_PHASE_3");
  };
  const authenticateUser = async (username, password) => {
    authenticationCalls += 1;
    assert.equal(username, "admin");
    assert.equal(password, "correcta");
    return AUTHENTICATED_USER;
  };

  const lanProbe = net.createServer();
  const lanPort = await listen(lanProbe);
  await close(lanProbe);
  await startLanServer({
    host: "127.0.0.1",
    port: lanPort,
    serverName: "JoyaControl LAN congelado",
    userDataPath: path.join(fixture.directory, "lan-user-data"),
    version: "2.1",
    authenticateUser: async () => ({ success: false }),
    executeRepositoryCall,
  });

  const httpsProbe = net.createServer();
  const httpsPort = await listen(httpsProbe);
  await close(httpsProbe);
  const firstState = await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall,
    authenticateUser,
    version: "3.0.0",
    serverName: "JoyaControl Principal",
    hostname: "principal-pruebas",
    env: createEnvironment({ port: httpsPort, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  const lanBefore = await requestLan(lanPort);
  assert.equal(lanBefore.statusCode, 200);
  assert.equal(lanBefore.body.protocolVersion, "LAN-1");

  const health = await requestHttps(httpsPort, "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.protocol, "HTTPS");
  assert.equal(health.body.version, "3.0.0");
  assert.ok(["TLSv1.2", "TLSv1.3"].includes(health.tlsProtocol));
  assert.equal(health.headers["access-control-allow-origin"], undefined);
  assert.equal(health.headers["set-cookie"], undefined);

  const serverInfo = await requestHttps(httpsPort, "/server-info");
  assert.equal(serverInfo.body.serverId, firstState.serverId);
  assert.equal(serverInfo.body.serverName, "JoyaControl Principal");

  const login = await requestHttps(httpsPort, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "3.0.0" },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.serverId, firstState.serverId);
  assert.equal(login.body.usuario, "admin");
  assert.equal(login.body.nombre, "Administrador Principal");
  assert.equal(login.body.rol, "admin");
  assert.equal(login.body.version, "3.0.0");
  assert.match(login.body.sessionId, /^[A-Za-z0-9_-]{40,}$/);
  assert.ok(Date.parse(login.body.expiracion) > Date.parse(login.body.fecha));

  const session = await requestHttps(httpsPort, "/session", { sessionId: login.body.sessionId });
  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.body, {
    usuario: "admin",
    nombre: "Administrador Principal",
    rol: "admin",
    hostname: "principal-pruebas",
    serverId: firstState.serverId,
    version: "3.0.0",
    estado: "active",
    fecha: login.body.fecha,
    expiracion: login.body.expiracion,
  });

  const logout = await requestHttps(httpsPort, "/logout", { method: "POST", sessionId: login.body.sessionId });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.body, { success: true, estado: "closed" });

  const afterLogout = await requestHttps(httpsPort, "/session", { sessionId: login.body.sessionId });
  assert.equal(afterLogout.statusCode, 401);
  assert.equal(afterLogout.body.error, "HTTPS_SESSION_INVALID");
  assert.equal(authenticationCalls, 1);
  assert.equal(repositoryCalls, 0);

  for (const [method, pathname] of [
    ["GET", "/login"],
    ["GET", "/logout"],
    ["POST", "/repository/call"],
    ["POST", "/sync"],
    ["POST", "/client/register"],
    ["POST", "/client/ping"],
    ["POST", "/print"],
    ["GET", "/websocket"],
    ["GET", "/unknown"],
  ]) {
    const response = await requestHttps(httpsPort, pathname, { method });
    assert.equal(response.statusCode, 404, `${method} ${pathname}`);
    assert.deepEqual(response.body, { error: "NOT_FOUND" }, `${method} ${pathname}`);
  }

  await assert.rejects(
    requestHttp(httpsPort),
    (error) => ["ECONNRESET", "EPROTO"].includes(error?.code) || /socket hang up/i.test(error?.message || ""),
  );

  await stopHttpsServer();
  const lanAfter = await requestLan(lanPort);
  assert.equal(lanAfter.statusCode, 200);
  assert.equal(lanAfter.body.protocolVersion, "LAN-1");

  const secondProbe = net.createServer();
  const secondPort = await listen(secondProbe);
  await close(secondProbe);
  const secondState = await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall,
    authenticateUser,
    version: "3.0.0",
    env: createEnvironment({ port: secondPort, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });
  assert.equal(secondState.serverId, firstState.serverId);
  const oldSessionAfterRestart = await requestHttps(secondPort, "/session", { sessionId: login.body.sessionId });
  assert.equal(oldSessionAfterRestart.statusCode, 401);
  assert.equal(oldSessionAfterRestart.body.error, "HTTPS_SESSION_INVALID");
  assert.equal(repositoryCalls, 0);
});

test("diferencia usuario inexistente, contraseña incorrecta y versión incompatible", async () => {
  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let authenticationCalls = 0;

  await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => { throw new Error("REPOSITORY_MUST_NOT_BE_CALLED"); },
    authenticateUser: async (username) => {
      authenticationCalls += 1;
      if (username === "desconocido") return { success: false, error: "Usuario no encontrado" };
      return { success: false, error: "Contraseña incorrecta" };
    },
    version: "3.0.0",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  const missingUser = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "desconocido", contrasena: "x", versionCliente: "3.0.0" },
  });
  assert.equal(missingUser.statusCode, 401);
  assert.equal(missingUser.body.error, "HTTPS_USER_NOT_FOUND");

  const wrongPassword = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "mala", versionCliente: "3.0.0" },
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(wrongPassword.body.error, "HTTPS_PASSWORD_INCORRECT");

  const incompatible = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "2.1.2" },
  });
  assert.equal(incompatible.statusCode, 426);
  assert.equal(incompatible.body.error, "HTTPS_VERSION_INCOMPATIBLE");
  assert.equal(authenticationCalls, 2);
});

test("expira sesiones en memoria y exige Bearer para consultarlas", async () => {
  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let clock = Date.parse("2026-07-28T20:00:00.000Z");

  await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => undefined,
    authenticateUser: async () => AUTHENTICATED_USER,
    version: "3.0.0",
    sessionDurationMs: 60_000,
    now: () => clock,
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  const noSession = await requestHttps(port, "/session");
  assert.equal(noSession.statusCode, 401);
  assert.equal(noSession.body.error, "HTTPS_SESSION_REQUIRED");

  const login = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "3.0.0" },
  });
  clock += 60_001;

  const expired = await requestHttps(port, "/contacts", { sessionId: login.body.sessionId });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.body.error, "HTTPS_SESSION_EXPIRED");
});

test("rechaza un certificado inválido sin dejar el servidor activo", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.certPath, "CERTIFICADO_INVALIDO", "utf8");
  const portProbe = net.createServer();
  const port = await listen(portProbe);
  await close(portProbe);

  await assert.rejects(startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => undefined,
    authenticateUser: async () => AUTHENTICATED_USER,
    version: "3.0.0",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  }), /PEM|certificate|certificado|no start line/i);
  assert.equal(getHttpsServerState().running, false);
});

test("rechaza un puerto ocupado sin autenticar ni llamar al Repository", async () => {
  const fixture = await createFixture();
  let repositoryCalls = 0;
  let authenticationCalls = 0;
  const occupiedServer = net.createServer();
  const occupiedPort = await listen(occupiedServer);

  try {
    await assert.rejects(startHttpsServer({
      userDataPath: fixture.userDataPath,
      executeRepositoryCall: async () => { repositoryCalls += 1; },
      authenticateUser: async () => { authenticationCalls += 1; return AUTHENTICATED_USER; },
      version: "3.0.0",
      env: createEnvironment({ port: occupiedPort, certPath: fixture.certPath, keyPath: fixture.keyPath }),
    }), (error) => error?.code === "EADDRINUSE");
    assert.equal(getHttpsServerState().running, false);
    assert.equal(repositoryCalls, 0);
    assert.equal(authenticationCalls, 0);
  } finally {
    await close(occupiedServer);
  }
});

test("exige configuración y proveedor de autenticación cuando HTTPS está habilitado", async () => {
  await assert.rejects(startHttpsServer({
    userDataPath: os.tmpdir(),
    executeRepositoryCall: async () => undefined,
    authenticateUser: async () => AUTHENTICATED_USER,
    env: { JOYACONTROL_HTTPS_ENABLED: "true" },
  }), (error) => error?.code === "HTTPS_CONFIGURATION_INVALID");

  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  await assert.rejects(startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => undefined,
    version: "3.0.0",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  }), (error) => error?.code === "HTTPS_CONFIGURATION_INVALID");
});

test("main conserva executeRepositoryCall y HTTPS no ejecuta operaciones comerciales", async () => {
  const mainSource = await fs.readFile(new URL("./main.js", import.meta.url), "utf8");
  const httpsSource = await fs.readFile(new URL("./httpsServer.js", import.meta.url), "utf8");
  const functionStart = mainSource.indexOf("function executeRepositoryCall(method, args)");
  const functionEnd = mainSource.indexOf("\nfunction authenticateLanUser", functionStart);
  const repositoryFunction = `${mainSource.slice(functionStart, functionEnd)}\nfunction authenticateLanUser`;

  assert.equal(repositoryFunction, `function executeRepositoryCall(method, args) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error("LAN_REPOSITORY_PROVIDER_UNAVAILABLE"));
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingRepositoryCalls.delete(requestId); reject(new Error("LAN_REPOSITORY_TIMEOUT")); }, 15000);
    pendingRepositoryCalls.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("lan-repository:request", { requestId, method, args });
  });
}

function authenticateLanUser`);
  assert.match(mainSource, /https-auth:request/);
  assert.match(mainSource, /authenticateUser:\s*authenticateHttpsUser/);
  assert.match(httpsSource, /pathname === "\/login"/);
  assert.match(httpsSource, /pathname === "\/session"/);
  assert.match(httpsSource, /pathname === "\/logout"/);
  assert.match(httpsSource, /minVersion:\s*"TLSv1\.2"/);
  assert.doesNotMatch(httpsSource, /Dexie|localDb|RepositoryRegistry|IDataRepository|ApiRepository/);
  assert.doesNotMatch(httpsSource, /Access-Control-Allow-Origin|Set-Cookie|JWT/);
  assert.doesNotMatch(httpsSource, /executeRepositoryCall\s*\(/);
});

test("expone me, company y permissions únicamente con sesión HTTPS válida", async () => {
  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let repositoryCalls = 0;
  const readCalls = [];

  await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => { repositoryCalls += 1; },
    authenticateUser: async () => AUTHENTICATED_USER,
    readServerData: async (resource, args) => {
      readCalls.push({ resource, args });
      if (resource === "permissions") {
        return { permissions: ["view_reports", "manage_settings"] };
      }
      if (resource === "company") {
        return {
          company: {
            name: "JoyaControl Principal",
            nit: "900123456-7",
            address: "Calle Principal 10",
            city: "Bogotá",
            phone: "3001234567; 6011234567",
            email: "contacto@joyacontrol.test",
            logoUrl: "data:image/png;base64,logo",
          },
          printConfiguration: { defaultPrinterName: "Impresora principal" },
        };
      }
      throw new Error("HTTPS_READ_RESOURCE_NOT_ALLOWED");
    },
    version: "3.0.0",
    hostname: "principal-fase4",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  for (const pathname of ["/me", "/company", "/permissions"]) {
    const anonymous = await requestHttps(port, pathname);
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.body.error, "HTTPS_SESSION_REQUIRED");
  }

  const login = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "3.0.0" },
  });
  assert.equal(login.statusCode, 200);

  const me = await requestHttps(port, "/me", { sessionId: login.body.sessionId });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.body, {
    id: "user-admin-1",
    usuario: "admin",
    nombre: "Administrador Principal",
    rol: "admin",
    permisos: ["view_reports", "manage_settings"],
  });

  const permissions = await requestHttps(port, "/permissions", { sessionId: login.body.sessionId });
  assert.equal(permissions.statusCode, 200);
  assert.deepEqual(permissions.body, { permisos: ["view_reports", "manage_settings"] });

  const company = await requestHttps(port, "/company", { sessionId: login.body.sessionId });
  assert.equal(company.statusCode, 200);
  assert.deepEqual(company.body, {
    nombreEmpresa: "JoyaControl Principal",
    nit: "900123456-7",
    direccion: "Calle Principal 10",
    ciudad: "Bogotá",
    telefonos: ["3001234567", "6011234567"],
    correo: "contacto@joyacontrol.test",
    logo: "data:image/png;base64,logo",
    configuracionImpresion: { defaultPrinterName: "Impresora principal" },
  });

  const invalid = await requestHttps(port, "/me", { sessionId: "token-invalido" });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.error, "HTTPS_SESSION_INVALID");

  const forbiddenWrite = await requestHttps(port, "/company", {
    method: "POST",
    sessionId: login.body.sessionId,
    body: {},
  });
  assert.equal(forbiddenWrite.statusCode, 404);
  const repositoryRoute = await requestHttps(port, "/repository/call", { sessionId: login.body.sessionId });
  assert.equal(repositoryRoute.statusCode, 404);

  assert.equal(repositoryCalls, 0);
  assert.deepEqual(readCalls.map(call => call.resource), ["permissions", "company"]);
});

test("expone contactos por lista, ID y búsqueda sin filtrar datos internos", async () => {
  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let repositoryCalls = 0;
  const readCalls = [];
  const contacts = [
    {
      id: "client-1",
      type: "client",
      name: "Cliente Uno",
      document: "1001",
      phone: "3001001001",
      email: "cliente@correo.test",
      address: "Calle 1",
      notes: "Preferente",
      password: "NO_DEBE_SALIR",
      token: "NO_DEBE_SALIR",
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
    },
  ];

  await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => { repositoryCalls += 1; },
    authenticateUser: async () => AUTHENTICATED_USER,
    readServerData: async (resource, args) => {
      readCalls.push({ resource, args });
      if (resource === "permissions") return { permissions: ["view_contacts"] };
      if (resource === "contacts") return contacts;
      if (resource === "contact") return contacts.find(contact => contact.id === args.id) || null;
      if (resource === "contactsSearch") {
        const query = String(args.query || "").toLowerCase();
        return contacts.filter(contact => `${contact.name} ${contact.document}`.toLowerCase().includes(query));
      }
      throw new Error("HTTPS_READ_RESOURCE_NOT_ALLOWED");
    },
    version: "3.0.0",
    hostname: "principal-fase5",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  for (const pathname of ["/contacts", "/contacts/client-1", "/contacts/search?q=oro"]) {
    const anonymous = await requestHttps(port, pathname);
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.body.error, "HTTPS_SESSION_REQUIRED");
  }

  const login = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "3.0.0" },
  });
  assert.equal(login.statusCode, 200);

  const all = await requestHttps(port, "/contacts", { sessionId: login.body.sessionId });
  assert.equal(all.statusCode, 200);
  assert.equal(all.headers["x-joyacontrol-server-id"], getHttpsServerState().serverId);
  assert.equal(all.headers["x-joyacontrol-version"], "3.0.0");
  assert.deepEqual(all.body, [
    {
      id: "client-1",
      type: "client",
      name: "Cliente Uno",
      document: "1001",
      phone: "3001001001",
      email: "cliente@correo.test",
      address: "Calle 1",
      notes: "Preferente",
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
  ]);
  assert.equal(JSON.stringify(all.body).includes("NO_DEBE_SALIR"), false);

  const one = await requestHttps(port, "/contacts/client-1", { sessionId: login.body.sessionId });
  assert.equal(one.statusCode, 200);
  assert.equal(one.body.id, "client-1");

  const search = await requestHttps(port, "/contacts/search?q=oro", { sessionId: login.body.sessionId });
  assert.equal(search.statusCode, 200);
  assert.deepEqual(search.body.map(contact => contact.id), ["supplier-1"]);

  const missing = await requestHttps(port, "/contacts/missing", { sessionId: login.body.sessionId });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "HTTPS_CONTACT_NOT_FOUND");

  const forbiddenPost = await requestHttps(port, "/contacts", {
    method: "POST",
    sessionId: login.body.sessionId,
    body: {},
  });
  assert.equal(forbiddenPost.statusCode, 404);
  assert.equal(repositoryCalls, 0);
  assert.deepEqual(readCalls.map(call => call.resource), [
    "permissions",
    "contacts",
    "contact",
    "contactsSearch",
    "contact",
  ]);
});

test("expone productos e inventario por GET autenticado con sanitización estricta", async () => {
  const fixture = await createFixture();
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let repositoryCalls = 0;
  const readCalls = [];
  const products = [
    {
      id: "product-1",
      code: "ANI-001",
      name: "Anillo Oro",
      category: "Anillos",
      reference: "REF-ANI-001",
      description: "Anillo de prueba",
      weightGrams: 4.5,
      availableGrams: 13.5,
      salePrice: 950000,
      stock: 3,
      minStock: 1,
      purchasePrice: 600000,
      averagePurchasePrice: 580000,
      margin: 40,
      supplierIds: ["supplier-secret"],
      token: "NO_DEBE_SALIR",
      httpsConfiguration: { key: "NO_DEBE_SALIR" },
    },
    {
      id: "product-2",
      code: "CAD-002",
      name: "Cadena Plata",
      category: "Cadenas",
      weightGrams: 8,
      salePrice: 250000,
      stock: 0,
      minStock: 2,
    },
  ];
  const inventory = [
    {
      product: products[0],
      location: "Vitrina A",
      lastMovement: {
        date: "2026-07-28T19:00:00.000Z",
        type: "increase",
        totalCost: 1800000,
        notes: "NO_DEBE_SALIR",
      },
      activityLog: ["NO_DEBE_SALIR"],
    },
    {
      product: products[1],
      location: "",
      lastMovement: null,
    },
  ];

  await startHttpsServer({
    userDataPath: fixture.userDataPath,
    executeRepositoryCall: async () => { repositoryCalls += 1; },
    authenticateUser: async () => AUTHENTICATED_USER,
    readServerData: async (resource, args) => {
      readCalls.push({ resource, args });
      if (resource === "permissions") return { permissions: ["view_inventory"] };
      if (resource === "products") return products;
      if (resource === "product") return products.find(product => product.id === args.id) || null;
      if (resource === "productsSearch") {
        const query = String(args.query || "").toLowerCase();
        return products.filter(product => `${product.code} ${product.name} ${product.category}`.toLowerCase().includes(query));
      }
      if (resource === "inventory") return inventory;
      if (resource === "inventoryItem") return inventory.find(item => item.product.id === args.id) || null;
      throw new Error("HTTPS_READ_RESOURCE_NOT_ALLOWED");
    },
    version: "3.0.0",
    hostname: "principal-fase6",
    env: createEnvironment({ port, certPath: fixture.certPath, keyPath: fixture.keyPath }),
  });

  for (const pathname of [
    "/products",
    "/products/product-1",
    "/products/search?q=oro",
    "/inventory",
    "/inventory/product-1",
  ]) {
    const anonymous = await requestHttps(port, pathname);
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.body.error, "HTTPS_SESSION_REQUIRED");
  }

  const login = await requestHttps(port, "/login", {
    method: "POST",
    body: { usuario: "admin", contrasena: "correcta", versionCliente: "3.0.0" },
  });
  assert.equal(login.statusCode, 200);
  const sessionId = login.body.sessionId;

  const allProducts = await requestHttps(port, "/products", { sessionId });
  assert.equal(allProducts.statusCode, 200);
  assert.deepEqual(allProducts.body[0], {
    id: "product-1",
    code: "ANI-001",
    name: "Anillo Oro",
    category: "Anillos",
    reference: "REF-ANI-001",
    description: "Anillo de prueba",
    weightGrams: 4.5,
    availableGrams: 13.5,
    salePrice: 950000,
    stock: 3,
    minStock: 1,
    status: "available",
  });
  assert.equal(allProducts.body[1].status, "out_of_stock");
  assert.equal(JSON.stringify(allProducts.body).includes("purchasePrice"), false);
  assert.equal(JSON.stringify(allProducts.body).includes("supplier-secret"), false);
  assert.equal(JSON.stringify(allProducts.body).includes("NO_DEBE_SALIR"), false);

  const oneProduct = await requestHttps(port, "/products/product-1", { sessionId });
  assert.equal(oneProduct.statusCode, 200);
  assert.equal(oneProduct.body.id, "product-1");

  const search = await requestHttps(port, "/products/search?q=oro", { sessionId });
  assert.equal(search.statusCode, 200);
  assert.deepEqual(search.body.map(product => product.id), ["product-1"]);

  const allInventory = await requestHttps(port, "/inventory", { sessionId });
  assert.equal(allInventory.statusCode, 200);
  assert.deepEqual(allInventory.body[0], {
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
  });
  assert.equal(JSON.stringify(allInventory.body).includes("totalCost"), false);
  assert.equal(JSON.stringify(allInventory.body).includes("activityLog"), false);
  assert.equal(JSON.stringify(allInventory.body).includes("NO_DEBE_SALIR"), false);

  const oneInventory = await requestHttps(port, "/inventory/product-1", { sessionId });
  assert.equal(oneInventory.statusCode, 200);
  assert.equal(oneInventory.body.location, "Vitrina A");

  const missingProduct = await requestHttps(port, "/products/missing", { sessionId });
  assert.equal(missingProduct.statusCode, 404);
  assert.equal(missingProduct.body.error, "HTTPS_PRODUCT_NOT_FOUND");
  const missingInventory = await requestHttps(port, "/inventory/missing", { sessionId });
  assert.equal(missingInventory.statusCode, 404);
  assert.equal(missingInventory.body.error, "HTTPS_INVENTORY_NOT_FOUND");

  for (const pathname of ["/products", "/inventory"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const forbidden = await requestHttps(port, pathname, { method, sessionId, body: {} });
      assert.equal(forbidden.statusCode, 404);
    }
  }

  assert.equal(repositoryCalls, 0);
  assert.deepEqual(readCalls.map(call => call.resource), [
    "permissions",
    "products",
    "product",
    "productsSearch",
    "inventory",
    "inventoryItem",
    "product",
    "inventoryItem",
  ]);
});
