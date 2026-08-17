import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Package as PackageIcon, Eye, Pencil, Trash2, X, Save, AlertTriangle, ArrowDownUp, Ban, Upload, FileSpreadsheet, Download, ReceiptText } from 'lucide-react';
import {
  formatCurrency,
  getProductAvailableGrams,
  getProductAveragePurchasePrice,
  isSoldByWeight,
  type Product,
} from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { buildTableDocumentData } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import BulkImportDialog from '@/components/BulkImportDialog';
import ProductMassUpdateDialog from '@/components/ProductMassUpdateDialog';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import { deleteCategoryByName, findOrCreateCategory, renameCategory } from '@/lib/categoryService';
import { formatWeight } from '@/lib/utils';
import DirectPdfActionButton from '@/components/DirectPdfActionButton';
import { useAuth } from '@/contexts/AuthContext';
import { hasSessionPermission } from '@/lib/auth';
import { exportRowsWithSummaryToExcel } from '@/lib/excelExport';
import { getActiveRepositoryMode } from '@/repositories/RepositoryRegistry';
import { buildInventoryPdfDocument, buildInventoryRows, inventoryProfessionalExcelColumns } from '@/lib/professionalExports';
import { downloadProductUpdateTemplate } from '@/lib/productMassUpdate';
import {
  buildProductSalesHistoryIndex,
  EMPTY_PRODUCT_SALES_INFO,
  type ProductSalesInfo,
} from '@/lib/salesTraceability';

const Inventory = () => {
  const {
    company,
    products,
    setProducts,
    contacts,
    setContacts,
    categories,
    setCategories,
    invoices,
    purchaseInvoices,
    layaways,
    refreshProducts,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isRemoteInventory = getActiveRepositoryMode() === 'lan';
  const canManageProducts = hasSessionPermission(user, 'manage_products');
  const canManageInventory = hasSessionPermission(user, 'manage_inventory');
  const [showingStaleRemoteData, setShowingStaleRemoteData] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string }>).detail;
      if (detail?.module === 'products' || detail?.module === 'categories') setShowingStaleRemoteData(true);
    };
    window.addEventListener('joyacontrol:lan-stale-data', handler);
    return () => window.removeEventListener('joyacontrol:lan-stale-data', handler);
  }, []);
  const [tab, setTab] = useState<'products' | 'categories' | 'summary'>('products');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all');
  const [viewProduct, setViewProduct] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [editCategory, setEditCategory] = useState<{ old: string; val: string } | null>(null);

  // Delete/deactivate state
  const [deleteProduct, setDeleteProduct] = useState<string | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showProductMassUpdate, setShowProductMassUpdate] = useState(false);
  // Inventory report option: when true (default), the physical-count report only
  // includes products with stock > 0. This only affects the printed report — it
  // never filters or modifies the actual inventory data shown in the table.
  const [printOnlyInStock, setPrintOnlyInStock] = useState(true);

  const suppliers = useMemo(() => contacts.filter(c => c.type === 'supplier'), [contacts]);

  const contactNameById = useMemo(
    () => new Map(contacts.map(contact => [contact.id, contact.name])),
    [contacts],
  );

  const productById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products],
  );

  const searchableProducts = useMemo(() => products.map(product => ({
    product,
    searchText: [product.code, product.name, product.reference || '', product.category]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  })), [products]);

  const filtered = useMemo(() => {
    const query = search
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);

    return searchableProducts
      .filter(({ product, searchText }) => {
        const matchSearch = tokens.length === 0 || tokens.every(token => searchText.includes(token));
        const matchCat = !categoryFilter || product.category === categoryFilter;
        const matchSupplier = !supplierFilter || product.supplierIds?.includes(supplierFilter);
        const matchStock = stockFilter === 'all' || product.stock <= product.minStock;
        return matchSearch && matchCat && matchSupplier && matchStock;
      })
      .map(({ product }) => product);
  }, [searchableProducts, search, categoryFilter, supplierFilter, stockFilter]);


  const inventoryFiltersDescription = useMemo(() => [
    search.trim() ? `Búsqueda: ${search.trim()}` : '',
    categoryFilter ? `Categoría: ${categoryFilter}` : '',
    supplierFilter ? `Proveedor: ${contactNameById.get(supplierFilter) || supplierFilter}` : '',
    stockFilter === 'low' ? 'Solo stock bajo' : '',
  ].filter(Boolean).join(' · ') || 'Sin filtros', [search, categoryFilter, supplierFilter, stockFilter, contactNameById]);

  const inventoryExportContext = useMemo(() => ({
    company,
    products: filtered,
    contacts,
    currentUserName: user?.displayName || user?.username || 'Usuario',
    filtersDescription: inventoryFiltersDescription,
  }), [company, filtered, contacts, user, inventoryFiltersDescription]);

  const exportInventoryExcel = (): void => {
    const rows = buildInventoryRows(inventoryExportContext);
    const totalCost = rows.reduce((sum, row) => sum + row.inventoryValue, 0);
    const totalSale = filtered.reduce((sum, product) => sum + product.salePrice * product.stock, 0);
    exportRowsWithSummaryToExcel({
      filename: 'Inventario_Filtrado', sheetName: 'Inventario', rows, columns: inventoryProfessionalExcelColumns,
      summaryLines: [
        { label: 'Cantidad productos', value: rows.length },
        { label: 'Gramos totales', value: rows.reduce((sum, row) => sum + row.grams, 0) },
        { label: 'Costo total', value: totalCost },
        { label: 'Valor venta', value: totalSale },
        { label: 'Utilidad potencial', value: totalSale - totalCost },
      ],
    });
  };

  // Read-only invoice history is indexed once whenever its source data changes.
  // Opening a product afterwards is an O(1) Map lookup.
  const salesByProduct = useMemo(
    () => buildProductSalesHistoryIndex(invoices, products, layaways),
    [invoices, layaways, products],
  );

  const getSalesInfo = useCallback((productId: string): ProductSalesInfo =>
    salesByProduct.get(productId) ?? EMPTY_PRODUCT_SALES_INFO, [salesByProduct]);

  const getSupplierNames = useCallback((product: typeof products[0]) => {
    if (!product.supplierIds?.length) return '—';
    return product.supplierIds.map(id => contactNameById.get(id) ?? '?').join(', ');
  }, [contactNameById]);

  const inventoryTotals = useMemo(() => products.reduce((totals, product) => {
    const averageCost = getProductAveragePurchasePrice(product);
    totals.totalPurchaseValue += averageCost * product.stock;
    totals.totalSaleValue += product.salePrice * product.stock;
    totals.totalStock += isSoldByWeight(product) ? 0 : product.stock;
    totals.totalGrams += getProductAvailableGrams(product);
    if (product.stock <= product.minStock) totals.lowStockCount += 1;
    return totals;
  }, {
    totalPurchaseValue: 0,
    totalSaleValue: 0,
    totalStock: 0,
    totalGrams: 0,
    lowStockCount: 0,
  }), [products]);

  const {
    totalPurchaseValue,
    totalSaleValue,
    totalStock,
    totalGrams,
    lowStockCount,
  } = inventoryTotals;


  const categoryStats = useMemo(() => {
    const stats = new Map<string, {
      category: string;
      productCount: number;
      stock: number;
      grams: number;
      purchaseValue: number;
      saleValue: number;
      byWeight: boolean;
    }>();

    products.forEach(product => {
      const current = stats.get(product.category) ?? {
        category: product.category,
        productCount: 0,
        stock: 0,
        grams: 0,
        purchaseValue: 0,
        saleValue: 0,
        byWeight: isSoldByWeight(product),
      };
      current.productCount += 1;
      current.stock += isSoldByWeight(product) ? 0 : product.stock;
      current.grams += getProductAvailableGrams(product);
      current.purchaseValue += getProductAveragePurchasePrice(product) * product.stock;
      current.saleValue += product.salePrice * product.stock;
      stats.set(product.category, current);
    });

    return stats;
  }, [products]);

  // Edit form state
  const [editForm, setEditForm] = useState<any>({});
  const [showEditNewSupplier, setShowEditNewSupplier] = useState(false);
  const [editNewSupplier, setEditNewSupplier] = useState({ name: '', document: '', phone: '', email: '', address: '' });

  const startEdit = useCallback((id: string) => {
    const product = productById.get(id);
    if (product) {
      setEditForm({
        ...product,
        reference: product.reference || product.code,
        availableGrams: getProductAvailableGrams(product),
        averagePurchasePrice: getProductAveragePurchasePrice(product),
      });
      setShowEditNewSupplier(false);
      setEditNewSupplier({ name: '', document: '', phone: '', email: '', address: '' });
      setEditProduct(id);
    }
  }, [productById]);

  const saveEdit = () => {
    const currentProduct = editProduct ? productById.get(editProduct) : undefined;
    const newSalePrice = Number(editForm.salePrice) || 0;
    if (!currentProduct) return;
    if (newSalePrice <= 0) {
      toast({ title: 'Precio de venta obligatorio', description: 'Debe ser mayor a 0', variant: 'destructive' });
      return;
    }

    const averagePurchasePrice = getProductAveragePurchasePrice(currentProduct);
    setProducts(products.map(product => product.id === editProduct ? {
      ...product,
      code: String(editForm.code || '').trim(),
      name: String(editForm.name || '').trim(),
      reference: String(editForm.reference || editForm.code || '').trim(),
      category: String(editForm.category || product.category),
      salePrice: newSalePrice,
      weightGrams: Number(editForm.weightGrams) || 0,
      minStock: Number(editForm.minStock) || 0,
      description: String(editForm.description || ''),
      supplierIds: Array.isArray(editForm.supplierIds) ? editForm.supplierIds : [],
      // Stock, available grams and acquisition costs are intentionally
      // preserved. Their only write path is Ajustes de Inventario.
      stock: product.stock,
      availableGrams: getProductAvailableGrams(product),
      purchasePrice: product.purchasePrice,
      averagePurchasePrice,
      lastPurchaseDate: product.lastPurchaseDate,
      margin: averagePurchasePrice > 0
        ? ((newSalePrice - averagePurchasePrice) / averagePurchasePrice) * 100
        : 0,
    } : product));
    setEditProduct(null);
    toast({ title: 'Producto actualizado' });
  };


  const toggleEditSupplier = (supplierId: string) => {
    setEditForm((current: any) => {
      const currentIds = Array.isArray(current.supplierIds) ? current.supplierIds : [];
      return {
        ...current,
        supplierIds: currentIds.includes(supplierId)
          ? currentIds.filter((id: string) => id !== supplierId)
          : [...currentIds, supplierId],
      };
    });
  };

  const createAndAssociateEditSupplier = () => {
    if (!editNewSupplier.name.trim()) {
      toast({ title: '⚠️ El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    const newContact = {
      id: crypto.randomUUID(),
      type: 'supplier' as const,
      name: editNewSupplier.name.trim(),
      document: editNewSupplier.document,
      phone: editNewSupplier.phone,
      email: editNewSupplier.email,
      address: editNewSupplier.address,
      notes: '',
    };
    setContacts([newContact, ...contacts]);
    setEditForm((current: any) => ({
      ...current,
      supplierIds: [...(Array.isArray(current.supplierIds) ? current.supplierIds : []), newContact.id],
    }));
    setEditNewSupplier({ name: '', document: '', phone: '', email: '', address: '' });
    setShowEditNewSupplier(false);
    toast({ title: '✅ Proveedor creado y asociado' });
  };

  const usedProductIds = useMemo(() => {
    const ids = new Set<string>();
    invoices.forEach(invoice => invoice.items.forEach(item => ids.add(item.productId)));
    // Historical purchases remain read-only but still protect referential integrity.
    purchaseInvoices.forEach(invoice => invoice.items.forEach(item => ids.add(item.productId)));
    return ids;
  }, [invoices, purchaseInvoices]);

  const isProductUsed = useCallback((productId: string) => usedProductIds.has(productId), [usedProductIds]);

  const handleDeleteProduct = (productId: string) => {
    setProducts(products.filter(p => p.id !== productId));
    setDeleteProduct(null);
    toast({ title: '🗑️ Producto eliminado', description: 'El artículo ha sido removido del inventario.' });
  };

  const handleDeactivateProduct = (productId: string) => {
    setProducts(products.map(p => p.id === productId ? { ...p, stock: 0, availableGrams: 0, minStock: 0 } : p));
    setDeleteProduct(null);
    toast({ title: '⏸️ Producto desactivado', description: 'El stock ha sido puesto en 0. El artículo permanece en el historial.' });
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    const normalizedKey = newCategory.trim().toLowerCase().replace(/\s+/g, ' ');
    const alreadyExists = categories.some(c => c.toLowerCase().replace(/\s+/g, ' ') === normalizedKey);
    if (alreadyExists) {
      toast({ title: '⚠️ Esa categoría ya existe', variant: 'destructive' });
      return;
    }
    const created = await findOrCreateCategory(newCategory.trim());
    setCategories(Array.from(new Set([...categories, created.name])).sort((a, b) => a.localeCompare(b, 'es')));
    setNewCategory('');
    toast({ title: 'Categoría agregada' });
  };
  const deleteCategory = async (c: string) => {
    if (products.some(p => p.category === c)) {
      toast({ title: '⚠️ No se puede eliminar', description: 'Hay productos con esta categoría', variant: 'destructive' });
      return;
    }
    try {
      await deleteCategoryByName(c);
      setCategories(categories.filter(x => x !== c));
      toast({ title: 'Categoría eliminada' });
    } catch (error) {
      toast({
        title: 'No se pudo eliminar la categoría',
        description: error instanceof Error ? error.message : 'Error de Repository',
        variant: 'destructive',
      });
    }
  };
  const saveEditCategory = async () => {
    if (!editCategory) return;
    const requestedName = editCategory.val.trim();
    if (!requestedName) {
      toast({ title: 'Nombre de categoría obligatorio', variant: 'destructive' });
      return;
    }
    try {
      const updated = await renameCategory(editCategory.old, requestedName);
      setCategories(categories.map(c => c === editCategory.old ? updated.name : c));
      setProducts(products.map(p => p.category === editCategory.old ? { ...p, category: updated.name } : p));
      setEditCategory(null);
      toast({ title: 'Categoría actualizada' });
    } catch (error) {
      toast({
        title: 'No se pudo actualizar la categoría',
        description: error instanceof Error ? error.message : 'Error de Repository',
        variant: 'destructive',
      });
    }
  };

  const buildInventoryDocument = useCallback((selection: Product[], title: string, subtitle: string) => {
    const selectionPurchaseValue = selection.reduce((sum, product) => sum + getProductAveragePurchasePrice(product) * product.stock, 0);
    const selectionSaleValue = selection.reduce((sum, product) => sum + product.salePrice * product.stock, 0);
    const selectionGrams = selection.reduce((sum, product) => sum + getProductAvailableGrams(product), 0);

    return buildTableDocumentData({
      company,
      title,
      subtitle: `${subtitle} · ${selection.length} productos · ${formatWeight(selectionGrams)} g`,
      filename: title,
      columns: [
        { header: 'Código' },
        { header: 'Producto' },
        { header: 'Descripción' },
        { header: 'Categoría' },
        { header: 'Stock', align: 'center' },
        { header: 'Gramos disp.', align: 'right' },
        { header: 'Costo prom.', align: 'right' },
        { header: 'Venta Unit.', align: 'right' },
        { header: 'Costo Inventario', align: 'right' },
        { header: 'Valor Inventario', align: 'right' },
        { header: 'Estado', align: 'center' },
      ],
      rows: selection.map(product => {
        const byWeight = isSoldByWeight(product);
        const averageCost = getProductAveragePurchasePrice(product);
        return [
          product.code,
          product.name,
          product.description || '-',
          product.category,
          byWeight ? `${formatWeight(product.stock)} g` : String(product.stock),
          `${formatWeight(getProductAvailableGrams(product))} g`,
          formatCurrency(averageCost),
          formatCurrency(product.salePrice),
          formatCurrency(averageCost * product.stock),
          formatCurrency(product.salePrice * product.stock),
          product.stock <= product.minStock ? 'Bajo Stock' : 'Stock OK',
        ];
      }),
      summaryLines: [
        { label: 'Costo total inventario', value: formatCurrency(selectionPurchaseValue) },
        { label: 'Valor comercial inventario', value: formatCurrency(selectionSaleValue) },
        { label: 'Utilidad potencial', value: formatCurrency(selectionSaleValue - selectionPurchaseValue), bold: true },
      ],
    });
  }, [company]);



  const vp = viewProduct ? productById.get(viewProduct) ?? null : null;
  const vpSalesHistory = vp ? getSalesInfo(vp.id).history : EMPTY_PRODUCT_SALES_INFO.history;
  const dp = deleteProduct ? productById.get(deleteProduct) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-sm text-muted-foreground mt-1">{products.length} productos · {totalStock} uds · {formatWeight(totalGrams)} g</p>
        </div>
        {(canManageInventory || canManageProducts) && (
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            {canManageInventory && (
              <Link to="/inventario/ajustes">
                <Button variant="outline" className="gap-2"><ArrowDownUp className="h-4 w-4" /> Ajustes</Button>
              </Link>
            )}
            {canManageProducts && (
              <>
                <Button variant="outline" onClick={() => downloadProductUpdateTemplate(products, contacts)} className="gap-2">
                  <Download className="h-4 w-4" /> Plantilla actualización
                </Button>
                <Button variant="outline" onClick={() => setShowBulkImport(true)} className="gap-2">
                  <Upload className="h-4 w-4" /> Carga Masiva
                </Button>
                <Button variant="outline" onClick={() => setShowProductMassUpdate(true)} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" /> Actualizar productos masivamente
                </Button>
                <Link to="/inventario/nuevo">
                  <Button className="gold-gradient text-primary-foreground font-semibold gap-2">
                    <Plus className="h-4 w-4" /> Nuevo Producto
                  </Button>
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      {canManageProducts && <BulkImportDialog open={showBulkImport} onOpenChange={setShowBulkImport} />}
      {canManageProducts && (
        <ProductMassUpdateDialog
          open={showProductMassUpdate}
          onOpenChange={setShowProductMassUpdate}
          products={products}
          contacts={contacts}
          categories={categories}
          onApplied={refreshProducts}
        />
      )}

      <div className={`rounded-lg border px-3 py-2 text-sm ${isRemoteInventory ? 'border-success/30 bg-success/5' : 'border-border bg-secondary/30'}`}>
        {isRemoteInventory ? '🟢 Inventario obtenido desde Servidor Principal' : '⚪ Inventario local'}
      </div>
      {showingStaleRemoteData && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Servidor LAN no disponible. Mostrando la última información recibida.
        </div>
      )}

      {/* Tabs */}
      <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5 w-fit">
        {(['products', 'categories', 'summary'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {t === 'products' ? 'Productos' : t === 'categories' ? 'Categorías' : 'Resumen General'}
          </button>
        ))}
      </div>

      {/* PRODUCTS TAB */}
      {tab === 'products' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nombre, código, referencia o categoría..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
              <option value="">Todos los proveedores</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => setStockFilter(stockFilter === 'all' ? 'low' : 'all')} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${stockFilter === 'low' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Stock bajo
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Código</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Producto</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoría</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gramos disp.</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Compra</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Venta</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Margen</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Stock</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gramos vendidos</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Valor vendido</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Transacciones</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    // O(1) lookup — sales stats were pre-aggregated in the salesByProduct Map above
                    const sales = getSalesInfo(p.id);
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-primary">{p.code}</td>
                        <td className="px-4 py-3 font-medium">{p.name}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{p.category}</span></td>
                        <td className="px-4 py-3 text-right">{formatWeight(getProductAvailableGrams(p))} g</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(p.purchasePrice)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(p.salePrice)}</td>
                        <td className="px-4 py-3 text-right"><span className="text-success font-medium">{p.margin.toFixed(1)}%</span></td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[28px] rounded-full px-2 py-0.5 text-xs font-bold ${p.stock <= p.minStock ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}>{isSoldByWeight(p) ? `${formatWeight(p.stock)} g` : p.stock}</span>
                        </td>
                        <td className="px-4 py-3 text-right">{formatWeight(sales.totalGrams)} g</td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(sales.totalAmount)}</td>
                        <td className="px-4 py-3 text-center">{sales.totalTransactions}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setViewProduct(p.id)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Ver"><Eye className="h-4 w-4" /></button>
                            {canManageProducts && <button onClick={() => startEdit(p.id)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="h-4 w-4" /></button>}
                            {canManageProducts && <button onClick={() => setDeleteProduct(p.id)} className="rounded-lg p-1.5 hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Eliminar/Desactivar"><Trash2 className="h-4 w-4" /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <PackageIcon className="h-10 w-10 mb-2" /><p className="text-sm">No se encontraron productos</p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Los indicadores de Gramos vendidos, Valor vendido y Transacciones corresponden únicamente a facturas con estado Pagada.
          </p>
        </>
      )}

      {/* CATEGORIES TAB */}
      {tab === 'categories' && (
        <div className="space-y-4 max-w-lg">
          {canManageProducts && <div className="flex gap-2">
            <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Nueva categoría..." className="bg-card border-border" onKeyDown={e => e.key === 'Enter' && addCategory()} />
            <Button onClick={addCategory} className="gold-gradient text-primary-foreground font-semibold gap-2"><Plus className="h-4 w-4" /> Agregar</Button>
          </div>}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {categories.map(c => (
              <div key={c} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0">
                {editCategory && editCategory.old === c ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input value={editCategory.val} onChange={e => setEditCategory({ old: editCategory.old, val: e.target.value })} className="h-8 text-sm bg-secondary/50 border-border" autoFocus />
                    <Button size="sm" onClick={saveEditCategory} className="h-8 text-xs gold-gradient text-primary-foreground">Guardar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditCategory(null)} className="h-8 text-xs">Cancelar</Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="font-medium">{c}</span>
                      <span className="text-xs text-muted-foreground ml-2">({categoryStats.get(c)?.productCount ?? 0} productos)</span>
                    </div>
                    {canManageProducts && <div className="flex gap-1">
                      <button onClick={() => setEditCategory({ old: c, val: c })} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => deleteCategory(c)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUMMARY TAB */}
      {tab === 'summary' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Productos</p>
              <p className="text-2xl font-bold mt-1">{products.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Stock Total</p>
              <p className="text-2xl font-bold mt-1">{totalStock} uds</p>
              <p className="text-xs text-muted-foreground mt-1">{formatWeight(totalGrams)} g totales</p>
              {lowStockCount > 0 && <p className="text-xs text-destructive mt-1">{lowStockCount} con stock bajo</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Compra Total</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(totalPurchaseValue)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Venta Total</p>
              <p className="text-2xl font-bold mt-1 gold-text">{formatCurrency(totalSaleValue)}</p>
              <p className="text-xs text-success mt-1">Ganancia proyectada: {formatCurrency(totalSaleValue - totalPurchaseValue)}</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground w-fit cursor-pointer select-none">
              <input
                type="checkbox"
                checked={printOnlyInStock}
                onChange={e => setPrintOnlyInStock(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              Mostrar solamente productos con stock
            </label>
            <div className="flex flex-wrap gap-3">
              <DirectPdfActionButton label="Inventario PDF" document={() => buildInventoryPdfDocument(inventoryExportContext)} />
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportInventoryExcel}>
                Inventario Excel
              </Button>
              <PdfDocumentActions
                label="Por categoría"
                document={() => buildInventoryDocument(
                  [...products].sort((left, right) => left.category.localeCompare(right.category, 'es') || left.name.localeCompare(right.name, 'es')),
                  'Inventario por Categoría',
                  'Productos agrupados por categoría',
                )}
              />
              <PdfDocumentActions
                label="Bajo stock"
                document={() => buildInventoryDocument(
                  products.filter(product => product.stock <= product.minStock),
                  'Inventario Bajo Stock',
                  'Productos que requieren reposición',
                )}
              />
            </div>
          </div>

          {/* By category breakdown */}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoría</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Productos</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Stock</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">V. Compra</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">V. Venta</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(category => {
                  const stats = categoryStats.get(category);
                  if (!stats) return null;
                  return (
                    <tr key={category} className="border-b border-border/50">
                      <td className="px-4 py-3 font-medium">{category}</td>
                      <td className="px-4 py-3 text-center">{stats.productCount}</td>
                      <td className="px-4 py-3 text-center">{stats.byWeight ? `${formatWeight(stats.grams)} g` : `${stats.stock} uds (${formatWeight(stats.grams)} g)`}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(stats.purchaseValue)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(stats.saleValue)}</td>
                      <td className="px-4 py-3 text-right text-success font-medium">{formatCurrency(stats.saleValue - stats.purchaseValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW PRODUCT MODAL */}
      {vp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setViewProduct(null)}>
          <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-xl border border-border bg-card p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="min-w-0 break-words text-lg font-bold">{vp.name}</h3>
              <button onClick={() => setViewProduct(null)} className="p-1.5 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Código:</span> <span className="font-mono text-primary">{vp.code}</span></div>
              <div><span className="text-muted-foreground">Referencia:</span> {vp.reference || vp.code}</div>
              <div><span className="text-muted-foreground">Categoría:</span> {vp.category}</div>
              <div><span className="text-muted-foreground">Peso unitario:</span> {formatWeight(vp.weightGrams)} g</div>
              <div><span className="text-muted-foreground">Stock:</span> <span className={vp.stock <= vp.minStock ? 'text-destructive font-bold' : ''}>{isSoldByWeight(vp) ? `${formatWeight(vp.stock)} g` : vp.stock}</span> (mín: {isSoldByWeight(vp) ? `${formatWeight(vp.minStock)} g` : vp.minStock})</div>
              <div><span className="text-muted-foreground">Gramos disponibles:</span> {formatWeight(getProductAvailableGrams(vp))} g</div>
              <div><span className="text-muted-foreground">Último precio:</span> {formatCurrency(vp.purchasePrice)}</div>
              <div><span className="text-muted-foreground">Costo promedio:</span> {formatCurrency(getProductAveragePurchasePrice(vp))}</div>
              <div><span className="text-muted-foreground">P. Venta:</span> {formatCurrency(vp.salePrice)}</div>
              <div><span className="text-muted-foreground">Margen:</span> <span className="text-success font-medium">{vp.margin.toFixed(1)}%</span></div>
              <div><span className="text-muted-foreground">Última entrada:</span> {vp.lastPurchaseDate || '—'}</div>
              <div><span className="text-muted-foreground">Proveedores:</span> {getSupplierNames(vp)}</div>
            </div>
            {vp.description && <p className="text-sm text-muted-foreground border-t border-border pt-3">{vp.description}</p>}

            <section className="space-y-3 border-t border-border pt-4" aria-label="Historial de venta del producto">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-4 w-4 text-primary" /> Historial de venta</h4>
                  <p className="text-xs text-muted-foreground">Facturas pagadas, ordenadas de la más reciente a la más antigua.</p>
                </div>
                {vpSalesHistory.length > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{vpSalesHistory.length} venta{vpSalesHistory.length === 1 ? '' : 's'}</span>}
              </div>

              {vpSalesHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-6 text-center text-sm text-muted-foreground">
                  Este producto aún no registra ventas.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Factura</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fecha</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Cliente</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cantidad</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Precio vendido</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Abrir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vpSalesHistory.map(entry => (
                        <tr key={`${entry.invoiceId}-${entry.invoiceNumber}-${entry.quantity}-${entry.subtotal}`} className="border-t border-border/60">
                          <td className="px-3 py-2 font-mono text-xs text-primary">{entry.invoiceNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground">{entry.date}</td>
                          <td className="px-3 py-2">{entry.clientName}</td>
                          <td className="px-3 py-2 text-right">{entry.isByWeight ? `${formatWeight(entry.quantity)} g` : entry.quantity}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(entry.unitPrice)}</td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => {
                                setViewProduct(null);
                                navigate(`/ventas?invoice=${encodeURIComponent(entry.invoiceId)}`);
                              }}
                            >
                              <Eye className="h-3.5 w-3.5" /> Ver factura
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="flex flex-wrap gap-2 pt-2">
              {canManageProducts && <Button size="sm" onClick={() => { setViewProduct(null); startEdit(vp.id); }} className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> Editar</Button>}
              {canManageProducts && <Button size="sm" variant="destructive" onClick={() => { setViewProduct(null); setDeleteProduct(vp.id); }} className="gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Eliminar</Button>}
              <Button size="sm" variant="outline" onClick={() => setViewProduct(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {canManageProducts && editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setEditProduct(null)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="break-words text-lg font-bold">Editar Producto</h3>
              <button onClick={() => setEditProduct(null)} className="p-1.5 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Código</label><Input value={editForm.code} onChange={e => setEditForm({ ...editForm, code: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Referencia</label><Input value={editForm.reference || ''} onChange={e => setEditForm({ ...editForm, reference: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1 sm:col-span-2"><label className="text-xs text-muted-foreground uppercase">Nombre</label><Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Categoría</label>
                <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Peso (g)</label><Input type="number" value={editForm.weightGrams} onChange={e => setEditForm({ ...editForm, weightGrams: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground uppercase">Proveedores</label>
                  <button type="button" onClick={() => setShowEditNewSupplier(value => !value)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /> Nuevo proveedor
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suppliers.map(supplier => (
                    <button
                      key={supplier.id}
                      type="button"
                      onClick={() => toggleEditSupplier(supplier.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${(editForm.supplierIds || []).includes(supplier.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
                    >
                      {supplier.name}
                    </button>
                  ))}
                  {suppliers.length === 0 && !showEditNewSupplier && <p className="text-xs text-muted-foreground">No hay proveedores. Crea uno nuevo.</p>}
                </div>
                {showEditNewSupplier && (
                  <div className="mt-3 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Nuevo Proveedor</h4>
                      <button type="button" onClick={() => setShowEditNewSupplier(false)} className="rounded p-1 hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input value={editNewSupplier.name} onChange={e => setEditNewSupplier({ ...editNewSupplier, name: e.target.value })} placeholder="Nombre del proveedor *" className="h-8 bg-card text-sm" />
                      <Input value={editNewSupplier.document} onChange={e => setEditNewSupplier({ ...editNewSupplier, document: e.target.value })} placeholder="NIT / Documento" className="h-8 bg-card text-sm" />
                      <Input value={editNewSupplier.phone} onChange={e => setEditNewSupplier({ ...editNewSupplier, phone: e.target.value })} placeholder="Teléfono" className="h-8 bg-card text-sm" />
                      <Input value={editNewSupplier.email} onChange={e => setEditNewSupplier({ ...editNewSupplier, email: e.target.value })} placeholder="correo@email.com" className="h-8 bg-card text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={createAndAssociateEditSupplier} className="gap-1 text-xs"><Save className="h-3 w-3" /> Crear y Asociar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowEditNewSupplier(false)} className="text-xs">Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Último precio compra</label><Input type="number" value={editForm.purchasePrice} disabled className="bg-secondary/30 border-border opacity-70" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Costo promedio</label><Input type="number" value={editForm.averagePurchasePrice} disabled className="bg-secondary/30 border-border opacity-70" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">P. Venta</label><Input type="number" value={editForm.salePrice} onChange={e => setEditForm({ ...editForm, salePrice: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Stock</label><Input type="text" value={formatWeight(Number(editForm.stock) || 0)} disabled className="bg-secondary/30 border-border opacity-70" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Gramos disponibles</label><Input type="text" value={formatWeight(Number(editForm.availableGrams) || 0)} disabled className="bg-secondary/30 border-border opacity-70" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Stock Mínimo</label><Input type="number" value={editForm.minStock} onChange={e => setEditForm({ ...editForm, minStock: e.target.value })} className="bg-secondary/50 border-border" /></div>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Stock, gramos y costos de adquisición se modifican únicamente desde <strong>Ajustes de Inventario</strong>.
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase">Descripción</label>
              <textarea value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={2} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={saveEdit} className="gold-gradient text-primary-foreground font-semibold gap-2"><Save className="h-4 w-4" /> Guardar</Button>
              <Button variant="outline" onClick={() => setEditProduct(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE/DEACTIVATE PRODUCT MODAL */}
      {canManageProducts && dp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setDeleteProduct(null)}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-destructive/30 bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-bold">¿Qué deseas hacer con este artículo?</h3>
                <p className="text-xs text-muted-foreground">{dp.code} · {dp.name}</p>
              </div>
            </div>

            <div className="rounded-lg bg-secondary/50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Stock actual:</span><span className="font-medium">{isSoldByWeight(dp) ? `${formatWeight(dp.stock)} g` : dp.stock}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Precio venta:</span><span className="font-medium">{formatCurrency(dp.salePrice)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Categoría:</span><span>{dp.category}</span></div>
            </div>

            {isProductUsed(dp.id) && (
              <div className="rounded-lg bg-warning/10 border border-warning/20 p-3 text-xs text-warning">
                ⚠️ Este producto tiene facturas asociadas. Se recomienda <strong>desactivar</strong> en lugar de eliminar para mantener la integridad del historial.
              </div>
            )}

            <div className="space-y-2">
              <Button
                onClick={() => handleDeactivateProduct(dp.id)}
                variant="outline"
                className="w-full gap-2 border-warning text-warning hover:bg-warning/10"
              >
                <Ban className="h-4 w-4" /> Desactivar (poner stock en 0)
              </Button>
              <Button
                onClick={() => handleDeleteProduct(dp.id)}
                className="w-full gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isProductUsed(dp.id)}
              >
                <Trash2 className="h-4 w-4" /> Eliminar permanentemente
              </Button>
              <Button variant="outline" onClick={() => setDeleteProduct(null)} className="w-full">
                Cancelar
              </Button>
            </div>

            {isProductUsed(dp.id) && (
              <p className="text-[10px] text-muted-foreground text-center">La eliminación permanente está deshabilitada porque el producto tiene facturas asociadas.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
