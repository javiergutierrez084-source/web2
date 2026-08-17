import { loadLanConfig } from '@/lib/LanCommunicationConfig';
import { LanServerDescriptor } from '@/lib/LanServerDescriptor';

export type RepositoryMode = 'local' | 'lan';

export interface RepositoryConfig {
  mode: RepositoryMode;
  apiBaseUrl: string;
  requestTimeoutMs: number;
}

let runtimeRequestTimeoutMs: number | undefined;

/**
 * Repository selection remains derived from the authoritative LAN mode. The
 * remote address is always resolved from LanServerDescriptor; RepositoryConfig
 * never stores, reconstructs or overrides a server URL.
 */
export function getRepositoryConfig(): RepositoryConfig {
  const lan = loadLanConfig();
  const automaticMode: RepositoryMode = lan.mode === 'lan' && lan.role === 'client' ? 'lan' : 'local';
  return {
    mode: automaticMode,
    apiBaseUrl: automaticMode === 'lan' ? LanServerDescriptor.getBaseUrl() : LanServerDescriptor.toJSON().baseUrl,
    requestTimeoutMs: runtimeRequestTimeoutMs ?? lan.timeoutMs ?? 15_000,
  };
}

/** Test/runtime timeout override. Address overrides are deliberately ignored. */
export function configureRepository(config: Partial<RepositoryConfig>, _persist = false): void {
  if (config.requestTimeoutMs !== undefined) runtimeRequestTimeoutMs = config.requestTimeoutMs;
}

export function clearRepositoryRuntimeConfig(): void {
  runtimeRequestTimeoutMs = undefined;
}
