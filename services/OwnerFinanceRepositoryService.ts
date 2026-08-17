import { getActiveRepositoryMode, getDataRepository } from '@/repositories/RepositoryRegistry';
import { ApiRepository } from '@/repositories/ApiRepository';
import type {
  OwnerFinanceFilters,
  OwnerFinanceSettings,
  OwnerFinanceWorkspace,
  OwnerWithdrawal,
  OwnerWithdrawalConcept,
} from '@/lib/OwnerFinanceService';
import {
  cancelOwnerWithdrawalLocal,
  createOwnerWithdrawalConceptLocal,
  createOwnerWithdrawalLocal,
  fetchOwnerFinanceWorkspaceLocal,
  saveOwnerFinanceSettingsLocal,
  updateOwnerWithdrawalConceptLocal,
} from '@/lib/OwnerFinanceLocalDataService';

export interface CreateOwnerWithdrawalInput {
  withdrawalDate: string;
  conceptId: string;
  amount: number;
  observations: string;
  accountId: string;
  paymentMethod: string;
}

function lanRepository(): ApiRepository {
  const repository = getDataRepository();
  if (!(repository instanceof ApiRepository)) {
    throw new Error('OWNER_FINANCE_LAN_REPOSITORY_UNAVAILABLE');
  }
  return repository;
}

export const OwnerFinanceRepositoryService = {
  fetchWorkspace(filters?: OwnerFinanceFilters): Promise<OwnerFinanceWorkspace> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().fetchOwnerFinanceWorkspace(filters);
    }
    return fetchOwnerFinanceWorkspaceLocal(filters);
  },

  createWithdrawal(input: CreateOwnerWithdrawalInput): Promise<OwnerWithdrawal> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().createOwnerWithdrawal(input);
    }
    return createOwnerWithdrawalLocal(input);
  },

  cancelWithdrawal(withdrawalId: string, reason: string): Promise<OwnerWithdrawal> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().cancelOwnerWithdrawal(withdrawalId, reason);
    }
    return cancelOwnerWithdrawalLocal(withdrawalId, reason);
  },

  createConcept(name: string): Promise<OwnerWithdrawalConcept> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().createOwnerWithdrawalConcept(name);
    }
    return createOwnerWithdrawalConceptLocal(name);
  },

  updateConcept(conceptId: string, changes: { name?: string; active?: boolean }): Promise<OwnerWithdrawalConcept> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().updateOwnerWithdrawalConcept(conceptId, changes);
    }
    return updateOwnerWithdrawalConceptLocal(conceptId, changes);
  },

  saveSettings(settings: OwnerFinanceSettings): Promise<OwnerFinanceSettings> {
    if (getActiveRepositoryMode() === 'lan') {
      return lanRepository().saveOwnerFinanceSettings(settings);
    }
    return saveOwnerFinanceSettingsLocal(settings);
  },
};
