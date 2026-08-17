import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, Eye, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useApp } from '@/contexts/AppContext';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import ExcelDocumentActions from '@/components/ExcelDocumentActions';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, paymentMethods } from '@/data/mockData';
import type { SupplierInvoiceView } from '@/domain/models';
import {
  fetchSupplierInvoices,
  addSupplierPaymentWithAccount,
  updateSupplierInvoiceSafe,
  deleteSupplierInvoiceSafe,
} from '@/lib/database';
import { parseExpenseDocumentNotes } from '@/lib/PurchaseDocumentsService';

const AccountsPayable = () => {
  const navigate = useNavigate();
  const { company, contacts, financialAccounts, refreshFinancialData, financialRefreshVersion } = useApp();
  const { toast } = useToast();
  const suppliers = contacts.filter(contact => contact.type === 'supplier');
  const [invoices, setInvoices] = useState<SupplierInvoiceView[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [paymentAccountId, setPaymentAccountId] = useState('account-caja-principal');
  const [editing, setEditing] = useState<SupplierInvoiceView | null>(null);
  const [deleting, setDeleting] = useState<SupplierInvoiceView | null>(null);
  const [busy, setBusy] = useState(false);


  const [editForm, setEditForm] = useState({
    supplierId: '',
    supplierName: '',
    invoiceNumber: '',
    issueDate: '',
    dueDate: '',
    total: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setInvoices(await fetchSupplierInvoices());
  }, []);

  useEffect(() => {
    void load();
  }, [load, financialRefreshVersion]);

  const conceptFor = (invoice: SupplierInvoiceView): string => {
    const expense = parseExpenseDocumentNotes(invoice.notes);
    if (expense) return expense.conceptName;
    if (invoice.sourceType === 'purchase_invoice') return 'Mercancía';
    return invoice.notes || 'Cuenta por pagar';
  };

  const addPayment = async (forcedInvoiceId?: string, forcedAmount?: number) => {
    const invoiceId = forcedInvoiceId || detail;
    const invoice = invoices.find(item => item.id === invoiceId);
    if (!invoice) return;
    const amount = forcedAmount ?? Number(paymentAmount);
    const pending = Math.max(0, invoice.pendingBalance);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (amount > pending + 0.01) {
      toast({ title: 'El abono supera el saldo pendiente', variant: 'destructive' });
      return;
    }
    try {
      await addSupplierPaymentWithAccount(invoice.id, {
        amount,
        date: new Date().toISOString().split('T')[0],
        method: paymentMethod,
        accountId: paymentAccountId,
      });
      await load();
      await refreshFinancialData();
      setPaymentAmount('');
      toast({ title: amount >= pending ? 'Cuenta pagada' : 'Abono registrado' });
    } catch (error) {
      toast({
        title: 'Error de pago',
        description: error instanceof Error && error.message === 'INSUFFICIENT_ACCOUNT_BALANCE'
          ? 'La cuenta seleccionada no tiene saldo suficiente.'
          : error instanceof Error ? error.message : 'No fue posible registrar el pago.',
        variant: 'destructive',
      });
    }
  };

  const openEdit = (invoice: SupplierInvoiceView) => {
    // Close the detail overlay first so the edit dialog is the only active layer.
    // The complete form is populated before opening the controlled Dialog.
    setDetail(null);
    setEditForm({
      supplierId: invoice.supplierId,
      supplierName: invoice.supplierName,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: String(invoice.total),
      notes: invoice.notes,
    });
    setEditing(invoice);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const total = Number(editForm.total);
    if (!Number.isFinite(total) || total <= 0) return;
    setBusy(true);
    try {
      await updateSupplierInvoiceSafe(editing.id, {
        supplierId: editForm.supplierId,
        supplierName: editForm.supplierName.trim() || editing.supplierName,
        invoiceNumber: editForm.invoiceNumber.trim() || editing.invoiceNumber,
        issueDate: editForm.issueDate,
        dueDate: editForm.dueDate,
        total,
        notes: editForm.notes,
        status: editing.payments.length > 0 || editing.status === 'paid' ? 'paid' : 'pending',
      });
      await load();
      await refreshFinancialData();
      setEditing(null);
      toast({ title: 'Cuenta por pagar actualizada' });
    } catch (error) {
      toast({
        title: 'No se pudo editar',
        description: error instanceof Error && error.message === 'PAID_PAYABLE_VALUE_LOCKED'
          ? 'El valor pagado está bloqueado; requiere reversión controlada.'
          : error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const removePayable = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteSupplierInvoiceSafe(deleting.id);
      await load();
      await refreshFinancialData();
      setDeleting(null);
      toast({ title: 'Cuenta por pagar eliminada' });
    } catch (error) {
      toast({
        title: 'No se puede eliminar',
        description: error instanceof Error && error.message === 'PAYABLE_HAS_PAYMENTS'
          ? 'La cuenta tiene pagos y debe conservarse.'
          : error instanceof Error ? error.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => invoices.filter(invoice => {
    const query = search.toLowerCase();
    const matchesSearch = !query || `${invoice.supplierName} ${invoice.invoiceNumber} ${conceptFor(invoice)}`.toLowerCase().includes(query);
    return matchesSearch && (!statusFilter || invoice.status === statusFilter);
  }), [invoices, search, statusFilter]);

  const detailInvoice = detail ? invoices.find(invoice => invoice.id === detail) : null;
  const statusLabel = (status: string) => status === 'paid' ? 'Pagada' : status === 'partial' ? 'Parcial' : status === 'cancelled' ? 'Anulada' : 'Pendiente';
  const statusClass = (status: string) => status === 'paid' ? 'bg-success/10 text-success' : status === 'partial' ? 'bg-warning/10 text-warning' : status === 'cancelled' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive';
  const totalPending = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.pendingBalance), 0);

  const buildPayablesDocument = (selection = filtered) => buildTableDocumentData({
    company,
    title: 'Estado de Cuentas por Pagar',
    subtitle: `${selection.length} cuentas`,
    filename: 'Cuentas_por_Pagar',
    columns: [
      { header: 'Factura' }, { header: 'Proveedor' }, { header: 'Concepto' }, { header: 'Emisión' }, { header: 'Vencimiento' },
      { header: 'Total', align: 'right' }, { header: 'Pagado', align: 'right' }, { header: 'Saldo', align: 'right' }, { header: 'Estado' },
    ],
    rows: selection.map(invoice => {
      const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
      return [invoice.invoiceNumber, invoice.supplierName, conceptFor(invoice), invoice.issueDate, invoice.dueDate,
        formatCurrency(invoice.total), formatCurrency(paid), formatCurrency(invoice.pendingBalance), statusLabel(invoice.status)];
    }),
    summaryLines: [{ label: 'Saldo pendiente total', value: formatCurrency(selection.reduce((sum, invoice) => sum + Math.max(0, invoice.pendingBalance), 0)), bold: true }],
  });

  const buildPayableDetailDocument = (invoice: SupplierInvoiceView) => buildTableDocumentData({
    company,
    title: `Cuenta por Pagar: ${invoice.invoiceNumber}`,
    subtitle: `${invoice.supplierName} · ${conceptFor(invoice)}`,
    filename: `Cuenta_${invoice.invoiceNumber}`,
    columns: [{ header: 'Fecha' }, { header: 'Método' }, { header: 'Usuario' }, { header: 'Abono', align: 'right' }, { header: 'Saldo', align: 'right' }],
    rows: invoice.payments.map(payment => [payment.date, payment.method, payment.userName || '', formatCurrency(payment.amount), formatCurrency(payment.balanceAfter)]),
    summaryLines: [
      { label: 'Valor inicial', value: formatCurrency(invoice.initialValue) },
      { label: 'Total abonado', value: formatCurrency(invoice.initialValue - invoice.pendingBalance) },
      { label: 'Saldo pendiente', value: formatCurrency(invoice.pendingBalance), bold: true },
    ],
  });

  const buildPaymentReceipt = (invoice: SupplierInvoiceView, payment: SupplierInvoiceView['payments'][number]) => buildTableDocumentData({
    company,
    title: 'Comprobante de pago a proveedor',
    subtitle: `${invoice.invoiceNumber} · ${invoice.supplierName}`,
    filename: `Comprobante_${invoice.invoiceNumber}_${payment.date}`,
    columns: [{ header: 'Campo' }, { header: 'Detalle' }],
    rows: [
      ['Proveedor', invoice.supplierName],
      ['Factura', invoice.invoiceNumber],
      ['Concepto', conceptFor(invoice)],
      ['Fecha', payment.date],
      ['Método', payment.method],
      ['Cuenta', financialAccounts.find(account => account.id === payment.accountId)?.name || payment.accountId],
      ['Usuario', payment.userName || 'Sistema'],
      ['Valor pagado', formatCurrency(payment.amount)],
      ['Saldo anterior', formatCurrency(payment.balanceBefore)],
      ['Saldo posterior', formatCurrency(payment.balanceAfter)],
    ],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Cuentas por Pagar</h1><p className="text-sm text-muted-foreground">Abonos parciales, pagos totales e historial por documento.</p></div>
        <div className="flex flex-wrap gap-2">
          <PdfDocumentActions document={buildPayablesDocument} formats={['letter']} label="PDF / Imprimir" />
          <ExcelDocumentActions document={buildPayablesDocument} />
          <Button size="lg" onClick={() => navigate('/cuentas-por-pagar/nueva')} className="gap-2"><Plus className="h-5 w-5" />Nueva factura de proveedor</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Saldo pendiente total</p><p className="text-2xl font-bold text-warning">{formatCurrency(totalPending)}</p></div>


      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar proveedor, factura o concepto..." /></div>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm"><option value="">Todas</option><option value="pending">Pendientes</option><option value="partial">Parciales</option><option value="paid">Pagadas</option></select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50"><tr><th className="px-3 py-3 text-left">Proveedor</th><th className="px-3 py-3 text-left">Número</th><th className="px-3 py-3 text-left">Concepto</th><th className="px-3 py-3 text-left">Fecha</th><th className="px-3 py-3 text-left">Vencimiento</th><th className="px-3 py-3 text-right">Saldo</th><th className="px-3 py-3 text-center">Estado</th><th className="px-3 py-3 text-center">Acciones</th></tr></thead>
            <tbody>{filtered.map(invoice => (
              <tr key={invoice.id} className="border-t border-border/60">
                <td className="px-3 py-3 font-medium">{invoice.supplierName}</td>
                <td className="px-3 py-3 font-mono text-xs text-primary">{invoice.invoiceNumber}</td>
                <td className="px-3 py-3">{conceptFor(invoice)}</td>
                <td className="px-3 py-3">{invoice.issueDate}</td>
                <td className="px-3 py-3">{invoice.dueDate}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(invoice.pendingBalance)}</td>
                <td className="px-3 py-3 text-center"><span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusClass(invoice.status)}`}>{statusLabel(invoice.status)}</span></td>
                <td className="px-3 py-3"><div className="flex justify-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setDetail(invoice.id)} title="Ver detalle"><Eye className="h-4 w-4" /></Button>
                  {invoice.status !== 'paid' && <Button size="icon" variant="ghost" onClick={() => void addPayment(invoice.id, invoice.pendingBalance)} title="Pago total"><DollarSign className="h-4 w-4" /></Button>}
                  <Button type="button" size="icon" variant="ghost" onClick={() => openEdit(invoice)} title="Editar" aria-label={`Editar ${invoice.invoiceNumber}`}><Pencil className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => setDeleting(invoice)} title="Eliminar" aria-label={`Eliminar ${invoice.invoiceNumber}`}><Trash2 className="h-4 w-4" /></Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="flex flex-col items-center py-12 text-muted-foreground"><FileText className="mb-2 h-10 w-10" /><p>No hay facturas registradas</p></div>}
      </div>

      {detailInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Detalle factura proveedor</p>
                <h3 className="break-words text-lg font-bold">{detailInvoice.invoiceNumber}</h3>
                <p className="break-words text-sm text-muted-foreground">{detailInvoice.supplierName} · {conceptFor(detailInvoice)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <PdfDocumentActions compact document={() => buildPayableDetailDocument(detailInvoice)} formats={['letter']} />
                <button onClick={() => setDetail(null)} className="rounded p-1.5 hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="my-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary/50 p-3 text-center"><p className="text-xs text-muted-foreground">Total</p><p className="font-bold">{formatCurrency(detailInvoice.initialValue)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3 text-center"><p className="text-xs text-muted-foreground">Pagado</p><p className="font-bold text-success">{formatCurrency(detailInvoice.initialValue - detailInvoice.pendingBalance)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3 text-center"><p className="text-xs text-muted-foreground">Saldo</p><p className="font-bold text-warning">{formatCurrency(detailInvoice.pendingBalance)}</p></div>
            </div>
            {detailInvoice.payments.length > 0 && <div className="space-y-2"><p className="text-xs font-medium uppercase text-muted-foreground">Historial de pagos</p>{detailInvoice.payments.map(payment => <div key={payment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm"><span className="min-w-0 break-words">{payment.date} · {payment.method} · {payment.userName || 'Sistema'}</span><div className="flex flex-wrap items-center gap-2"><strong>{formatCurrency(payment.amount)}</strong><PdfDocumentActions compact document={() => buildPaymentReceipt(detailInvoice, payment)} formats={['letter']} title="Imprimir comprobante" /></div></div>)}</div>}
            {detailInvoice.pendingBalance > 0.01 && (
              <div className="mt-6 border-t border-border pt-5">
                <p className="mb-3 text-xs font-medium uppercase text-muted-foreground">Registrar abono</p>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,1.4fr)_minmax(150px,0.9fr)_160px] md:items-end">
                  <label className="min-w-0 space-y-1.5">
                    <span className="block text-xs text-muted-foreground">Monto</span>
                    <Input className="w-full" type="number" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} placeholder="Monto" />
                  </label>
                  <label className="min-w-0 space-y-1.5">
                    <span className="block text-xs text-muted-foreground">Cuenta bancaria</span>
                    <select value={paymentAccountId} onChange={event => setPaymentAccountId(event.target.value)} className="w-full min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">{financialAccounts.filter(account => account.active).map(account => <option key={account.id} value={account.id}>{account.name} · {formatCurrency(account.balance)}</option>)}</select>
                  </label>
                  <label className="min-w-0 space-y-1.5">
                    <span className="block text-xs text-muted-foreground">Forma de pago</span>
                    <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} className="w-full min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">{paymentMethods.map(method => <option key={method}>{method}</option>)}</select>
                  </label>
                  <Button className="w-full" onClick={() => void addPayment()}>Pagar</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar cuenta por pagar</DialogTitle><DialogDescription>Los valores ya pagados permanecen protegidos.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2"><select value={editForm.supplierId} onChange={event => { const supplier = suppliers.find(item => item.id === event.target.value); setEditForm({ ...editForm, supplierId: event.target.value, supplierName: supplier?.name || editForm.supplierName }); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><Input value={editForm.invoiceNumber} onChange={event => setEditForm({ ...editForm, invoiceNumber: event.target.value })} /><Input type="date" value={editForm.issueDate} onChange={event => setEditForm({ ...editForm, issueDate: event.target.value })} /><Input type="date" value={editForm.dueDate} onChange={event => setEditForm({ ...editForm, dueDate: event.target.value })} /><Input type="number" value={editForm.total} onChange={event => setEditForm({ ...editForm, total: event.target.value })} /><Input value={editForm.notes} onChange={event => setEditForm({ ...editForm, notes: event.target.value })} placeholder="Concepto / notas" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={() => void saveEdit()} disabled={busy}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar cuenta por pagar?</AlertDialogTitle><AlertDialogDescription>Solo es posible eliminar documentos que no tengan pagos registrados.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void removePayable()} disabled={busy}>Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AccountsPayable;
