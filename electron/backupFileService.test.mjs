import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  BACKUP_ROOT_DIRECTORY,
  BackupFileService,
  enforceAutomaticRetention,
  sha256Buffer,
} from './backupFileService.js';

async function tempWorkspace(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `joyacontrol-${label}-`));
  const userDataPath = path.join(root, 'user data');
  const destination = path.join(root, 'OneDrive - Copias JoyaControl');
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  return { root, userDataPath, destination };
}

function backupContent(createdAt = '2026-07-29T19:30:00.000Z') {
  return JSON.stringify({
    version: 6,
    databaseVersion: 6,
    createdAt,
    checksum: 'internal-envelope-checksum',
    metadata: { recordCount: 3 },
    data: { appName: 'JoyaControl', version: 6, createdAt, tables: { products: [{ id: 'p1' }] } },
  }, null, 2);
}

test('crea estructura profesional, escribe de forma verificable y conserva estado', async t => {
  const workspace = await tempWorkspace('write');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);

  const content = backupContent();
  const result = await service.writeBackup({
    category: 'AUTO',
    createdAt: '2026-07-29T19:30:00.000Z',
    content,
    expectedSha256: sha256Buffer(Buffer.from(content, 'utf8')),
  });

  assert.equal(result.ok, true);
  assert.match(result.fileName, /^joyacontrol_auto_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jcb$/);
  assert.equal(result.size > 0, true);
  assert.equal(result.checksum, sha256Buffer(Buffer.from(content, 'utf8')));
  assert.equal(await fs.readFile(result.filePath, 'utf8'), content);
  assert.equal(JSON.parse(await fs.readFile(result.filePath, 'utf8')).data.appName, 'JoyaControl');

  const expectedRoot = path.join(workspace.destination, BACKUP_ROOT_DIRECTORY);
  for (const directory of ['AUTO', 'MANUAL', 'RESTORE POINTS']) {
    assert.equal((await fs.stat(path.join(expectedRoot, directory))).isDirectory(), true);
  }
  const status = service.getStatus();
  assert.equal(status.configuredFolder, workspace.destination);
  assert.equal(status.external.status, 'success');
  assert.equal(status.external.lastFilePath, result.filePath);
  assert.equal(status.external.lastSize, result.size);
});

test('retención AUTO aplica 30 días o 100 archivos y nunca elimina MANUAL', async t => {
  const workspace = await tempWorkspace('retention');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const rootPath = path.join(workspace.destination, BACKUP_ROOT_DIRECTORY);
  const autoPath = path.join(rootPath, 'AUTO');
  const manualPath = path.join(rootPath, 'MANUAL');
  await fs.mkdir(autoPath, { recursive: true });
  await fs.mkdir(manualPath, { recursive: true });

  const now = Date.parse('2026-07-29T20:00:00.000Z');
  for (let index = 0; index < 105; index += 1) {
    const filePath = path.join(autoPath, `joyacontrol_auto_recent_${String(index).padStart(3, '0')}.jcb`);
    await fs.writeFile(filePath, '{}');
    const timestamp = new Date(now - index * 60_000);
    await fs.utimes(filePath, timestamp, timestamp);
  }
  const oldAuto = path.join(autoPath, 'joyacontrol_auto_old.jcb');
  await fs.writeFile(oldAuto, '{}');
  const oldTimestamp = new Date(now - 31 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldAuto, oldTimestamp, oldTimestamp);

  const manualFile = path.join(manualPath, 'joyacontrol_manual_2020-01-01_00-00-00.jcb');
  await fs.writeFile(manualFile, '{}');
  await fs.utimes(manualFile, oldTimestamp, oldTimestamp);

  const result = await enforceAutomaticRetention(autoPath, now);
  const remainingAuto = (await fs.readdir(autoPath)).filter(name => name.endsWith('.jcb'));
  assert.equal(remainingAuto.length, 100);
  assert.equal(result.deleted.length, 6);
  assert.equal(await fs.readFile(manualFile, 'utf8'), '{}');
});

test('rechaza checksum incorrecto y persiste un estado de error legible', async t => {
  const workspace = await tempWorkspace('checksum');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);

  await assert.rejects(
    service.writeBackup({
      category: 'AUTO',
      createdAt: new Date().toISOString(),
      content: backupContent(),
      expectedSha256: crypto.randomBytes(32).toString('hex'),
    }),
    /checksum SHA-256 previo/i,
  );
  assert.equal(service.getStatus().external.status, 'error');
  assert.match(service.getStatus().external.lastError, /checksum/i);
});

test('si la carpeta desaparece, informa ruta no encontrada y permite reemplazarla', async t => {
  const workspace = await tempWorkspace('missing');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const replacement = path.join(workspace.root, 'USB BACKUPS');
  await fs.mkdir(replacement, { recursive: true });

  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);
  await fs.rm(workspace.destination, { recursive: true, force: true });

  await assert.rejects(
    service.writeBackup({
      category: 'AUTO',
      createdAt: new Date().toISOString(),
      content: backupContent(),
      expectedSha256: sha256Buffer(Buffer.from(backupContent(), 'utf8')),
    }),
    error => error?.code === 'BACKUP_PATH_NOT_FOUND' && /Ruta no encontrada/i.test(error.message),
  );

  await service.setConfiguredFolder(replacement);
  assert.equal(service.getStatus().configuredFolder, replacement);
  assert.equal(service.getStatus().external.status, 'ready');
});

test('MANUAL y RESTORE POINTS usan carpetas separadas y no participan en retención AUTO', async t => {
  const workspace = await tempWorkspace('categories');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);
  const content = backupContent();
  const expectedSha256 = sha256Buffer(Buffer.from(content, 'utf8'));

  const manual = await service.writeBackup({ category: 'MANUAL', createdAt: new Date().toISOString(), content, expectedSha256 });
  const restore = await service.writeBackup({ category: 'RESTORE_POINTS', createdAt: new Date().toISOString(), content, expectedSha256 });
  assert.equal(path.basename(path.dirname(manual.filePath)), 'MANUAL');
  assert.equal(path.basename(path.dirname(restore.filePath)), 'RESTORE POINTS');
  assert.equal((await fs.stat(manual.filePath)).isFile(), true);
  assert.equal((await fs.stat(restore.filePath)).isFile(), true);
});

test('dos copias creadas en el mismo segundo reciben nombres únicos sin sobrescritura', async t => {
  const workspace = await tempWorkspace('collision');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);
  const content = backupContent();
  const expectedSha256 = sha256Buffer(Buffer.from(content, 'utf8'));
  const createdAt = '2026-07-29T20:00:00.000Z';

  const first = await service.writeBackup({ category: 'AUTO', createdAt, content, expectedSha256 });
  const second = await service.writeBackup({ category: 'AUTO', createdAt, content, expectedSha256 });
  assert.notEqual(first.filePath, second.filePath);
  assert.equal((await fs.stat(first.filePath)).isFile(), true);
  assert.equal((await fs.stat(second.filePath)).isFile(), true);
});

test('la carpeta configurada permanece después de reiniciar Electron', async t => {
  const workspace = await tempWorkspace('restart');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const firstInstance = new BackupFileService({ userDataPath: workspace.userDataPath });
  await firstInstance.initialize();
  await firstInstance.setConfiguredFolder(workspace.destination);

  const restartedInstance = new BackupFileService({ userDataPath: workspace.userDataPath });
  await restartedInstance.initialize();
  assert.equal(restartedInstance.getStatus().configuredFolder, workspace.destination);
  assert.equal(restartedInstance.getStatus().rootPath, path.join(workspace.destination, BACKUP_ROOT_DIRECTORY));
});

test('un archivo JSON corrupto se rechaza y nunca queda marcado como backup correcto', async t => {
  const workspace = await tempWorkspace('corrupt');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);
  const content = '{"data":';

  await assert.rejects(
    service.writeBackup({
      category: 'AUTO',
      createdAt: new Date().toISOString(),
      content,
      expectedSha256: sha256Buffer(Buffer.from(content, 'utf8')),
    }),
    /JSON|Unexpected|position|end/i,
  );
  assert.equal(service.getStatus().external.status, 'error');
  const autoFiles = await fs.readdir(path.join(workspace.destination, BACKUP_ROOT_DIRECTORY, 'AUTO'));
  assert.equal(autoFiles.some(name => name.endsWith('.jcb')), false);
});

test('permite cambiar la carpeta repetidamente sin borrar respaldos anteriores', async t => {
  const workspace = await tempWorkspace('replace-many');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const secondDestination = path.join(workspace.root, 'Segundo destino externo');
  const thirdDestination = path.join(workspace.root, 'Tercer destino externo');
  await fs.mkdir(secondDestination, { recursive: true });
  await fs.mkdir(thirdDestination, { recursive: true });

  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);

  const content = backupContent();
  const expectedSha256 = sha256Buffer(Buffer.from(content, 'utf8'));
  const first = await service.writeBackup({
    category: 'AUTO',
    createdAt: '2026-07-30T20:00:00.000Z',
    content,
    expectedSha256,
  });

  await service.setConfiguredFolder(secondDestination);
  await service.setConfiguredFolder(thirdDestination);
  const third = await service.writeBackup({
    category: 'AUTO',
    createdAt: '2026-07-30T20:01:00.000Z',
    content,
    expectedSha256,
  });

  assert.equal(service.getStatus().configuredFolder, thirdDestination);
  assert.equal((await fs.stat(first.filePath)).isFile(), true);
  assert.equal(third.filePath.startsWith(path.join(thirdDestination, BACKUP_ROOT_DIRECTORY)), true);
  const oldFiles = await fs.readdir(path.join(workspace.destination, BACKUP_ROOT_DIRECTORY, 'AUTO'));
  assert.equal(oldFiles.length, 1);
});

test('una carpeta nueva inválida no reemplaza la ruta persistida anterior', async t => {
  const workspace = await tempWorkspace('reject-replacement');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const invalidDestination = path.join(workspace.root, 'carpeta inexistente');

  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();
  await service.setConfiguredFolder(workspace.destination);

  await assert.rejects(
    service.setConfiguredFolder(invalidDestination),
    error => error?.code === 'BACKUP_PATH_NOT_FOUND',
  );
  assert.equal(service.getStatus().configuredFolder, workspace.destination);

  const restarted = new BackupFileService({ userDataPath: workspace.userDataPath });
  await restarted.initialize();
  assert.equal(restarted.getStatus().configuredFolder, workspace.destination);
});

test('la validación comprueba escritura real y elimina el archivo temporal de prueba', async t => {
  const workspace = await tempWorkspace('write-probe');
  t.after(() => fs.rm(workspace.root, { recursive: true, force: true }));
  const service = new BackupFileService({ userDataPath: workspace.userDataPath });
  await service.initialize();

  const validation = await service.validateFolder(workspace.destination);
  assert.equal(validation.ok, true);
  const entries = await fs.readdir(workspace.destination);
  assert.equal(entries.some(name => name.startsWith('.joyacontrol-write-probe-')), false);
  assert.equal(service.getStatus().configuredFolder, '');
});
