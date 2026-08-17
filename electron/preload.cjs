"use strict";
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('joyaControlLan', {
  getServerDescriptorSync: () => ipcRenderer.sendSync('lan-server-descriptor:get-sync'),
  saveServerDescriptorSync: (descriptor) => ipcRenderer.sendSync('lan-server-descriptor:save-sync', descriptor),
  loadServerDescriptor: () => ipcRenderer.invoke('lan-server-descriptor:load'),
  saveServerDescriptor: (descriptor) => ipcRenderer.invoke('lan-server-descriptor:save', descriptor),
  resetServerDescriptor: () => ipcRenderer.invoke('lan-server-descriptor:reset'),
  detectLanIp: () => ipcRenderer.invoke('lan-network-detect-ip'),
  notifyRepositoryChanged: (type) => ipcRenderer.invoke('lan-repository-event:publish', type),
  startServer: (config) => ipcRenderer.invoke('lan-server-start', config),
  stopServer: () => ipcRenderer.invoke('lan-server-stop'),
  getServerStatus: () => ipcRenderer.invoke('lan-server-status'),
  getActivityEvents: () => ipcRenderer.invoke('lan-server-activity-events'),
  getSystemIdentity: () => ipcRenderer.invoke('lan-system-identity'),
  discoverServers: (options) => ipcRenderer.invoke('lan-network-discover', options),
  onLanEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('lan-server-event', listener);
    return () => ipcRenderer.removeListener('lan-server-event', listener);
  },
  onServerStateChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('lan-server-state-changed', listener);
    return () => ipcRenderer.removeListener('lan-server-state-changed', listener);
  },
  onRepositoryRequest: (handler) => {
    const listener = async (_event, request) => {
      try {
        const data = await handler(request);
        ipcRenderer.send('lan-repository:response', { requestId: request.requestId, result: { success: true, data } });
      } catch (error) {
        ipcRenderer.send('lan-repository:response', { requestId: request.requestId, result: { success: false, error: error instanceof Error ? error.message : 'LAN_REPOSITORY_CALL_FAILED' } });
      }
    };
    ipcRenderer.on('lan-repository:request', listener);
    return () => ipcRenderer.removeListener('lan-repository:request', listener);
  },
  onAuthRequest: (handler) => {
    const listener = async (_event, request) => {
      const result = await handler(request);
      ipcRenderer.send('lan-auth:response', { requestId: request.requestId, result });
    };
    ipcRenderer.on('lan-auth:request', listener);
    return () => ipcRenderer.removeListener('lan-auth:request', listener);
  },
});

contextBridge.exposeInMainWorld('joyaControlHttps', {
  testConnection: (options) => ipcRenderer.invoke('https-server:test-connection', options),
  login: (options) => ipcRenderer.invoke('https-server:login', options),
  getSession: (options) => ipcRenderer.invoke('https-server:session', options),
  logout: (options) => ipcRenderer.invoke('https-server:logout', options),
  read: (options) => ipcRenderer.invoke('https-server:read', options),
  onAuthRequest: (handler) => {
    const listener = async (_event, request) => {
      try {
        const result = await handler(request);
        ipcRenderer.send('https-auth:response', { requestId: request.requestId, result });
      } catch (error) {
        ipcRenderer.send('https-auth:response', {
          requestId: request.requestId,
          result: { success: false, error: error instanceof Error ? error.message : 'HTTPS_AUTH_FAILED' },
        });
      }
    };
    ipcRenderer.on('https-auth:request', listener);
    return () => ipcRenderer.removeListener('https-auth:request', listener);
  },
  onReadRequest: (handler) => {
    const listener = async (_event, request) => {
      try {
        const data = await handler(request);
        ipcRenderer.send('https-read:response', { requestId: request.requestId, result: { success: true, data } });
      } catch (error) {
        ipcRenderer.send('https-read:response', {
          requestId: request.requestId,
          result: { success: false, error: error instanceof Error ? error.message : 'HTTPS_READ_PROVIDER_FAILED' },
        });
      }
    };
    ipcRenderer.on('https-read:request', listener);
    return () => ipcRenderer.removeListener('https-read:request', listener);
  },
});

contextBridge.exposeInMainWorld('joyaControlBackup', {
  selectFolder: () => ipcRenderer.invoke('backup:select-folder'),
  setFolder: (folderPath) => ipcRenderer.invoke('backup:set-folder', folderPath),
  getStatus: () => ipcRenderer.invoke('backup:get-status'),
  validateFolder: (folderPath) => ipcRenderer.invoke('backup:validate-folder', folderPath),
  writeBackup: (payload) => ipcRenderer.invoke('backup:write-file', payload),
  openFolder: (folderPath) => ipcRenderer.invoke('backup:open-folder', folderPath),
  onBeforeQuit: (handler) => {
    const listener = async (_event, request) => {
      const reportProgress = (progress = {}) => {
        ipcRenderer.send('backup:before-quit-progress', {
          requestId: request.requestId,
          ...progress,
        });
      };
      try {
        const result = await handler(request, reportProgress);
        ipcRenderer.send('backup:before-quit-response', { requestId: request.requestId, result });
      } catch (error) {
        ipcRenderer.send('backup:before-quit-response', {
          requestId: request.requestId,
          result: { completed: false, reason: error instanceof Error ? error.message : 'BACKUP_BEFORE_QUIT_FAILED' },
        });
      }
    };
    ipcRenderer.on('backup:before-quit', listener);
    return () => ipcRenderer.removeListener('backup:before-quit', listener);
  },
});

contextBridge.exposeInMainWorld('joyaControlApp', {
  reportSessionState: (state) => ipcRenderer.send('app-session:state', state),
  requestLogout: (options) => ipcRenderer.invoke('app-session:logout', options),
  onPrepareClose: (handler) => {
    const listener = async (_event, request) => {
      try {
        const result = await handler(request);
        ipcRenderer.send('app-close:prepare-response', { requestId: request.requestId, result });
      } catch (error) {
        ipcRenderer.send('app-close:prepare-response', {
          requestId: request.requestId,
          result: { completed: false, reason: error instanceof Error ? error.message : 'APP_CLOSE_PREPARE_FAILED' },
        });
      }
    };
    ipcRenderer.on('app-close:prepare', listener);
    return () => ipcRenderer.removeListener('app-close:prepare', listener);
  },
});
