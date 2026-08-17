import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = relative => fs.readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('cada pulsación abre el selector y solo valida la carpeta candidata', async () => {
  const main = await read('electron/main.js');
  const handler = main.match(/ipcMain\.handle\("backup:select-folder"[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(handler, /dialog\.showOpenDialog/);
  assert.match(handler, /properties: \["openDirectory", "createDirectory"\]/);
  assert.match(handler, /service\.validateFolder\(folderPath\)/);
  assert.doesNotMatch(handler, /service\.setConfiguredFolder/);
  assert.doesNotMatch(handler, /defaultPath/);
});

test('la ruta se reemplaza sin reescribir otras preferencias y el evento incluye ruta anterior y nueva', async () => {
  const service = await read('src/lib/ProfessionalBackupService.ts');
  const method = service.match(/async selectExternalFolder\(\): Promise<string \| null> \{[\s\S]*?\n  \}\n\n  async openExternalFolder/)?.[0] || '';
  assert.match(method, /backupFolder: nextPath/);
  assert.match(method, /BackupManager\.saveSettings\(nextSettings\)/);
  assert.match(method, /await bridge\.setFolder\(nextPath\)/);
  assert.match(method, /BACKUP_PATH_CHANGED/);
  assert.match(method, /previousPath: previousPath \|\| null/);
  assert.match(method, /newPath: nextPath/);
  assert.doesNotMatch(method, /current\.backupEnabled/);
  assert.doesNotMatch(method, /BackupScheduler/);
});

test('la interfaz refresca y muestra ruta actual, última selección y próxima copia', async () => {
  const page = await read('src/pages/BackupRestore.tsx');
  assert.match(page, /await refreshStatus\(\)/);
  assert.match(page, /Ruta actual:/);
  assert.match(page, /Última carpeta seleccionada:/);
  assert.match(page, /Próxima copia:/);
  assert.match(page, /handleOpenExternalFolder/);
});
