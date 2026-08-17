import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PRINT_JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PRINTING: 'PRINTING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
});

const DEFAULT_CONFIG = Object.freeze({
  defaultPrinter: '',
  maxRetries: 2,
  retryDelayMs: 1_500,
  printerRefreshIntervalMs: 15_000,
  completedRetentionMs: 24 * 60 * 60_000,
});

function sanitizeConfig(input = {}) {
  return {
    defaultPrinter: String(input.defaultPrinter || '').trim(),
    maxRetries: Math.max(0, Math.min(10, Number(input.maxRetries) || DEFAULT_CONFIG.maxRetries)),
    retryDelayMs: Math.max(100, Number(input.retryDelayMs) || DEFAULT_CONFIG.retryDelayMs),
    printerRefreshIntervalMs: Math.max(1_000, Number(input.printerRefreshIntervalMs) || DEFAULT_CONFIG.printerRefreshIntervalMs),
    completedRetentionMs: Math.max(60_000, Number(input.completedRetentionMs) || DEFAULT_CONFIG.completedRetentionMs),
  };
}

function printableJob(job) {
  const { content: _content, ...record } = job;
  return { ...record };
}

function normalizePrinterName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function makeCounts(jobs) {
  const counts = {
    PENDING: 0,
    PRINTING: 0,
    COMPLETED: 0,
    ERROR: 0,
    CANCELLED: 0,
  };
  for (const job of jobs) {
    if (Object.hasOwn(counts, job.status)) counts[job.status] += 1;
  }
  return counts;
}

export class PrintAgentCore {
  constructor({
    storagePath,
    executePrint,
    listPrinters,
    logger = console,
    now = () => new Date(),
    randomUUID = () => crypto.randomUUID(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    configuration = {},
  }) {
    if (!storagePath) throw new Error('PRINT_AGENT_STORAGE_PATH_REQUIRED');
    if (typeof executePrint !== 'function') throw new Error('PRINT_AGENT_EXECUTOR_REQUIRED');
    if (typeof listPrinters !== 'function') throw new Error('PRINT_AGENT_PRINTER_PROVIDER_REQUIRED');
    this.storagePath = storagePath;
    this.executePrint = executePrint;
    this.listPrinters = listPrinters;
    this.logger = logger;
    this.now = now;
    this.randomUUID = randomUUID;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.configuration = sanitizeConfig(configuration);
    this.jobs = [];
    this.printers = [];
    this.running = false;
    this.processing = false;
    this.activeRequestId = null;
    this.printerTimer = null;
    this.retryTimers = new Map();
  }

  async start() {
    if (this.running) return this.getWorkspace();
    this.load();
    this.running = true;
    const interruptedAt = this.now().toISOString();
    for (const job of this.jobs) {
      if (job.status === PRINT_JOB_STATUS.PRINTING) {
        job.status = PRINT_JOB_STATUS.ERROR;
        job.finishedAt = interruptedAt;
        job.failureReason = 'PRINT_INTERRUPTED_UNKNOWN_RESULT';
      }
    }
    this.cleanupCompleted();
    this.persist();
    await this.refreshPrinters();
    this.printerTimer = this.setIntervalFn(() => {
      void this.refreshPrinters();
    }, this.configuration.printerRefreshIntervalMs);
    void this.processNext();
    return this.getWorkspace();
  }

  async stop() {
    this.running = false;
    if (this.printerTimer) this.clearIntervalFn(this.printerTimer);
    this.printerTimer = null;
    for (const timer of this.retryTimers.values()) this.clearTimeoutFn(timer);
    this.retryTimers.clear();
    this.persist();
  }

  load() {
    let payload = null;
    try {
      payload = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch {}
    this.configuration = sanitizeConfig({ ...this.configuration, ...(payload?.configuration || {}) });
    this.jobs = Array.isArray(payload?.jobs)
      ? payload.jobs.filter(job => job?.requestId && job?.documentId && job?.content?.kind && typeof job?.content?.data === 'string')
      : [];
    this.printers = Array.isArray(payload?.printers) ? payload.printers : [];
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const temporary = `${this.storagePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({
        version: 1,
        configuration: this.configuration,
        printers: this.printers,
        jobs: this.jobs,
        savedAt: this.now().toISOString(),
      }), 'utf8');
      fs.renameSync(temporary, this.storagePath);
    } catch (error) {
      this.logger.error?.('[Print Agent] No fue posible persistir la cola:', error);
      throw error;
    }
  }

  resolvePrinter(job) {
    return String(job.printer || this.configuration.defaultPrinter || '').trim();
  }

  isPrinterAvailable(printerName) {
    if (!this.printers.length) return false;
    if (!printerName) return this.printers.some(printer => printer.isDefault) || this.printers.length > 0;
    const normalized = normalizePrinterName(printerName);
    return this.printers.some(printer => (
      normalizePrinterName(printer.name) === normalized
      || normalizePrinterName(printer.displayName) === normalized
    ));
  }

  async refreshPrinters() {
    if (!this.running) return [];
    try {
      const printers = await this.listPrinters();
      this.printers = Array.isArray(printers)
        ? printers.map(printer => ({
          name: String(printer.name || printer.displayName || '').trim(),
          displayName: String(printer.displayName || printer.name || '').trim(),
          description: String(printer.description || '').trim(),
          status: Number.isFinite(printer.status) ? printer.status : undefined,
          isDefault: Boolean(printer.isDefault),
        })).filter(printer => printer.name)
        : [];

      let changed = false;
      for (const job of this.jobs) {
        if (job.status === PRINT_JOB_STATUS.PENDING) {
          const printer = this.resolvePrinter(job);
          if (!this.isPrinterAvailable(printer)) {
            job.status = PRINT_JOB_STATUS.ERROR;
            job.failureReason = `PRINTER_NOT_AVAILABLE${printer ? `:${printer}` : ''}`;
            job.finishedAt = this.now().toISOString();
            changed = true;
          }
        } else if (job.status === PRINT_JOB_STATUS.ERROR && (
          String(job.failureReason || '').startsWith('PRINTER_NOT_AVAILABLE')
          || String(job.failureReason || '') === 'PRINTER_DISCOVERY_FAILED'
        )) {
          const printer = this.resolvePrinter(job);
          if (this.isPrinterAvailable(printer)) {
            job.status = PRINT_JOB_STATUS.PENDING;
            job.failureReason = null;
            job.finishedAt = null;
            changed = true;
          }
        }
      }
      if (changed) this.persist();
      else {
        try { this.persist(); } catch {}
      }
      void this.processNext();
      return this.printers;
    } catch (error) {
      this.logger.error?.('[Print Agent] No fue posible actualizar impresoras:', error);
      this.printers = [];
      for (const job of this.jobs) {
        if (job.status === PRINT_JOB_STATUS.PENDING) {
          job.status = PRINT_JOB_STATUS.ERROR;
          job.failureReason = 'PRINTER_DISCOVERY_FAILED';
          job.finishedAt = this.now().toISOString();
        }
      }
      this.persist();
      return [];
    }
  }

  validateSubmission(input) {
    if (!input || typeof input !== 'object') throw new Error('PRINT_JOB_REQUIRED');
    const requestId = String(input.requestId || '').trim();
    const documentId = String(input.documentId || '').trim();
    const documentType = String(input.documentType || '').trim();
    const kind = String(input.content?.kind || '').trim();
    const data = typeof input.content?.data === 'string' ? input.content.data : '';
    if (!requestId) throw new Error('PRINT_REQUEST_ID_REQUIRED');
    if (!documentId) throw new Error('PRINT_DOCUMENT_ID_REQUIRED');
    if (!documentType) throw new Error('PRINT_DOCUMENT_TYPE_REQUIRED');
    if (!['html', 'pdf'].includes(kind)) throw new Error('PRINT_CONTENT_TYPE_INVALID');
    if (!data) throw new Error('PRINT_CONTENT_REQUIRED');
    return { requestId, documentId, documentType, kind, data };
  }

  async submitPrintJob(input, context = {}) {
    const validated = this.validateSubmission(input);
    const existing = this.jobs.find(job => job.requestId === validated.requestId);
    if (existing) return printableJob(existing);
    const createdAt = this.now().toISOString();
    const job = {
      requestId: validated.requestId,
      documentId: validated.documentId,
      documentType: validated.documentType,
      title: String(input.title || '').trim() || undefined,
      content: {
        kind: validated.kind,
        data: validated.data,
        mimeType: String(input.content?.mimeType || (validated.kind === 'pdf' ? 'application/pdf' : 'text/html')),
      },
      printer: String(input.printer || '').trim(),
      paperSize: String(input.paperSize || 'Letter').trim(),
      orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
      copies: Math.max(1, Math.min(99, Number(input.copies) || 1)),
      silent: input.silent !== false,
      createdAt,
      startedAt: null,
      finishedAt: null,
      status: PRINT_JOB_STATUS.PENDING,
      attempts: 0,
      failureReason: null,
      clientId: String(context.clientId || input.clientId || 'SERVER_LOCAL'),
      userId: String(context.userId || input.userId || 'SYSTEM'),
      sourceRequestId: input.sourceRequestId ? String(input.sourceRequestId) : undefined,
    };
    this.jobs.push(job);
    this.persist();
    void this.processNext();
    return printableJob(job);
  }

  findJob(reference) {
    const requestId = String(reference?.requestId || '').trim();
    if (!requestId) throw new Error('PRINT_REQUEST_ID_REQUIRED');
    const job = this.jobs.find(item => item.requestId === requestId);
    if (!job) throw new Error('PRINT_JOB_NOT_FOUND');
    return job;
  }

  async retryPrintJob(reference) {
    const job = this.findJob(reference);
    if (job.status === PRINT_JOB_STATUS.PRINTING) throw new Error('PRINT_JOB_ALREADY_PRINTING');
    if (job.status === PRINT_JOB_STATUS.COMPLETED) throw new Error('PRINT_JOB_ALREADY_COMPLETED');
    const timer = this.retryTimers.get(job.requestId);
    if (timer) this.clearTimeoutFn(timer);
    this.retryTimers.delete(job.requestId);
    job.status = PRINT_JOB_STATUS.PENDING;
    job.startedAt = null;
    job.finishedAt = null;
    job.failureReason = null;
    this.persist();
    void this.refreshPrinters();
    void this.processNext();
    return printableJob(job);
  }

  async cancelPrintJob(reference) {
    const job = this.findJob(reference);
    if (job.status === PRINT_JOB_STATUS.PRINTING) throw new Error('PRINT_JOB_ALREADY_PRINTING');
    if (job.status === PRINT_JOB_STATUS.COMPLETED) throw new Error('PRINT_JOB_ALREADY_COMPLETED');
    const timer = this.retryTimers.get(job.requestId);
    if (timer) this.clearTimeoutFn(timer);
    this.retryTimers.delete(job.requestId);
    job.status = PRINT_JOB_STATUS.CANCELLED;
    job.finishedAt = this.now().toISOString();
    job.failureReason = null;
    this.persist();
    return printableJob(job);
  }

  async reprintPrintJob(input, context = {}) {
    const source = this.findJob(input);
    const newRequestId = String(input?.newRequestId || this.randomUUID()).trim();
    return this.submitPrintJob({
      requestId: newRequestId,
      documentId: source.documentId,
      documentType: source.documentType,
      title: source.title,
      content: { ...source.content },
      printer: source.printer,
      paperSize: source.paperSize,
      orientation: source.orientation,
      copies: source.copies,
      silent: source.silent,
      sourceRequestId: source.requestId,
    }, {
      clientId: context.clientId || source.clientId,
      userId: context.userId || source.userId,
    });
  }

  scheduleAutomaticRetry(job) {
    if (!this.running || job.status !== PRINT_JOB_STATUS.ERROR) return;
    if (job.attempts > this.configuration.maxRetries) return;
    if (String(job.failureReason || '').startsWith('PRINTER_NOT_AVAILABLE')) return;
    if (String(job.failureReason || '') === 'PRINT_INTERRUPTED_UNKNOWN_RESULT') return;
    const previous = this.retryTimers.get(job.requestId);
    if (previous) this.clearTimeoutFn(previous);
    const timer = this.setTimeoutFn(() => {
      this.retryTimers.delete(job.requestId);
      if (!this.running || job.status !== PRINT_JOB_STATUS.ERROR) return;
      job.status = PRINT_JOB_STATUS.PENDING;
      job.startedAt = null;
      job.finishedAt = null;
      this.persist();
      void this.processNext();
    }, this.configuration.retryDelayMs);
    this.retryTimers.set(job.requestId, timer);
  }

  async processNext() {
    if (!this.running || this.processing) return;
    const job = this.jobs
      .filter(item => item.status === PRINT_JOB_STATUS.PENDING)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    if (!job) return;
    const printer = this.resolvePrinter(job);
    if (!this.isPrinterAvailable(printer)) {
      job.status = PRINT_JOB_STATUS.ERROR;
      job.finishedAt = this.now().toISOString();
      job.failureReason = `PRINTER_NOT_AVAILABLE${printer ? `:${printer}` : ''}`;
      this.persist();
      return;
    }

    this.processing = true;
    this.activeRequestId = job.requestId;
    job.status = PRINT_JOB_STATUS.PRINTING;
    job.startedAt = this.now().toISOString();
    job.finishedAt = null;
    job.attempts += 1;
    job.failureReason = null;
    this.persist();

    try {
      await this.executePrint({ ...job, printer: printer || undefined });
      if (job.status === PRINT_JOB_STATUS.PRINTING) {
        job.status = PRINT_JOB_STATUS.COMPLETED;
        job.finishedAt = this.now().toISOString();
        job.failureReason = null;
      }
    } catch (error) {
      if (job.status === PRINT_JOB_STATUS.PRINTING) {
        job.status = PRINT_JOB_STATUS.ERROR;
        job.finishedAt = this.now().toISOString();
        job.failureReason = error instanceof Error ? error.message : 'PRINT_FAILED';
      }
    } finally {
      this.processing = false;
      this.activeRequestId = null;
      this.cleanupCompleted();
      this.persist();
      if (job.status === PRINT_JOB_STATUS.ERROR) this.scheduleAutomaticRetry(job);
      queueMicrotask(() => { void this.processNext(); });
    }
  }

  cleanupCompleted() {
    const threshold = this.now().getTime() - this.configuration.completedRetentionMs;
    this.jobs = this.jobs.filter(job => {
      if (![PRINT_JOB_STATUS.COMPLETED, PRINT_JOB_STATUS.CANCELLED].includes(job.status)) return true;
      const finished = new Date(job.finishedAt || job.createdAt).getTime();
      return !Number.isFinite(finished) || finished >= threshold;
    });
  }

  getWorkspace() {
    this.cleanupCompleted();
    return {
      running: this.running,
      processing: this.processing,
      activeRequestId: this.activeRequestId,
      printers: this.printers.map(printer => ({ ...printer })),
      configuration: { ...this.configuration },
      jobs: this.jobs.map(printableJob),
      counts: makeCounts(this.jobs),
      updatedAt: this.now().toISOString(),
    };
  }
}
