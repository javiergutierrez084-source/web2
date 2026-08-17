const DEFAULT_RETRY_DELAY_MS = 30_000;

export const PRINT_CONFIGURATION_TARGETS = [
  'invoiceLetter',
  'invoiceTicket80',
  'invoiceTicket58',
  'quotation',
  'report',
  'label',
  'barcode',
  'pdf',
];

const setting = (paperSize, colorMode = 'color') => ({
  printerName: null,
  paperSize,
  orientation: 'portrait',
  copies: 1,
  silent: true,
  margin: paperSize === 'letter' || paperSize === 'a4' ? 'default' : 'none',
  scale: 100,
  colorMode,
});

export const defaultDocumentSettings = () => ({
  invoiceLetter: setting('letter'),
  invoiceTicket80: setting('ticket80', 'monochrome'),
  invoiceTicket58: setting('ticket58', 'monochrome'),
  quotation: setting('letter'),
  report: setting('letter'),
  label: setting('label', 'monochrome'),
  barcode: setting('barcode', 'monochrome'),
  pdf: setting('letter'),
});

export const defaultConfiguration = () => ({
  defaultPrinterName: null,
  profilePrinters: {},
  documentPrinters: {},
  documentSettings: defaultDocumentSettings(),
  automaticRetry: true,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  updatedAt: new Date().toISOString(),
});

const normalizedPrinterName = value => {
  const name = String(value || '').trim();
  return name || null;
};

export const normalizeDocumentSettings = value => {
  const defaults = defaultDocumentSettings();
  return Object.fromEntries(PRINT_CONFIGURATION_TARGETS.map(key => {
    const candidate = value?.[key] || {};
    const copies = Number(candidate.copies);
    const scale = Number(candidate.scale);
    return [key, {
      ...defaults[key],
      ...candidate,
      printerName: normalizedPrinterName(candidate.printerName),
      paperSize: ['letter', 'a4', 'ticket80', 'ticket58', 'label', 'barcode'].includes(candidate.paperSize)
        ? candidate.paperSize
        : defaults[key].paperSize,
      orientation: candidate.orientation === 'landscape' ? 'landscape' : 'portrait',
      copies: Number.isFinite(copies) ? Math.max(1, Math.min(20, Math.round(copies))) : defaults[key].copies,
      silent: candidate.silent !== false,
      margin: ['default', 'none', 'printableArea'].includes(candidate.margin) ? candidate.margin : defaults[key].margin,
      scale: Number.isFinite(scale) ? Math.max(10, Math.min(200, Math.round(scale))) : defaults[key].scale,
      colorMode: candidate.colorMode === 'monochrome' ? 'monochrome' : 'color',
    }];
  }));
};

export const normalizeConfiguration = value => {
  const defaults = defaultConfiguration();
  const delay = Number(value?.retryDelayMs);
  const profilePrinters = { ...(value?.profilePrinters || {}) };
  const documentPrinters = { ...(value?.documentPrinters || {}) };
  const documentSettings = normalizeDocumentSettings(value?.documentSettings);
  if (!value?.documentSettings) {
    const legacy = {
      invoiceLetter: documentPrinters.invoice || profilePrinters.invoice || profilePrinters.letter || null,
      invoiceTicket80: documentPrinters.invoice || profilePrinters.ticket || null,
      invoiceTicket58: documentPrinters.invoice || profilePrinters.ticket || null,
      quotation: documentPrinters.quotation || profilePrinters.letter || null,
      report: documentPrinters.report || profilePrinters.a4 || profilePrinters.letter || null,
      label: documentPrinters.label || profilePrinters.label || null,
      barcode: documentPrinters.barcode || profilePrinters.barcode || null,
      pdf: profilePrinters.a4 || profilePrinters.letter || null,
    };
    for (const key of PRINT_CONFIGURATION_TARGETS) documentSettings[key].printerName = normalizedPrinterName(legacy[key]);
  }
  return {
    ...defaults,
    ...(value || {}),
    defaultPrinterName: normalizedPrinterName(value?.defaultPrinterName),
    profilePrinters,
    documentPrinters,
    documentSettings,
    automaticRetry: value?.automaticRetry !== false,
    retryDelayMs: Number.isFinite(delay) && delay >= 1000 ? delay : DEFAULT_RETRY_DELAY_MS,
    updatedAt: value?.updatedAt || defaults.updatedAt,
  };
};

export const configurationTargetForJob = job => {
  if (PRINT_CONFIGURATION_TARGETS.includes(job.configurationTarget)) return job.configurationTarget;
  if (job.documentType === 'invoice' && job.format === 'ticket80') return 'invoiceTicket80';
  if (job.documentType === 'invoice' && job.format === 'ticket50') return 'invoiceTicket58';
  if (job.documentType === 'invoice') return 'invoiceLetter';
  if (job.documentType === 'quotation') return 'quotation';
  if (job.documentType === 'report' || job.documentType === 'cash_close') return 'report';
  if (job.documentType === 'label' || job.format === 'label') return 'label';
  if (job.documentType === 'barcode' || job.format === 'barcode') return 'barcode';
  if (job.contentType === 'application/pdf') return 'pdf';
  return 'report';
};

export const resolveJobPrintSettings = (configuration, job) => {
  const normalized = normalizeConfiguration(configuration);
  const target = configurationTargetForJob(job);
  const configured = normalized.documentSettings[target] || defaultDocumentSettings()[target];
  const overrides = job.printOptions || {};
  const copies = Number(overrides.copies ?? configured.copies ?? job.copies);
  const scale = Number(overrides.scale ?? configured.scale);
  return {
    ...configured,
    ...overrides,
    printerName: normalizedPrinterName(job.requestedPrinterName) || configured.printerName || null,
    copies: Number.isFinite(copies) ? Math.max(1, Math.min(20, Math.round(copies))) : 1,
    scale: Number.isFinite(scale) ? Math.max(10, Math.min(200, Math.round(scale))) : 100,
  };
};
