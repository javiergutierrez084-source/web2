import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startLanServer, stopLanServer } from './lanServer.js';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('Print Agent usa exclusivamente POST /repository/call con sesión autenticada', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'joyacontrol-print-lan-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const calls = [];
  try {
    await startLanServer({
      host: '127.0.0.1',
      port,
      serverName: 'Print Test',
      userDataPath: directory,
      authenticateUser: async () => ({
        success: true,
        userId: 'user-1',
        username: 'master',
        displayName: 'Master',
        role: 'master',
        permissions: [],
      }),
      executeRepositoryCall: async (method, args, context) => {
        calls.push({ method, args, context });
        return {
          requestId: args.input.requestId,
          documentId: args.input.documentId,
          documentType: args.input.documentType,
          printer: '',
          paperSize: 'Letter',
          orientation: 'portrait',
          copies: 1,
          silent: true,
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
          status: 'PENDING',
          attempts: 0,
          failureReason: null,
          clientId: context.clientId,
          userId: context.userId,
        };
      },
    });

    const registration = await post(baseUrl, '/client/register', {
      name: 'Cliente Print',
      hostname: 'client-print',
      deviceInstanceId: 'device-print-1',
      version: '2.1',
      localTime: new Date().toISOString(),
    });
    assert.equal(registration.response.status, 201);

    const login = await post(baseUrl, '/login', {
      username: 'master',
      password: 'test',
      clientId: registration.payload.clientId,
      sessionToken: registration.payload.sessionToken,
    });
    assert.equal(login.response.status, 200);

    const result = await post(baseUrl, '/repository/call', {
      method: 'submitPrintJob',
      args: {
        input: {
          requestId: 'route-request-1',
          documentId: 'invoice-1',
          documentType: 'invoice',
          content: { kind: 'html', data: '<html><body>Factura</body></html>' },
        },
      },
      clientId: registration.payload.clientId,
      sessionToken: registration.payload.sessionToken,
      authToken: login.payload.authToken,
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.payload.success, true);
    assert.equal(result.payload.data.requestId, 'route-request-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'submitPrintJob');
    assert.equal(calls[0].context.clientId, registration.payload.clientId);
    assert.equal(calls[0].context.userId, 'user-1');

    const forbiddenParallelRoute = await post(baseUrl, '/print/jobs', {});
    assert.equal(forbiddenParallelRoute.response.status, 404);
  } finally {
    await stopLanServer().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
