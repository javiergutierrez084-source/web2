import { fetchActivityLog, getSession, logActivity } from '@/lib/auth';

export interface ExpenseConcept {
  id: string;
  name: string;
  active: boolean;
  builtIn: boolean;
  updatedAt: string;
}

const ENTITY = 'expense_concept';
const DEFAULT_CONCEPTS: Array<Pick<ExpenseConcept, 'id' | 'name'>> = [
  { id: 'expense-concept-rent', name: 'Arriendo' },
  { id: 'expense-concept-energy', name: 'Energía' },
  { id: 'expense-concept-water', name: 'Agua' },
  { id: 'expense-concept-internet', name: 'Internet' },
  { id: 'expense-concept-stationery', name: 'Papelería' },
  { id: 'expense-concept-transport', name: 'Transporte' },
  { id: 'expense-concept-advertising', name: 'Publicidad' },
  { id: 'expense-concept-fees', name: 'Honorarios' },
  { id: 'expense-concept-taxes', name: 'Impuestos' },
  { id: 'expense-concept-payroll', name: 'Nómina' },
];

interface ExpenseConceptEventDetail {
  id: string;
  name: string;
  active: boolean;
}

const parseDetail = (value: string): ExpenseConceptEventDetail | null => {
  try {
    const parsed = JSON.parse(value) as Partial<ExpenseConceptEventDetail>;
    if (!parsed.id || !parsed.name || typeof parsed.active !== 'boolean') return null;
    return { id: String(parsed.id), name: String(parsed.name), active: parsed.active };
  } catch {
    return null;
  }
};

export async function fetchExpenseConcepts(): Promise<ExpenseConcept[]> {
  const now = new Date(0).toISOString();
  const concepts = new Map<string, ExpenseConcept>(DEFAULT_CONCEPTS.map(item => [item.id, {
    ...item,
    active: true,
    builtIn: true,
    updatedAt: now,
  }]));

  try {
    const events = (await fetchActivityLog(5000))
      .filter(event => event.entity === ENTITY)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const event of events) {
      const detail = parseDetail(event.detail);
      if (!detail) continue;
      const current = concepts.get(detail.id);
      concepts.set(detail.id, {
        id: detail.id,
        name: detail.name,
        active: detail.active,
        builtIn: current?.builtIn ?? false,
        updatedAt: event.created_at,
      });
    }
  } catch (error) {
    // Concept defaults remain available even when an older role cannot read
    // the activity log. Writes continue through the official Repository.
    console.warn('[ExpenseConceptService] Activity history unavailable', error);
  }

  return [...concepts.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

const persistConcept = async (action: string, concept: ExpenseConcept): Promise<void> => {
  const session = getSession();
  if (!session) throw new Error('AUTH_SESSION_REQUIRED');
  await logActivity(session, action, ENTITY, concept.id, JSON.stringify({
    id: concept.id,
    name: concept.name,
    active: concept.active,
  }));
};

export async function createExpenseConcept(name: string): Promise<ExpenseConcept> {
  const normalized = name.trim();
  if (!normalized) throw new Error('EXPENSE_CONCEPT_NAME_REQUIRED');
  const concept: ExpenseConcept = {
    id: `expense-concept-${crypto.randomUUID()}`,
    name: normalized,
    active: true,
    builtIn: false,
    updatedAt: new Date().toISOString(),
  };
  await persistConcept('EXPENSE_CONCEPT_CREATED', concept);
  return concept;
}

export async function updateExpenseConcept(concept: ExpenseConcept, name: string): Promise<ExpenseConcept> {
  const normalized = name.trim();
  if (!normalized) throw new Error('EXPENSE_CONCEPT_NAME_REQUIRED');
  const next = { ...concept, name: normalized, updatedAt: new Date().toISOString() };
  await persistConcept('EXPENSE_CONCEPT_UPDATED', next);
  return next;
}

export async function setExpenseConceptActive(concept: ExpenseConcept, active: boolean): Promise<ExpenseConcept> {
  const next = { ...concept, active, updatedAt: new Date().toISOString() };
  await persistConcept(active ? 'EXPENSE_CONCEPT_ACTIVATED' : 'EXPENSE_CONCEPT_DEACTIVATED', next);
  return next;
}
