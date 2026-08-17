import type { IDataRepository } from '@/repositories/IDataRepository';
import { DexieRepository } from '@/repositories/DexieRepository';
import { ApiRepository } from '@/repositories/ApiRepository';
import { getRepositoryConfig, type RepositoryMode } from '@/repositories/RepositoryConfig';

let activeRepository: IDataRepository | null = null;
let activeKey = '';

function buildRepository(): IDataRepository {
  const config = getRepositoryConfig();
  if (config.mode === 'lan') {
    return new ApiRepository({
      baseUrl: config.apiBaseUrl,
      timeoutMs: config.requestTimeoutMs,
      getAccessToken: () => {
        try {
          return sessionStorage.getItem('joyacontrol_lan_access_token');
        } catch {
          return null;
        }
      },
    });
  }
  return new DexieRepository();
}

export function getDataRepository(): IDataRepository {
  const config = getRepositoryConfig();
  const key = `${config.mode}|${config.apiBaseUrl}|${config.requestTimeoutMs}`;
  if (!activeRepository || activeKey !== key) {
    activeRepository = buildRepository();
    activeKey = key;
  }
  return activeRepository;
}

export function getActiveRepositoryMode(): RepositoryMode {
  return getRepositoryConfig().mode;
}

/** Test/startup hook. A mode change should be followed by an application reload. */
export function resetDataRepository(): void {
  activeRepository = null;
  activeKey = '';
}
