import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Check,
  ChevronDown,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import {
  calculateInventoryProjection,
  formatCurrency,
  getProductAvailableGrams,
  isSoldByWeight,
  recalculateInventoryCosts,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryAdjustmentType,
  type InventoryCostField,
  type InventoryCostValues,
  type Product,
} from '@/data/mockData';
import { fetchInventoryAdjustments } from '@/lib/database';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import ExcelDocumentActions from '@/components/ExcelDocumentActions';
import { formatWeight } from '@/lib/utils';

const MAX_SEARCH_RESULTS = 30;

interface AdjustmentFormMeta {
  productId: string;
  type: InventoryAdjustmentType;
  notes: string;
  date: string;
  supplierId: string;
  paymentStatus: 'paid' | 'pending';
  accountId: string;
  dueDate: string;
}

const EMPTY_COSTS: InventoryCostValues = {
  quantity: 1,
  grams: 0,
  totalCost: 0,
  unitCost: 0,
  valuePerGram: 0,
  purchasePrice: 0,
};

const todayIso = () => new Date().toISOString().split('T')[0];

const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatNumber = (value: number, maximumFractionDigits = 2): string =>
  value.toLocaleString('es-CO', { maximumFractionDigits });

const InventoryAdjustments = () => {
  const navigate = useNavigate();
  const { company, products, contacts, applyInventoryAdjustment, financialAccounts, refreshFinancialData } = useApp();
  const { toast } = useToast();
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<AdjustmentFormMeta>({
    productId: '',
    type: 'increase',
    notes: '',
    date: todayIso(),
    supplierId: '', paymentStatus: 'paid', accountId: 'account-caja-principal', dueDate: '',
  });
  const [costs, setCosts] = useState<InventoryCostValues>(EMPTY_COSTS);
  const [editingAdjustment, setEditingAdjustment] = useState<InventoryAdjustment | null>(null);

  const [productQuery, setProductQuery] = useState('');
  const deferredProductQuery = useDeferredValue(productQuery);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let mounted = true;
    void fetchInventoryAdjustments().then(data => {
      if (mounted) setAdjustments(data);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!searchContainerRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const productById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products],
  );

  const suppliers = useMemo(
    () => contacts.filter(contact => contact.type === 'supplier'),
    [contacts],
  );

  const supplierById = useMemo(
    () => new Map(suppliers.map(supplier => [supplier.id, supplier])),
    [suppliers],
  );

  const searchableProducts = useMemo(() => products.map(product => ({
    product,
    searchText: normalizeSearch([
      product.code,
      product.name,
      product.reference || '',
      product.category,
    ].join(' ')),
  })), [products]);

  const searchResults = useMemo(() => {
    const query = normalizeSearch(deferredProductQuery);
    if (!query) return searchableProducts.slice(0, MAX_SEARCH_RESULTS).map(row => row.product);

    const tokens = query.split(/\s+/).filter(Boolean);
    const matches: Product[] = [];
    for (const row of searchableProducts) {
      if (tokens.every(token => row.searchText.includes(token))) {
        matches.push(row.product);
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
    }
    return matches;
  }, [deferredProductQuery, searchableProducts]);

  useEffect(() => {
    setActiveResult(0);
  }, [deferredProductQuery]);

  useEffect(() => {
    resultRefs.current[activeResult]?.scrollIntoView({ block: 'nearest' });
  }, [activeResult]);

  const selectedProduct = form.productId ? productById.get(form.productId) : undefined;

  const adjustmentInput = useMemo<InventoryAdjustmentInput | null>(() => {
    if (!selectedProduct) return null;
    const supplier = form.supplierId ? supplierById.get(form.supplierId) : undefined;
    return {
      productId: selectedProduct.id,
      type: form.type,
      operation: editingAdjustment ? 'update' : 'create',
      adjustmentId: editingAdjustment?.id,
      ...costs,
      notes: form.notes.trim(),
      date: form.date,
      supplierId: supplier?.id,
      supplierName: supplier?.name, paymentStatus: form.paymentStatus, accountId: form.accountId, dueDate: form.dueDate,
    };
  }, [selectedProduct, supplierById, form, costs, editingAdjustment]);

  const projection = useMemo(() => {
    if (!selectedProduct || !adjustmentInput) return null;
    return calculateInventoryProjection(selectedProduct, adjustmentInput);
  }, [selectedProduct, adjustmentInput]);

  const resetForm = useCallback(() => {
    setForm({
      productId: '',
      type: 'increase',
      notes: '',
      date: todayIso(),
      supplierId: '', paymentStatus: 'paid', accountId: 'account-caja-principal', dueDate: '',
    });
    setCosts(EMPTY_COSTS);
    setProductQuery('');
    setSearchOpen(false);
    setActiveResult(0);
    setEditingAdjustment(null);
  }, []);

  const selectProduct = useCallback((product: Product) => {
    const byWeight = isSoldByWeight(product);
    const quantity = 1;
    const grams = byWeight ? 0 : Math.max(0, product.weightGrams);
    const purchasePrice = Math.max(0, product.purchasePrice);
    const totalCost = byWeight ? 0 : purchasePrice * quantity;

    setForm(previous => ({ ...previous, productId: product.id }));
    setCosts({
      quantity,
      grams,
      totalCost,
      unitCost: byWeight ? 0 : purchasePrice,
      purchasePrice: byWeight ? 0 : purchasePrice,
      valuePerGram: byWeight
        ? purchasePrice
        : (grams > 0 ? totalCost / grams : 0),
    });
    setProductQuery(`${product.code} | ${product.name}`);
    setSearchOpen(false);
  }, []);

  const updateCost = useCallback((field: InventoryCostField, rawValue: string) => {
    const value = rawValue === '' ? 0 : Number(rawValue);
    setCosts(previous => recalculateInventoryCosts(previous, field, value));
  }, []);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (searchResults.length > 0) setSearchOpen(true);
      return;
    }
    if (!searchOpen) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (searchResults.length === 0) return;
      setActiveResult(index => Math.min(index + 1, searchResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const product = searchResults[activeResult];
      if (product) selectProduct(product);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSearchOpen(false);
    }
  };

  const validate = (): string | null => {
    if (!selectedProduct || !adjustmentInput || !projection) return 'Selecciona un producto.';
    if (costs.quantity <= 0) return 'La cantidad debe ser mayor a 0.';
    if (costs.grams <= 0) return 'Los gramos deben ser mayores a 0.';
    if (!form.date) return 'Selecciona la fecha del movimiento.';
    if (form.type === 'increase' && costs.totalCost <= 0) return 'El costo total debe ser mayor a 0.';
    if (form.type === 'increase' && form.paymentStatus === 'paid' && !form.accountId) return 'Selecciona la cuenta de pago.';
    if (form.type === 'increase' && form.paymentStatus === 'pending' && !form.supplierId) return 'Selecciona un proveedor para crear la cuenta por pagar.';
    if (form.type === 'increase' && (costs.unitCost <= 0 || costs.valuePerGram <= 0)) {
      return 'El costo unitario y el valor por gramo deben ser mayores a 0.';
    }
    if (projection.stockAfter < -1e-9) return `Stock insuficiente. Stock actual: ${formatWeight(selectedProduct.stock)}.`;
    if (projection.gramsAfter < -1e-9) {
      return `Gramos insuficientes. Disponibles: ${formatWeight(getProductAvailableGrams(selectedProduct))} g.`;
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError || !adjustmentInput || !selectedProduct) {
      toast({ title: 'No se pudo guardar', description: validationError || 'Datos incompletos.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const result = await applyInventoryAdjustment({
        ...adjustmentInput,
        notes: adjustmentInput.notes || (form.type === 'increase' ? 'Entrada de mercancía' : 'Salida de inventario'),
      });
      setAdjustments(previous => editingAdjustment
        ? previous.map(row => row.id === result.adjustment.id ? result.adjustment : row)
        : [result.adjustment, ...previous]);
      await refreshFinancialData();
      setShowForm(false);
      resetForm();
      toast({
        title: editingAdjustment ? 'Ajuste actualizado' : (form.type === 'increase' ? 'Entrada registrada' : 'Salida registrada'),
        description: `${selectedProduct.name}: ${formatWeight(result.adjustment.stockBefore)} → ${formatWeight(result.adjustment.stockAfter)}`,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const description = code === 'INSUFFICIENT_STOCK'
        ? 'El producto no tiene stock suficiente.'
        : code === 'INSUFFICIENT_GRAMS'
          ? 'El producto no tiene gramos suficientes.'
          : code === 'PRODUCT_NOT_FOUND'
            ? 'El producto ya no existe.'
            : 'No fue posible guardar el ajuste. Revisa los datos e intenta nuevamente.';
      toast({ title: 'Error al guardar', description, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const openForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (adjustment: InventoryAdjustment) => {
    const product = productById.get(adjustment.productId);
    if (!product) {
      toast({ title: 'Producto no disponible', variant: 'destructive' });
      return;
    }
    setEditingAdjustment(adjustment);
    setForm({
      productId: adjustment.productId, type: adjustment.type, notes: adjustment.notes, date: adjustment.date,
      supplierId: adjustment.supplierId || '', paymentStatus: 'paid', accountId: 'account-caja-principal', dueDate: '',
    });
    setCosts({
      quantity: adjustment.quantity, grams: adjustment.grams, totalCost: adjustment.totalCost,
      unitCost: adjustment.unitCost, valuePerGram: adjustment.valuePerGram, purchasePrice: adjustment.purchasePrice,
    });
    setProductQuery(`${product.code} | ${product.name}`);
    setSearchOpen(false);
    setShowForm(true);
  };

  const deleteAdjustment = async (adjustment: InventoryAdjustment) => {
    if (!window.confirm(`¿Eliminar el ajuste de ${adjustment.productName || adjustment.productCode}? Esta acción revertirá su impacto.`)) return;
    setIsSaving(true);
    try {
      await applyInventoryAdjustment({
        operation: 'delete', adjustmentId: adjustment.id, productId: adjustment.productId, type: adjustment.type,
        quantity: adjustment.quantity, grams: adjustment.grams, totalCost: adjustment.totalCost, unitCost: adjustment.unitCost,
        valuePerGram: adjustment.valuePerGram, purchasePrice: adjustment.purchasePrice, notes: adjustment.notes, date: adjustment.date,
      });
      setAdjustments(previous => previous.filter(row => row.id !== adjustment.id));
      await refreshFinancialData();
      toast({ title: 'Ajuste eliminado', description: 'Stock, valorización y movimientos exclusivos fueron revertidos.' });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const description = code === 'ADJUSTMENT_HAS_PAID_PAYABLE'
        ? 'El ajuste tiene pagos asociados y no puede eliminarse sin afectar cuentas por pagar.'
        : code === 'ADJUSTMENT_REVERSAL_CONFLICT'
          ? 'El inventario actual no permite revertir este ajuste de forma segura.'
          : 'No se eliminó ningún dato. La transacción fue revertida.';
      toast({ title: 'No se pudo eliminar', description, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const buildMovementsDocument = () => buildTableDocumentData({
    company,
    title: 'Kardex y Movimientos de Inventario',
    subtitle: `${adjustments.length} movimientos`,
    columns: [
      { header: 'Fecha' }, { header: 'Código' }, { header: 'Producto' }, { header: 'Tipo' },
      { header: 'Cantidad', align: 'right' }, { header: 'Gramos', align: 'right' },
      { header: 'Costo total', align: 'right' }, { header: 'Stock antes', align: 'right' },
      { header: 'Stock después', align: 'right' }, { header: 'Proveedor' }, { header: 'Observaciones' },
    ],
    rows: adjustments.map(adjustment => [
      adjustment.date,
      adjustment.productCode,
      adjustment.productName,
      adjustment.type === 'increase' ? 'Entrada' : 'Salida',
      adjustment.quantity,
      formatWeight(adjustment.grams),
      adjustment.type === 'increase' ? formatCurrency(adjustment.totalCost) : '—',
      formatWeight(adjustment.stockBefore),
      formatWeight(adjustment.stockAfter),
      adjustment.supplierName || '—',
      adjustment.notes || '—',
    ]),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => navigate('/inventario')} className="rounded-lg p-2 hover:bg-secondary transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold">Ajustes de Inventario</h1>
            <p className="break-words text-sm text-muted-foreground">Único punto de entrada y salida de mercancía</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap gap-2"><PdfDocumentActions document={buildMovementsDocument} label="Kardex PDF" formats={['letter']} /><ExcelDocumentActions document={buildMovementsDocument} label="Kardex Excel" /></div>
          <Button onClick={openForm} className="gold-gradient text-primary-foreground font-semibold gap-2">
            <Plus className="h-4 w-4" /> Nuevo Ajuste
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-primary/20 bg-card p-5 space-y-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{editingAdjustment ? 'Editar Ajuste' : 'Nuevo Ajuste'}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Los costos se recalculan en tiempo real.</p>
            </div>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="rounded-lg p-1.5 hover:bg-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1 lg:col-span-2" ref={searchContainerRef}>
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Producto *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  disabled={Boolean(editingAdjustment)}
                  onFocus={() => { if (!editingAdjustment) setSearchOpen(true); }}
                  onChange={event => {
                    setProductQuery(event.target.value);
                    if (form.productId) setForm(previous => ({ ...previous, productId: '' }));
                    setSearchOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Buscar por código, nombre, referencia o categoría..."
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={searchOpen}
                  className="pl-9 pr-9 bg-secondary/50 border-border"
                />
                <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                {searchOpen && (
                  <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
                    {searchResults.length > 0 ? searchResults.map((product, index) => {
                      const byWeight = isSoldByWeight(product);
                      const active = index === activeResult;
                      return (
                        <button
                          key={product.id}
                          ref={element => { resultRefs.current[index] = element; }}
                          type="button"
                          onMouseEnter={() => setActiveResult(index)}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => selectProduct(product)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors ${active ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/60'}`}
                        >
                          <div className="min-w-0">
                            <p className="break-words font-medium">
                              <span className="font-mono text-primary">{product.code}</span> | {product.name}
                            </p>
                            <p className="break-words text-[11px] text-muted-foreground">
                              {product.reference && product.reference !== product.code ? `Ref. ${product.reference} · ` : ''}{product.category}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Stock: {byWeight ? formatWeight(product.stock) : formatNumber(product.stock)}{byWeight ? ' g' : ''}
                          </span>
                        </button>
                      );
                    }) : (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">No se encontraron productos.</div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Usa ↑ ↓, Enter y Escape para navegar sin mouse.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Tipo de ajuste *</label>
              <select
                value={form.type}
                disabled={Boolean(editingAdjustment)}
                onChange={event => setForm(previous => ({ ...previous, type: event.target.value as InventoryAdjustmentType }))}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="increase">⬆️ Entrada</option>
                <option value="decrease">⬇️ Salida</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Fecha *</label>
              <Input
                type="date"
                disabled={Boolean(editingAdjustment)}
                value={form.date}
                onChange={event => setForm(previous => ({ ...previous, date: event.target.value }))}
                className="bg-secondary/50 border-border"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Cantidad *</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costs.quantity || ''}
                onChange={event => updateCost('quantity', event.target.value)}
                placeholder="0"
                className="bg-secondary/50 border-border"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Gramos *</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costs.grams || ''}
                onChange={event => updateCost('grams', event.target.value)}
                placeholder="0"
                className="bg-secondary/50 border-border"
              />
            </div>

            {form.type === 'increase' ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Costo total *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costs.totalCost || ''}
                    onChange={event => updateCost('totalCost', event.target.value)}
                    placeholder="0"
                    className="bg-secondary/50 border-border"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Costo unitario *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costs.unitCost || ''}
                    onChange={event => updateCost('unitCost', event.target.value)}
                    placeholder="0"
                    className="bg-secondary/50 border-border"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Valor por gramo *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costs.valuePerGram || ''}
                    onChange={event => updateCost('valuePerGram', event.target.value)}
                    placeholder="0"
                    className="bg-secondary/50 border-border"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Precio de compra {selectedProduct && isSoldByWeight(selectedProduct) ? '(por gramo)' : '(unitario)'} *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={selectedProduct && isSoldByWeight(selectedProduct) ? (costs.valuePerGram || '') : (costs.purchasePrice || '')}
                    onChange={event => updateCost(
                      selectedProduct && isSoldByWeight(selectedProduct) ? 'valuePerGram' : 'purchasePrice',
                      event.target.value,
                    )}
                    placeholder="0"
                    className="bg-secondary/50 border-border"
                  />
                </div>

                <div className="space-y-1 lg:col-span-2">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Proveedor opcional</label>
                  <select
                    value={form.supplierId}
                    disabled={Boolean(editingAdjustment)}
                    onChange={event => setForm(previous => ({ ...previous, supplierId: event.target.value }))}
                    className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Sin proveedor</option>
                    {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Estado de pago</label>
                  <select value={form.paymentStatus} disabled={Boolean(editingAdjustment)} onChange={event => setForm(previous => ({ ...previous, paymentStatus: event.target.value as 'paid' | 'pending' }))} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                    <option value="paid">Pagada</option><option value="pending">Pendiente</option>
                  </select>
                </div>
                {form.paymentStatus === 'paid' ? (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Cuenta de salida</label>
                    <select value={form.accountId} disabled={Boolean(editingAdjustment)} onChange={event => setForm(previous => ({ ...previous, accountId: event.target.value }))} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                      {financialAccounts.filter(account => account.active).map(account => <option key={account.id} value={account.id}>{account.name} · {formatCurrency(account.balance)}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Fecha de vencimiento</label>
                    <Input type="date" disabled={Boolean(editingAdjustment)} value={form.dueDate} onChange={event => setForm(previous => ({ ...previous, dueDate: event.target.value }))} className="bg-secondary/50 border-border" />
                  </div>
                )}
              </>
            ) : (
              <div className="lg:col-span-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                Las salidas solo disminuyen stock y gramos. El precio de compra y el costo promedio no se modifican.
              </div>
            )}

            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Notas</label>
              <textarea
                value={form.notes}
                onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))}
                rows={2}
                placeholder="Detalle del movimiento, factura, lote, observaciones..."
                className="w-full resize-none rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {selectedProduct && projection && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Stock</p>
                <p className="font-semibold">{formatWeight(projection.stockBefore)} → {formatWeight(Math.max(0, projection.stockAfter))}</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Gramos disponibles</p>
                <p className="font-semibold">{formatWeight(projection.gramsBefore)} → {formatWeight(Math.max(0, projection.gramsAfter))} g</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Precio compra</p>
                <p className="font-semibold">{formatCurrency(projection.purchasePriceAfter)}</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Costo promedio</p>
                <p className="font-semibold">{formatCurrency(projection.averagePriceAfter)}</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Utilidad proyectada</p>
                <p className={`font-semibold ${projection.marginAfter >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatNumber(projection.marginAfter)}%
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button disabled={isSaving} onClick={handleSave} className="gold-gradient text-primary-foreground font-semibold gap-2">
              {isSaving ? 'Guardando...' : <><Check className="h-4 w-4" /> {editingAdjustment ? 'Guardar Cambios' : 'Guardar Ajuste'}</>}
            </Button>
            <Button variant="outline" disabled={isSaving} onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Producto</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cantidad</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gramos</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Costo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Notas</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map(adjustment => {
                const product = productById.get(adjustment.productId);
                const code = adjustment.productCode || product?.code || adjustment.productId;
                const name = adjustment.productName || product?.name || 'Producto no disponible';
                return (
                  <tr key={adjustment.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{adjustment.date}</td>
                    <td className="px-4 py-3 font-medium"><span className="font-mono text-primary text-xs mr-1.5">{code}</span>{name}</td>
                    <td className="px-4 py-3 text-center">
                      {adjustment.type === 'increase' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-[10px] font-medium text-success"><ArrowUpCircle className="h-3 w-3" /> Entrada</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-[10px] font-medium text-destructive"><ArrowDownCircle className="h-3 w-3" /> Salida</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatNumber(adjustment.quantity)}</td>
                    <td className="px-4 py-3 text-right">{formatWeight(adjustment.grams)} g</td>
                    <td className="px-4 py-3 text-right">{adjustment.type === 'increase' ? formatCurrency(adjustment.totalCost) : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{adjustment.supplierName || '—'}</td>
                    <td className="max-w-[320px] break-words px-4 py-3 text-muted-foreground" title={adjustment.notes}>{adjustment.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon" disabled={isSaving} onClick={() => openEditForm(adjustment)} title="Editar ajuste">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" disabled={isSaving} onClick={() => void deleteAdjustment(adjustment)} title="Eliminar ajuste" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {adjustments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No hay ajustes registrados.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryAdjustments;
