import { useEffect, useState, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, FileText, Eye, Ban, ArrowUpDown, Calendar, Pencil, Trash2, Save, X, FileSpreadsheet, Download, Clock3 } from 'lucide-react';
import { formatCurrency, isSoldByWeight } from '@/data/mockData';
import { useApp, type Layaway } from '@/contexts/AppContext';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import InvoicePreview from '@/components/InvoicePreview';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import { buildTableDocumentData } from '@/lib/pdf';
import ClientSearchCombobox from '@/components/ClientSearchCombobox';
import { useToast } from '@/hooks/use-toast';
import type { Invoice, InvoiceItem } from '@/data/mockData';
import type { LayawayCancellationResolution } from '@/domain/models';
import { formatWeight } from '@/lib/utils';
import ExcelExportButton from '@/components/ExcelExportButton';
import DirectPdfActionButton from '@/components/DirectPdfActionButton';
import LayawayDeadlineSelector from '@/components/LayawayDeadlineSelector';
import { useAuth } from '@/contexts/AuthContext';
import { SalesRepositoryService } from '@/lib/SalesRepositoryService';
import {
  buildInvoiceTraceSearchIndex,
  exactInvoiceIdsForTraceSearch,
  invoiceMatchesTraceSearch,
  normalizeSalesTraceSearch,
} from '@/lib/salesTraceability';
import { LAYAWAY_RESERVE_ACCOUNT_ID } from '@/lib/FinancialPositionService';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { exportRowsWithSummaryToExcel } from '@/lib/excelExport';
import {
  buildIndividualInvoicePdf,
  buildInvoiceExcelRows,
  buildSalesPdfDocument,
  buildSalesSummaryRows,
  getInvoiceUserName,
  invoiceExcelColumns,
  salesSummaryExcelColumns,
} from '@/lib/professionalExports';
import { isSalesInvoice } from '@/lib/DashboardMetricsService';
import {
  LAYAWAY_ALERTS_CHANGED_EVENT,
  LAYAWAY_TERM_OPTIONS,
  archiveCancelledLayaway,
  calculateLayawayAlertInfo,
  deleteLayawayDeadline,
  ensureLayawayDeadlines,
  formatLayawayStatusIcon,
  layawayStatusClasses,
  loadArchivedCancelledLayaways,
  loadLayawayDeadlineRegistry,
  resolveLayawayDeadline,
  saveLayawayDeadline,
  type LayawayAlertInfo,
  type LayawayDeadlineMode,
  type LayawayLifecycleFilter,
  type LayawaySortKey,
} from '@/lib/LayawayAlertService';

interface LayawayDisplayRow {
  layaway: Layaway;
  alert: LayawayAlertInfo;
  lifecycle: 'active' | 'completed' | 'cancelled';
}

const Sales = () => {
  const { company, invoices, contacts, layaways, products, financialAccounts, financialMovements, recordLayawayPayment, completeLayaway, updateLayaway, deleteLayaway, cancelInvoice } = useApp();
  
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedInvoiceId = searchParams.get('invoice');
  const requestedTab = searchParams.get('tab');
  const requestedLayawayFilter = searchParams.get('filter') as LayawayLifecycleFilter | null;
  const { user } = useAuth();
  const [tab, setTab] = useState<'sales' | 'layaways'>(requestedTab === 'layaways' ? 'layaways' : 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [layawayDetail, setLayawayDetail] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [paymentAccountId, setPaymentAccountId] = useState('account-caja-principal');
  const [layawaySearch, setLayawaySearch] = useState('');
  const [layawayStatusFilter, setLayawayStatusFilter] = useState<LayawayLifecycleFilter>(requestedLayawayFilter || 'active');
  const [layawaySortKey, setLayawaySortKey] = useState<LayawaySortKey>('dueDate');
  const [layawaySortDirection, setLayawaySortDirection] = useState<'asc' | 'desc'>('asc');
  const [layawayDeadlineRegistry, setLayawayDeadlineRegistry] = useState(() => loadLayawayDeadlineRegistry());
  const [cancelledLayawayArchive, setCancelledLayawayArchive] = useState(() => loadArchivedCancelledLayaways());
  const [editLayawayId, setEditLayawayId] = useState<string | null>(null);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editDeadlineMode, setEditDeadlineMode] = useState<LayawayDeadlineMode>('term');
  const [editTermDays, setEditTermDays] = useState(30);
  const [editCustomDueDate, setEditCustomDueDate] = useState('');
  const [deleteLayawayId, setDeleteLayawayId] = useState<string | null>(null);
  const [deleteResolution, setDeleteResolution] = useState<LayawayCancellationResolution | 'cancel' | ''>('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const lastAutoOpenedSearch = useRef('');

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [salesResults, setSalesResults] = useState<Invoice[] | null>(null);

  // Annul state
  const [annulInvoice, setAnnulInvoice] = useState<Invoice | null>(null);
  const [annulReason, setAnnulReason] = useState('');
  const [annulLoading, setAnnulLoading] = useState(false);

  const activeLayawayInvoiceIds = useMemo(
    () => new Set(layaways.filter(layaway => !layaway.completed).map(layaway => layaway.invoiceId)),
    [layaways],
  );

  const clients = useMemo(() => contacts.filter(contact => contact.type === 'client'), [contacts]);
  const clientById = useMemo(() => new Map(contacts.map(contact => [contact.id, contact])), [contacts]);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);

  // Read-only search index built once from the invoices and products already loaded by AppContext.
  const invoiceSearchIndex = useMemo(
    () => buildInvoiceTraceSearchIndex(invoices, products),
    [invoices, products],
  );

  const locallyMatchedSales = useMemo(() => invoices.filter(invoice => {
    if (statusFilter && invoice.status !== statusFilter) return false;
    if (dateFrom && invoice.date < dateFrom) return false;
    if (dateTo && invoice.date > dateTo) return false;
    return invoiceMatchesTraceSearch(invoice.id, search, invoiceSearchIndex);
  }), [dateFrom, dateTo, invoiceSearchIndex, invoices, search, statusFilter]);
  const editLayaway = useMemo(
    () => editLayawayId ? layaways.find(layaway => layaway.id === editLayawayId) || null : null,
    [editLayawayId, layaways],
  );
  const deleteCandidate = useMemo(
    () => deleteLayawayId ? layaways.find(layaway => layaway.id === deleteLayawayId) || null : null,
    [deleteLayawayId, layaways],
  );

  useEffect(() => {
    const synchronizeAlertMetadata = () => {
      setLayawayDeadlineRegistry(ensureLayawayDeadlines(layaways));
      setCancelledLayawayArchive(loadArchivedCancelledLayaways());
    };
    synchronizeAlertMetadata();
    window.addEventListener(LAYAWAY_ALERTS_CHANGED_EVENT, synchronizeAlertMetadata);
    return () => window.removeEventListener(LAYAWAY_ALERTS_CHANGED_EVENT, synchronizeAlertMetadata);
  }, [layaways]);

  useEffect(() => {
    if (requestedTab === 'layaways') setTab('layaways');
    if (requestedLayawayFilter) setLayawayStatusFilter(requestedLayawayFilter);
  }, [requestedLayawayFilter, requestedTab]);

  useEffect(() => {
    if (tab !== 'sales') return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void SalesRepositoryService.querySales({
        text: search || undefined,
        status: (statusFilter || undefined) as Invoice['status'] | undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }).then(result => {
        if (!cancelled) setSalesResults(result);
      }).catch(() => {
        // Preserve the last Repository-backed state already loaded by AppContext
        // when the server is temporarily unavailable.
        if (!cancelled) setSalesResults(null);
      });
    }, search ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dateFrom, dateTo, invoices, search, statusFilter, tab]);

  const matchedEditProducts = useMemo(() => {
    const query = editProductSearch.trim().toLocaleLowerCase('es');
    if (!query) return [];
    const matches = [];
    for (const product of products) {
      if (
        product.code.toLocaleLowerCase('es').includes(query) ||
        product.name.toLocaleLowerCase('es').includes(query) ||
        (product.reference || '').toLocaleLowerCase('es').includes(query)
      ) {
        matches.push(product);
        if (matches.length >= 8) break;
      }
    }
    return matches;
  }, [editProductSearch, products]);

  const recalculateEditInvoice = (invoice: Invoice, items: InvoiceItem[]): Invoice => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    return {
      ...invoice,
      items,
      subtotal,
      total: Math.max(0, subtotal - invoice.discount + invoice.tax),
    };
  };

  const startEditLayaway = (layawayId: string): void => {
    const layaway = layaways.find(item => item.id === layawayId);
    if (!layaway) return;
    setEditLayawayId(layawayId);
    setEditInvoice({
      ...layaway.invoice,
      items: layaway.invoice.items.map(item => ({ ...item })),
    });
    const deadline = layawayDeadlineRegistry[layawayId];
    const predefinedTerm = Boolean(
      deadline && LAYAWAY_TERM_OPTIONS.includes(deadline.termDays as (typeof LAYAWAY_TERM_OPTIONS)[number]),
    );
    setEditDeadlineMode(deadline?.source === 'custom' || (deadline && !predefinedTerm) ? 'custom' : 'term');
    setEditTermDays(predefinedTerm && deadline ? deadline.termDays : 30);
    setEditCustomDueDate(deadline?.dueDate || '');
    setEditProductSearch('');
    setLayawayDetail(null);
  };

  const closeEditLayaway = (): void => {
    setEditLayawayId(null);
    setEditInvoice(null);
    setEditProductSearch('');
    setEditDeadlineMode('term');
    setEditTermDays(30);
    setEditCustomDueDate('');
  };

  const selectEditClient = (clientId: string): void => {
    if (!editInvoice) return;
    const client = clientById.get(clientId);
    setEditInvoice({
      ...editInvoice,
      clientId,
      clientName: client?.name || '',
    });
  };

  const editAvailableStock = (productId: string): number => {
    const product = productById.get(productId);
    if (!product) return 0;
    const originalQuantity = editLayaway?.invoice.items.find(item => item.productId === productId)?.quantity || 0;
    return product.stock + originalQuantity;
  };

  const updateEditQuantity = (productId: string, nextQuantity: number): void => {
    if (!editInvoice || !Number.isFinite(nextQuantity) || nextQuantity <= 0) return;
    const product = productById.get(productId);
    if (!product) return;
    const maximum = editAvailableStock(productId);
    if (nextQuantity > maximum) {
      toast({
        title: 'Stock insuficiente',
        description: `Máximo disponible para este separado: ${maximum}${isSoldByWeight(product) ? ' g' : ''}`,
        variant: 'destructive',
      });
      return;
    }

    const items = editInvoice.items.map(item => item.productId === productId
      ? {
          ...item,
          quantity: nextQuantity,
          weightGrams: isSoldByWeight(product) ? nextQuantity : item.weightGrams,
          subtotal: nextQuantity * item.unitPrice,
        }
      : item);
    setEditInvoice(recalculateEditInvoice(editInvoice, items));
  };

  const updateEditPrice = (productId: string, nextPrice: number): void => {
    if (!editInvoice || !Number.isFinite(nextPrice) || nextPrice < 0) return;
    const items = editInvoice.items.map(item => item.productId === productId
      ? {
          ...item,
          unitPrice: nextPrice,
          subtotal: nextPrice * item.quantity,
          priceModified: nextPrice !== (item.originalPrice ?? item.unitPrice),
        }
      : item);
    setEditInvoice(recalculateEditInvoice(editInvoice, items));
  };

  const removeEditItem = (productId: string): void => {
    if (!editInvoice) return;
    setEditInvoice(recalculateEditInvoice(
      editInvoice,
      editInvoice.items.filter(item => item.productId !== productId),
    ));
  };

  const addEditProduct = (productId: string): void => {
    if (!editInvoice) return;
    if (editInvoice.items.some(item => item.productId === productId)) {
      toast({ title: 'El producto ya está incluido en el separado' });
      return;
    }
    const product = productById.get(productId);
    if (!product || product.stock <= 0) {
      toast({ title: 'Producto sin stock disponible', variant: 'destructive' });
      return;
    }
    const byWeight = isSoldByWeight(product);
    const initialQuantity = Math.min(1, product.stock);
    const item: InvoiceItem = {
      productId: product.id,
      code: product.code,
      name: product.name,
      quantity: initialQuantity,
      weightGrams: byWeight ? initialQuantity : product.weightGrams,
      unitPrice: product.salePrice,
      subtotal: product.salePrice * initialQuantity,
      originalPrice: product.salePrice,
      priceModified: false,
      costPrice: product.averagePurchasePrice ?? product.purchasePrice,
    };
    setEditInvoice(recalculateEditInvoice(editInvoice, [...editInvoice.items, item]));
    setEditProductSearch('');
  };

  const saveEditedLayaway = async (): Promise<void> => {
    if (!editLayawayId || !editInvoice) return;
    if (!editInvoice.clientId) {
      toast({ title: 'Selecciona un cliente', variant: 'destructive' });
      return;
    }
    if (editInvoice.items.length === 0) {
      toast({ title: 'El separado debe conservar al menos un artículo', variant: 'destructive' });
      return;
    }
    const totalPaid = editLayaway?.payments.reduce((sum, payment) => sum + payment.amount, 0) || 0;
    const deadlineSelection = {
      mode: editDeadlineMode,
      termDays: editTermDays,
      dueDate: editCustomDueDate,
    } as const;
    try {
      resolveLayawayDeadline(editInvoice.date, deadlineSelection);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      toast({
        title: 'Fecha de vencimiento inválida',
        description: code === 'LAYAWAY_DUE_DATE_BEFORE_CREATION'
          ? 'La fecha de vencimiento debe ser posterior a la fecha de creación.'
          : 'Selecciona un plazo o una fecha válida.',
        variant: 'destructive',
      });
      return;
    }
    if (editInvoice.total < totalPaid - 0.01) {
      toast({
        title: 'El total no puede ser menor que los abonos',
        description: `Ya se han abonado ${formatCurrency(totalPaid)}.`,
        variant: 'destructive',
      });
      return;
    }

    const previousDeadline = layawayDeadlineRegistry[editLayawayId];
    let deadlinePersisted = false;
    setEditSaving(true);
    try {
      const updatedDeadline = saveLayawayDeadline(editLayawayId, editInvoice.date, deadlineSelection);
      deadlinePersisted = true;
      await updateLayaway(editLayawayId, editInvoice);
      setLayawayDeadlineRegistry(current => ({ ...current, [editLayawayId]: updatedDeadline }));
      toast({ title: 'Separado actualizado', description: 'El plazo y las observaciones se guardaron sin modificar abonos, saldo ni historial.' });
      closeEditLayaway();
    } catch (error) {
      if (deadlinePersisted) {
        try {
          if (previousDeadline) {
            const previousUsesTerm = previousDeadline.source !== 'custom'
              && LAYAWAY_TERM_OPTIONS.includes(previousDeadline.termDays as (typeof LAYAWAY_TERM_OPTIONS)[number]);
            saveLayawayDeadline(editLayawayId, previousDeadline.createdDate, previousUsesTerm
              ? { mode: 'term', termDays: previousDeadline.termDays }
              : { mode: 'custom', dueDate: previousDeadline.dueDate });
          } else {
            deleteLayawayDeadline(editLayawayId);
          }
        } catch {
          // The commercial update failed; preserve its original error and let the next view reload metadata.
        }
      }
      const code = error instanceof Error ? error.message : '';
      const description = code === 'LAYAWAY_INSUFFICIENT_STOCK'
        ? 'No hay inventario suficiente para aumentar una de las cantidades.'
        : code === 'LAYAWAY_TOTAL_BELOW_PAYMENTS'
          ? 'El nuevo total es menor que el valor ya abonado.'
          : 'No fue posible actualizar el separado.';
      toast({ title: 'Error al editar', description, variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteLayaway = (layawayId: string): void => {
    setDeleteResolution('');
    setDeleteLayawayId(layawayId);
  };

  const closeDeleteLayaway = (): void => {
    if (deleteLoading) return;
    setDeleteResolution('');
    setDeleteLayawayId(null);
  };

  const confirmDeleteLayaway = async (): Promise<void> => {
    if (!deleteLayawayId || !deleteCandidate) return;
    const totalPaid = deleteCandidate.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (totalPaid > 0.01 && deleteResolution === 'cancel') {
      closeDeleteLayaway();
      return;
    }
    if (totalPaid > 0.01 && deleteResolution !== 'refund' && deleteResolution !== 'credit') {
      toast({
        title: 'Seleccione qué hacer con el dinero',
        description: 'La cancelación no puede continuar sin una resolución financiera.',
        variant: 'destructive',
      });
      return;
    }

    const resolution: LayawayCancellationResolution = deleteResolution === 'credit' ? 'credit' : 'refund';
    setDeleteLoading(true);
    try {
      const cancelledSnapshot = deleteCandidate;
      await deleteLayaway(deleteLayawayId, resolution);
      archiveCancelledLayaway(cancelledSnapshot, resolution);
      if (layawayDetail === deleteLayawayId) setLayawayDetail(null);
      setDeleteResolution('');
      setDeleteLayawayId(null);
      toast({
        title: 'Separado cancelado',
        description: totalPaid <= 0.01
          ? 'El inventario reservado fue restaurado.'
          : resolution === 'credit'
            ? `${formatCurrency(totalPaid)} quedó registrado como saldo a favor del cliente.`
            : `${formatCurrency(totalPaid)} fue devuelto y retirado de Caja Separados.`,
      });
    } catch {
      toast({
        title: 'No se pudo cancelar el separado',
        description: 'No se realizaron cambios parciales.',
        variant: 'destructive',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const completedSales = useMemo(() => {
    const repositoryResults = search.trim() ? locallyMatchedSales : (salesResults ?? invoices);
    const result = repositoryResults.filter(invoice => {
      if (activeLayawayInvoiceIds.has(invoice.id)) return false;
      return !userFilter || getInvoiceUserName(invoice, financialMovements) === userFilter;
    });
    result.sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      const newestFirst = byDate !== 0 ? byDate : right.number.localeCompare(left.number, 'es');
      return sortOrder === 'desc' ? newestFirst : -newestFirst;
    });
    return result;
  }, [activeLayawayInvoiceIds, financialMovements, invoices, locallyMatchedSales, salesResults, search, sortOrder, userFilter]);

  useEffect(() => {
    if (!requestedInvoiceId) return;
    const invoice = invoices.find(item => item.id === requestedInvoiceId || item.number === requestedInvoiceId);
    if (!invoice) return;
    setTab('sales');
    setPreviewInvoice(invoice);
  }, [invoices, requestedInvoiceId]);

  useEffect(() => {
    const query = normalizeSalesTraceSearch(search);
    if (!query || query === lastAutoOpenedSearch.current) return;

    const allowedInvoiceIds = new Set(completedSales.map(invoice => invoice.id));
    const directMatches = exactInvoiceIdsForTraceSearch(query, invoiceSearchIndex)
      .filter(invoiceId => allowedInvoiceIds.has(invoiceId));

    if (directMatches.length === 1) {
      const invoice = invoices.find(item => item.id === directMatches[0]);
      if (!invoice) return;
      lastAutoOpenedSearch.current = query;
      setPreviewInvoice(invoice);
    }
  }, [completedSales, invoiceSearchIndex, invoices, search]);

  const layawayDisplayRows = useMemo<LayawayDisplayRow[]>(() => {
    const liveIds = new Set(layaways.map(layaway => layaway.id));
    const liveRows = layaways.map(layaway => {
      const lifecycle = layaway.completed ? 'completed' as const : 'active' as const;
      return {
        layaway,
        lifecycle,
        alert: calculateLayawayAlertInfo(layaway, layawayDeadlineRegistry[layaway.id]),
      };
    });
    const cancelledRows = cancelledLayawayArchive
      .filter(record => !liveIds.has(record.layaway.id))
      .map(record => ({
        layaway: record.layaway,
        lifecycle: 'cancelled' as const,
        alert: calculateLayawayAlertInfo(record.layaway, layawayDeadlineRegistry[record.layaway.id], new Date(), 'cancelled'),
      }));
    return [...liveRows, ...cancelledRows];
  }, [cancelledLayawayArchive, layawayDeadlineRegistry, layaways]);

  const filteredLayawayRows = useMemo(() => {
    const query = layawaySearch.trim().toLocaleLowerCase('es');
    const matchesFilter = (row: LayawayDisplayRow): boolean => {
      if (layawayStatusFilter === 'all') return true;
      if (layawayStatusFilter === 'active') return row.lifecycle === 'active';
      if (layawayStatusFilter === 'completed') return row.lifecycle === 'completed';
      if (layawayStatusFilter === 'cancelled') return row.lifecycle === 'cancelled';
      if (layawayStatusFilter === 'upcoming') return row.lifecycle === 'active' && row.alert.isUpcoming;
      if (layawayStatusFilter === 'overdue') return row.lifecycle === 'active' && row.alert.isOverdue;
      if (layawayStatusFilter === 'noRecentPayments') return row.lifecycle === 'active' && row.alert.hasNoRecentPayments;
      return true;
    };
    const rows = layawayDisplayRows.filter(row => {
      if (!matchesFilter(row)) return false;
      if (!query) return true;
      const client = clientById.get(row.layaway.invoice.clientId);
      return [
        row.layaway.invoice.clientName,
        client?.document,
        row.layaway.invoice.number,
        row.layaway.invoice.date,
        row.alert.dueDate,
      ].some(value => String(value || '').toLocaleLowerCase('es').includes(query));
    });

    rows.sort((left, right) => {
      const values: Record<LayawaySortKey, [string | number, string | number]> = {
        createdDate: [left.alert.createdDate, right.alert.createdDate],
        dueDate: [left.alert.dueDate, right.alert.dueDate],
        client: [left.layaway.invoice.clientName, right.layaway.invoice.clientName],
        value: [left.layaway.invoice.total, right.layaway.invoice.total],
        balance: [left.alert.balance, right.alert.balance],
        daysRemaining: [left.alert.daysRemaining, right.alert.daysRemaining],
      };
      const [leftValue, rightValue] = values[layawaySortKey];
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), 'es');
      return layawaySortDirection === 'asc' ? comparison : -comparison;
    });
    return rows;
  }, [clientById, layawayDisplayRows, layawaySearch, layawaySortDirection, layawaySortKey, layawayStatusFilter]);

  const activeLayawayCount = useMemo(
    () => layawayDisplayRows.filter(row => row.lifecycle === 'active').length,
    [layawayDisplayRows],
  );
  const buildLayawayDocument = (layaway: Layaway) => {
    const totalPaid = layaway.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const pending = Math.max(0, layaway.invoice.total - totalPaid);
    const alert = calculateLayawayAlertInfo(layaway, layawayDeadlineRegistry[layaway.id]);
    return buildTableDocumentData({
      company,
      title: `Separado ${layaway.invoice.number}`,
      subtitle: `${layaway.invoice.clientName} · Creado ${alert.createdDate} · Vence ${alert.dueDate}`,
      filename: `Separado_${layaway.invoice.number}`,
      columns: [
        { header: 'Tipo' }, { header: 'Detalle' }, { header: 'Cantidad / Fecha' }, { header: 'Valor', align: 'right' },
      ],
      rows: [
        ...layaway.invoice.items.map(item => [
          'Artículo',
          `${item.code} · ${item.name}`,
          productById.get(item.productId) && isSoldByWeight(productById.get(item.productId)!)
            ? `${formatWeight(item.quantity)} g`
            : String(item.quantity),
          formatCurrency(item.subtotal),
        ]),
        ...layaway.payments.map(payment => [
          'Abono',
          payment.method,
          payment.date,
          formatCurrency(payment.amount),
        ]),
      ],
      summaryLines: [
        { label: 'Fecha de vencimiento', value: alert.dueDate },
        { label: 'Estado de plazo', value: alert.statusLabel },
        { label: 'Total del separado', value: formatCurrency(layaway.invoice.total) },
        { label: 'Total abonado', value: formatCurrency(totalPaid) },
        { label: 'Saldo pendiente', value: formatCurrency(pending), bold: true },
      ],
      notes: layaway.invoice.clientNotes || '',
    });
  };

  const selectedLayawayRow = layawayDetail ? layawayDisplayRows.find(row => row.layaway.id === layawayDetail) || null : null;
  const ld = selectedLayawayRow?.layaway || null;
  const ldAlert = selectedLayawayRow?.alert || null;
  const ldIsActive = selectedLayawayRow?.lifecycle === 'active';

  const addLayawayPayment = async () => {
    if (!ld || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (amount <= 0) return;
    const alreadyPaid = ld.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const remaining = Math.max(0, ld.invoice.total - alreadyPaid);
    if (amount > remaining + 0.01) {
      toast({ title: 'El abono supera el saldo pendiente', variant: 'destructive' });
      return;
    }
    try {
      const completed = await recordLayawayPayment(ld.id, {
        id: crypto.randomUUID(), amount, date: new Date().toISOString().split('T')[0],
        method: paymentMethod, accountId: paymentAccountId,
      });
      setPaymentAmount('');
      if (completed) setLayawayDetail(null);
    } catch (error) {
      toast({ title: 'No se pudo registrar el abono', description: 'Revisa la cuenta seleccionada.', variant: 'destructive' });
    }
  };

  const handleCompleteLayaway = async (id: string) => {
    try {
      await completeLayaway(id, new Date().toISOString().split('T')[0]);
      setLayawayDetail(null);
    } catch {
      toast({ title: 'No se pudo completar el apartado', variant: 'destructive' });
    }
  };

  const handleAnnul = async () => {
    if (!annulInvoice || !annulReason.trim()) {
      toast({ title: '⚠️ Debes ingresar un motivo de anulación', variant: 'destructive' });
      return;
    }
    setAnnulLoading(true);
    try {
      await cancelInvoice(annulInvoice.id, annulReason.trim());
      toast({ title: '🚫 Factura anulada', description: `${annulInvoice.number} anulada. Stock reintegrado.` });
      setAnnulInvoice(null);
      setAnnulReason('');
    } catch (err) {
      toast({ title: '❌ Error al anular', description: 'Intenta de nuevo.', variant: 'destructive' });
    } finally {
      setAnnulLoading(false);
    }
  };

  const totalFiltered = completedSales.filter(isSalesInvoice).reduce((s, i) => s + i.total, 0);

  const invoiceUsers = useMemo(() => Array.from(new Set(
    invoices.map(invoice => getInvoiceUserName(invoice, financialMovements)).filter(name => name !== 'No registrado'),
  )).sort((a, b) => a.localeCompare(b, 'es')), [invoices, financialMovements]);

  const salesExportContext = useMemo(() => ({
    company,
    invoices: completedSales,
    contacts,
    products,
    financialMovements,
    currentUserName: user?.displayName || user?.username || 'Usuario',
    filters: { search, status: statusFilter, dateFrom, dateTo, user: userFilter, sortOrder },
  }), [company, completedSales, contacts, products, financialMovements, user, search, statusFilter, dateFrom, dateTo, userFilter, sortOrder]);

  const exportAllInvoicesExcel = (): void => {
    const rows = buildSalesSummaryRows(salesExportContext);
    const totalSales = rows.reduce((sum, row) => sum + row.sale, 0);
    const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
    exportRowsWithSummaryToExcel({
      filename: 'Facturas_Filtradas', sheetName: 'Facturas', rows, columns: salesSummaryExcelColumns,
      summaryLines: [
        { label: 'Total ventas', value: totalSales },
        { label: 'Total costo', value: totalCost },
        { label: 'Utilidad', value: totalSales - totalCost },
        { label: 'Cantidad de facturas', value: rows.length },
        { label: 'Cantidad de productos vendidos', value: rows.reduce((sum, row) => sum + row.totalQuantity, 0) },
      ],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Ventas</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestiona tus facturas de venta</p>
        </div>
        <Link to="/ventas/nueva" className="shrink-0">
          <Button className="gold-gradient text-primary-foreground font-semibold gap-2">
            <Plus className="h-4 w-4" /> Nueva Factura
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
          <button onClick={() => setTab('sales')} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tab === 'sales' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Ventas</button>
          <button onClick={() => setTab('layaways')} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tab === 'layaways' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            Separados {activeLayawayCount > 0 && <span className="ml-1 bg-warning/20 text-warning text-[10px] px-1.5 rounded-full">{activeLayawayCount}</span>}
          </button>
        </div>

        <div key={tab} className="contents">
          {tab === 'sales' && (
            <>
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por factura, cliente, código, producto o código de barras..."
                  className="pl-9 bg-card border-border"
                  value={search}
                  onChange={e => { setSearch(e.target.value); lastAutoOpenedSearch.current = ''; }}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === 'Enter' && completedSales.length > 0) {
                      event.preventDefault();
                      setPreviewInvoice(completedSales[0]);
                    }
                  }}
                />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                <option value="">Todos</option>
                <option value="paid">Pagadas</option>
                <option value="pending">Pendientes</option>
                <option value="cancelled">Anuladas</option>
              </select>
              <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                <option value="">Todos los usuarios</option>
                {invoiceUsers.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> Exportar Facturas</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <div><DirectPdfActionButton document={() => buildSalesPdfDocument(salesExportContext)} label="PDF" /></div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={event => { event.preventDefault(); exportAllInvoicesExcel(); }}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* DATE FILTERS & SORT (sales tab only) */}
      {tab === 'sales' && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-card border-border w-[150px] text-sm" />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-card border-border w-[150px] text-sm" />
          </div>
          <button
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-all"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortOrder === 'desc' ? 'Más recientes' : 'Más antiguas'}
          </button>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-primary hover:underline">Limpiar fechas</button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{completedSales.length} resultados · Total: {formatCurrency(totalFiltered)}</span>
        </div>
      )}

      {/* SALES TABLE */}
      {tab === 'sales' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">N° Documento</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pago</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {completedSales.map(inv => (
                  <tr key={inv.id} className={`border-b border-border/50 hover:bg-secondary/30 transition-colors ${inv.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-primary">{inv.number}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${(!inv.tipoDocumento || inv.tipoDocumento === 'factura') ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                        {(!inv.tipoDocumento || inv.tipoDocumento === 'factura') ? 'Factura' : 'Cotización'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{inv.clientName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{inv.paymentMethod || '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${inv.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}`}>{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-medium ${inv.status === 'paid' ? 'bg-success/10 text-success' : inv.status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
                        {inv.status === 'paid' ? 'Pagada' : inv.status === 'pending' ? 'Pendiente' : 'Anulada'}
                      </span>
                      {inv.status === 'cancelled' && inv.cancellationReason && (
                        <p className="mx-auto mt-0.5 max-w-[180px] break-words text-[9px] text-destructive/70" title={inv.cancellationReason}>
                          {inv.cancellationReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setPreviewInvoice(inv)} className="rounded-lg p-1.5 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Vista previa"><Eye className="h-4 w-4" /></button>
                        <button type="button" disabled title="Las facturas emitidas no se editan; deben anularse y emitirse nuevamente" className="rounded-lg p-1.5 text-muted-foreground opacity-40"><Pencil className="h-4 w-4" /></button>
                        <DirectPdfActionButton compact action="print" title={`Imprimir ${inv.number}`} document={() => buildIndividualInvoicePdf(inv, company, clientById.get(inv.clientId), products)} />
                        <DirectPdfActionButton compact action="download" title={`Descargar PDF ${inv.number}`} document={() => buildIndividualInvoicePdf(inv, company, clientById.get(inv.clientId), products)} />
                        <ExcelExportButton compact filename={`Factura_${inv.number}`} sheetName="Factura"
                          rows={buildInvoiceExcelRows(inv, clientById.get(inv.clientId), financialMovements, products)} columns={invoiceExcelColumns} />
                        {inv.status !== 'cancelled' && (
                          <button
                            onClick={() => setAnnulInvoice(inv)}
                            className="rounded-lg p-1.5 hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                            title="Anular factura"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {completedSales.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground"><FileText className="h-10 w-10 mb-2" /><p className="text-sm">No se encontraron facturas</p></div>
          )}
        </div>
      )}

      {/* LAYAWAYS TAB */}
      {tab === 'layaways' && (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, cédula, factura, creación o vencimiento..."
                className="border-border bg-card pl-9"
                value={layawaySearch}
                onChange={event => setLayawaySearch(event.target.value)}
              />
            </div>
            <select
              value={layawaySortKey}
              onChange={event => setLayawaySortKey(event.target.value as LayawaySortKey)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              aria-label="Ordenar separados"
            >
              <option value="createdDate">Fecha creación</option>
              <option value="dueDate">Fecha vencimiento</option>
              <option value="client">Cliente</option>
              <option value="value">Valor</option>
              <option value="balance">Saldo</option>
              <option value="daysRemaining">Días restantes</option>
            </select>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setLayawaySortDirection(direction => direction === 'asc' ? 'desc' : 'asc')}
            >
              <ArrowUpDown className="h-4 w-4" /> {layawaySortDirection === 'asc' ? 'Ascendente' : 'Descendente'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de separados">
            {([
              ['all', 'Todos'],
              ['active', 'Activos'],
              ['upcoming', 'Próximos a vencer'],
              ['overdue', 'Vencidos'],
              ['noRecentPayments', 'Sin abonos recientes'],
              ['completed', 'Entregados'],
              ['cancelled', 'Anulados'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayawayStatusFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${layawayStatusFilter === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {filteredLayawayRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 text-muted-foreground">
              <FileText className="mb-2 h-10 w-10" />
              <p className="text-sm">No se encontraron separados para este filtro</p>
            </div>
          ) : filteredLayawayRows.map(row => {
            const { layaway, alert, lifecycle } = row;
            const totalPaid = alert.totalPaid;
            const remaining = alert.balance;
            const percentage = layaway.invoice.total > 0
              ? Math.min((totalPaid / layaway.invoice.total) * 100, 100)
              : 0;
            const client = clientById.get(layaway.invoice.clientId);
            const isActive = lifecycle === 'active';
            return (
              <div
                key={`${lifecycle}-${layaway.id}`}
                className="min-w-0 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20"
              >
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setLayawayDetail(layaway.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-medium">{layaway.invoice.clientName}</p>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${layawayStatusClasses(alert.tone)}`}>
                        {formatLayawayStatusIcon(alert.tone)}&nbsp; {alert.statusLabel}
                      </span>
                      {alert.hasNoRecentPayments && (
                        <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                          Sin abonos recientes
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {layaway.invoice.number} · Creado: {alert.createdDate} · Vence: {alert.dueDate}
                      {client?.document && <span className="ml-1">· CC: {client.document}</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      <span><span className="text-muted-foreground">Estado:</span> <strong>{alert.statusLabel}</strong></span>
                      <span><span className="text-muted-foreground">Días restantes:</span> <strong>{alert.lifecycle === 'active' ? (alert.daysRemaining < 0 ? `Vencido hace ${Math.abs(alert.daysRemaining)} días` : `${alert.daysRemaining} días`) : 'No aplica'}</strong></span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-start justify-between gap-3 sm:justify-end">
                    <div className="min-w-0 text-left sm:text-right">
                      <p className="break-words font-bold">{formatCurrency(layaway.invoice.total)}</p>
                      <p className="text-xs text-muted-foreground">
                        Pagado: {formatCurrency(totalPaid)} · Pendiente:{' '}
                        <span className="font-medium text-warning">{formatCurrency(remaining)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <PdfDocumentActions
                        compact
                        document={() => buildLayawayDocument(layaway)}
                        title={`Documentos de ${layaway.invoice.number}`}
                      />
                      {isActive && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditLayaway(layaway.id)}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="Editar separado"
                            aria-label={`Editar ${layaway.invoice.number}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteLayaway(layaway.id)}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title="Cancelar separado"
                            aria-label={`Cancelar ${layaway.invoice.number}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  onClick={() => setLayawayDetail(layaway.id)}
                  aria-label={`Ver detalle de ${layaway.invoice.number}`}
                >
                  <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* LAYAWAY DETAIL MODAL */}
      {ld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-3 backdrop-blur-sm" onClick={() => setLayawayDetail(null)}>
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl sm:p-6" onClick={event => event.stopPropagation()}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words text-lg font-bold">Separado: {ld.invoice.number}</h3>
                  {ldAlert && (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${layawayStatusClasses(ldAlert.tone)}`}>
                      {formatLayawayStatusIcon(ldAlert.tone)}&nbsp; {ldAlert.statusLabel}
                    </span>
                  )}
                </div>
                <p className="break-words text-sm text-muted-foreground">{ld.invoice.clientName}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PdfDocumentActions document={() => buildLayawayDocument(ld)} label="Documentos" />
                {ldIsActive && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => startEditLayaway(ld.id)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => openDeleteLayaway(ld.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Cancelar
                    </Button>
                  </>
                )}
                <button type="button" onClick={() => setLayawayDetail(null)} className="rounded p-1.5 transition-colors hover:bg-secondary" aria-label="Cerrar detalle">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {(() => {
              const totalPaid = ld.payments.reduce((sum, payment) => sum + payment.amount, 0);
              const remaining = Math.max(0, ld.invoice.total - totalPaid);
              return (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="max-w-full break-words text-lg font-bold">{formatCurrency(ld.invoice.total)}</p>
                    </div>
                    <div className="flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Abonado</p>
                      <p className="max-w-full break-words text-lg font-bold text-success">{formatCurrency(totalPaid)}</p>
                    </div>
                    <div className="flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Pendiente</p>
                      <p className={`max-w-full break-words text-lg font-bold ${remaining > 0 ? 'text-warning' : 'text-success'}`}>{formatCurrency(remaining)}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3 text-sm sm:grid-cols-2">
                    <div><span className="text-muted-foreground">Fecha creación:</span> {ldAlert?.createdDate || ld.invoice.date}</div>
                    <div><span className="text-muted-foreground">Fecha vencimiento:</span> {ldAlert?.dueDate || 'No registrada'}</div>
                    <div><span className="text-muted-foreground">Cliente:</span> {ld.invoice.clientName}</div>
                    <div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">Último abono:</span> {ldAlert?.lastPaymentDate || 'Sin abonos'}</div>
                    {ld.invoice.clientNotes && <div className="sm:col-span-2"><span className="text-muted-foreground">Observaciones:</span> {ld.invoice.clientNotes}</div>}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Artículos</p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[560px] text-xs">
                        <thead className="border-b border-border bg-secondary/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Producto</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cantidad</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Precio</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ld.invoice.items.map(item => (
                            <tr key={item.productId} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-2"><span className="mr-1 font-mono text-primary">{item.code}</span>{item.name}</td>
                              <td className="px-3 py-2 text-right">{productById.get(item.productId) && isSoldByWeight(productById.get(item.productId)!) ? `${formatWeight(item.quantity)} g` : item.quantity}</td>
                              <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {ld.payments.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Abonos realizados</p>
                      <div className="space-y-1.5">
                        {ld.payments.map(payment => (
                          <div key={payment.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                            <span className="min-w-0 break-words">{payment.date} · {payment.method}</span>
                            <span className="shrink-0 font-medium text-success">+{formatCurrency(payment.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {remaining > 0 && ldIsActive && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Registrar abono</p>
                      <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(150px,0.8fr)_minmax(210px,1.25fr)_minmax(150px,0.8fr)_auto]">
                        <div className="min-w-0 space-y-1">
                          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground" htmlFor="layaway-payment-amount">Valor del abono</label>
                          <Input
                            id="layaway-payment-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={paymentAmount}
                            onChange={event => setPaymentAmount(event.target.value)}
                            placeholder="0"
                            className="h-10 w-full min-w-0 border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground" htmlFor="layaway-payment-account">Cuenta financiera</label>
                          <select
                            id="layaway-payment-account"
                            value={paymentAccountId}
                            onChange={event => setPaymentAccountId(event.target.value)}
                            className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                          >
                            {financialAccounts.filter(account => account.active && account.id !== LAYAWAY_RESERVE_ACCOUNT_ID).map(account => (
                              <option key={account.id} value={account.id}>{account.name} · {formatCurrency(account.balance)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground" htmlFor="layaway-payment-method">Medio de pago</label>
                          <select
                            id="layaway-payment-method"
                            value={paymentMethod}
                            onChange={event => setPaymentMethod(event.target.value)}
                            className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                          >
                            {['Efectivo', 'Transferencia', 'Tarjeta', 'Nequi', 'Daviplata'].map(method => <option key={method} value={method}>{method}</option>)}
                          </select>
                        </div>
                        <Button
                          onClick={addLayawayPayment}
                          disabled={!paymentAmount || !paymentAccountId}
                          className="h-10 w-full gold-gradient px-5 font-semibold text-primary-foreground lg:w-auto"
                        >
                          Abonar
                        </Button>
                      </div>
                    </div>
                  )}

                  {remaining <= 0 && !ld.completed && ldIsActive && (
                    <Button onClick={() => handleCompleteLayaway(ld.id)} className="w-full gold-gradient font-semibold text-primary-foreground">
                      Marcar como completado
                    </Button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* EDIT LAYAWAY MODAL */}
      {editLayaway && editInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-3 backdrop-blur-sm" onClick={closeEditLayaway}>
          <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl sm:p-6" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Editar separado {editInvoice.number}</h3>
                <p className="text-sm text-muted-foreground">Los abonos y movimientos financieros existentes se conservan.</p>
              </div>
              <button type="button" onClick={closeEditLayaway} disabled={editSaving} className="rounded p-1.5 transition-colors hover:bg-secondary disabled:opacity-50" aria-label="Cerrar edición">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cliente *</label>
                <ClientSearchCombobox clients={clients} value={editInvoice.clientId} onChange={selectEditClient} disabled={editSaving} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground" htmlFor="edit-layaway-date">Fecha *</label>
                <Input
                  id="edit-layaway-date"
                  type="date"
                  value={editInvoice.date}
                  onChange={event => setEditInvoice({ ...editInvoice, date: event.target.value })}
                  disabled={editSaving}
                  className="h-10 bg-secondary/50"
                />
              </div>
              <div className="lg:col-span-2">
                <LayawayDeadlineSelector
                  createdDate={editInvoice.date}
                  mode={editDeadlineMode}
                  termDays={editTermDays}
                  customDueDate={editCustomDueDate}
                  disabled={editSaving}
                  onModeChange={setEditDeadlineMode}
                  onTermDaysChange={setEditTermDays}
                  onCustomDueDateChange={setEditCustomDueDate}
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground" htmlFor="edit-layaway-notes">Observaciones</label>
                <textarea
                  id="edit-layaway-notes"
                  value={editInvoice.clientNotes || ''}
                  onChange={event => setEditInvoice({ ...editInvoice, clientNotes: event.target.value })}
                  disabled={editSaving}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  placeholder="Observaciones del separado"
                />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agregar artículo</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={editProductSearch}
                  onChange={event => setEditProductSearch(event.target.value)}
                  disabled={editSaving}
                  placeholder="Buscar por código, referencia o nombre..."
                  className="h-10 bg-secondary/50 pl-9"
                />
                {editProductSearch.trim() && (
                  <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
                    {matchedEditProducts.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">No se encontraron productos</p>
                    ) : matchedEditProducts.map(product => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addEditProduct(product.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <span className="min-w-0"><span className="font-mono text-primary">{product.code}</span> · <span className="font-medium">{product.name}</span></span>
                        <span className="shrink-0 text-xs text-muted-foreground">Stock: {isSoldByWeight(product) ? formatWeight(product.stock) : product.stock}{isSoldByWeight(product) ? ' g' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border bg-secondary/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Artículo</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cantidad</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Precio</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Subtotal</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {editInvoice.items.map(item => {
                    const product = productById.get(item.productId);
                    const byWeight = product ? isSoldByWeight(product) : false;
                    return (
                      <tr key={item.productId} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium"><span className="mr-1 font-mono text-primary">{item.code}</span>{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">Disponible: {editAvailableStock(item.productId)}{byWeight ? ' g' : ''}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min={byWeight ? 0.01 : 1}
                            step={byWeight ? 0.01 : 1}
                            value={item.quantity}
                            onChange={event => updateEditQuantity(item.productId, Number(event.target.value))}
                            disabled={editSaving}
                            className="ml-auto h-9 w-28 bg-background text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={event => updateEditPrice(item.productId, Number(event.target.value))}
                            disabled={editSaving}
                            className="ml-auto h-9 w-36 bg-background text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeEditItem(item.productId)}
                            disabled={editSaving || editInvoice.items.length <= 1}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`Quitar ${item.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-lg bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Abonos conservados: <strong className="text-foreground">{formatCurrency(editLayaway.payments.reduce((sum, payment) => sum + payment.amount, 0))}</strong>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase text-muted-foreground">Nuevo total</p>
                <p className="text-2xl font-bold">{formatCurrency(editInvoice.total)}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={closeEditLayaway} disabled={editSaving}>Cancelar</Button>
              <Button onClick={saveEditedLayaway} disabled={editSaving} className="gap-2 gold-gradient font-semibold text-primary-foreground">
                <Save className="h-4 w-4" /> {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE LAYAWAY MODAL */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 p-3 backdrop-blur-sm" onClick={closeDeleteLayaway}>
          <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold">Cancelar separado</h3>
                <p className="break-words text-xs text-muted-foreground">{deleteCandidate.invoice.number} · {deleteCandidate.invoice.clientName}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 rounded-lg bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total:</span><strong>{formatCurrency(deleteCandidate.invoice.total)}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Abonado:</span><strong>{formatCurrency(deleteCandidate.payments.reduce((sum, payment) => sum + payment.amount, 0))}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Artículos:</span><strong>{deleteCandidate.invoice.items.length}</strong></div>
            </div>
            {deleteCandidate.payments.reduce((sum, payment) => sum + payment.amount, 0) > 0.01 ? (
              <div className="mt-4 space-y-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div>
                  <p className="text-sm font-semibold">Este separado posee abonos registrados.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Total abonado: <strong className="text-foreground">{formatCurrency(deleteCandidate.payments.reduce((sum, payment) => sum + payment.amount, 0))}</strong>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">Seleccione qué desea hacer con el dinero:</p>
                </div>
                <RadioGroup
                  value={deleteResolution}
                  onValueChange={value => setDeleteResolution(value as LayawayCancellationResolution | 'cancel')}
                  className="gap-3"
                >
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
                    <RadioGroupItem value="refund" id="layaway-refund" className="mt-0.5" />
                    <Label htmlFor="layaway-refund" className="cursor-pointer leading-5">
                      <span className="block font-medium">Devolver dinero al cliente</span>
                      <span className="block text-xs font-normal text-muted-foreground">Registra LAYAWAY_REFUND y retira el valor de Caja Separados.</span>
                    </Label>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
                    <RadioGroupItem value="credit" id="layaway-credit" className="mt-0.5" />
                    <Label htmlFor="layaway-credit" className="cursor-pointer leading-5">
                      <span className="block font-medium">Convertir en saldo a favor del cliente</span>
                      <span className="block text-xs font-normal text-muted-foreground">El dinero permanece reservado y el crédito queda trazado en el libro mayor.</span>
                    </Label>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
                    <RadioGroupItem value="cancel" id="layaway-cancel-operation" className="mt-0.5" />
                    <Label htmlFor="layaway-cancel-operation" className="cursor-pointer leading-5">
                      <span className="block font-medium">Cancelar operación</span>
                      <span className="block text-xs font-normal text-muted-foreground">No se modifica inventario, dinero ni movimientos.</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-muted-foreground">
                Se restaurará el inventario reservado. No existen abonos que deban devolverse o convertirse en saldo a favor.
              </div>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={closeDeleteLayaway} disabled={deleteLoading}>Cancelar</Button>
              <Button
                variant={deleteResolution === 'cancel' ? 'outline' : 'destructive'}
                onClick={confirmDeleteLayaway}
                disabled={deleteLoading || (
                  deleteCandidate.payments.reduce((sum, payment) => sum + payment.amount, 0) > 0.01
                  && !deleteResolution
                )}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleteLoading
                  ? 'Procesando...'
                  : deleteResolution === 'cancel'
                    ? 'Cerrar sin cambios'
                    : 'Confirmar cancelación'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ANNUL INVOICE MODAL */}
      {annulInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => { setAnnulInvoice(null); setAnnulReason(''); }}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-destructive/30 bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <Ban className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-bold">Anular Factura</h3>
                <p className="text-xs text-muted-foreground">{annulInvoice.number} · {annulInvoice.clientName}</p>
              </div>
            </div>

            <div className="rounded-lg bg-destructive/5 border border-destructive/10 p-3 text-sm text-muted-foreground">
              <p>Esta acción cambiará el estado a <strong className="text-destructive">Anulada</strong> y reintegrará el stock de los siguientes productos:</p>
              <ul className="mt-2 space-y-1">
                {annulInvoice.items.map((it, i) => (
                  <li key={i} className="text-xs">• {it.name} × {productById.get(it.productId) && isSoldByWeight(productById.get(it.productId)!) ? `${formatWeight(it.quantity)} g` : it.quantity} ({formatCurrency(it.subtotal)})</li>
                ))}
              </ul>
              <p className="mt-2 font-medium">Total a anular: {formatCurrency(annulInvoice.total)}</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Motivo de anulación *</label>
              <textarea
                value={annulReason}
                onChange={e => setAnnulReason(e.target.value)}
                rows={3}
                placeholder="Ej: Error en precios, devolución del cliente, duplicado..."
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-destructive resize-none"
                autoFocus
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { setAnnulInvoice(null); setAnnulReason(''); }}>
                Cancelar
              </Button>
              <Button
                onClick={handleAnnul}
                disabled={annulLoading || !annulReason.trim()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              >
                <Ban className="h-4 w-4" />
                {annulLoading ? 'Anulando...' : 'Confirmar Anulación'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewInvoice && <InvoicePreview key={previewInvoice.id} invoice={previewInvoice} type="sale" onClose={() => setPreviewInvoice(null)} />}
    </div>
  );
};

export default Sales;
