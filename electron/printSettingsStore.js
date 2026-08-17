import fs from 'node:fs';
import path from 'node:path';

export const PRINT_DOCUMENT_TYPES = Object.freeze([
  'Facturas Carta',
  'Factura Térmica 80',
  'Factura Térmica 58',
  'Cotización',
  'Reporte',
  'Etiqueta',
  'Código de barras',
  'PDF',
]);

const DEFAULT_BY_TYPE = Object.freeze({
  'Facturas Carta': { paper: 'Carta', orientation: 'portrait' },
  'Factura Térmica 80': { paper: 'Térmica 80 mm', orientation: 'portrait' },
  'Factura Térmica 58': { paper: 'Térmica 58 mm', orientation: 'portrait' },
  'Cotización': { paper: 'Carta', orientation: 'portrait' },
  'Reporte': { paper: 'Carta', orientation: 'portrait' },
  'Etiqueta': { paper: 'Etiqueta', orientation: 'portrait' },
  'Código de barras': { paper: 'Etiqueta', orientation: 'portrait' },
  'PDF': { paper: 'Carta', orientation: 'portrait' },
});

function normalizePrinterName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

export function normalizePrinter(printer) {
  const name = String(printer?.name || printer?.displayName || '').trim();
  return {
    name,
    displayName: String(printer?.displayName || name).trim(),
    description: String(printer?.description || '').trim(),
    status: Number.isFinite(printer?.status) ? printer.status : undefined,
    isDefault: Boolean(printer?.isDefault),
  };
}

export function sanitizeTypeSettings(documentType, input = {}) {
  const defaults = DEFAULT_BY_TYPE[documentType] || DEFAULT_BY_TYPE.PDF;
  const orientation = input.orientation === 'landscape' ? 'landscape' : defaults.orientation;
  const copies = Math.max(1, Math.min(99, Math.trunc(Number(input.copies) || 1)));
  const scale = Math.max(10, Math.min(200, Math.trunc(Number(input.scale) || 100)));
  return {
    printerName: String(input.printerName || '').trim(),
    orientation,
    copies,
    paper: String(input.paper || defaults.paper).trim() || defaults.paper,
    scale,
    silent: input.silent !== false,
  };
}

export function createDefaultPrintSettings() {
  return Object.fromEntries(
    PRINT_DOCUMENT_TYPES.map(documentType => [documentType, sanitizeTypeSettings(documentType)]),
  );
}

export class PrintSettingsStore {
  constructor({ storagePath }) {
    if (!storagePath) throw new Error('PRINT_SETTINGS_PATH_REQUIRED');
    this.storagePath = storagePath;
    this.settings = createDefaultPrintSettings();
  }

  load() {
    let persisted = {};
    try {
      persisted = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch {}
    this.settings = Object.fromEntries(
      PRINT_DOCUMENT_TYPES.map(documentType => [
        documentType,
        sanitizeTypeSettings(documentType, persisted?.[documentType]),
      ]),
    );
    return this.toJSON();
  }

  save(input = this.settings) {
    this.settings = Object.fromEntries(
      PRINT_DOCUMENT_TYPES.map(documentType => [
        documentType,
        sanitizeTypeSettings(documentType, input?.[documentType]),
      ]),
    );
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const temporary = `${this.storagePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(temporary, this.storagePath);
    return this.toJSON();
  }

  assignDefaultPrinter(printers = []) {
    const normalized = printers.map(normalizePrinter).filter(printer => printer.name);
    const selected = normalized.find(printer => printer.isDefault) || normalized[0];
    if (!selected) return this.toJSON();
    let changed = false;
    for (const documentType of PRINT_DOCUMENT_TYPES) {
      if (!this.settings[documentType].printerName) {
        this.settings[documentType].printerName = selected.name;
        changed = true;
      }
    }
    if (changed) return this.save(this.settings);
    return this.toJSON();
  }

  get(documentType) {
    if (!PRINT_DOCUMENT_TYPES.includes(documentType)) throw new Error('PRINT_DOCUMENT_TYPE_INVALID');
    return { ...this.settings[documentType] };
  }

  resolvePrinter(documentType, printers = []) {
    const setting = this.get(documentType);
    const normalized = printers.map(normalizePrinter).filter(printer => printer.name);
    const configured = normalizePrinterName(setting.printerName);
    const match = normalized.find(printer => (
      normalizePrinterName(printer.name) === configured
      || normalizePrinterName(printer.displayName) === configured
    ));
    if (match) return match;
    if (!setting.printerName) return normalized.find(printer => printer.isDefault) || normalized[0] || null;
    return null;
  }

  toJSON() {
    return Object.fromEntries(
      PRINT_DOCUMENT_TYPES.map(documentType => [documentType, { ...this.settings[documentType] }]),
    );
  }
}
