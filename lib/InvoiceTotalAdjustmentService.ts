import type { InvoiceItem } from '@/data/mockData';

export interface ManualInvoiceTotalResult {
  items: InvoiceItem[];
  calculatedTotal: number;
  finalTotal: number;
}

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

export function adjustInvoiceItemsToFinalTotal(
  items: InvoiceItem[],
  finalTotal: number,
): ManualInvoiceTotalResult {
  if (!Number.isFinite(finalTotal) || finalTotal <= 0) throw new Error('INVALID_MANUAL_TOTAL');
  if (items.length === 0) throw new Error('INVOICE_ITEMS_REQUIRED');

  const calculatedTotal = roundCurrency(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
  const totalBasis = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (!Number.isFinite(totalBasis) || totalBasis <= 0) throw new Error('INVALID_SOLD_GRAMS');

  let assigned = 0;
  const adjusted = items.map((item, index) => {
    const basis = Number(item.quantity || 0);
    if (!Number.isFinite(basis) || basis <= 0) throw new Error('INVALID_SOLD_GRAMS');
    const subtotal = index === items.length - 1
      ? roundCurrency(finalTotal - assigned)
      : roundCurrency(finalTotal * (basis / totalBasis));
    assigned = roundCurrency(assigned + subtotal);
    const unitPrice = subtotal / basis;
    return {
      ...item,
      unitPrice,
      subtotal,
      priceModified: true,
      originalPrice: item.originalPrice ?? item.unitPrice,
    };
  });

  const verified = roundCurrency(adjusted.reduce((sum, item) => sum + item.subtotal, 0));
  if (Math.abs(verified - finalTotal) > 0.01) throw new Error('MANUAL_TOTAL_RECALCULATION_FAILED');

  return { items: adjusted, calculatedTotal, finalTotal: roundCurrency(finalTotal) };
}
