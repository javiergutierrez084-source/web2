import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('Electron coordina el cierre sin iniciar una copia nueva', async () => {
  const main = await read('electron/main.js');
  const bridge = await read('src/components/BackupAutomationBridge.tsx');
  assert.match(main, /mainWindow\.on\("close", event =>/);
  assert.match(main, /void beginApplicationClose\(\)/);
  assert.match(main, /app\.on\("before-quit", event =>/);
  assert.match(main, /await requestRendererBackupBeforeQuit\(\)/);
  assert.match(main, /await Promise\.allSettled\(\[stopLanServer\(\), stopHttpsServer\(\)\]\)/);
  assert.doesNotMatch(bridge, /createAutomaticBackup\('app-close'\)/);
});

test('preload expone el progreso y una sola respuesta del handshake de cierre', async () => {
  const preload = await read('electron/preload.cjs');
  for (const method of ['selectFolder', 'setFolder', 'getStatus', 'validateFolder', 'writeBackup', 'openFolder', 'onBeforeQuit']) {
    assert.match(preload, new RegExp(`${method}:`));
  }
  assert.match(preload, /backup:before-quit-progress/);
  assert.match(preload, /backup:before-quit-response/);
  assert.doesNotMatch(preload, /joyaControlBackup[\s\S]*?(createSale|updateProduct|syncRepository)/);
});

test('la automatización permanece restringida al Servidor Principal y el cierre solo espera operaciones activas', async () => {
  const app = await read('src/App.tsx');
  const bridge = await read('src/components/BackupAutomationBridge.tsx');
  const scheduler = await read('src/lib/BackupScheduler.ts');
  assert.match(app, /<BackupAutomationBridge \/>/);
  assert.match(bridge, /effectiveMode !== 'server'/);
  assert.match(bridge, /ProfessionalBackupService\.getStatus\(\)/);
  assert.match(bridge, /!status\.running && status\.queued === 0/);
  assert.match(bridge, /waitForActiveBackupToFinish/);
  assert.match(bridge, /createAutomaticBackup\('cash-close'\)/);
  assert.match(bridge, /previousCashClosures\.current\.has\(session\.id\)/);
  assert.doesNotMatch(bridge, /createAutomaticBackup\('app-close'\)/);
  assert.match(scheduler, /15 \* 60 \* 1000|PROFESSIONAL_BACKUP_INTERVAL_MS/);
  assert.match(scheduler, /getEffectiveWorkMode\(\) !== 'server'/);
});

test('Activity Log conserva los cinco eventos exigidos sin implementar un log paralelo', async () => {
  const service = await read('src/lib/ProfessionalBackupService.ts');
  for (const action of [
    'BACKUP_INTERNAL_COMPLETED',
    'BACKUP_EXTERNAL_COMPLETED',
    'BACKUP_EXTERNAL_FAILED',
    'BACKUP_PATH_CHANGED',
    'BACKUP_RESTORE_COMPLETED',
  ]) {
    assert.match(service, new RegExp(action));
  }
  assert.match(service, /import \{ getSession, logActivity \} from '@\/lib\/auth'/);
});
