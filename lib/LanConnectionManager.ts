import {
  ensureLanClientSession,
  loadLanConfig,
  normalizeHeartbeatIntervalSeconds,
  rediscoverTrustedLanServer,
  restoreLanUser,
  sendLanHeartbeat,
} from '@/lib/LanCommunicationConfig';
import { LanServerDescriptor } from '@/lib/LanServerDescriptor';

export type LanGlobalConnectionState = 'CONNECTING' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
export type LanGlobalEvent = 'SERVER_ONLINE' | 'SERVER_OFFLINE' | 'SERVER_RECONNECTING' | 'PRODUCTS_UPDATED' | 'CATEGORIES_UPDATED' | 'CLIENT_RECONNECTED' | 'AUTH_RESTORED';
export interface LanConnectionEventDetail { type: LanGlobalEvent; state: LanGlobalConnectionState; reason?: string; sequence?: number; at: string; }
type Listener = (detail: LanConnectionEventDetail) => void;

const FAILURE_THRESHOLD = 3;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15000;
const RECONNECT_TIMEOUT_MIN_MS = 10000;
const RECONNECT_TIMEOUT_MAX_MS = 60000;
const APP_VERSION = '2.1';
const RUNTIME_DIAGNOSTICS_EVENT = 'joyacontrol-lan-runtime-diagnostics';

export interface LanRuntimeDiagnosticsSnapshot {
  lastHeartbeatSent: string | null;
  lastHeartbeatReceived: string | null;
  timerState: 'stopped' | 'running' | 'retrying';
  reconnectAttempts: number;
  lastPingAgeMs: number | null;
  autoReconnect: boolean;
  lastDisconnectReason: string | null;
  lastReconnect: string | null;
  reconnectCount: number;
  watcherState: 'stopped' | 'watching' | 'recovering';
  lastIpChange: string | null;
  timeWithoutServerMs: number;
}

function boundedTimeout(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function reconnectTimeoutMs(configTimeoutMs: number): number {
  return boundedTimeout(configTimeoutMs * 4 + 8000, RECONNECT_TIMEOUT_MIN_MS, RECONNECT_TIMEOUT_MAX_MS);
}

function heartbeatTimeoutMs(configTimeoutMs: number): number {
  return boundedTimeout(configTimeoutMs + 500, 1000, RECONNECT_TIMEOUT_MAX_MS);
}

function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutError: string,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(timeoutError);
      onTimeout();
      reject(error);
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(
        value => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          resolve(value);
        },
        error => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          reject(error);
        },
      );
  });
}

class Manager {
  private state: LanGlobalConnectionState = 'OFFLINE';
  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private running = false;
  private failures = 0;
  private reconnecting: Promise<void> | null = null;
  private reconnectAbortController: AbortController | null = null;
  private heartbeatAbortController: AbortController | null = null;
  private lastEventSequence = 0;
  private cleanupListeners: (() => void) | null = null;
  private lastHeartbeatSent: string | null = null;
  private lastHeartbeatReceived: string | null = null;
  private timerState: LanRuntimeDiagnosticsSnapshot['timerState'] = 'stopped';
  private reconnectAttempts = 0;
  private lastDisconnectReason: string | null = null;
  private lastReconnect: string | null = null;
  private reconnectCount = 0;
  private lastIpChange: string | null = null;
  private offlineSince: number | null = null;

  getConnectionState() { return this.state; }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  getRuntimeDiagnostics(): LanRuntimeDiagnosticsSnapshot {
    const config = loadLanConfig();
    const heartbeatAt = this.lastHeartbeatReceived ? new Date(this.lastHeartbeatReceived).getTime() : NaN;
    return {
      lastHeartbeatSent: this.lastHeartbeatSent,
      lastHeartbeatReceived: this.lastHeartbeatReceived,
      timerState: this.timerState,
      reconnectAttempts: this.reconnectAttempts,
      lastPingAgeMs: Number.isFinite(heartbeatAt) ? Math.max(0, Date.now() - heartbeatAt) : null,
      autoReconnect: config.autoReconnect,
      lastDisconnectReason: this.lastDisconnectReason,
      lastReconnect: this.lastReconnect,
      reconnectCount: this.reconnectCount,
      watcherState: !this.running ? 'stopped' : this.state === 'ONLINE' ? 'watching' : 'recovering',
      lastIpChange: this.lastIpChange,
      timeWithoutServerMs: this.offlineSince == null ? 0 : Math.max(0, Date.now() - this.offlineSince),
    };
  }

  private publishRuntimeDiagnostics() {
    window.dispatchEvent(new CustomEvent(RUNTIME_DIAGNOSTICS_EVENT, {
      detail: this.getRuntimeDiagnostics(),
    }));
  }

  private emit(type: LanGlobalEvent, reason?: string, sequence?: number) {
    const detail = { type, state: this.state, reason, sequence, at: new Date().toISOString() };
    this.listeners.forEach(listener => listener(detail));
    window.dispatchEvent(new CustomEvent('joyacontrol-lan-manager-event', { detail }));
    this.publishRuntimeDiagnostics();
  }

  private setState(next: LanGlobalConnectionState, event?: LanGlobalEvent, reason?: string) {
    const changed = this.state !== next;
    this.state = next;
    if (event && (changed || event === 'SERVER_RECONNECTING')) this.emit(event, reason);
  }

  private schedule(delay: number) {
    if (!this.running) return;
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timerState = delay > 0 && this.state !== 'ONLINE' ? 'retrying' : 'running';
    this.timer = window.setTimeout(() => void this.cycle(), delay);
    this.publishRuntimeDiagnostics();
  }

  private async reconnect() {
    if (this.reconnecting) return this.reconnecting;

    this.setState('RECONNECTING', 'SERVER_RECONNECTING');
    this.reconnectAttempts += 1;
    this.publishRuntimeDiagnostics();
    const initialConfig = loadLanConfig();
    const timeoutMs = reconnectTimeoutMs(initialConfig.timeoutMs);
    const controller = new AbortController();
    this.reconnectAbortController = controller;

    const reconnectPromise = withTimeout(async () => {
      let config = initialConfig;
      const descriptorBefore = LanServerDescriptor.toJSON();
      try {
        LanServerDescriptor.getBaseUrl();
        config = await ensureLanClientSession(APP_VERSION, controller.signal);
      } catch (firstError) {
        if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : firstError;
        if (!config.autoReconnect) throw firstError;
        config = await rediscoverTrustedLanServer(config, controller.signal);
        LanServerDescriptor.getBaseUrl();
        config = await ensureLanClientSession(APP_VERSION, controller.signal);
      }

      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error('LAN_RECONNECT_ABORTED');
      const descriptorAfter = LanServerDescriptor.toJSON();
      const ipChanged = descriptorBefore.ip !== descriptorAfter.ip;
      if (ipChanged) this.lastIpChange = new Date().toISOString();
      this.lastReconnect = new Date().toISOString();
      this.reconnectCount += 1;
      this.emit('CLIENT_RECONNECTED', ipChanged ? 'LAN_SERVER_IP_CHANGED' : undefined);

      if (config.authToken) {
        const restored = await restoreLanUser(config, controller.signal);
        if (!restored) throw new Error('LAN_AUTH_RESTORE_FAILED');
        this.emit('AUTH_RESTORED');
      }

      if (!this.running || controller.signal.aborted) throw new Error('LAN_RECONNECT_ABORTED');
      this.setState('ONLINE', 'SERVER_ONLINE');
    }, timeoutMs, 'LAN_RECONNECT_TIMEOUT', () => controller.abort(new Error('LAN_RECONNECT_TIMEOUT')));

    let wrappedReconnectPromise: Promise<void>;
    wrappedReconnectPromise = reconnectPromise.finally(() => {
      if (this.reconnectAbortController === controller) this.reconnectAbortController = null;
      if (this.reconnecting === wrappedReconnectPromise) this.reconnecting = null;
    });
    this.reconnecting = wrappedReconnectPromise;
    return wrappedReconnectPromise;
  }

  private processEvents(events: Array<{ sequence?: number; type?: string }> = [], latest = 0) {
    for (const event of events) {
      const sequence = Number(event.sequence) || 0;
      if (sequence <= this.lastEventSequence) continue;
      this.lastEventSequence = sequence;
      if (event.type === 'PRODUCTS_UPDATED' || event.type === 'CATEGORIES_UPDATED') {
        this.emit(event.type, undefined, sequence);
      }
    }
    if (latest > this.lastEventSequence) this.lastEventSequence = latest;
  }

  private async heartbeat() {
    const config = loadLanConfig();
    const controller = new AbortController();
    this.heartbeatAbortController = controller;
    this.lastHeartbeatSent = new Date().toISOString();
    this.publishRuntimeDiagnostics();
    try {
      const response = await withTimeout(
        () => sendLanHeartbeat(config, this.lastEventSequence, controller.signal),
        heartbeatTimeoutMs(config.timeoutMs),
        'LAN_HEARTBEAT_TIMEOUT',
        () => controller.abort(new Error('LAN_HEARTBEAT_TIMEOUT')),
      );
      this.lastHeartbeatReceived = new Date().toISOString();
      this.publishRuntimeDiagnostics();
      return response;
    } finally {
      if (this.heartbeatAbortController === controller) this.heartbeatAbortController = null;
    }
  }

  private async cycle() {
    if (!this.running) return;
    const config = loadLanConfig();
    if (config.mode !== 'lan' || config.role !== 'client') {
      this.state = 'OFFLINE';
      return;
    }
    if (!navigator.onLine) {
      this.failures = FAILURE_THRESHOLD;
      this.setState('OFFLINE', 'SERVER_OFFLINE', 'LAN_NETWORK_LOST');
      this.schedule(RETRY_MIN_MS);
      return;
    }

    try {
      if (!LanServerDescriptor.hasAddress() || !config.clientId || !config.sessionToken || this.state !== 'ONLINE') {
        await this.reconnect();
      }
      if (!this.running) return;

      const response = await this.heartbeat();
      if (!this.running) return;
      this.processEvents(response.events, response.latestEventSequence);
      this.failures = 0;
      this.reconnectAttempts = 0;
      this.lastDisconnectReason = null;
      this.offlineSince = null;
      this.setState('ONLINE', this.state === 'ONLINE' ? undefined : 'SERVER_ONLINE');
      this.schedule(normalizeHeartbeatIntervalSeconds(config.heartbeatIntervalSeconds) * 1000);
    } catch (error) {
      if (!this.running) return;
      const reason = error instanceof Error ? error.message : 'LAN_SERVER_UNAVAILABLE';
      this.lastDisconnectReason = reason;
      if (this.offlineSince == null) this.offlineSince = Date.now();
      this.failures += 1;
      // Never destroy client/session identity merely because an old DHCP address
      // answered. Reconnection first rediscovers and validates the trusted serverId.
      if (this.failures >= FAILURE_THRESHOLD) this.setState('OFFLINE', 'SERVER_OFFLINE', reason);
      else this.setState('RECONNECTING', 'SERVER_RECONNECTING', reason);
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(this.failures, 4)));
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state = 'CONNECTING';
    this.timerState = 'running';
    const resume = () => this.schedule(0);
    window.addEventListener('online', resume);
    window.addEventListener('joyacontrol-lan-config-changed', resume);
    window.addEventListener(LanServerDescriptor.changedEvent, resume);
    this.cleanupListeners = () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('joyacontrol-lan-config-changed', resume);
      window.removeEventListener(LanServerDescriptor.changedEvent, resume);
    };
    this.schedule(0);
    this.publishRuntimeDiagnostics();
  }

  stop() {
    this.running = false;
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    this.reconnectAbortController?.abort(new Error('LAN_MANAGER_STOPPED'));
    this.reconnectAbortController = null;
    this.heartbeatAbortController?.abort(new Error('LAN_MANAGER_STOPPED'));
    this.heartbeatAbortController = null;
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    this.timerState = 'stopped';
    this.publishRuntimeDiagnostics();
  }
}

export const LanConnectionManager = new Manager();
