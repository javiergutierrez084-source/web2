import type { Invoice } from '@/data/mockData';
import { isSalesInvoice } from '@/lib/DashboardMetricsService';

export interface CustomerSalesSummary {
  clientId: string;
  clientName: string;
  invoiceCount: number;
  totalPurchased: number;
  firstSale: string;
  lastSale: string;
  invoices: Invoice[];
}

/**
 * Central customer-commercial projection.
 *
 * The immutable invoice history remains available elsewhere, but customer
 * totals, rankings and commercial histories include only invoices accepted by
 * the official JoyaControl sale-validity rule.
 */
export function calculateCustomerSalesSummaries(
  invoices: readonly Invoice[],
): CustomerSalesSummary[] {
  const summaries = new Map<string, CustomerSalesSummary>();

  invoices.filter(isSalesInvoice).forEach(invoice => {
    const clientId = invoice.clientId || '';
    const current = summaries.get(clientId) ?? {
      clientId,
      clientName: invoice.clientName || 'Consumidor final',
      invoiceCount: 0,
      totalPurchased: 0,
      firstSale: invoice.date,
      lastSale: invoice.date,
      invoices: [],
    };
    current.invoiceCount += 1;
    current.totalPurchased += Number(invoice.total) || 0;
    if (invoice.date < current.firstSale) current.firstSale = invoice.date;
    if (invoice.date > current.lastSale) current.lastSale = invoice.date;
    current.invoices.push(invoice);
    summaries.set(clientId, current);
  });

  return [...summaries.values()]
    .map(summary => ({
      ...summary,
      invoices: summary.invoices.slice().sort((left, right) => (
        right.date.localeCompare(left.date)
        || right.number.localeCompare(left.number, 'es')
      )),
    }))
    .sort((left, right) => right.totalPurchased - left.totalPurchased || left.clientName.localeCompare(right.clientName, 'es'));
}

export function calculateCustomerSalesSummary(
  invoices: readonly Invoice[],
  clientId: string,
): CustomerSalesSummary | null {
  return calculateCustomerSalesSummaries(invoices).find(summary => summary.clientId === clientId) ?? null;
}
