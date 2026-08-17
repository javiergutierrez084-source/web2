import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrintAgentCore } from './printAgentCore.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(agent, predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const workspace = agent.getWorkspace();
    if (predicate(workspace)) return workspace;
    await sleep(15);
  }
  throw new Error('TEST_TIMEOUT');
}

function jobInput(index, overrides = {}) {
  return {
    requestId: overrides.requestId || `request-${index}`,
    documentId: overrides.documentId || `document-${index}`,
    documentType: overrides.documentType || 'invoice',
    title: `Documento ${index}`,
    content: { kind: 'html', data: `<html><body>${index}</body></html>` },
    paperSize: 'Letter',
    orientation: 'portrait',
    copies: 1,
    silent: true,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'joyacontrol-print-agent-'));
  const storagePath = path.join(directory, 'queue.json');
  let printers = options.printers ?? [{ name: 'Printer A', displayName: 'Printer A', isDefault: true }];
  let active = 0;
  let maxActive = 0;
  const executions = [];
  const failures = new Map(Object.entries(options.failures || {}));
  const executePrint = async job => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    executions.push({ requestId: job.requestId, printer: job.printer || '', clientId: job.clientId, attempt: job.attempts });
    await sleep(options.printDelayMs ?? 5);
    active -= 1;
    const remaining = Number(failures.get(job.requestId) || 0);
    if (remaining > 0) {
      failures.set(job.requestId, remaining - 1);
      throw new Error('SIMULATED_PRINT_FAILURE');
    }
  };
  const agent = new PrintAgentCore({
    storagePath,
    executePrint,
    listPrinters: async () => printers,
    configuration: {
      retryDelayMs: 100,
      printerRefreshIntervalMs: 60_000,
      maxRetries: options.maxRetries ?? 2,
    },
    logger: { error() {} },
  });
  return {
    agent,
    storagePath,
    directory,
    executions,
    get maxActive() { return maxActive; },
    setPrinters(value) { printers = value; },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test('un cliente imprime una sola vez y requestId es idempotente', async () => {
  const h = createHarness();
  try {
    await h.agent.start();
    await h.agent.submitPrintJob(jobInput(1), { clientId: 'client-1', userId: 'user-1' });
    await h.agent.submitPrintJob(jobInput(1), { clientId: 'client-1', userId: 'user-1' });
    const workspace = await waitFor(h.agent, value => value.counts.COMPLETED === 1);
    assert.equal(workspace.jobs.length, 1);
    assert.equal(h.executions.length, 1);
    assert.equal(workspace.jobs[0].clientId, 'client-1');
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});

test('cinco clientes simultáneos se procesan estrictamente uno por uno', async () => {
  const h = createHarness({ printDelayMs: 15 });
  try {
    await h.agent.start();
    await Promise.all(Array.from({ length: 5 }, (_, index) => h.agent.submitPrintJob(
      jobInput(index + 1),
      { clientId: `client-${index + 1}`, userId: `user-${index + 1}` },
    )));
    await waitFor(h.agent, value => value.counts.COMPLETED === 5);
    assert.equal(h.executions.length, 5);
    assert.equal(h.maxActive, 1);
    assert.equal(new Set(h.executions.map(item => item.requestId)).size, 5);
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});

test('veinte trabajos consecutivos terminan sin duplicados', async () => {
  const h = createHarness();
  try {
    await h.agent.start();
    for (let index = 1; index <= 20; index += 1) {
      await h.agent.submitPrintJob(jobInput(index), { clientId: 'client-batch', userId: 'user-batch' });
    }
    await waitFor(h.agent, value => value.counts.COMPLETED === 20, 8_000);
    assert.equal(h.executions.length, 20);
    assert.equal(new Set(h.executions.map(item => item.requestId)).size, 20);
    assert.equal(h.maxActive, 1);
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});

test('reinicio recupera trabajos PENDING persistidos', async () => {
  const h = createHarness();
  try {
    const pending = {
      ...jobInput(99),
      printer: '',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      status: 'PENDING',
      attempts: 0,
      failureReason: null,
      clientId: 'client-restart',
      userId: 'user-restart',
    };
    fs.writeFileSync(h.storagePath, JSON.stringify({
      configuration: { retryDelayMs: 100, printerRefreshIntervalMs: 60_000, maxRetries: 2 },
      printers: [],
      jobs: [pending],
    }));
    await h.agent.start();
    const workspace = await waitFor(h.agent, value => value.counts.COMPLETED === 1);
    assert.equal(workspace.jobs[0].attempts, 1);
    assert.equal(h.executions.length, 1);
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});

test('impresora apagada marca ERROR y al volver reanuda; cambio de impresora y cancelación funcionan', async () => {
  const h = createHarness({ printers: [] });
  try {
    await h.agent.start();
    await h.agent.submitPrintJob(jobInput(1, { printer: 'Printer A' }));
    await waitFor(h.agent, value => value.counts.ERROR === 1);
    assert.equal(h.executions.length, 0);

    h.setPrinters([
      { name: 'Printer A', displayName: 'Printer A', isDefault: true },
      { name: 'Printer B', displayName: 'Printer B', isDefault: false },
    ]);
    await h.agent.refreshPrinters();
    await waitFor(h.agent, value => value.counts.COMPLETED === 1);

    await h.agent.submitPrintJob(jobInput(2, { printer: 'Printer B' }));
    await waitFor(h.agent, value => value.counts.COMPLETED === 2);
    assert.equal(h.executions.find(item => item.requestId === 'request-2')?.printer, 'Printer B');

    h.setPrinters([]);
    await h.agent.refreshPrinters();
    await h.agent.submitPrintJob(jobInput(3, { printer: 'Printer C' }));
    await waitFor(h.agent, value => value.jobs.some(job => job.requestId === 'request-3' && job.status === 'ERROR'));
    const cancelled = await h.agent.cancelPrintJob({ requestId: 'request-3' });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(h.executions.filter(item => item.requestId === 'request-3').length, 0);
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});

test('reintento automático y reimpresión completan sin duplicar el trabajo original', async () => {
  const h = createHarness({ failures: { 'request-1': 1 } });
  try {
    await h.agent.start();
    await h.agent.submitPrintJob(jobInput(1));
    let workspace = await waitFor(h.agent, value => value.jobs.some(job => job.requestId === 'request-1' && job.status === 'COMPLETED'), 5_000);
    const original = workspace.jobs.find(job => job.requestId === 'request-1');
    assert.equal(original.attempts, 2);
    assert.equal(h.executions.filter(item => item.requestId === 'request-1').length, 2);

    await h.agent.reprintPrintJob({ requestId: 'request-1', newRequestId: 'request-1-copy' });
    workspace = await waitFor(h.agent, value => value.jobs.some(job => job.requestId === 'request-1-copy' && job.status === 'COMPLETED'));
    const copy = workspace.jobs.find(job => job.requestId === 'request-1-copy');
    assert.equal(copy.sourceRequestId, 'request-1');
    assert.equal(h.executions.filter(item => item.requestId === 'request-1-copy').length, 1);
  } finally {
    await h.agent.stop();
    h.cleanup();
  }
});
