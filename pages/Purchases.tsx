import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, ReceiptText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import ExpenseConceptCatalog from '@/components/ExpenseConceptCatalog';
import ExpenseInvoiceDialog from '@/components/ExpenseInvoiceDialog';
import PurchaseDocumentCenter from '@/components/PurchaseDocumentCenter';
import PurchaseFinanceDashboard from '@/components/PurchaseFinanceDashboard';
import { fetchExpenseConcepts, type ExpenseConcept } from '@/lib/ExpenseConceptService';
import {
  buildPurchaseDocumentRows,
  calculatePurchaseDashboardMetrics,
  encodeExpenseDocumentNotes,
  parseExpenseDocumentNotes,
  type PurchaseDocumentRow,
} from '@/lib/PurchaseDocumentsService';
import { deleteSupplierInvoiceSafe, fetchSupplierInvoices } from '@/lib/database';
import type { SupplierInvoiceView } from '@/domain/models';

const asSyntheticPayable = (document: PurchaseDocumentRow): SupplierInvoiceView | null => {
  if (document.payable) return document.payable;
  if (!document.legacyExpense) return null;
  return {
    id: document.legacyExpense.id,
    supplierId: document.legacyExpense.supplierId,
    supplierName: document.legacyExpense.supplierName,
    invoiceNumber: document.legacyExpense.number,
    issueDate: document.legacyExpense.date,
    dueDate: document.legacyExpense.date,
    total: document.legacyExpense.total,
    initialValue: document.legacyExpense.total,
    pendingBalance: document.legacyExpense.status === 'paid' ? 0 : document.legacyExpense.total,
    sourceType: 'legacy_expense',
    sourceId: document.legacyExpense.id,
    status: document.legacyExpense.status,
    notes: '',
    payments: [],
  };
};

const Purchases = () => {
  const navigate = useNavigate();
  const {
    company,
    purchaseInvoices,
    expenses,
    contacts,
    financialAccounts,
    financialRefreshVersion,
    deletePurchase,
    refreshFinancialData,
  } = useApp();
  const { toast } = useToast();
  const suppliers = useMemo(() => contacts.filter(contact => contact.type === 'supplier'), [contacts]);
  const [payables, setPayables] = useState<SupplierInvoiceView[]>([]);
  const [concepts, setConcepts] = useState<ExpenseConcept[]>([]);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<SupplierInvoiceView | null>(null);
  const [duplicatingExpense, setDuplicatingExpense] = useState<SupplierInvoiceView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PurchaseDocumentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadSupportingData = useCallback(async () => {
    const [nextPayables, nextConcepts] = await Promise.all([
      fetchSupplierInvoices(),
      fetchExpenseConcepts(),
    ]);
    setPayables(nextPayables);
    setConcepts(nextConcepts);
  }, []);

  useEffect(() => {
    void reloadSupportingData();
  }, [reloadSupportingData, financialRefreshVersion]);

  const documents = useMemo(() => buildPurchaseDocumentRows({
    purchases: purchaseInvoices,
    payables,
    legacyExpenses: expenses,
  }), [purchaseInvoices, payables, expenses]);

  const metrics = useMemo(() => calculatePurchaseDashboardMetrics(documents), [documents]);

  const openNewExpense = () => {
    setEditingExpense(null);
    setDuplicatingExpense(null);
    setExpenseDialogOpen(true);
  };

  const handleEdit = (document: PurchaseDocumentRow) => {
    if (document.type === 'purchase' && document.purchase) {
      navigate(`/cuentas-por-pagar/editar/${document.purchase.id}`);
      return;
    }
    if (document.source === 'legacy_expense') {
      toast({ title: 'Documento heredado', description: 'Este gasto se conserva para compatibilidad y no puede editarse desde el Centro de Documentos.' });
      return;
    }
    setEditingExpense(asSyntheticPayable(document));
    setDuplicatingExpense(null);
    setExpenseDialogOpen(true);
  };

  const handleDuplicate = (document: PurchaseDocumentRow) => {
    const source = asSyntheticPayable(document);
    if (!source) return;
    const metadata = parseExpenseDocumentNotes(source.notes);
    setDuplicatingExpense(metadata ? source : {
      ...source,
      notes: encodeExpenseDocumentNotes({
        conceptId: concepts.find(item => item.name === document.concept)?.id || concepts[0]?.id || 'expense-concept-other',
        conceptName: document.concept || 'Otros',
        description: document.legacyExpense?.description || '',
      }),
    });
    setEditingExpense(null);
    setExpenseDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.source === 'purchase') {
        await deletePurchase(pendingDelete.id);
      } else if (pendingDelete.source === 'supplier_invoice') {
        await deleteSupplierInvoiceSafe(pendingDelete.id);
      } else {
        throw new Error('LEGACY_EXPENSE_DELETE_UNAVAILABLE');
      }
      await refreshFinancialData();
      await reloadSupportingData();
      toast({ title: 'Documento eliminado' });
      setPendingDelete(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      toast({
        title: 'No se pudo eliminar el documento',
        description: code === 'PAYABLE_HAS_PAYMENTS'
          ? 'El documento tiene pagos y debe conservarse.'
          : code === 'PAID_PURCHASE_REVERSAL_REQUIRED'
            ? 'Una compra pagada requiere reversión controlada.'
            : code === 'LEGACY_EXPENSE_DELETE_UNAVAILABLE'
              ? 'Los gastos heredados se conservan por compatibilidad.'
              : code,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Compras</h1>
          <p className="text-sm text-muted-foreground">Documentos de mercancía, gastos, obligaciones y pagos enlazados.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openNewExpense} className="gap-2"><ReceiptText className="h-4 w-4" />Factura de gasto</Button>
          <Button variant="outline" onClick={() => navigate('/cuentas-por-pagar')} className="gap-2"><CreditCard className="h-4 w-4" />Cuentas por pagar</Button>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-5">
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="dashboard">Resumen financiero</TabsTrigger>
          <TabsTrigger value="documents">Centro de documentos</TabsTrigger>
          <TabsTrigger value="concepts">Conceptos de gasto</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><PurchaseFinanceDashboard metrics={metrics} /></TabsContent>
        <TabsContent value="documents">
          <PurchaseDocumentCenter
            company={company}
            documents={documents}
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
            onDelete={setPendingDelete}
          />
        </TabsContent>
        <TabsContent value="concepts"><ExpenseConceptCatalog concepts={concepts} onChange={setConcepts} /></TabsContent>
      </Tabs>

      <ExpenseInvoiceDialog
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        suppliers={suppliers}
        concepts={concepts}
        financialAccounts={financialAccounts}
        initial={editingExpense}
        duplicateFrom={duplicatingExpense}
        onSaved={async () => {
          await refreshFinancialData();
          await reloadSupportingData();
        }}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará {pendingDelete?.number}. Los documentos con pagos no pueden eliminarse y las compras revertirán el inventario mediante el flujo existente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} disabled={busy}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Purchases;
