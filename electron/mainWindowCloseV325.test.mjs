import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relativePath => fs.readFile(path.join(root, relativePath), 'utf8');

test('v3.2.5 X y Alt+F4 comparten el evento close y no recursan app.quit', async () => {
  const main = await read('electron/main.js');
  assert.match(main, /mainWindow\.on\("close", event => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?beginApplicationClose\(\)/);
  assert.match(main, /if \(process\.platform === "darwin" \|\| allowWindowClose\) return/);
  const closeHandler = main.match(/mainWindow\.on\("close", event => \{[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.doesNotMatch(closeHandler, /app\.quit\(\)/);
});

test('v3.2.5 Salir del menú usa el mismo coordinador mediante before-quit', async () => {
  const main = await read('electron/main.js');
  assert.match(main, /app\.on\("before-quit", event => \{[\s\S]*?if \(allowAppQuit\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?beginApplicationClose\(\)/);
});

test('sin respaldo activo el renderer autoriza el cierre sin crear otro respaldo', async () => {
  const bridge = await read('src/components/BackupAutomationBridge.tsx');
  assert.match(bridge, /if \(!status\.running && status\.queued === 0\) \{[\s\S]*?completed: true, waitedForBackup: false/);
  assert.doesNotMatch(bridge, /createAutomaticBackup\('app-close'\)/);
});

test('respaldo manual o automático activo mantiene la ventana abierta hasta quedar ocioso', async () => {
  const bridge = await read('src/components/BackupAutomationBridge.tsx');
  assert.match(bridge, /status\.running/);
  assert.match(bridge, /status\.queued/);
  assert.match(bridge, /waitForActiveBackupToFinish\(reportProgress\)/);
  assert.match(bridge, /PROFESSIONAL_BACKUP_STATUS_EVENT/);
  assert.match(bridge, /window\.setInterval/);
  assert.match(bridge, /window\.clearInterval\(pollTimer\)/);
  assert.match(bridge, /waitedForBackup: true/);
});

test('la espera es visible, explica el respaldo y anuncia el cierre automático', async () => {
  const main = await read('electron/main.js');
  assert.match(main, /Guardando copia de seguridad\.\.\./);
  assert.match(main, /JoyaControl está terminando una copia de seguridad para proteger la información antes de cerrar\./);
  assert.match(main, /No cierre el programa ni apague el computador\./);
  assert.match(main, /Finalizando respaldo\.\.\./);
  assert.match(main, /se cerrará automáticamente/);
  assert.match(main, /new BrowserWindow\(\{[\s\S]*?frame: false[\s\S]*?closable: false/);
});

test('cambios sin guardar muestran Salir y Cancelar antes de consultar el backup', async () => {
  const main = await read('electron/main.js');
  assert.match(main, /rendererHasUnsavedChanges/);
  assert.match(main, /confirmUnsavedChangesBeforeClose/);
  assert.match(main, /if \(!await confirmUnsavedChangesBeforeClose\(\)\)[\s\S]*?requestRendererBackupBeforeQuit\(\)/);
  assert.match(main, /will-prevent-unload/);
  assert.match(main, /message: "Existen cambios sin guardar\."/);
  assert.match(main, /buttons: \["Salir", "Cancelar"\]/);
  assert.match(main, /cancelId: 1/);
  assert.match(main, /if \(choice\.response !== 0\) return false/);
  assert.match(main, /allowUnsavedUnload = true/);
  assert.match(main, /if \(choice === 0\) \{[\s\S]*?event\.preventDefault\(\)/);
  assert.match(main, /resetCloseFlow\(\)/);
});

test('el cierre evita solicitudes, watchdogs y apagados duplicados', async () => {
  const main = await read('electron/main.js');
  assert.match(main, /if \(allowAppQuit \|\| closeFlowInProgress\) return/);
  assert.match(main, /if \(shutdownPromise\) return shutdownPromise/);
  assert.match(main, /clearTimeout\(pending\.timer\)/);
  assert.match(main, /pendingBackupQuitRequests\.delete\(requestId\)/);
  assert.match(main, /CLOSE_PREPARATION_WATCHDOG_MS = 15_000/);
});

test('la reparación no cambia servicios de repositorio, LAN, HTTPS ni backups', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.version, '3.2.5');
  const main = await read('electron/main.js');
  assert.match(main, /registerLanIpcHandlers\(\)/);
  assert.match(main, /registerHttpsClientIpcHandlers\(\)/);
  assert.match(main, /registerBackupIpcHandlers\(\)/);
});
