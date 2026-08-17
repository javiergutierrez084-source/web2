import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startLanServer, stopLanServer } from './lanServer.js';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function post(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('impresión LAN usa exclusivamente POST /repository/call y conserva contexto de cliente y usuario', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'joya-print-route-'));
  const port = await freePort();
  const calls = [];
  try {
    await startLanServer({
      host: '127.0.0.1',
      port,
      serverName: 'Servidor de prueba',
      userDataPath,
      version: '2.1',
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
        if (method === 'getPrintSettings') {
          return { documentTypes: ['PDF'], settings: {}, printers: [] };
        }
        return {
          success: true,
          documentType: args.input.documentType,
          printerName: 'Printer A',
          clientId: context.clientId,
          userId: context.userId,
          printedAt: new Date().toISOString(),
        };
      },
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const registration = await post(baseUrl, '/client/register', {
      name: 'Cliente 1',
      hostname: 'cliente-1',
      version: '2.1',
      localTime: new Date().toISOString(),
      deviceInstanceId: 'device-1',
    });
    assert.equal(registration.response.status, 201);
    const login = await post(baseUrl, '/login', {
      username: 'master',
      password: 'secret',
      clientId: registration.payload.clientId,
      sessionToken: registration.payload.sessionToken,
    });
    assert.equal(login.response.status, 200);
    const auth = {
      clientId: registration.payload.clientId,
      sessionToken: registration.payload.sessionToken,
      authToken: login.payload.authToken,
    };

    const printCalls = await Promise.all(Array.from({ length: 20 }, (_, index) => post(baseUrl, '/repository/call', {
      ...auth,
      method: 'printDocument',
      args: {
        input: {
          documentType: 'PDF',
          content: { kind: 'html', data: `<p>${index}</p>` },
        },
      },
    })));
    assert.equal(printCalls.every(item => item.response.status === 200), true);
    assert.equal(calls.filter(call => call.method === 'printDocument').length, 20);
    assert.equal(calls.every(call => call.context.clientId === registration.payload.clientId), true);
    assert.equal(calls.every(call => call.context.userId === 'user-1'), true);

    const settings = await post(baseUrl, '/repository/call', {
      ...auth,
      method: 'getPrintSettings',
      args: {},
    });
    assert.equal(settings.response.status, 200);
    assert.equal(calls.at(-1).method, 'getPrintSettings');

    const forbidden = await post(baseUrl, '/print', { anything: true });
    assert.equal(forbidden.response.status, 404);
  } finally {
    await stopLanServer();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
