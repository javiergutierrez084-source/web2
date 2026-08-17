import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la página profesional muestra la tarjeta BACKUP AUTOMÁTICO inmediatamente debajo del encabezado', async () => {
  const source = await read('src/pages/BackupRestore.tsx');
  assert.match(source, /Copias de Seguridad Profesionales[\s\S]*?<BackupStatusIndicator variant="backup-page" \/>/);
  assert.match(source, /const schedulerArmed = Boolean\(settings\?\.backupEnabled\) && BackupScheduler\.isArmed\(\)/);
  assert.match(source, /schedulerArmed \? 'Respaldo automático activo'/);
  assert.doesNotMatch(source, /Respaldo automático activo' : 'Respaldo automático deshabilitado'/);
});

test('la tarjeta incorpora interruptor grande, estado real y contador de próxima ejecución', async () => {
  const source = await read('src/components/BackupStatusIndicator.tsx');
  assert.match(source, /'backup-page'/);
  assert.match(source, /BACKUP AUTOMÁTICO/);
  assert.match(source, /<Switch/);
  assert.match(source, /scale-125/);
  assert.match(source, /const schedulerRunning = automaticEnabled && schedulerArmed/);
  assert.match(source, /Programador detenido/);
  assert.match(source, /Próxima ejecución/);
  assert.match(source, /Última ejecución/);
  assert.match(source, /bg-emerald-500/);
  assert.match(source, /bg-red-500/);
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1_000\)/);
});

test('el interruptor controla la única instancia existente de BackupScheduler', async () => {
  const indicator = await read('src/components/BackupStatusIndicator.tsx');
  const scheduler = await read('src/lib/BackupScheduler.ts');
  assert.match(indicator, /await BackupScheduler\.onSettingsChanged\(\)/);
  assert.match(scheduler, /private timerId: ReturnType<typeof setInterval> \| null = null/);
  assert.match(scheduler, /private armTimer\(\): void \{\s*this\.disarmTimer\(\)/);
  assert.match(scheduler, /private disarmTimer\(\): void/);
  assert.match(scheduler, /PROFESSIONAL_BACKUP_INTERVAL_MS/);
});
