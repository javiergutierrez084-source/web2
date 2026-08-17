import { BrowserWindow } from 'electron';
import path from 'node:path';
import {
  PRINT_DOCUMENT_TYPES,
  PrintSettingsStore,
  normalizePrinter,
} from './printSettingsStore.js';

let service = null;

function pageSizeFor(value) {
  const paper = String(value || 'Carta').trim().toLocaleLowerCase();
  if (['térmica 80 mm', 'termica 80 mm', 'tirilla 80 mm', 'ticket80', '80mm'].includes(paper)) {
    return { width: 80_000, height: 500_000 };
  }
  if (['térmica 58 mm', 'termica 58 mm', 'tirilla 58 mm', 'ticket58', '58mm'].includes(paper)) {
    return { width: 58_000, height: 500_000 };
  }
  if (['etiqueta', 'label'].includes(paper)) return { width: 50_000, height: 30_000 };
  if (['carta', 'letter'].includes(paper)) return 'Letter';
  if (paper === 'a4') return 'A4';
  return value || 'Letter';
}

function createResidentWindow() {
  return new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

async function loadContent(win, content) {
  if (content.kind === 'pdf') {
    await win.loadURL(`data:application/pdf;base64,${content.data}`);
    await new Promise(resolve => setTimeout(resolve, 750));
    return;
  }
  const encoded = Buffer.from(content.data, 'utf8').toString('base64');
  await win.loadURL(`data:text/html;charset=utf-8;base64,${encoded}`);
  await new Promise(resolve => setTimeout(resolve, 250));
}

async function getPrintersFromElectron() {
  const win = createResidentWindow();
  try {
    await win.loadURL('data:text/html,<html><body></body></html>');
    const printers = await win.webContents.getPrintersAsync();
    return Array.isArray(printers)
      ? printers.map(normalizePrinter).filter(printer => printer.name)
      : [];
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function printWithElectron(content, settings, printerName) {
  const win = createResidentWindow();
  try {
    await loadContent(win, content);
    await new Promise((resolve, reject) => {
      win.webContents.print({
        silent: settings.silent,
        printBackground: true,
        landscape: settings.orientation === 'landscape',
        pageSize: pageSizeFor(settings.paper),
        copies: settings.copies,
        scaleFactor: settings.scale,
        deviceName: printerName,
      }, (success, failureReason) => {
        if (success) resolve();
        else reject(new Error(failureReason || 'PRINT_FAILED'));
      });
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function buildTestPage(documentType, printerName) {
  const generatedAt = new Date().toLocaleString('es-CO');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Prueba de impresora</title>
  <style>@page{margin:10mm}body{font-family:Arial,sans-serif;color:#111;padding:12px}h1{font-size:20px;margin:0 0 14px}.box{border:2px solid #111;padding:14px}.row{margin:6px 0}.small{font-size:11px;color:#555}</style></head>
  <body><div class="box"><h1>JoyaControl — Prueba de impresora</h1><div class="row"><strong>Tipo:</strong> ${documentType}</div><div class="row"><strong>Impresora:</strong> ${printerName}</div><div class="row"><strong>Fecha:</strong> ${generatedAt}</div><p class="small">Esta página confirma la configuración de impresión del Servidor Principal. No contiene datos comerciales.</p></div></body></html>`;
}

class DirectPrintService {
  constructor({ userDataPath }) {
    this.store = new PrintSettingsStore({ storagePath: path.join(userDataPath, 'print-settings.json') });
    this.printers = [];
  }

  async start() {
    this.store.load();
    await this.refreshPrinters();
    return this.getPrintSettings();
  }

  async stop() {
    this.store.save();
  }

  async refreshPrinters() {
    this.printers = await getPrintersFromElectron();
    this.store.assignDefaultPrinter(this.printers);
    return this.getPrintSettings();
  }

  getPrintSettings() {
    return {
      documentTypes: [...PRINT_DOCUMENT_TYPES],
      settings: this.store.toJSON(),
      printers: this.printers.map(printer => ({ ...printer })),
    };
  }

  savePrintSettings(input) {
    const settings = this.store.save(input?.settings || input || {});
    return {
      documentTypes: [...PRINT_DOCUMENT_TYPES],
      settings,
      printers: this.printers.map(printer => ({ ...printer })),
    };
  }

  validateRequest(input) {
    const documentType = String(input?.documentType || '').trim();
    const kind = String(input?.content?.kind || '').trim();
    const data = typeof input?.content?.data === 'string' ? input.content.data : '';
    if (!PRINT_DOCUMENT_TYPES.includes(documentType)) throw new Error('PRINT_DOCUMENT_TYPE_INVALID');
    if (!['html', 'pdf'].includes(kind)) throw new Error('PRINT_CONTENT_TYPE_INVALID');
    if (!data) throw new Error('PRINT_CONTENT_REQUIRED');
    return { documentType, content: { kind, data } };
  }

  async printDocument(input, context = {}) {
    const request = this.validateRequest(input);
    this.store.load();
    if (!this.printers.length) await this.refreshPrinters();
    const printer = this.store.resolvePrinter(request.documentType, this.printers);
    if (!printer) throw new Error('PRINT_CONFIGURED_PRINTER_NOT_AVAILABLE');
    const settings = this.store.get(request.documentType);
    await printWithElectron(request.content, settings, printer.name);
    return {
      success: true,
      documentType: request.documentType,
      printerName: printer.name,
      clientId: String(context.clientId || input?.clientId || 'SERVER_LOCAL'),
      userId: String(context.userId || input?.userId || 'SYSTEM'),
      printedAt: new Date().toISOString(),
    };
  }

  async testPrinter(input) {
    const documentType = String(input?.documentType || '').trim();
    if (!PRINT_DOCUMENT_TYPES.includes(documentType)) throw new Error('PRINT_DOCUMENT_TYPE_INVALID');
    this.store.load();
    if (!this.printers.length) await this.refreshPrinters();
    const printer = this.store.resolvePrinter(documentType, this.printers);
    if (!printer) throw new Error('PRINT_CONFIGURED_PRINTER_NOT_AVAILABLE');
    const settings = this.store.get(documentType);
    await printWithElectron({ kind: 'html', data: buildTestPage(documentType, printer.name) }, settings, printer.name);
    return { success: true, documentType, printerName: printer.name };
  }
}

function requireService() {
  if (!service) throw new Error('PRINT_SERVICE_NOT_STARTED');
  return service;
}

export async function startPrintAgent({ userDataPath }) {
  if (service) return service.getPrintSettings();
  service = new DirectPrintService({ userDataPath });
  return service.start();
}

export async function stopPrintAgent() {
  if (!service) return;
  const current = service;
  service = null;
  await current.stop();
}

export function printDocument(input, context = {}) {
  return requireService().printDocument(input, context);
}

export function getPrintSettings() {
  return requireService().getPrintSettings();
}

export function savePrintSettings(input) {
  return requireService().savePrintSettings(input);
}

export function refreshPrinters() {
  return requireService().refreshPrinters();
}

export function testPrinter(input) {
  return requireService().testPrinter(input);
}

export async function executePrintAgentRepositoryOperation(method, args = {}, context = {}) {
  switch (method) {
    case 'printDocument': return printDocument(args.input || args, context);
    case 'getPrintSettings': return getPrintSettings();
    default: throw new Error('PRINT_REPOSITORY_METHOD_NOT_ALLOWED');
  }
}
