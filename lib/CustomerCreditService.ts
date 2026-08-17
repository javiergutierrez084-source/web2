import type { Contact, FinancialMovement } from '@/data/mockData';
import {
  isActiveFinancialMovement,
  resolveFinancialMovementCode,
} from '@/lib/FinancialLedgerService';

const EPSILON = 0.01;

export interface CustomerCreditSource {
  movementId: string;
  customerId: string;
  amount: number;
  used: number;
  available: number;
  originReferenceType: string;
  originReferenceId: string;
  originDocument: string;
  createdAt: string;
  userName: string;
}

export interface CustomerCreditUsage {
  movementId: string;
  sourceMovementId: string;
  customerId: string;
  amount: number;
  destinationReferenceType: string;
  destinationReferenceId: string;
  destinationDocument: string;
  createdAt: string;
  userName: string;
}

export interface CustomerCreditSummary {
  customerId: string;
  customerName: string;
  created: number;
  used: number;
  available: number;
  sources: CustomerCreditSource[];
  usages: CustomerCreditUsage[];
}

export interface CustomerCreditAuditIssue {
  id: string;
  type: 'ORPHAN_USAGE' | 'CUSTOMER_MISMATCH' | 'OVERUSED_CREDIT' | 'MISSING_CUSTOMER';
  movementId: string;
  detail: string;
}

const movementCustomerId = (movement: FinancialMovement): string =>
  movement.customerId
  || (resolveFinancialMovementCode(movement) === 'CUSTOMER_CREDIT' ? movement.referenceId : '')
  || '';

const timestampOf = (movement: FinancialMovement): string =>
  movement.createdAt || movement.updatedAt || `${movement.date}T00:00:00.000Z`;

export function buildCustomerCreditSummaries(
  movements: FinancialMovement[],
  contacts: Contact[] = [],
): CustomerCreditSummary[] {
  const sourceMovements = movements
    .filter(movement => (
      isActiveFinancialMovement(movement)
      && resolveFinancialMovementCode(movement) === 'CUSTOMER_CREDIT'
    ))
    .sort((left, right) => timestampOf(left).localeCompare(timestampOf(right)) || left.id.localeCompare(right.id));

  const usageMovements = movements.filter(movement => (
    isActiveFinancialMovement(movement)
    && resolveFinancialMovementCode(movement) === 'CUSTOMER_CREDIT_USED'
  ));
  const usageBySource = new Map<string, FinancialMovement[]>();
  usageMovements.forEach(movement => {
    if (!movement.relatedMovementId) return;
    const current = usageBySource.get(movement.relatedMovementId) || [];
    current.push(movement);
    usageBySource.set(movement.relatedMovementId, current);
  });

  const summaryByCustomer = new Map<string, CustomerCreditSummary>();
  sourceMovements.forEach(source => {
    const customerId = movementCustomerId(source);
    if (!customerId) return;
    const sourceUsages = usageBySource.get(source.id) || [];
    const used = sourceUsages.reduce((sum, movement) => sum + Math.max(0, Number(movement.amount) || 0), 0);
    const amount = Math.max(0, Number(source.amount) || 0);
    const available = Math.max(0, amount - used);
    const contact = contacts.find(item => item.id === customerId && item.type === 'client');
    const current = summaryByCustomer.get(customerId) || {
      customerId,
      customerName: contact?.name || source.observation || 'Cliente',
      created: 0,
      used: 0,
      available: 0,
      sources: [],
      usages: [],
    };

    current.created += amount;
    current.used += used;
    current.available += available;
    current.sources.push({
      movementId: source.id,
      customerId,
      amount,
      used,
      available,
      originReferenceType: source.referenceType || 'CUSTOMER',
      originReferenceId: source.documentId || source.referenceId || '',
      originDocument: source.reference || source.documentId || source.id,
      createdAt: timestampOf(source),
      userName: source.userName || 'Sistema',
    });
    sourceUsages.forEach(usage => {
      current.usages.push({
        movementId: usage.id,
        sourceMovementId: source.id,
        customerId,
        amount: Math.max(0, Number(usage.amount) || 0),
        destinationReferenceType: usage.referenceType || 'SALE',
        destinationReferenceId: usage.referenceId || usage.documentId || '',
        destinationDocument: usage.reference || usage.documentId || usage.id,
        createdAt: timestampOf(usage),
        userName: usage.userName || 'Sistema',
      });
    });
    summaryByCustomer.set(customerId, current);
  });

  return Array.from(summaryByCustomer.values())
    .map(summary => ({
      ...summary,
      created: Number(summary.created.toFixed(2)),
      used: Number(summary.used.toFixed(2)),
      available: Number(summary.available.toFixed(2)),
      usages: summary.usages.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    }))
    .filter(summary => summary.created > EPSILON || summary.used > EPSILON)
    .sort((left, right) => right.available - left.available || left.customerName.localeCompare(right.customerName, 'es'));
}

export function getCustomerCreditBalance(
  movements: FinancialMovement[],
  customerId: string,
): number {
  if (!customerId) return 0;
  return buildCustomerCreditSummaries(movements)
    .find(summary => summary.customerId === customerId)?.available || 0;
}

export function auditCustomerCredits(movements: FinancialMovement[]): CustomerCreditAuditIssue[] {
  const issues: CustomerCreditAuditIssue[] = [];
  const activeCredits = movements.filter(movement => (
    isActiveFinancialMovement(movement)
    && resolveFinancialMovementCode(movement) === 'CUSTOMER_CREDIT'
  ));
  const creditById = new Map(activeCredits.map(movement => [movement.id, movement]));
  const usedBySource = new Map<string, number>();

  movements
    .filter(movement => isActiveFinancialMovement(movement) && resolveFinancialMovementCode(movement) === 'CUSTOMER_CREDIT_USED')
    .forEach(usage => {
      const sourceId = usage.relatedMovementId || '';
      const source = creditById.get(sourceId);
      if (!source) {
        issues.push({
          id: `orphan-credit-usage-${usage.id}`,
          type: 'ORPHAN_USAGE',
          movementId: usage.id,
          detail: `El uso ${usage.id} no está relacionado con un CUSTOMER_CREDIT activo.`,
        });
        return;
      }
      const sourceCustomerId = movementCustomerId(source);
      const usageCustomerId = movementCustomerId(usage);
      if (!sourceCustomerId) {
        issues.push({
          id: `missing-credit-customer-${source.id}`,
          type: 'MISSING_CUSTOMER',
          movementId: source.id,
          detail: `El crédito ${source.id} no identifica al cliente.`,
        });
      }
      if (usageCustomerId && sourceCustomerId && usageCustomerId !== sourceCustomerId) {
        issues.push({
          id: `credit-customer-mismatch-${usage.id}`,
          type: 'CUSTOMER_MISMATCH',
          movementId: usage.id,
          detail: `El uso ${usage.id} pertenece a un cliente diferente al crédito ${source.id}.`,
        });
      }
      usedBySource.set(sourceId, (usedBySource.get(sourceId) || 0) + Math.max(0, Number(usage.amount) || 0));
    });

  activeCredits.forEach(source => {
    const used = usedBySource.get(source.id) || 0;
    if (used > source.amount + EPSILON) {
      issues.push({
        id: `credit-overused-${source.id}`,
        type: 'OVERUSED_CREDIT',
        movementId: source.id,
        detail: `El crédito ${source.id} tiene ${used} utilizados sobre ${source.amount} disponibles.`,
      });
    }
  });

  return issues;
}
