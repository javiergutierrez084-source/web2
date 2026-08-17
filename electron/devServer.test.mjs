import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { resolveDevServerUrl, waitForDevServer } from './devServer.js';

test('normaliza localhost a IPv4 explícito', () => {
  assert.equal(resolveDevServerUrl('http://localhost:5173'), 'http://127.0.0.1:5173/');
});

test('espera una respuesta HTTP real antes de continuar', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body>Vite ready</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const url = await waitForDevServer(`http://localhost:${address.port}`, { timeoutMs: 2_000 });
    assert.equal(url, `http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('scripts de desarrollo usan la misma dirección IPv4 y una comprobación GET', async () => {
  const { readFile } = await import('node:fs/promises');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.dev, /--host 127\.0\.0\.1/);
  assert.match(packageJson.scripts.dev, /--port 5173/);
  assert.match(packageJson.scripts.dev, /--strictPort/);
  assert.match(packageJson.scripts.electron, /http-get:\/\/127\.0\.0\.1:5173\//);
  assert.doesNotMatch(packageJson.scripts.electron, /localhost/);
});

test('Vite y Electron comparten host y puerto de desarrollo', async () => {
  const { readFile } = await import('node:fs/promises');
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const electronMain = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(viteConfig, /host:\s*["']127\.0\.0\.1["']/);
  assert.match(viteConfig, /port:\s*5173/);
  assert.match(electronMain, /resolveDevServerUrl/);
  assert.doesNotMatch(electronMain, /http:\/\/localhost:5173/);
});

test('el router usa BrowserRouter en HTTP y HashRouter en file', async () => {
  const { readFile } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /window\.location\.protocol\s*===\s*["']file:["']/);
  assert.match(appSource, /return\s*<HashRouter>/);
  assert.match(appSource, /return\s*<BrowserRouter>/);
});
