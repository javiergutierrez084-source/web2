import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FileText, Eye, Trash2, ShoppingCart } from 'lucide-react';
import { formatCurrency, isSoldByWeight } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import QuotationPreview from '@/components/QuotationPreview';
import type { Quotation } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import { formatWeight } from '@/lib/utils';

const Quotations = () => {
  const { quotations, updateQuotationStatus, invoices, products, financialAccounts, recordInvoice } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null);
  const [convertConfirm, setConvertConfirm] = useState<Quotation | null>(null);
  const { toast } = useToast();

  const filtered = useMemo(() => quotations.filter(q => {
    const matchSearch = !search || q.clientName.toLowerCase().includes(search.toLowerCase()) || q.number.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || q.status === statusFilter;
    return matchSearch && matchStatus;
  }), [quotations, search, statusFilter]);

  const convertToInvoice = async (q: Quotation) => {
    // Check stock availability
    for (const item of q.items) {
      const product = products.find(p => p.id === item.productId);
      if (product && product.stock < item.quantity) {
        toast({ title: '⚠️ Stock insuficiente', description: `${product.name}: Stock ${isSoldByWeight(product) ? `${formatWeight(product.stock)} g` : product.stock}, Requerido ${isSoldByWeight(product) ? `${formatWeight(item.quantity)} g` : item.quantity}`, variant: 'destructive' });
        return;
      }
    }

    const invoiceNumber = `FAC-${String(invoices.length + 1).padStart(4, '0')}`;
    const paymentAccount = financialAccounts.find(account => account.id === 'account-caja-principal' && account.active)
      || financialAccounts.find(account => account.active);
    if (!paymentAccount) {
      toast({ title: 'No hay cuentas financieras activas', variant: 'destructive' });
      return;
    }

    const newInvoice = {
      id: crypto.randomUUID(),
      number: invoiceNumber,
      clientId: q.clientId,
      clientName: q.clientName,
      items: q.items.map(item => {
        const product = products.find(candidate => candidate.id === item.productId);
        return {
          ...item,
          // In weight-based quotations `quantity` is the grams sold. Normalize
          // the persisted weight snapshot before entering the atomic sale path.
          weightGrams: product && isSoldByWeight(product) ? item.quantity : item.weightGrams,
          costPrice: product?.averagePurchasePrice ?? product?.purchasePrice ?? item.costPrice,
        };
      }),
      subtotal: q.subtotal,
      discount: q.discount,
      tax: q.tax,
      total: q.total,
      date: new Date().toISOString().split('T')[0],
      status: 'paid' as const,
      paymentMethod: 'Efectivo',
      tipoDocumento: 'factura' as const,
    };

    try {
      await recordInvoice(newInvoice, [{
        accountId: paymentAccount.id,
        amount: newInvoice.total,
        paymentMethod: paymentAccount.name,
      }], { quotationId: q.id });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const stockError = code === 'INSUFFICIENT_SALE_STOCK' || code === 'INSUFFICIENT_SALE_GRAMS';
      toast({
        title: 'No se pudo convertir la cotización',
        description: stockError
          ? 'El inventario cambió y ya no es suficiente para completar la venta.'
          : 'No se guardó la factura ni ningún movimiento asociado.',
        variant: 'destructive',
      });
      return;
    }

    setConvertConfirm(null);
    toast({ title: '✅ Cotización convertida a factura', description: `${invoiceNumber} · Stock descontado` });
  };

  const cancelQuotation = async (id: string) => {
    try {
      await updateQuotationStatus(id, 'cancelled');
      toast({ title: 'Cotización anulada' });
    } catch (error) {
      console.error('No se pudo anular la cotización.', error);
      toast({ title: 'No se pudo anular la cotización', variant: 'destructive' });
    }
  };

  const statusLabel = (s: string) => s === 'active' ? 'Activa' : s === 'accepted' ? 'Aceptada' : s === 'expired' ? 'Vencida' : 'Anulada';
  const statusClass = (s: string) => s === 'active' ? 'bg-primary/10 text-primary' : s === 'accepted' ? 'bg-success/10 text-success' : s === 'expired' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Cotizaciones</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestiona tus cotizaciones</p>
        </div>
        <Link to="/cotizaciones/nueva" className="shrink-0">
          <Button className="gold-gradient text-primary-foreground font-semibold gap-2">
            <Plus className="h-4 w-4" /> Nueva Cotización
          </Button>
        </Link>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por cliente o número..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
          <option value="">Todas</option>
          <option value="active">Activas</option>
          <option value="accepted">Aceptadas</option>
          <option value="expired">Vencidas</option>
          <option value="cancelled">Anuladas</option>
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">N° Cotización</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Válida hasta</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => (
                <tr key={q.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-primary">{q.number}</td>
                  <td className="px-4 py-3 font-medium">{q.clientName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{q.date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{q.validUntil}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(q.total)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-medium ${statusClass(q.status)}`}>
                      {statusLabel(q.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setPreviewQuotation(q)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Ver">
                        <Eye className="h-4 w-4" />
                      </button>
                      {q.status === 'active' && (
                        <>
                          <button onClick={() => setConvertConfirm(q)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-success" title="Convertir a factura">
                            <ShoppingCart className="h-4 w-4" />
                          </button>
                          <button onClick={() => cancelQuotation(q.id)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive" title="Anular">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mb-2" />
            <p className="text-sm">No se encontraron cotizaciones</p>
          </div>
        )}
      </div>

      {/* CONVERT CONFIRMATION MODAL */}
      {convertConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setConvertConfirm(null)}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-primary/30 bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">Convertir en Factura</h3>
                <p className="text-xs text-muted-foreground">{convertConfirm.number} · {convertConfirm.clientName}</p>
              </div>
            </div>
            <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-sm text-muted-foreground">
              <p>Se creará una factura de venta con los productos de esta cotización. Se descontará el stock automáticamente.</p>
              <ul className="mt-2 space-y-1">
                {convertConfirm.items.map((it, i) => (
                  <li key={i} className="text-xs">• {it.name} × {products.find(product => product.id === it.productId) && isSoldByWeight(products.find(product => product.id === it.productId)!) ? `${formatWeight(it.quantity)} g` : it.quantity} ({formatCurrency(it.subtotal)})</li>
                ))}
              </ul>
              <p className="mt-2 font-medium">Total: {formatCurrency(convertConfirm.total)}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setConvertConfirm(null)}>Cancelar</Button>
              <Button onClick={() => convertToInvoice(convertConfirm)} className="gold-gradient text-primary-foreground font-semibold gap-2">
                <ShoppingCart className="h-4 w-4" /> Confirmar Conversión
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewQuotation && <QuotationPreview quotation={previewQuotation} onClose={() => setPreviewQuotation(null)} />}
    </div>
  );
};

export default Quotations;
