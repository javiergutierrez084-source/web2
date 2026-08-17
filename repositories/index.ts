export type { IDataRepository } from '@/repositories/IDataRepository';
export { DexieRepository } from '@/repositories/DexieRepository';
export { ApiRepository, type ApiRepositoryOptions } from '@/repositories/ApiRepository';
export {
  getDataRepository,
  getActiveRepositoryMode,
  resetDataRepository,
} from '@/repositories/RepositoryRegistry';
export {
  configureRepository,
  getRepositoryConfig,
  clearRepositoryRuntimeConfig,
  type RepositoryConfig,
  type RepositoryMode,
} from '@/repositories/RepositoryConfig';
