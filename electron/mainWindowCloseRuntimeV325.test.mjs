import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath = new URL('./main.js', import.meta.url);

function preventableEvent() {
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('WAIT_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function loadHarness({ unsavedChoice = 1 } = {}) {
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => undefined;
  ipcMain.removeHandler = () => undefined;
  ipcMain.removeAllListeners = ipcMain.removeAllListeners.bind(ipcMain);

  const app = new EventEmitter();
  app.isPackaged = false;
  app.quitCalls = 0;
  app.didQuit = false;
  app.setName = () => undefined;
  app.setAppUserModelId = () => undefined;
  app.getPath = () => os.tmpdir();
  app.whenReady = () => new Promise(() => undefined);
  app.quit = () => {
    app.quitCalls += 1;
    const event = preventableEvent();
    app.emit('before-quit', event);
    if (!event.defaultPrevented) app.didQuit = true;
  };

  const dialogState = { unsavedChoice };
  const dialog = {
    showMessageBoxSync: () => dialogState.unsavedChoice,
    showMessageBox: async (_window, options = {}) => ({
      response: options.title === 'Confirmar salida' ? dialogState.unsavedChoice : 0,
    }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  };

  class MockWebContents extends EventEmitter {
    constructor(owner) {
      super();
      this.owner = owner;
      this.destroyed = false;
      this.sent = [];
      this.onSend = null;
    }
    isDestroyed() { return this.destroyed; }
    async executeJavaScript() { return this.owner.hasUnsavedChanges; }
    send(channel, payload) {
      this.sent.push({ channel, payload });
      this.onSend?.(channel, payload);
    }
  }

  class BrowserWindow extends EventEmitter {
    static instances = [];
    static getAllWindows() { return BrowserWindow.instances.filter(item => !item.destroyed); }
    constructor(options = {}) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = Boolean(options.show);
      this.hasUnsavedChanges = false;
      this.webContents = new MockWebContents(this);
      this.loadedUrl = '';
      BrowserWindow.instances.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setMenuBarVisibility() {}
    center() {}
    show() { this.visible = true; }
    focus() {}
    async loadURL(url) { this.loadedUrl = url; }
    async loadFile(file) { this.loadedUrl = file; }
    close() {
      if (this.destroyed) return;
      const closeEvent = preventableEvent();
      this.emit('close', closeEvent);
      if (closeEvent.defaultPrevented) return;
      if (this.hasUnsavedChanges) {
        const unloadEvent = preventableEvent();
        this.webContents.emit('will-prevent-unload', unloadEvent);
        if (!unloadEvent.defaultPrevented) return;
      }
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit('closed');
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit('closed');
    }
  }

  const noopAsync = async () => undefined;
  const mocks = {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell: { openPath: noopAsync },
    startLanServer: noopAsync,
    stopLanServer: noopAsync,
    getLanServerState: () => ({}),
    drainLanActivityEvents: () => [],
    publishLanRepositoryEvent: noopAsync,
    refreshLanServerNetworkAddress: noopAsync,
    setLanServerStateChangeListener: () => undefined,
    discoverLanServers: noopAsync,
    detectLanIpv4: () => '127.0.0.1',
    LanServerDescriptor: class {
      constructor() {}
      load() { return { addressMode: 'manual', enabled: false, port: 0 }; }
      update(value) { return value; }
      refreshDetectedIp() {}
      toJSON() { return {}; }
      reset() { return {}; }
    },
    startHttpsServer: noopAsync,
    stopHttpsServer: noopAsync,
    getHttpsServerSession: noopAsync,
    loginHttpsServer: noopAsync,
    logoutHttpsServer: noopAsync,
    readHttpsServerResource: noopAsync,
    testHttpsServerConnection: noopAsync,
    BACKUP_ROOT_DIRECTORY: 'JoyaControl',
    BackupFileService: class {
      async initialize() {}
      getStatus() { return {}; }
    },
  };

  globalThis.__JOYACONTROL_CLOSE_TEST_MOCKS = mocks;
  let source = await fs.readFile(sourcePath, 'utf8');
  source = source
    .replace('import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";', 'const { app, BrowserWindow, dialog, ipcMain, shell } = globalThis.__JOYACONTROL_CLOSE_TEST_MOCKS;')
    .replace(/import \{ startLanServer[^\n]+from "\.\/lanServer\.js";\n/, '')
    .replace(/import \{ discoverLanServers \} from "\.\/lanDiscovery\.js";\n/, '')
    .replace(/import \{ detectLanIpv4, LanServerDescriptor \} from "\.\/lanServerDescriptor\.js";\n/, '')
    .replace(/import \{ startHttpsServer, stopHttpsServer \} from "\.\/httpsServer\.js";\n/, '')
    .replace(/import \{ getHttpsServerSession[^\n]+from "\.\/httpsClient\.js";\n/, '')
    .replace(/import \{ BACKUP_ROOT_DIRECTORY, BackupFileService \} from "\.\/backupFileService\.js";\n/, '');
  source = source.replace(
    'const __filename = fileURLToPath(import.meta.url);',
    `const { startLanServer, stopLanServer, getLanServerState, drainLanActivityEvents, publishLanRepositoryEvent, refreshLanServerNetworkAddress, setLanServerStateChangeListener, discoverLanServers, detectLanIpv4, LanServerDescriptor, startHttpsServer, stopHttpsServer, getHttpsServerSession, loginHttpsServer, logoutHttpsServer, readHttpsServerResource, testHttpsServerConnection, BACKUP_ROOT_DIRECTORY, BackupFileService } = globalThis.__JOYACONTROL_CLOSE_TEST_MOCKS;\nconst __filename = fileURLToPath(import.meta.url);`,
  );
  source += '\nexport { createWindow, beginApplicationClose };\n';

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'joya-close-harness-'));
  const modulePath = path.join(directory, 'main-harness.mjs');
  await fs.writeFile(modulePath, source, 'utf8');
  const module = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}-${Math.random()}`);

  return {
    ...module,
    app,
    BrowserWindow,
    dialogState,
    ipcMain,
    cleanup: async () => {
      delete globalThis.__JOYACONTROL_CLOSE_TEST_MOCKS;
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

function answerCloseRequest(harness, window, responder) {
  window.webContents.onSend = (channel, payload) => {
    if (channel !== 'backup:before-quit') return;
    responder(payload);
  };
}

test('runtime: sin backup la X cierra y apaga una sola vez', async () => {
  const harness = await loadHarness();
  try {
    const window = await harness.createWindow();
    answerCloseRequest(harness, window, payload => {
      queueMicrotask(() => harness.ipcMain.emit('backup:before-quit-response', {}, {
        requestId: payload.requestId,
        result: { completed: true, waitedForBackup: false },
      }));
    });
    window.close();
    await waitFor(() => harness.app.didQuit);
    assert.equal(window.destroyed, true);
    assert.equal(harness.app.quitCalls, 1);
  } finally {
    await harness.cleanup();
  }
});

test('runtime: backup activo muestra espera y no cierra antes de la respuesta final', async () => {
  const harness = await loadHarness();
  try {
    const window = await harness.createWindow();
    answerCloseRequest(harness, window, payload => {
      harness.ipcMain.emit('backup:before-quit-progress', {}, { requestId: payload.requestId, phase: 'backup' });
      setTimeout(() => harness.ipcMain.emit('backup:before-quit-response', {}, {
        requestId: payload.requestId,
        result: { completed: true, waitedForBackup: true },
      }), 40);
    });
    window.close();
    await waitFor(() => harness.BrowserWindow.instances.length >= 2);
    const waitWindow = harness.BrowserWindow.instances[1];
    assert.equal(window.destroyed, false);
    await waitFor(() => waitWindow.visible);
    assert.match(decodeURIComponent(waitWindow.loadedUrl), /Guardando copia de seguridad/);
    await waitFor(() => harness.app.didQuit);
    assert.equal(window.destroyed, true);
  } finally {
    await harness.cleanup();
  }
});

test('runtime: cambios sin guardar permiten Cancelar y luego Salir', async () => {
  const harness = await loadHarness({ unsavedChoice: 1 });
  try {
    const window = await harness.createWindow();
    window.hasUnsavedChanges = true;
    let closeRequests = 0;
    answerCloseRequest(harness, window, payload => {
      closeRequests += 1;
      queueMicrotask(() => harness.ipcMain.emit('backup:before-quit-response', {}, {
        requestId: payload.requestId,
        result: { completed: true, waitedForBackup: false },
      }));
    });

    window.close();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closeRequests, 0);
    assert.equal(window.destroyed, false);
    assert.equal(harness.app.didQuit, false);

    harness.dialogState.unsavedChoice = 0;
    window.close();
    await waitFor(() => harness.app.didQuit);
    assert.equal(closeRequests, 1);
    assert.equal(window.destroyed, true);
  } finally {
    await harness.cleanup();
  }
});

test('runtime: pulsaciones repetidas durante la espera no duplican el handshake', async () => {
  const harness = await loadHarness();
  try {
    const window = await harness.createWindow();
    let closeRequests = 0;
    answerCloseRequest(harness, window, payload => {
      closeRequests += 1;
      setTimeout(() => harness.ipcMain.emit('backup:before-quit-response', {}, {
        requestId: payload.requestId,
        result: { completed: true, waitedForBackup: true },
      }), 40);
    });
    window.close();
    window.close();
    harness.app.quit();
    await waitFor(() => harness.app.didQuit);
    assert.equal(closeRequests, 1);
    assert.equal(harness.app.quitCalls, 2);
  } finally {
    await harness.cleanup();
  }
});
