import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  defaultConfiguration,
  normalizeConfiguration,
  resolveJobPrintSettings,
} from './printConfiguration.js';

const DEFAULT_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

const summaryOf = job => {
  const { contentBase64: _contentBase64, contentType: _contentType, copies: _copies, ...summary } = job;
  return summary;
};

const atomicWriteJson = (filename, value) => {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temporary, filename);
  } catch (error) {
    // Windows cannot always replace an existing destination with renameSync.
    try { fs.rmSync(filename, { force: true }); } catch { /* best effort replacement */ }
    fs.renameSync(temporary, filename);
  }
};

export class PrintQueueService {
  constructor({ userDataPath, adapter, onChange = null, now = () => Date.now() }) {
    this.adapter = adapter;
    this.onChange = onChange;
    this.now = now;
    this.statePath = path.join(userDataPath, 'joyacontrol-print-queue.json');
    this.jobs = [];
    this.configuration = defaultConfiguration();
    this.processing = false;
    this.processAgain = false;
    this.retryTimer = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.load();
    const nowIso = new Date(this.now()).toISOString();
    this.jobs = this.jobs.map(job => job.status === 'printing'
      ? { ...job, status: 'pending', startedAt: null, updatedAt: nowIso, lastError: 'PRINT_SERVER_RESTARTED' }
      : job);
    this.persist('startup');
    this.kick();
  }

  stop() {
    this.started = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  load() {
    if (!fs.existsSync(this.statePath)) return;
    try {
      const stored = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      this.jobs = Array.isArray(stored.jobs) ? stored.jobs : [];
      this.configuration = normalizeConfiguration(stored.configuration || {});
    } catch {
      this.jobs = [];
      this.configuration = defaultConfiguration();
    }
  }

  persist(reason = 'updated') {
    atomicWriteJson(this.statePath, { version: 1, configuration: this.configuration, jobs: this.jobs });
    try { this.onChange?.(reason); } catch { /* diagnostic notification must never break printing */ }
  }

  kick() {
    if (!this.started) return;
    if (this.processing) {
      this.processAgain = true;
      return;
    }
    void this.process();
  }

  async discoverPrinters() {
    const printers = await this.adapter.discoverPrinters();
    return Array.isArray(printers) ? printers : [];
  }

  async getWorkspace() {
    this.start();
    const environment = typeof this.adapter.getPrinterEnvironment === 'function'
      ? await this.adapter.getPrinterEnvironment()
      : {
          printers: await this.discoverPrinters(),
          spooler: { status: 'unknown', checkedAt: new Date(this.now()).toISOString(), message: 'Estado no disponible' },
          server: { name: 'Servidor Principal', platform: process.platform },
          discoveredAt: new Date(this.now()).toISOString(),
        };
    const printers = Array.isArray(environment?.printers) ? environment.printers : [];
    return {
      printers,
      configuration: {
        ...this.configuration,
        profilePrinters: { ...this.configuration.profilePrinters },
        documentPrinters: { ...this.configuration.documentPrinters },
        documentSettings: Object.fromEntries(Object.entries(this.configuration.documentSettings || {}).map(([key, value]) => [key, { ...value }])),
      },
      jobs: [...this.jobs].sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).map(summaryOf),
      spooler: environment.spooler,
      server: environment.server,
      discoveredAt: environment.discoveredAt,
    };
  }

  saveConfiguration(configuration = {}) {
    this.start();
    this.configuration = normalizeConfiguration({
      ...this.configuration,
      ...configuration,
      profilePrinters: { ...(configuration.profilePrinters || {}) },
      documentPrinters: { ...(configuration.documentPrinters || {}) },
      documentSettings: { ...(configuration.documentSettings || {}) },
      updatedAt: new Date(this.now()).toISOString(),
    });
    this.persist('configuration');
    this.kick();
    return { ...this.configuration };
  }

  submit(request, originalJobId = null) {
    this.start();
    const existing = this.jobs.find(job => job.requestId === request.requestId);
    if (existing) return summaryOf(existing);
    const now = new Date(this.now()).toISOString();
    const job = {
      id: crypto.randomUUID(),
      requestId: String(request.requestId || crypto.randomUUID()),
      originalJobId,
      documentType: request.documentType || 'other',
      documentId: String(request.documentId || ''),
      documentNumber: String(request.documentNumber || ''),
      title: String(request.title || request.documentNumber || 'Documento'),
      format: request.format || 'letter',
      contentType: request.contentType === 'text/html' ? 'text/html' : 'application/pdf',
      contentBase64: String(request.contentBase64 || ''),
      copies: Math.max(1, Math.min(20, Number(request.copies) || 1)),
      requester: request.requester || { userId: '', username: '', displayName: '', clientId: '', deviceName: '' },
      printerName: null,
      status: 'pending',
      attempts: 0,
      requestedAt: request.requestedAt || now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      nextRetryAt: null,
      lastError: null,
      durationMs: null,
      configurationTarget: request.configurationTarget || null,
      requestedPrinterName: request.requestedPrinterName ? String(request.requestedPrinterName) : null,
      printOptions: request.printOptions && typeof request.printOptions === 'object' ? { ...request.printOptions } : {},
      isTestPrint: request.isTestPrint === true,
    };
    if (!job.contentBase64) throw new Error('PRINT_CONTENT_REQUIRED');
    this.jobs.push(job);
    this.persist('submitted');
    this.kick();
    return summaryOf(job);
  }

  cancel(jobId) {
    this.start();
    const job = this.requireJob(jobId);
    if (job.status === 'completed') throw new Error('PRINT_JOB_ALREADY_COMPLETED');
    if (job.status === 'printing') throw new Error('PRINT_JOB_CURRENTLY_PRINTING');
    const now = new Date(this.now()).toISOString();
    Object.assign(job, { status: 'cancelled', updatedAt: now, nextRetryAt: null, lastError: null });
    this.persist('cancelled');
    return summaryOf(job);
  }

  retry(jobId) {
    this.start();
    const job = this.requireJob(jobId);
    if (!['error', 'pending'].includes(job.status)) throw new Error('PRINT_JOB_NOT_RETRYABLE');
    Object.assign(job, { status: 'pending', nextRetryAt: null, lastError: null, updatedAt: new Date(this.now()).toISOString() });
    this.persist('retry');
    this.kick();
    return summaryOf(job);
  }

  reprint(jobId, requestId = crypto.randomUUID(), requester = null) {
    this.start();
    const original = this.requireJob(jobId);
    return this.submit({
      requestId,
      documentType: original.documentType,
      documentId: original.documentId,
      documentNumber: original.documentNumber,
      title: original.title,
      format: original.format,
      contentType: original.contentType,
      contentBase64: original.contentBase64,
      copies: original.copies,
      requester: requester || original.requester,
      requestedAt: new Date(this.now()).toISOString(),
      configurationTarget: original.configurationTarget || null,
      requestedPrinterName: original.requestedPrinterName || null,
      printOptions: { ...(original.printOptions || {}) },
      isTestPrint: original.isTestPrint === true,
    }, original.id);
  }

  requireJob(jobId) {
    const job = this.jobs.find(item => item.id === jobId);
    if (!job) throw new Error('PRINT_JOB_NOT_FOUND');
    return job;
  }

  routingProfile(job) {
    if (job.documentType === 'invoice') return 'invoice';
    if (job.format === 'ticket80' || job.format === 'ticket50') return 'ticket';
    if (job.format === 'a4') return 'a4';
    if (job.format === 'label') return 'label';
    if (job.format === 'barcode') return 'barcode';
    return 'letter';
  }

  resolvePrintSettings(job) {
    return resolveJobPrintSettings(this.configuration, job);
  }

  choosePrinter(job, printers) {
    const settings = this.resolvePrintSettings(job);
    const configured = settings.printerName
      || this.configuration.documentPrinters?.[job.documentType]
      || this.configuration.profilePrinters?.[this.routingProfile(job)]
      || this.configuration.defaultPrinterName;
    if (configured) return printers.find(printer => printer.name === configured || printer.displayName === configured) || null;
    return printers.find(printer => printer.isDefault) || printers.find(printer => printer.available) || null;
  }

  isRunnableJob(job) {
    const now = this.now();
    return job.status === 'pending'
      || (job.status === 'error' && this.configuration.automaticRetry !== false && (!job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= now));
  }

  nextRunnableJob() {
    return this.jobs.find(job => this.isRunnableJob(job));
  }

  scheduleNextRetry() {
    if (!this.started || this.retryTimer || this.configuration.automaticRetry === false) return;
    const retryTimes = this.jobs
      .filter(job => job.status === 'error' && job.nextRetryAt)
      .map(job => new Date(job.nextRetryAt).getTime())
      .filter(value => Number.isFinite(value));
    if (!retryTimes.length) return;
    const delay = Math.max(0, Math.min(...retryTimes) - this.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, delay);
    this.retryTimer.unref?.();
  }

  async process() {
    if (!this.started) return;
    if (this.processing) { this.processAgain = true; return; }
    this.processing = true;
    this.processAgain = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      while (this.started) {
        const job = this.nextRunnableJob();
        if (!job) break;
        const printers = await this.discoverPrinters();
        // The job may have been cancelled while Windows was enumerating printers.
        if (!this.isRunnableJob(job)) continue;
        const settings = this.resolvePrintSettings(job);
        const printer = this.choosePrinter(job, printers);
        if (!printer) {
          this.recordFailure(job, 'PRINT_PRINTER_NOT_CONFIGURED');
          continue;
        }
        if (printer.available === false) {
          this.recordFailure(job, `PRINT_PRINTER_UNAVAILABLE:${printer.name}`);
          continue;
        }
        const started = this.now();
        Object.assign(job, {
          status: 'printing',
          printerName: printer.name,
          attempts: job.attempts + 1,
          startedAt: new Date(started).toISOString(),
          updatedAt: new Date(started).toISOString(),
          nextRetryAt: null,
          lastError: null,
        });
        this.persist('printing');
        try {
          await this.adapter.printJob(job, printer, settings);
          const completed = this.now();
          Object.assign(job, {
            status: 'completed',
            completedAt: new Date(completed).toISOString(),
            updatedAt: new Date(completed).toISOString(),
            durationMs: Math.max(0, completed - started),
            nextRetryAt: null,
            lastError: null,
          });
          this.persist('completed');
        } catch (error) {
          this.recordFailure(job, error instanceof Error ? error.message : 'PRINT_FAILED');
        }
      }
    } finally {
      this.processing = false;
      if (this.processAgain || this.nextRunnableJob()) {
        this.processAgain = false;
        queueMicrotask(() => this.kick());
      } else {
        this.scheduleNextRetry();
      }
    }
  }

  recordFailure(job, message) {
    const now = this.now();
    const baseDelay = Math.max(1000, Number(this.configuration.retryDelayMs) || DEFAULT_RETRY_DELAY_MS);
    const delay = Math.min(MAX_RETRY_DELAY_MS, baseDelay * Math.max(1, 2 ** Math.min(job.attempts, 4)));
    const attempts = job.status === 'printing' ? job.attempts : job.attempts + 1;
    Object.assign(job, {
      status: 'error',
      attempts,
      updatedAt: new Date(now).toISOString(),
      completedAt: null,
      durationMs: job.startedAt ? Math.max(0, now - new Date(job.startedAt).getTime()) : null,
      lastError: String(message || 'PRINT_FAILED'),
      nextRetryAt: this.configuration.automaticRetry === false ? null : new Date(now + delay).toISOString(),
    });
    this.persist('failed');
  }
}
