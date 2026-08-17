/// <reference types="vite/client" />

interface LanServerDescriptorPayload {
  type?: 'lan' | 'online';
  serverId: string;
  companyId: string;
  serverName: string;
  ip: string;
  port: number;
  protocolVersion: string;
  baseUrl: string;
  enabled?: boolean;
  allowMultipleUserSessions?: boolean;
  addressMode?: 'automatic' | 'remote';
  lastLanIp?: string;
  ipSource?: 'automatic' | 'persisted' | 'discovered' | 'manual' | 'unavailable';
  ipUpdatedAt?: string | null;
  networkAvailable?: boolean;
}

interface LanServerRuntimeState {
  running: boolean;
  serverId?: string;
  companyId?: string;
  serverName?: string;
  ip?: string;
  port?: number;
  baseUrl?: string;
  protocolVersion?: string;
  startedAt?: string | null;
  connectedClients?: number;
  activeClients?: number;
  inactiveClients?: number;
  requestsHandled?: number;
  heartbeatsReceived?: number;
  averageResponseTimeMs?: number;
  connectedUsers?: number;
  activeUserSessions?: number;
  averageUserSessionSeconds?: number;
  lastLanIp?: string | null;
  ipSource?: 'automatic' | 'persisted' | 'discovered' | 'manual' | 'unavailable';
  ipUpdatedAt?: string | null;
  networkAvailable?: boolean;
}


declare global {
  interface NavigatorUAData {
    platform?: string;
  }

  interface Navigator {
    readonly userAgentData?: NavigatorUAData;
  }

  interface Error {
    cause?: unknown;
  }

  interface HttpsServerHealthPayload {
    server: 'active';
    active: true;
    date: string;
    uptime: number;
    protocol: 'HTTPS';
    version: string;
  }
  
  interface HttpsServerInfoPayload {
    serverId: string;
    serverName: string;
    version: string;
    hostname: string;
    online: true;
    uptime: number;
  }
  
  interface HttpsServerConnectionSuccess {
    ok: true;
    errorCode?: never;
    errorMessage?: never;
    endpoint: { url: string; port: number; baseUrl: string };
    latencyMs: number;
    tlsProtocol: string | null;
    health: HttpsServerHealthPayload;
    serverInfo: HttpsServerInfoPayload;
  }
  
  interface HttpsServerConnectionFailure {
    ok: false;
    errorCode: string;
    errorMessage: string;
  }
  
  type HttpsServerConnectionResult = HttpsServerConnectionSuccess | HttpsServerConnectionFailure;

  interface HttpsLoginSessionPayload {
    sessionId: string;
    serverId: string;
    usuario: string;
    nombre: string;
    rol: string;
    fecha: string;
    expiracion: string;
    version: string;
  }

  interface HttpsSessionStatusPayload {
    usuario: string;
    nombre: string;
    rol: string;
    hostname: string;
    serverId: string;
    version: string;
    estado: 'active';
    fecha: string;
    expiracion: string;
  }

  interface HttpsServerLoginSuccess {
    ok: true;
    errorCode?: never;
    errorMessage?: never;
    endpoint: { url: string; port: number; baseUrl: string };
    session: HttpsLoginSessionPayload;
  }

  interface HttpsServerSessionSuccess {
    ok: true;
    errorCode?: never;
    errorMessage?: never;
    endpoint: { url: string; port: number; baseUrl: string };
    session: HttpsSessionStatusPayload;
  }

  interface HttpsServerLogoutSuccess {
    ok: true;
    errorCode?: never;
    errorMessage?: never;
    endpoint: { url: string; port: number; baseUrl: string };
    sessionClosed: true;
  }

  type HttpsServerLoginResult = HttpsServerLoginSuccess | HttpsServerConnectionFailure;
  type HttpsServerSessionResult = HttpsServerSessionSuccess | HttpsServerConnectionFailure;
  type HttpsServerLogoutResult = HttpsServerLogoutSuccess | HttpsServerConnectionFailure;

  interface OnlineApiSessionPayload {
    sessionId: string;
    serverId: string;
    userId: string;
    username: string;
    displayName: string;
    role: string;
    permissions: string[];
    createdAt: string;
    expiresAt: string;
    version: string;
    protocol: 'ONLINE-1';
  }

  interface OnlineApiProbeResult {
    ok: true;
    baseUrl: string;
    health: { status: string; version: string; protocol: 'ONLINE-1'; database: string; serverName?: string; serverId?: string; uptime?: number };
    serverInfo: { serverId: string; serverName: string; version: string; protocol: 'ONLINE-1'; database: string; hostname?: string; online?: true; uptime?: number };
  }

  interface Window {
    joyaControlLan?: {
      getServerDescriptorSync(): LanServerDescriptorPayload;
      saveServerDescriptorSync(descriptor: Partial<LanServerDescriptorPayload>): LanServerDescriptorPayload;
      loadServerDescriptor(): Promise<LanServerDescriptorPayload>;
      saveServerDescriptor(descriptor: Partial<LanServerDescriptorPayload>): Promise<LanServerDescriptorPayload>;
      resetServerDescriptor(): Promise<LanServerDescriptorPayload>;
      detectLanIp(): Promise<{ hostname: string; ip: string }>;
      startServer(config?: { host?: string; ip?: string; port?: number; serverName?: string; allowMultipleUserSessions?: boolean }): Promise<LanServerRuntimeState>;
      stopServer(): Promise<LanServerRuntimeState>;
      getServerStatus(): Promise<LanServerRuntimeState>;
      getActivityEvents(): Promise<Array<{ id: string; action: string; createdAt: string; details: Record<string, unknown> }>>;
      getSystemIdentity(): Promise<{ hostname: string; ip: string }>;
      discoverServers(options: { port: number; timeoutMs: number; knownIp?: string }): Promise<Array<{ serverId: string; serverName: string; companyId: string; company: string; version: string; protocolVersion: string; repository: string; mode: string; maxClients: number; connectedClients: number; features: { sales: boolean; inventory: boolean; reports: boolean; sync: boolean }; ip: string; port: number; latencyMs: number }>>;
      listLocalClients(): Promise<unknown[]>;
      listLocalUsers(): Promise<unknown[]>;
      maintainLocalClients(request: { action: 'remove-client' | 'remove-disconnected' | 'remove-older-than'; clientId?: string; days?: 30 | 60 | 90 | 180; actor: { userId: string; username: string; displayName: string; role: string } }): Promise<{ success: boolean; action: string; removedCount: number; removed: unknown[]; registeredClients: number; connectedClients: number }>;
      notifyRepositoryChanged?(type: 'PRODUCTS_UPDATED' | 'CATEGORIES_UPDATED'): Promise<{ sequence: number; type: string; createdAt: string } | null>;
      onLanEvent?(handler: (payload: { reason: string; eventType?: string; details?: Record<string, unknown>; state: LanServerRuntimeState }) => void): () => void;
      onServerStateChanged?(handler: (payload: { reason: string; state: LanServerRuntimeState }) => void): () => void;
      onAuthRequest?(handler: (request: { requestId: string; username: string; password: string }) => Promise<Record<string, unknown>>): () => void;
      onRepositoryRequest?(handler: (request: { requestId: string; method: string; args?: Record<string, unknown> }) => Promise<unknown>): () => void;
    };
    joyaControlHttps?: {
      testConnection(options: { url: string; port?: number; timeoutMs?: number }): Promise<HttpsServerConnectionResult>;
      login(options: {
        url: string;
        port?: number;
        username: string;
        password: string;
        clientVersion: string;
        expectedServerId?: string;
        expectedVersion?: string;
        timeoutMs?: number;
      }): Promise<HttpsServerLoginResult>;
      getSession(options: {
        url: string;
        port?: number;
        sessionId: string;
        expectedServerId?: string;
        expectedVersion?: string;
        timeoutMs?: number;
      }): Promise<HttpsServerSessionResult>;
      logout(options: {
        url: string;
        port?: number;
        sessionId: string;
        expectedServerId?: string;
        expectedVersion?: string;
        timeoutMs?: number;
      }): Promise<HttpsServerLogoutResult>;
      read?<T = unknown>(options: {
        url: string;
        port?: number;
        sessionId: string;
        resource: string;
        args?: Record<string, unknown>;
        expectedServerId?: string;
        expectedVersion?: string;
        timeoutMs?: number;
      }): Promise<
        | { ok: true; resource: string; data: T; latencyMs: number; communicatedAt: string; tlsProtocol?: string | null }
        | HttpsServerConnectionFailure
      >;
      onReadRequest?(handler: (request: {
        requestId: string;
        resource: string;
        args?: Record<string, unknown>;
      }) => Promise<unknown>): () => void;
      onAuthRequest?(handler: (request: {
        requestId: string;
        username: string;
        password: string;
      }) => Promise<Record<string, unknown>>): () => void;
    };
    joyaControlApp?: {
      reportSessionState(state: { authenticated: boolean; mode: 'server' | 'client' | 'online' | 'local' }): void;
      requestLogout(options?: { mode?: 'server' | 'client' | 'local' }): Promise<{ completed: boolean; cancelled?: boolean }>;
      onPrepareClose(handler: (request: { requestId: string; logout: boolean }) => Promise<{
        completed: boolean;
        authenticated: boolean;
        mode: 'server' | 'client' | 'online' | 'local';
        backupActive: boolean;
        reason?: string;
      }>): () => void;
    };
    joyaControlOnline?: {
      probe(options: { baseUrl: string; timeoutMs?: number }): Promise<OnlineApiProbeResult>;
      login(options: { baseUrl: string; username: string; password: string; timeoutMs?: number }): Promise<{ ok: true; baseUrl: string; session: OnlineApiSessionPayload }>;
      session(options: { baseUrl: string; sessionId: string; timeoutMs?: number }): Promise<{ ok: true; baseUrl: string; session: OnlineApiSessionPayload }>;
      logout(options: { baseUrl: string; sessionId: string; timeoutMs?: number }): Promise<{ ok: true; baseUrl: string; result: { success: boolean; protocol: 'ONLINE-1' } }>;
      call<T = unknown>(options: { baseUrl: string; sessionId: string; operation: string; args?: unknown[]; timeoutMs?: number }): Promise<T>;
    };
    joyaControlOnlineServer?: {
      onRepositoryRequest(handler: (request: {
        requestId: string;
        operation: string;
        args?: unknown[];
        session: { id: string; username: string; displayName: string; role: string; permissions: string[] };
      }) => Promise<unknown>): () => void;
    };
    joyaControlBackup?: {
      selectFolder(): Promise<{
        canceled: boolean;
        folderPath?: string;
        status?: {
          configuredFolder: string;
          rootPath: string;
          external: Record<string, unknown>;
        };
      }>;
      setFolder(folderPath: string): Promise<{
        configuredFolder: string;
        rootPath: string;
        external: Record<string, unknown>;
      }>;
      getStatus(): Promise<{
        configuredFolder: string;
        rootPath: string;
        external: {
          status: 'not-configured' | 'ready' | 'success' | 'error';
          lastSuccessAt: string | null;
          lastAttemptAt: string | null;
          lastErrorAt: string | null;
          lastError: string | null;
          lastFilePath: string | null;
          lastChecksum: string | null;
          lastSize: number;
        };
      }>;
      validateFolder(folderPath?: string): Promise<
        | { ok: true; baseFolder: string; rootPath: string }
        | { ok: false; code: string; message: string }
      >;
      writeBackup(payload: {
        baseFolder: string;
        category: 'AUTO' | 'MANUAL' | 'RESTORE_POINTS';
        createdAt: string;
        content: string;
        expectedSha256: string;
      }): Promise<{
        ok: true;
        category: string;
        rootPath: string;
        directoryPath: string;
        filePath: string;
        fileName: string;
        size: number;
        checksum: string;
        createdAt: string;
      }>;
      openFolder(folderPath?: string): Promise<{ opened: true; rootPath: string }>;
      onBeforeQuit(handler: (
        request: { requestId: string },
        reportProgress: (progress: { phase: 'backup' | 'finalizing' }) => void,
      ) => Promise<Record<string, unknown>>): () => void;
    };
  }
}
export {};
