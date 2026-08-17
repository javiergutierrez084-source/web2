import { useCallback, useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Search, Save, AlertTriangle, Pencil, X, UserPlus, WalletCards, Printer, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, isSoldByWeight, type PaymentAllocation } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import ClientSearchCombobox from '@/components/ClientSearchCombobox';
import type { Invoice, InvoiceItem, Contact } from '@/data/mockData';
import { formatWeight } from '@/lib/utils';
import { adjustInvoiceItemsToFinalTotal } from '@/lib/InvoiceTotalAdjustmentService';
import { LAYAWAY_RESERVE_ACCOUNT_ID } from '@/lib/FinancialPositionService';
import { getCustomerCreditBalance } from '@/lib/CustomerCreditService';
import { buildInvoiceDocumentData } from '@/lib/pdf';
import { printThermalInvoice80 } from '@/lib/thermalInvoicePrint';
import LayawayDeadlineSelector from '@/components/LayawayDeadlineSelector';
import {
  LAYAWAY_TERM_OPTIONS,
  deleteLayawayDeadline,
  loadLayawayAlertSettings,
  resolveLayawayDeadline,
  saveLayawayDeadline,
  type LayawayDeadlineMode,
} from '@/lib/LayawayAlertService';

const NewInvoice = () => {
  const navigate = useNavigate();
  const { company, products, contacts, setContacts, invoices, layaways, financialAccounts, financialMovements, recordInvoice, recordLayaway, createQuotation } = useApp();
  const { toast } = useToast();
  const [clientId, setClientId] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'factura' | 'cotizacion'>('factura');
  const [searchCode, setSearchCode] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate] = useState(0);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [isLayaway, setIsLayaway] = useState(false);
  const [clientNotes, setClientNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: '', document: '', phone: '', email: '', address: '' });

  // Layaway first payment
  const [layawayFirstPayment, setLayawayFirstPayment] = useState(false);
  const [layawayPayAmount, setLayawayPayAmount] = useState('');
  const [layawayPayMethod, setLayawayPayMethod] = useState('Efectivo');
  const [layawayAccountId, setLayawayAccountId] = useState('account-caja-principal');
  const configuredLayawayTerm = useMemo(() => {
    const configured = loadLayawayAlertSettings().defaultTermDays;
    return LAYAWAY_TERM_OPTIONS.includes(configured as (typeof LAYAWAY_TERM_OPTIONS)[number]) ? configured : 30;
  }, []);
  const [layawayDeadlineMode, setLayawayDeadlineMode] = useState<LayawayDeadlineMode>('term');
  const [layawayTermDays, setLayawayTermDays] = useState(configuredLayawayTerm);
  const [layawayCustomDueDate, setLayawayCustomDueDate] = useState('');
  const layawayCreatedDate = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Combined payment
  const [combinedPayment, setCombinedPayment] = useState(false);
  const [payment1, setPayment1] = useState({ accountId: 'account-caja-principal', amount: '' });
  const [payment2, setPayment2] = useState({ accountId: 'account-bancolombia', amount: '' });
  const [singleAccountId, setSingleAccountId] = useState('account-caja-principal');
  const [manualTotalInput, setManualTotalInput] = useState('');
  const [showManualTotal, setShowManualTotal] = useState(false);
  const [manualTotalAudit, setManualTotalAudit] = useState<{ calculatedTotal: number; finalTotal: number } | null>(null);
  const [customerCreditInput, setCustomerCreditInput] = useState('');
  const [appliedCustomerCredit, setAppliedCustomerCredit] = useState(0);
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);

  const hasUnsavedChanges = useMemo(() => !savedInvoice && (
    Boolean(clientId)
    || tipoDocumento !== 'factura'
    || Boolean(searchCode.trim())
    || items.length > 0
    || discount !== 0
    || isLayaway
    || Boolean(clientNotes.trim())
    || Boolean(internalNotes.trim())
    || layawayFirstPayment
    || Boolean(layawayPayAmount.trim())
    || combinedPayment
    || Boolean(payment1.amount.trim())
    || Boolean(payment2.amount.trim())
    || Boolean(manualTotalInput.trim())
    || appliedCustomerCredit > 0
  ), [
    appliedCustomerCredit, clientId, clientNotes, combinedPayment, discount,
    internalNotes, isLayaway, items.length, layawayFirstPayment,
    layawayPayAmount, manualTotalInput, payment1.amount, payment2.amount,
    savedInvoice, searchCode, tipoDocumento,
  ]);

  const newClientHasUnsavedChanges = useMemo(
    () => Object.values(newClientForm).some(value => value.trim().length > 0),
    [newClientForm],
  );

  const requestCloseSale = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm('Hay cambios sin guardar en la venta. ¿Deseas salir y descartarlos?')) return;
    navigate('/ventas');
  }, [hasUnsavedChanges, navigate]);

  const requestCloseNewClient = useCallback(() => {
    if (newClientHasUnsavedChanges && !window.confirm('Hay datos del nuevo cliente sin guardar. ¿Deseas cerrar esta ventana?')) return;
    setShowNewClient(false);
  }, [newClientHasUnsavedChanges]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (showNewClient) {
        requestCloseNewClient();
        return;
      }
      requestCloseSale();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestCloseNewClient, requestCloseSale, showNewClient]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const clients = useMemo(() => contacts.filter(contact => contact.type === 'client'), [contacts]);
  const selectedCustomerCredit = useMemo(
    () => getCustomerCreditBalance(financialMovements, clientId),
    [financialMovements, clientId],
  );

  const clearManualTotal = () => { setManualTotalAudit(null); setManualTotalInput(''); };

  const matchedProducts = useMemo(() => {
    if (!searchCode) return [];
    return products.filter(p => p.code.toLowerCase().includes(searchCode.toLowerCase()) || p.name.toLowerCase().includes(searchCode.toLowerCase())).slice(0, 5);
  }, [searchCode, products]);

  const addProduct = (productId: string) => {
    clearManualTotal();
    const product = products.find(p => p.id === productId);
    if (!product || product.stock <= 0) { toast({ title: '⚠️ Sin stock', variant: 'destructive' }); return; }
    const existing = items.find(i => i.productId === productId);
    const byWeight = isSoldByWeight(product);

    if (existing) {
      if (byWeight) {
        // For weight-based, don't auto-increment - user edits grams manually
        toast({ title: 'ℹ️ Ya agregado', description: 'Edita los gramos a vender en la tabla.' }); return;
      }
      if (existing.quantity >= product.stock) { toast({ title: '⚠️ Stock insuficiente', variant: 'destructive' }); return; }
      setItems(items.map(i => i.productId === productId ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice } : i));
    } else {
      if (byWeight) {
        // Weight-based: quantity=1g default, unitPrice=salePrice (per gram, editable)
        setItems([...items, { productId: product.id, code: product.code, name: product.name, quantity: 1, weightGrams: 1, unitPrice: product.salePrice, subtotal: product.salePrice, originalPrice: product.salePrice, priceModified: false, costPrice: product.averagePurchasePrice ?? product.purchasePrice }]);
      } else {
        setItems([...items, { productId: product.id, code: product.code, name: product.name, quantity: 1, weightGrams: product.weightGrams, unitPrice: product.salePrice, subtotal: product.salePrice, originalPrice: product.salePrice, priceModified: false, costPrice: product.averagePurchasePrice ?? product.purchasePrice }]);
      }
    }
    setSearchCode('');
  };

  const removeItem = (productId: string) => { clearManualTotal(); setItems(items.filter(i => i.productId !== productId)); };

  const updateQuantity = (productId: string, qty: number) => {
    clearManualTotal();
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const byWeight = isSoldByWeight(product);
    if (byWeight) {
      // qty represents grams for weight-based products
      if (qty <= 0 || qty > product.stock) { toast({ title: `⚠️ Máximo disponible: ${formatWeight(product.stock)} g`, variant: 'destructive' }); return; }
      setItems(items.map(i => i.productId === productId ? { ...i, quantity: qty, weightGrams: qty, subtotal: qty * i.unitPrice } : i));
    } else {
      if (qty < 1 || qty > product.stock) return;
      setItems(items.map(i => i.productId === productId ? { ...i, quantity: qty, subtotal: qty * i.unitPrice } : i));
    }
  };

  const updateUnitPrice = (productId: string, newPrice: number) => {
    if (newPrice < 0) return;
    clearManualTotal();
    setItems(items.map(i => i.productId === productId ? { ...i, unitPrice: newPrice, subtotal: i.quantity * newPrice, priceModified: newPrice !== (i.originalPrice ?? 0), originalPrice: i.originalPrice ?? i.unitPrice } : i));
  };

  const isPriceBelowCost = (item: InvoiceItem) => {
    const product = products.find(p => p.id === item.productId);
    return product && item.unitPrice < product.purchasePrice;
  };

  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal - discount + taxAmount;
  const maxApplicableCustomerCredit = Math.max(0, Math.min(selectedCustomerCredit, total));
  const paymentDue = Math.max(0, total - appliedCustomerCredit);

  useEffect(() => {
    setAppliedCustomerCredit(0);
    setCustomerCreditInput('');
  }, [clientId]);

  useEffect(() => {
    if (appliedCustomerCredit <= maxApplicableCustomerCredit + 0.01) return;
    setAppliedCustomerCredit(maxApplicableCustomerCredit);
    setCustomerCreditInput(maxApplicableCustomerCredit > 0 ? String(maxApplicableCustomerCredit) : '');
  }, [appliedCustomerCredit, maxApplicableCustomerCredit]);

  useEffect(() => {
    if (tipoDocumento === 'factura' && !isLayaway) return;
    setAppliedCustomerCredit(0);
    setCustomerCreditInput('');
  }, [tipoDocumento, isLayaway]);

  const handleApplyCustomerCredit = () => {
    const requested = customerCreditInput.trim()
      ? Number(customerCreditInput)
      : maxApplicableCustomerCredit;
    if (!Number.isFinite(requested) || requested <= 0) {
      toast({ title: 'Valor no válido', description: 'Ingresa un valor de saldo mayor que cero.', variant: 'destructive' });
      return;
    }
    if (requested > maxApplicableCustomerCredit + 0.01) {
      toast({
        title: 'Saldo insuficiente',
        description: `Puedes aplicar como máximo ${formatCurrency(maxApplicableCustomerCredit)}.`,
        variant: 'destructive',
      });
      return;
    }
    const applied = Math.min(requested, maxApplicableCustomerCredit);
    setAppliedCustomerCredit(applied);
    setCustomerCreditInput(String(applied));
  };

  const applyManualTotal = () => {
    const requested = Number(manualTotalInput);
    try {
      const result = adjustInvoiceItemsToFinalTotal(items, requested);
      setItems(result.items);
      setDiscount(0);
      setManualTotalAudit({ calculatedTotal: result.calculatedTotal, finalTotal: result.finalTotal });
      setManualTotalInput(String(result.finalTotal));
      toast({ title: 'Total ajustado', description: formatCurrency(result.finalTotal) });
    } catch {
      toast({ title: 'Total no válido', description: 'Ingresa un valor mayor que cero y numéricamente válido.', variant: 'destructive' });
    }
  };

  const accountName = (id: string) => financialAccounts.find(account => account.id === id)?.name || 'Cuenta';
  const conventionalPaymentMethod = combinedPayment
    ? `${accountName(payment1.accountId)}: ${formatCurrency(parseFloat(payment1.amount) || 0)} + ${accountName(payment2.accountId)}: ${formatCurrency(parseFloat(payment2.amount) || 0)}`
    : paymentDue > 0.01 ? accountName(singleAccountId) : '';
  const paymentMethodStr = [
    appliedCustomerCredit > 0.01 ? `Saldo a favor: ${formatCurrency(appliedCustomerCredit)}` : '',
    conventionalPaymentMethod,
  ].filter(Boolean).join(' + ');

  const handleSaveNewClient = () => {
    if (!newClientForm.name) return;
    if (contacts.some(c => c.document === newClientForm.document && newClientForm.document)) {
      toast({ title: '⚠️ Documento duplicado', variant: 'destructive' }); return;
    }
    const newClient: Contact = { id: crypto.randomUUID(), type: 'client', ...newClientForm, notes: '' };
    setContacts([newClient, ...contacts]);
    setClientId(newClient.id);
    setShowNewClient(false);
    setNewClientForm({ name: '', document: '', phone: '', email: '', address: '' });
    toast({ title: '✅ Cliente creado' });
  };

  const closeSavedInvoiceDialog = () => {
    setSavedInvoice(null);
    navigate('/ventas');
  };

  const viewSavedInvoice = () => {
    if (!savedInvoice) return;
    const invoiceId = savedInvoice.id;
    setSavedInvoice(null);
    navigate(`/ventas?invoice=${encodeURIComponent(invoiceId)}`);
  };

  const printSavedInvoice = () => {
    if (!savedInvoice) return;
    const contact = contacts.find(item => item.id === savedInvoice.clientId);
    const document = buildInvoiceDocumentData({
      invoice: savedInvoice,
      type: 'sale',
      company,
      contact,
      products,
    });
    printThermalInvoice80(document);
    window.setTimeout(() => navigate('/ventas'), 900);
  };

  const handleSave = async () => {
    if (items.length === 0 || !clientId) return;

    const client = clients.find(contact => contact.id === clientId);
    const today = new Date();
    const documentDate = today.toISOString().split('T')[0];
    const layawayDeadlineSelection = {
      mode: layawayDeadlineMode,
      termDays: layawayTermDays,
      dueDate: layawayCustomDueDate,
    } as const;

    if (isLayaway) {
      try {
        resolveLayawayDeadline(documentDate, layawayDeadlineSelection);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        const description = code === 'LAYAWAY_DUE_DATE_BEFORE_CREATION'
          ? 'La fecha de vencimiento debe ser posterior a la fecha de creación.'
          : code === 'LAYAWAY_DUE_DATE_TOO_FAR'
            ? 'La fecha de vencimiento supera el límite permitido.'
            : 'Selecciona un plazo o una fecha de vencimiento válida.';
        toast({ title: 'Plazo del separado inválido', description, variant: 'destructive' });
        return;
      }
    }

    if (tipoDocumento === 'cotizacion') {
      const validUntilDate = new Date(today);
      validUntilDate.setDate(validUntilDate.getDate() + 15);

      try {
        const quotation = await createQuotation({
          clientId,
          clientName: client?.name || '',
          items,
          subtotal,
          discount,
          tax: taxAmount,
          total,
          date: documentDate,
          validUntil: validUntilDate.toISOString().split('T')[0],
          status: 'active',
          notes: [clientNotes, internalNotes].filter(Boolean).join('\n'),
        });
        toast({ title: 'Cotización guardada', description: quotation.number });
        navigate('/cotizaciones');
      } catch (error) {
        console.error('No se pudo crear la cotización desde Ventas.', error);
        toast({
          title: 'No se pudo guardar la cotización',
          description: 'No se creó ningún registro. Intenta nuevamente.',
          variant: 'destructive',
        });
      }
      return;
    }

    if (!isLayaway && paymentDue > 0.01 && financialAccounts.length === 0) {
      toast({ title: 'No hay cuentas financieras activas', variant: 'destructive' });
      return;
    }

    if (combinedPayment) {
      const sum = (parseFloat(payment1.amount) || 0) + (parseFloat(payment2.amount) || 0);
      if (Math.abs(sum - paymentDue) > 1) {
        toast({ title: '⚠️ La suma de pagos no coincide con el saldo pendiente', description: `Suma: ${formatCurrency(sum)} vs Pendiente: ${formatCurrency(paymentDue)}`, variant: 'destructive' });
        return;
      }
    }

    const invoiceNumber = `FAC-${String(invoices.length + layaways.length + 1).padStart(4, '0')}`;
    const newInvoice = {
      id: crypto.randomUUID(),
      number: invoiceNumber,
      clientId,
      clientName: client?.name || '',
      items,
      subtotal,
      discount,
      tax: taxAmount,
      total,
      date: documentDate,
      status: isLayaway ? 'pending' as const : 'paid' as const,
      paymentMethod: paymentMethodStr,
      clientNotes,
      internalNotes,
      tipoDocumento: 'factura' as const,
    };

    if (isLayaway) {
      const firstPayments = [];
      if (layawayFirstPayment && layawayPayAmount) {
        const amount = parseFloat(layawayPayAmount);
        if (amount > total + 0.01) {
          toast({ title: 'El abono inicial supera el total del apartado', variant: 'destructive' });
          return;
        }
        if (amount > 0) {
          firstPayments.push({
            id: crypto.randomUUID(),
            amount,
            date: documentDate,
            method: layawayPayMethod,
            accountId: layawayAccountId,
          });
        }
      }

      const layawayId = crypto.randomUUID();
      try {
        saveLayawayDeadline(layawayId, documentDate, layawayDeadlineSelection);
        await recordLayaway({
          id: layawayId,
          invoiceId: newInvoice.id,
          invoice: newInvoice,
          payments: firstPayments,
          completed: false,
        });
      } catch (error) {
        deleteLayawayDeadline(layawayId);
        const message = error instanceof Error && error.message === 'LAYAWAY_PAYMENT_EXCEEDS_TOTAL'
          ? 'El abono inicial supera el total del apartado.'
          : 'No fue posible guardar el apartado y su factura relacionada.';
        toast({ title: 'Error al guardar el apartado', description: message, variant: 'destructive' });
        return;
      }

      toast({ title: '📋 Separado creado', description: `${invoiceNumber} guardado como separado${firstPayments.length > 0 ? ` con abono de ${formatCurrency(firstPayments[0].amount)}` : ''}` });
    } else {
      const allocations: PaymentAllocation[] = combinedPayment
        ? [
            { accountId: payment1.accountId, amount: parseFloat(payment1.amount) || 0, paymentMethod: accountName(payment1.accountId) },
            { accountId: payment2.accountId, amount: parseFloat(payment2.amount) || 0, paymentMethod: accountName(payment2.accountId) },
          ].filter(allocation => allocation.amount > 0.01)
        : paymentDue > 0.01
          ? [{ accountId: singleAccountId, amount: paymentDue, paymentMethod: accountName(singleAccountId) }]
          : [];
      try {
        await recordInvoice(
          { ...newInvoice, paymentAllocations: allocations },
          allocations,
          {
            ...(manualTotalAudit ? { manualTotal: manualTotalAudit } : {}),
            ...(appliedCustomerCredit > 0.01
              ? { customerCredit: { customerId: clientId, amount: appliedCustomerCredit } }
              : {}),
          },
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        const messages: Record<string, string> = {
          PAYMENT_ALLOCATION_MISMATCH: 'La distribución del pago no coincide con el total.',
          SALE_PRODUCT_NOT_FOUND: 'Uno de los productos ya no existe en inventario.',
          SALE_PRODUCT_INACTIVE: 'Uno de los productos está desactivado.',
          INVALID_SALE_QUANTITY: 'Una de las cantidades no es válida.',
          INVALID_SALE_GRAMS: 'Los gramos vendidos no son válidos.',
          SALE_WEIGHT_QUANTITY_MISMATCH: 'La cantidad y los gramos de un producto no coinciden.',
          INSUFFICIENT_SALE_STOCK: 'El stock cambió y ya no es suficiente para completar la venta.',
          INSUFFICIENT_SALE_GRAMS: 'Los gramos disponibles cambiaron y ya no son suficientes para completar la venta.',
          CUSTOMER_CREDIT_CLIENT_MISMATCH: 'El saldo a favor no pertenece al cliente seleccionado.',
          CUSTOMER_CREDIT_EXCEEDS_AVAILABLE: 'El saldo a favor disponible cambió y ya no cubre el valor aplicado.',
          CUSTOMER_CREDIT_EXCEEDS_SALE_TOTAL: 'El saldo aplicado supera el total de la venta.',
          CUSTOMER_CREDIT_ALLOCATION_INCOMPLETE: 'No fue posible distribuir el saldo a favor disponible.',
          INSUFFICIENT_ACCOUNT_BALANCE: 'La Caja Separados no tiene fondos suficientes para aplicar este saldo.',
        };
        const message = messages[code] || 'No fue posible registrar la venta. No se guardó ningún cambio.';
        toast({ title: 'Error al guardar', description: message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Factura guardada', description: invoiceNumber });
      setSavedInvoice({ ...newInvoice, paymentAllocations: allocations });
      return;
    }
    navigate('/ventas');
  };

  return (
    <div className="w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={requestCloseSale} className="rounded-lg p-2 hover:bg-secondary transition-colors" aria-label="Volver a ventas"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold">Nueva Venta</h1>
            <p className="break-words text-sm text-muted-foreground">Consecutivo automático según tipo de documento</p>
          </div>
        </div>
        <button type="button" onClick={requestCloseSale} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Cerrar venta" title="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {/* Client */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cliente *</label>
              <button type="button" onClick={() => setShowNewClient(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <UserPlus className="h-3.5 w-3.5" /> Crear nuevo
              </button>
            </div>
            <ClientSearchCombobox
              clients={clients}
              value={clientId}
              onChange={setClientId}
            />
            {clientId && selectedCustomerCredit > 0.01 && tipoDocumento === 'factura' && !isLayaway && (
              <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <WalletCards className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Saldo disponible</p>
                      <p className="font-semibold text-primary">{formatCurrency(selectedCustomerCredit)}</p>
                    </div>
                  </div>
                  <div className="flex min-w-[240px] flex-1 justify-end gap-2">
                    <Input
                      type="number"
                      min="0"
                      max={maxApplicableCustomerCredit}
                      step="0.01"
                      value={customerCreditInput}
                      onChange={event => setCustomerCreditInput(event.target.value)}
                      placeholder={String(maxApplicableCustomerCredit)}
                      className="max-w-40 bg-secondary/50 border-border"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={handleApplyCustomerCredit}>
                      Aplicar saldo
                    </Button>
                    {appliedCustomerCredit > 0.01 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setAppliedCustomerCredit(0); setCustomerCreditInput(''); }}>
                        Quitar
                      </Button>
                    )}
                  </div>
                </div>
                {appliedCustomerCredit > 0.01 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Aplicado: {formatCurrency(appliedCustomerCredit)} · Restante del crédito: {formatCurrency(selectedCustomerCredit - appliedCustomerCredit)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Tipo de documento */}
          <div className="rounded-xl border border-border bg-card p-4">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Tipo de Documento *</label>
            <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
              <button type="button" onClick={() => setTipoDocumento('factura')} className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all ${tipoDocumento === 'factura' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                📄 Factura
              </button>
              <button type="button" onClick={() => setTipoDocumento('cotizacion')} className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all ${tipoDocumento === 'cotizacion' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                📋 Cotización
              </button>
            </div>
            {tipoDocumento === 'cotizacion' && (
              <p className="mt-2 text-xs text-warning">⚠️ Las cotizaciones NO descontarán inventario ni registrarán movimientos.</p>
            )}
          </div>

          {/* Type toggle */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-4">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo:</label>
              <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
                <button onClick={() => setIsLayaway(false)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${!isLayaway ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Venta normal</button>
                <button onClick={() => setIsLayaway(true)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${isLayaway ? 'bg-warning text-warning-foreground' : 'text-muted-foreground'}`}>Separado</button>
              </div>
              {isLayaway && <span className="text-xs text-warning">No se sumará al cuadre de caja</span>}
            </div>

            {isLayaway && (
              <div className="border-t border-border pt-3">
                <LayawayDeadlineSelector
                  createdDate={layawayCreatedDate}
                  mode={layawayDeadlineMode}
                  termDays={layawayTermDays}
                  customDueDate={layawayCustomDueDate}
                  onModeChange={setLayawayDeadlineMode}
                  onTermDaysChange={setLayawayTermDays}
                  onCustomDueDateChange={setLayawayCustomDueDate}
                />
              </div>
            )}

            {/* First payment for layaway */}
            {isLayaway && (
              <div className="border-t border-border pt-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={layawayFirstPayment} onChange={e => setLayawayFirstPayment(e.target.checked)} className="rounded" />
                  <span className="text-sm font-medium">Registrar primer abono ahora</span>
                </label>
                {layawayFirstPayment && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={layawayPayAmount}
                      onChange={e => setLayawayPayAmount(e.target.value)}
                      placeholder="Monto del abono"
                      className="bg-secondary/50 border-border"
                    />
                    <select value={layawayPayMethod} onChange={e => setLayawayPayMethod(e.target.value)} className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                      {['Efectivo', 'Transferencia', 'Tarjeta', 'Nequi', 'Daviplata'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select value={layawayAccountId} onChange={e => setLayawayAccountId(e.target.value)} className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                      {financialAccounts.filter(account => account.active && account.id !== LAYAWAY_RESERVE_ACCOUNT_ID).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </div>
                )}
                {layawayFirstPayment && layawayPayAmount && parseFloat(layawayPayAmount) > 0 && items.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Saldo pendiente: <span className="text-warning font-medium">{formatCurrency(total - (parseFloat(layawayPayAmount) || 0))}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Product search */}
          <div className="rounded-xl border border-border bg-card p-4">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agregar Producto</label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código o nombre..." className="pl-9 bg-secondary/50 border-border" value={searchCode} onChange={e => setSearchCode(e.target.value)} />
            </div>
            {matchedProducts.length > 0 && (
              <div className="mt-2 rounded-lg border border-border bg-popover overflow-hidden">
                {matchedProducts.map(p => {
                  const byWeight = isSoldByWeight(p);
                  return (
                  <button key={p.id} onClick={() => addProduct(p.id)} disabled={p.stock <= 0} className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-secondary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-b border-border/50 last:border-0">
                    <div className="text-left">
                      <span className="font-mono text-xs text-primary mr-2">{p.code}</span><span>{p.name}</span>
                      {byWeight ? <span className="text-warning ml-2 text-xs">(por gramos)</span> : <span className="text-muted-foreground ml-2">({formatWeight(p.weightGrams)} g)</span>}
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{formatCurrency(p.salePrice)}{byWeight ? '/g' : ''}</span>
                      <span className={`ml-2 text-xs ${p.stock <= p.minStock ? 'text-destructive' : 'text-muted-foreground'}`}>Stock: {byWeight ? `${formatWeight(p.stock)} g` : p.stock}</span>
                    </div>
                  </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Items table */}
          {items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Producto</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Cant.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">P. Unit.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Subtotal</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const product = products.find(p => p.id === item.productId);
                    const byWeight = product ? isSoldByWeight(product) : false;
                    return (
                    <tr key={item.productId} className="border-b border-border/50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.code} {byWeight ? <span className="text-warning">· Venta por gramos</span> : `· ${formatWeight(item.weightGrams)} g`}</p>
                        {item.priceModified && <span className="text-[10px] text-warning flex items-center gap-1 mt-0.5"><Pencil className="h-2.5 w-2.5" /> Precio modificado</span>}
                        {isPriceBelowCost(item) && <span className="text-[10px] text-destructive flex items-center gap-1 mt-0.5"><AlertTriangle className="h-2.5 w-2.5" /> Por debajo del costo</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {byWeight ? (
                          <div className="flex flex-col items-center">
                            <input type="number" min={0.1} step={0.1} value={item.quantity} onChange={e => updateQuantity(item.productId, parseFloat(e.target.value) || 0)} className="w-20 rounded border border-border bg-secondary/50 px-2 py-1 text-center text-sm outline-none focus:ring-1 focus:ring-primary" />
                            <span className="text-[10px] text-muted-foreground mt-0.5">gramos</span>
                          </div>
                        ) : (
                          <input type="number" min={1} value={item.quantity} onChange={e => updateQuantity(item.productId, parseInt(e.target.value) || 1)} className="w-14 rounded border border-border bg-secondary/50 px-2 py-1 text-center text-sm outline-none focus:ring-1 focus:ring-primary" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editingPrice === item.productId ? (
                          <div className="flex flex-col items-end">
                            <input type="number" autoFocus min={0} value={item.unitPrice} onChange={e => updateUnitPrice(item.productId, parseFloat(e.target.value) || 0)} onBlur={() => setEditingPrice(null)} onKeyDown={e => e.key === 'Enter' && setEditingPrice(null)} className="w-28 rounded border border-primary bg-secondary/50 px-2 py-1 text-right text-sm outline-none focus:ring-1 focus:ring-primary" />
                            {byWeight && <span className="text-[10px] text-muted-foreground mt-0.5">por gramo</span>}
                          </div>
                        ) : (
                          <button onClick={() => setEditingPrice(item.productId)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors" title="Editar precio">
                            {formatCurrency(item.unitPrice)}{byWeight ? '/g' : ''}<Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                      <td className="px-2 py-2.5"><button onClick={() => removeItem(item.productId)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notas para el cliente (visibles en PDF)</label>
              <textarea value={clientNotes} onChange={e => setClientNotes(e.target.value)} rows={2} placeholder="Ej: Garantía de 6 meses..." className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none" />
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notas internas (solo admin)</label>
              <textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} placeholder="Notas privadas..." className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none" />
            </div>
          </div>
        </div>

        {/* Right: Summary */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-6">
            <h3 className="font-semibold">Resumen</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Descuento</span>
                <input type="number" min={0} value={discount} onChange={e => { clearManualTotal(); setDiscount(parseFloat(e.target.value) || 0); }} className="w-28 rounded border border-border bg-secondary/50 px-2 py-1 text-right text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              {/* IVA omitido según requerimiento */}
              <div className="border-t border-border pt-2 space-y-2">
                <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="gold-text">{formatCurrency(total)}</span></div>
                {appliedCustomerCredit > 0.01 && (
                  <>
                    <div className="flex justify-between text-sm text-primary"><span>Saldo a favor</span><span>− {formatCurrency(appliedCustomerCredit)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Por pagar</span><span>{formatCurrency(paymentDue)}</span></div>
                  </>
                )}
                {tipoDocumento === 'factura' && (
                  <div className="space-y-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowManualTotal(value => !value)} className="w-full">
                      Ajustar total
                    </Button>
                    {showManualTotal && (
                      <div className="flex gap-2">
                        <Input
                          type="number" min="0.01" step="0.01" value={manualTotalInput}
                          onChange={event => setManualTotalInput(event.target.value)}
                          placeholder="Nuevo total" className="h-9 bg-secondary/50 border-border"
                        />
                        <Button type="button" size="sm" onClick={applyManualTotal}>Aplicar</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Forma de Pago</label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={combinedPayment} onChange={e => setCombinedPayment(e.target.checked)} className="rounded" />
                  Pago combinado
                </label>
              </div>
              <div key={combinedPayment ? 'combined' : 'single'}>
                {!combinedPayment ? (
                  <select value={singleAccountId} onChange={e => setSingleAccountId(e.target.value)} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                    {financialAccounts.filter(a => a.active && a.id !== LAYAWAY_RESERVE_ACCOUNT_ID).map(a => <option key={a.id} value={a.id}>{a.name} · {formatCurrency(a.balance)}</option>)}
                  </select>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select value={payment1.accountId} onChange={e => setPayment1({ ...payment1, accountId: e.target.value })} className="flex-1 rounded border border-border bg-secondary/50 px-2 py-1.5 text-xs text-foreground outline-none">
                        {financialAccounts.filter(a => a.active && a.id !== LAYAWAY_RESERVE_ACCOUNT_ID).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <Input type="number" value={payment1.amount} onChange={e => setPayment1({ ...payment1, amount: e.target.value })} placeholder="$0" className="w-28 h-8 text-xs bg-secondary/50 border-border" />
                    </div>
                    <div className="flex gap-2">
                      <select value={payment2.accountId} onChange={e => setPayment2({ ...payment2, accountId: e.target.value })} className="flex-1 rounded border border-border bg-secondary/50 px-2 py-1.5 text-xs text-foreground outline-none">
                        {financialAccounts.filter(a => a.active && a.id !== LAYAWAY_RESERVE_ACCOUNT_ID).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <Input type="number" value={payment2.amount} onChange={e => setPayment2({ ...payment2, amount: e.target.value })} placeholder="$0" className="w-28 h-8 text-xs bg-secondary/50 border-border" />
                    </div>
                    {(() => {
                      const sum = (parseFloat(payment1.amount) || 0) + (parseFloat(payment2.amount) || 0);
                      const diff = sum - paymentDue;
                      return Math.abs(diff) > 1 ? (
                        <p className="text-[10px] text-destructive">Diferencia: {formatCurrency(Math.abs(diff))} {diff > 0 ? 'de más' : 'faltante'}</p>
                      ) : sum > 0 ? (
                        <p className="text-[10px] text-success">✓ Suma correcta</p>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[minmax(96px,0.8fr)_minmax(180px,1.4fr)] gap-2 pt-2">
              <Button type="button" variant="outline" onClick={requestCloseSale}>Cancelar</Button>
              <Button className="w-full gold-gradient text-primary-foreground font-semibold gap-2" disabled={items.length === 0 || !clientId} onClick={handleSave}>
                <Save className="h-4 w-4" /> {isLayaway ? 'Guardar Separado' : tipoDocumento === 'factura' ? 'Guardar Factura' : 'Guardar Cotización'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* New Client Modal */}
      {showNewClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={requestCloseNewClient}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold">Nuevo Cliente</h3>
              <button type="button" onClick={requestCloseNewClient} className="p-1.5 rounded hover:bg-secondary" aria-label="Cerrar nuevo cliente"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Nombre *</label><Input value={newClientForm.name} onChange={e => setNewClientForm({ ...newClientForm, name: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Documento</label><Input value={newClientForm.document} onChange={e => setNewClientForm({ ...newClientForm, document: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Teléfono</label><Input value={newClientForm.phone} onChange={e => setNewClientForm({ ...newClientForm, phone: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Email</label><Input value={newClientForm.email} onChange={e => setNewClientForm({ ...newClientForm, email: e.target.value })} className="bg-secondary/50 border-border" /></div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSaveNewClient} className="gold-gradient text-primary-foreground font-semibold gap-2"><UserPlus className="h-4 w-4" /> Crear Cliente</Button>
              <Button variant="outline" onClick={requestCloseNewClient}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(savedInvoice)} onOpenChange={open => { if (!open) closeSavedInvoiceDialog(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Factura guardada correctamente.</DialogTitle>
            <DialogDescription>
              {savedInvoice ? `${savedInvoice.number} quedó registrada. Selecciona qué deseas hacer ahora.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" onClick={printSavedInvoice} className="w-full gold-gradient font-semibold text-primary-foreground">
              <Printer className="h-4 w-4" /> Imprimir ahora
            </Button>
            <Button type="button" variant="outline" onClick={viewSavedInvoice} className="w-full">
              <Eye className="h-4 w-4" /> Ver factura
            </Button>
            <Button type="button" variant="outline" onClick={closeSavedInvoiceDialog} className="w-full">
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NewInvoice;
