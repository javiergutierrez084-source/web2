import { normalizeCategoryKey, normalizeCategoryName } from '@/lib/localDb';
import type { CategoryRecord } from '@/domain/models';
import { getDataRepository } from '@/repositories/RepositoryRegistry';

/**
 * In-memory session used during a single bulk-import run.
 * Avoids hitting IndexedDB for every row: loads all existing categories once,
 * then resolves/creates new ones purely in memory, persisting at the end.
 */
export class CategoryResolver {
  private byKey: Map<string, CategoryRecord> = new Map();
  private createdThisRun: CategoryRecord[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const existing = await getDataRepository().fetchCategories();
    for (const cat of existing) {
      this.byKey.set(cat.name_key, cat);
    }
    this.loaded = true;
  }

  /**
   * Resolve a raw category string to a normalized category name.
   * Creates it in-memory if it doesn't exist yet (does not hit the DB per-row).
   * Returns the normalized display name to assign to the product.
   */
  resolve(rawName: string): { name: string; isNew: boolean } {
    const key = normalizeCategoryKey(rawName);
    const existing = this.byKey.get(key);
    if (existing) {
      return { name: existing.name, isNew: false };
    }

    const displayName = normalizeCategoryName(rawName);
    const newCategory: CategoryRecord = {
      id: crypto.randomUUID(),
      name: displayName,
      name_key: key,
      created_at: new Date().toISOString(),
      auto_created: true,
    };
    this.byKey.set(key, newCategory);
    this.createdThisRun.push(newCategory);
    return { name: displayName, isNew: true };
  }

  /** Persist all newly-created categories from this run in a single bulk write. */
  async commit(): Promise<CategoryRecord[]> {
    if (this.createdThisRun.length === 0) return [];
    await getDataRepository().bulkPutCategories(this.createdThisRun);
    const created = [...this.createdThisRun];
    this.createdThisRun = [];
    return created;
  }

  getCreatedNames(): string[] {
    return this.createdThisRun.map(c => c.name);
  }
}

// ── Standalone helpers for non-bulk use (e.g. manual product form) ──

export async function getAllCategoryNames(): Promise<string[]> {
  const cats = await getDataRepository().fetchCategories();
  return cats.map(c => c.name).sort((a, b) => a.localeCompare(b, 'es'));
}

export async function findOrCreateCategory(rawName: string): Promise<CategoryRecord> {
  const key = normalizeCategoryKey(rawName);
  const existing = await getDataRepository().findCategoryByKey(key);
  if (existing) return existing;

  const newCategory: CategoryRecord = {
    id: crypto.randomUUID(),
    name: normalizeCategoryName(rawName),
    name_key: key,
    created_at: new Date().toISOString(),
    auto_created: false,
  };
  await getDataRepository().putCategory(newCategory);
  return newCategory;
}

export async function renameCategory(oldName: string, rawNewName: string): Promise<CategoryRecord> {
  const repository = getDataRepository();
  const oldKey = normalizeCategoryKey(oldName);
  const newKey = normalizeCategoryKey(rawNewName);
  const categories = await repository.fetchCategories();
  const current = categories.find(category => category.name_key === oldKey);
  if (!current) throw new Error('CATEGORY_NOT_FOUND');

  const duplicate = categories.find(category => category.id !== current.id && category.name_key === newKey);
  if (duplicate) throw new Error('CATEGORY_ALREADY_EXISTS');

  const updated: CategoryRecord = {
    ...current,
    name: normalizeCategoryName(rawNewName),
    name_key: newKey,
  };
  await repository.putCategory(updated);
  return updated;
}

export async function deleteCategoryByName(name: string): Promise<void> {
  const repository = getDataRepository();
  const category = await repository.findCategoryByKey(normalizeCategoryKey(name));
  if (!category) return;
  await repository.deleteCategory(category.id);
}
