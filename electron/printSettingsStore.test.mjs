import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PRINT_DOCUMENT_TYPES,
  PrintSettingsStore,
  createDefaultPrintSettings,
} from './printSettingsStore.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joya-print-v3-'));
  return { dir, file: path.join(dir, 'print-settings.json') };
}

test('print-settings.json contiene solamente los ocho tipos y seis campos por tipo', () => {
  const { dir, file } = tempFile();
  try {
    const store = new PrintSettingsStore({ storagePath: file });
    store.load();
    store.save();
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(payload), [...PRINT_DOCUMENT_TYPES]);
    for (const documentType of PRINT_DOCUMENT_TYPES) {
      assert.deepEqual(
        Object.keys(payload[documentType]).sort(),
        ['copies', 'orientation', 'paper', 'printerName', 'scale', 'silent'].sort(),
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asigna automáticamente la impresora predeterminada sin crear historial ni cola', () => {
  const { dir, file } = tempFile();
  try {
    const store = new PrintSettingsStore({ storagePath: file });
    store.load();
    store.assignDefaultPrinter([
      { name: 'Impresora secundaria', isDefault: false },
      { name: 'Impresora principal', isDefault: true },
    ]);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const documentType of PRINT_DOCUMENT_TYPES) {
      assert.equal(payload[documentType].printerName, 'Impresora principal');
    }
    assert.equal('jobs' in payload, false);
    assert.equal('history' in payload, false);
    assert.equal('queue' in payload, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normaliza copias, escala y orientación al guardar', () => {
  const { dir, file } = tempFile();
  try {
    const store = new PrintSettingsStore({ storagePath: file });
    const settings = createDefaultPrintSettings();
    settings.PDF = {
      printerName: '  Microsoft Print to PDF  ',
      orientation: 'landscape',
      copies: 300,
      paper: 'A4',
      scale: 500,
      silent: false,
    };
    const saved = store.save(settings);
    assert.equal(saved.PDF.printerName, 'Microsoft Print to PDF');
    assert.equal(saved.PDF.orientation, 'landscape');
    assert.equal(saved.PDF.copies, 99);
    assert.equal(saved.PDF.scale, 200);
    assert.equal(saved.PDF.paper, 'A4');
    assert.equal(saved.PDF.silent, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resuelve la impresora configurada ignorando mayúsculas y minúsculas', () => {
  const { dir, file } = tempFile();
  try {
    const store = new PrintSettingsStore({ storagePath: file });
    const settings = createDefaultPrintSettings();
    settings.Reporte.printerName = 'impresora reportes';
    store.save(settings);
    const resolved = store.resolvePrinter('Reporte', [
      { name: 'IMPRESORA REPORTES', displayName: 'Impresora Reportes' },
    ]);
    assert.equal(resolved?.name, 'IMPRESORA REPORTES');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
