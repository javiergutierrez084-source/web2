import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la ventana de nueva venta comparte un cierre seguro para X, Cancelar y Escape', async () => {
  const source = await read('src/pages/NewInvoice.tsx');
  assert.match(source, /const requestCloseSale = useCallback/);
  assert.match(source, /Hay cambios sin guardar en la venta/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /beforeunload/);
  assert.match(source, /aria-label="Cerrar venta"/);
  assert.match(source, /variant="outline" onClick=\{requestCloseSale\}>Cancelar/);
  assert.match(source, /onClick=\{requestCloseNewClient\}/);
});

test('el estado OFF persistido no es forzado nuevamente a ON', async () => {
  const source = await read('src/lib/ProfessionalBackupService.ts');
  assert.match(source, /backupEnabled: current\.backupEnabled !== false/);
  assert.doesNotMatch(source, /backupEnabled: true,\s*backupInterval: '15m'/);
});

test('el programador pausa solo el temporizador y evita instancias duplicadas', async () => {
  const source = await read('src/lib/BackupScheduler.ts');
  assert.match(source, /if \(settings\.backupEnabled\) this\.armTimer\(\);\s*else this\.disarmTimer\(\);/);
  assert.match(source, /private disarmTimer\(\): void/);
  assert.match(source, /private armTimer\(\): void \{\s*this\.disarmTimer\(\);/);
  assert.match(source, /PROFESSIONAL_BACKUP_INTERVAL_MS/);
});

test('la configuración expone ON OFF y registra únicamente las acciones solicitadas', async () => {
  const source = await read('src/components/BackupStatusIndicator.tsx');
  assert.match(source, /BACKUP_AUTOMATIC_ENABLED/);
  assert.match(source, /BACKUP_AUTOMATIC_DISABLED/);
  assert.match(source, /backupInterval: '15m'/);
  assert.match(source, /Desactivado por el usuario/);
  assert.match(source, /<Switch/);
});
