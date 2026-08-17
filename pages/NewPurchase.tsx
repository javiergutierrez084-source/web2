import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, paymentMethods, type InvoiceItem, type PurchaseInvoice } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import { formatWeight } from '@/lib/utils';
import { fetchSupplierInvoices, updateSupplierInvoiceSafe } from '@/lib/database';

const today = () => new Date().toISOString().slice(0, 10);
const defaultDueDate = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const NewPurchase = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { products, contacts, purchaseInvoices, financialAccounts, createPurchase, updatePurchase } = useApp();
  const { toast } = useToast();
  const existing = id ? purchaseInvoices.find(item => item.id === id) : undefined;
  const source = existing;
  const [supplierId, setSupplierId] = useState(source?.supplierId || '');
  const [searchCode, setSearchCode] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>(source?.items.map(item => ({ ...item })) || []);
  const [discount, setDiscount] = useState(source?.discount || 0);
  const [taxRate, setTaxRate] = useState(source?.subtotal ? (source.tax / source.subtotal) * 100 : 0);
  const [paymentMethod, setPaymentMethod] = useState(source?.paymentMethod || 'Transferencia');
  const [status, setStatus] = useState<'pending' | 'paid'>(existing?.status === 'paid' ? 'paid' : 'pending');
  const [accountId, setAccountId] = useState('account-caja-principal');
  const [description, setDescription] = useState(source?.description || '');
  const [date, setDate] = useState(existing?.date || today());
  const [dueDate, setDueDate] = useState(defaultDueDate());

  const suppliers = contacts.filter(contact => contact.type === 'supplier');
  const matches = useMemo(() => !searchCode ? [] : products.filter(product =>
    product.code.toLowerCase().includes(searchCode.toLowerCase()) || product.name.toLowerCase().includes(searchCode.toLowerCase())
  ).slice(0, 6), [products, searchCode]);

  useEffect(() => {
    if (!existing) return;
    void fetchSupplierInvoices().then(payables => {
      const payable = payables.find(item => item.sourceType === 'purchase_invoice' && item.sourceId === existing.id);
      if (payable?.dueDate) setDueDate(payable.dueDate);
    });
  }, [existing]);

  const addProduct = (productId: string) => {
    const product = products.find(item => item.id === productId);
    if (!product) return;
    const found = items.find(item => item.productId === productId);
    if (found) setItems(items.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.unitPrice } : item));
    else setItems([...items, { productId: product.id, code: product.code, name: product.name, quantity: 1, weightGrams: product.weightGrams, unitPrice: product.purchasePrice, subtotal: product.purchasePrice }]);
    setSearchCode('');
  };

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const tax = subtotal * taxRate / 100;
  const total = subtotal - discount + tax;

  const synchronizePayableDueDate = async (purchase: PurchaseInvoice) => {
    if (purchase.status === 'paid') return;
    const payables = await fetchSupplierInvoices();
    const payable = payables.find(item => item.sourceType === 'purchase_invoice' && item.sourceId === purchase.id);
    if (!payable || payable.dueDate === dueDate) return;
    await updateSupplierInvoiceSafe(payable.id, {
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      invoiceNumber: purchase.number,
      issueDate: purchase.date,
      dueDate: dueDate || purchase.date,
      total: purchase.total,
      notes: purchase.description || '',
      status: payable.status === 'paid' ? 'paid' : 'pending',
    });
  };

  const save = async () => {
    if (!supplierId || items.length === 0 || total <= 0) {
      toast({ title: 'Completa proveedor, productos y valor', variant: 'destructive' }); return;
    }
    const supplier = suppliers.find(item => item.id === supplierId);
    const purchase: PurchaseInvoice = {
      id: existing?.id || crypto.randomUUID(),
      number: existing?.number || `COM-${String(purchaseInvoices.length + 1).padStart(4, '0')}`,
      supplierId, supplierName: supplier?.name || existing?.supplierName || '', items,
      subtotal, discount, tax, total, date,
      status, paymentMethod, description,
    };
    try {
      if (existing) await updatePurchase(purchase);
      else await createPurchase(purchase, status === 'paid' ? accountId : undefined);
      await synchronizePayableDueDate(purchase);
      toast({ title: existing ? 'Compra actualizada' : 'Compra registrada' });
      navigate('/cuentas-por-pagar');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      toast({ title: 'No se pudo guardar', description: code === 'PAID_PURCHASE_VALUE_LOCKED' ? 'Una compra pagada no permite cambiar su valor sin reversión.' : code === 'INSUFFICIENT_ACCOUNT_BALANCE' ? 'Saldo insuficiente.' : code, variant: 'destructive' });
    }
  };

  return (
    <div className="w-full max-w-7xl space-y-6">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={() => navigate('/cuentas-por-pagar')} className="shrink-0 rounded p-2 hover:bg-secondary" aria-label="Volver a cuentas por pagar">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cuentas por pagar</p>
          <h1 className="break-words text-2xl font-bold">{existing ? 'Editar factura de proveedor' : 'Nueva factura de proveedor'}</h1>
          <p className="break-words text-sm text-muted-foreground">{existing?.number || 'Mercancía: actualiza Inventario, Cuentas por Pagar y Finanzas'}</p>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <select value={supplierId} onChange={event => setSupplierId(event.target.value)} className="h-10 w-full min-w-0 rounded-lg border bg-card px-3 py-2 text-sm">
            <option value="">Proveedor...</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input className="pl-9" value={searchCode} onChange={event => setSearchCode(event.target.value)} placeholder="Buscar producto" />
          </div>
          {matches.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              {matches.map(product => (
                <button key={product.id} onClick={() => addProduct(product.id)} className="flex w-full min-w-0 items-center justify-between gap-4 px-3 py-2 text-left hover:bg-secondary">
                  <span className="min-w-0 break-words">{product.code} · {product.name}</span>
                  <span className="shrink-0 font-medium">{formatCurrency(product.purchasePrice)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b bg-secondary/40 text-xs text-muted-foreground">
                  <th className="p-3 text-left font-medium">Producto</th>
                  <th className="p-3 text-center font-medium">Cantidad</th>
                  <th className="p-3 text-center font-medium">Costo unitario</th>
                  <th className="p-3 text-right font-medium">Subtotal</th>
                  <th className="w-12 p-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.productId} className="border-b last:border-0">
                    <td className="min-w-[220px] p-3">
                      <p className="break-words font-medium">{item.name}</p>
                      <div className="break-words text-xs text-muted-foreground">{item.code} · {formatWeight(item.weightGrams)} g</div>
                    </td>
                    <td className="p-3">
                      <Input type="number" min={1} value={item.quantity} onChange={event => { const quantity = Math.max(1, Number(event.target.value)); setItems(items.map(current => current.productId === item.productId ? { ...current, quantity, subtotal: quantity * current.unitPrice } : current)); }} className="mx-auto w-24 text-center" />
                    </td>
                    <td className="p-3">
                      <Input type="number" min={0} value={item.unitPrice} onChange={event => { const price = Math.max(0, Number(event.target.value)); setItems(items.map(current => current.productId === item.productId ? { ...current, unitPrice: price, subtotal: price * current.quantity } : current)); }} className="mx-auto w-32 text-right" />
                    </td>
                    <td className="whitespace-nowrap p-3 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => setItems(items.filter(current => current.productId !== item.productId))} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Eliminar ${item.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-fit min-w-0 space-y-3 rounded-xl border p-4 lg:sticky lg:top-6">
          <Input type="date" value={date} onChange={event => setDate(event.target.value)} />
          <Input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} title="Fecha de vencimiento" />
          <Input value={description} onChange={event => setDescription(event.target.value)} placeholder="Concepto u observaciones" />
          <Input type="number" value={discount} onChange={event => setDiscount(Number(event.target.value) || 0)} placeholder="Descuento" />
          <Input type="number" value={taxRate} onChange={event => setTaxRate(Number(event.target.value) || 0)} placeholder="Impuesto %" />
          {!existing && (
            <select value={status} onChange={event => setStatus(event.target.value as 'pending' | 'paid')} className="h-10 w-full min-w-0 rounded border px-3 py-2 text-sm">
              <option value="pending">Pendiente</option>
              <option value="paid">Pagada</option>
            </select>
          )}
          <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} className="h-10 w-full min-w-0 rounded border px-3 py-2 text-sm">
            {paymentMethods.map(method => <option key={method}>{method}</option>)}
          </select>
          {!existing && status === 'paid' && (
            <select value={accountId} onChange={event => setAccountId(event.target.value)} className="h-10 w-full min-w-0 rounded border px-3 py-2 text-sm">
              {financialAccounts.filter(account => account.active).map(account => <option key={account.id} value={account.id}>{account.name} · {formatCurrency(account.balance)}</option>)}
            </select>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-lg font-bold">
            <span>Total</span><span className="break-all text-right">{formatCurrency(total)}</span>
          </div>
          <Button onClick={() => void save()} className="w-full">{existing ? 'Guardar cambios' : 'Guardar factura de proveedor'}</Button>
        </div>
      </div>
    </div>
  );
};
export default NewPurchase;
