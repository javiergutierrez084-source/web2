import { useState, useMemo } from 'react';
import { Lock, Unlock, Clock, DollarSign, AlertTriangle, RotateCcw, Plus, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/data/mockData';
import { useApp, type CashSession } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import { calculateCashDayMetrics, isSalesInvoice, isValidExpense, isValidPurchase } from '@/lib/DashboardMetricsService';
import { getSaleAccountFlowsForDate } from '@/lib/FinancialLedgerService';
import { MAIN_CASH_ACCOUNT_ID } from '@/lib/FinancialPositionService';

const CashRegister = () => {
  const { company, invoices, expenses, purchaseInvoices, layaways, cashSessions, setCashSessions, financialAccounts, financialMovements, createFinancialAccount, transferFunds } = useApp();
  const { toast } = useToast();

  const today = new Date().toISOString().split('T')[0];
  const now = () => new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  // Current session for today
  const todaySession = cashSessions.find(s => s.date === today);
  const isOpen = todaySession && !todaySession.closedAt;
  const isClosed = todaySession && !!todaySession.closedAt;

  // Open form state
  const [openAmount, setOpenAmount] = useState('');

  // Close form state
  const [closeObservations, setCloseObservations] = useState('');

  // Reopen confirmation
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountKind, setNewAccountKind] = useState<'cash' | 'bank' | 'wallet'>('bank');
  const [transfer, setTransfer] = useState({ originAccountId: 'account-caja-principal', destinationAccountId: 'account-bancolombia', amount: '', observation: '' });

  // ── Day calculations ──
  const todaySalesPaid = useMemo(() =>
    invoices.filter(i => i.date === today && isSalesInvoice(i)),
    [invoices, today]
  );
  const todaySalesTotal = todaySalesPaid.reduce((s, i) => s + i.total, 0);

  const todayPurchases = useMemo(() =>
    purchaseInvoices.filter(p => p.date === today && isValidPurchase(p)),
    [purchaseInvoices, today]
  );
  const todayPurchasesTotal = todayPurchases.reduce((s, p) => s + p.total, 0);

  const todayExpenses = useMemo(() =>
    expenses.filter(e => e.date === today && isValidExpense(e)),
    [expenses, today]
  );
  const todayExpensesTotal = todayExpenses.reduce((s, e) => s + e.total, 0);

  const todayLayawayPayments = useMemo(() => {
    const payments: { client: string; amount: number; method: string; accountId?: string }[] = [];
    layaways.forEach(l => {
      if (l.completed || l.invoice.status === 'cancelled') return;
      l.payments.filter(p => p.date === today).forEach(p => {
        payments.push({ client: l.invoice.clientName, amount: p.amount, method: p.method, accountId: p.accountId });
      });
    });
    return payments;
  }, [layaways, today]);
  const todayCashLayawayPayments = todayLayawayPayments.filter(payment => (
    payment.accountId === MAIN_CASH_ACCOUNT_ID || (!payment.accountId && payment.method === 'Efectivo')
  ));
  const todayLayawayTotal = todayCashLayawayPayments.reduce((s, p) => s + p.amount, 0);
  const todayCashSaleMovements = useMemo(
    () => getSaleAccountFlowsForDate(financialMovements, MAIN_CASH_ACCOUNT_ID, today),
    [financialMovements, today],
  );

  const cashMetrics = useMemo(() => calculateCashDayMetrics({
    date: today,
    invoices,
    expenses,
    purchases: purchaseInvoices,
    layaways,
    movements: financialMovements,
  }), [today, invoices, expenses, purchaseInvoices, layaways, financialMovements]);
  const totalIncome = cashMetrics.totalIncome;
  const totalExpense = cashMetrics.totalOutflow;
  const expectedCash = (todaySession?.initialAmount || 0) + totalIncome - totalExpense;

  // ── Handlers ──
  const handleOpen = () => {
    const amount = parseFloat(openAmount);
    if (isNaN(amount) || amount < 0) {
      toast({ title: '⚠️ Ingresa un valor válido', variant: 'destructive' });
      return;
    }
    if (todaySession) {
      toast({ title: '⚠️ Ya existe una sesión para hoy', variant: 'destructive' });
      return;
    }
    const session: CashSession = {
      id: crypto.randomUUID(),
      openedAt: now(),
      openedBy: 'Admin',
      initialAmount: amount,
      date: today,
    };
    setCashSessions([...cashSessions, session]);
    setOpenAmount('');
    toast({ title: '🔓 Caja abierta', description: `Base: ${formatCurrency(amount)} a las ${session.openedAt}` });
  };

  const handleClose = () => {
    if (!todaySession || todaySession.closedAt) return;
    const updated = cashSessions.map(s =>
      s.id === todaySession.id
        ? { ...s, closedAt: now(), closedBy: 'Admin', observations: closeObservations }
        : s
    );
    setCashSessions(updated);
    setCloseObservations('');
    toast({ title: '🔒 Caja cerrada', description: `Cerrada a las ${now()}` });
  };

  const handleReopen = () => {
    if (!todaySession) return;
    const updated = cashSessions.map(s =>
      s.id === todaySession.id
        ? { ...s, closedAt: undefined, closedBy: undefined, observations: (s.observations || '') + ` [Reabierta a las ${now()} para correcciones]` }
        : s
    );
    setCashSessions(updated);
    setShowReopenConfirm(false);
    toast({ title: '🔓 Caja reabierta', description: 'Puedes realizar correcciones ahora.' });
  };

  const buildCashDocument = () => {
    const session = todaySession;
    if (!session) {
      return buildTableDocumentData({
        company,
        title: 'Cuadre de Caja Diario',
        subtitle: today,
        columns: [{ header: 'Concepto' }, { header: 'Detalle' }, { header: 'Valor', align: 'right' }],
        rows: [],
      });
    }

    return buildTableDocumentData({
      company,
      title: 'Cuadre de Caja Diario',
      subtitle: `Fecha: ${today} · Apertura: ${session.openedAt}${session.closedAt ? ` · Cierre: ${session.closedAt}` : ''}`,
      columns: [
        { header: 'Concepto' },
        { header: 'Detalle' },
        { header: 'Valor', align: 'right' },
      ],
      rows: [
        ['Base inicial', `Apertura ${session.openedAt}`, formatCurrency(session.initialAmount)],
        ...todayCashSaleMovements.map(({ movement, code, signedAmount }) => [
          signedAmount < 0 ? movement.reference : `Venta ${movement.reference}`,
          movement.observation || `Movimiento ${code} en Caja Principal`,
          `${signedAmount < 0 ? '-' : ''}${formatCurrency(Math.abs(signedAmount))}`,
        ]),
        ...todayCashLayawayPayments.map(payment => ['Abono separado', `${payment.client} · ${payment.method}`, formatCurrency(payment.amount)]),
        ['Subtotal ingresos', `${todayCashSaleMovements.length} movimientos de venta + ${todayCashLayawayPayments.length} abonos en efectivo`, formatCurrency(totalIncome)],
        ...todayPurchases.map(purchase => [`Compra ${purchase.number}`, purchase.supplierName, `-${formatCurrency(purchase.total)}`]),
        ...todayExpenses.map(expense => [`Gasto ${expense.number}`, expense.description, `-${formatCurrency(expense.total)}`]),
        ['Subtotal egresos', `${todayPurchases.length + todayExpenses.length} movimientos`, `-${formatCurrency(totalExpense)}`],
      ],
      summaryLines: [
        { label: 'Base inicial', value: formatCurrency(session.initialAmount) },
        { label: 'Total ingresos', value: `+${formatCurrency(totalIncome)}` },
        { label: 'Total egresos', value: `-${formatCurrency(totalExpense)}` },
        { label: 'Total esperado en caja', value: formatCurrency(expectedCash), bold: true },
        ...(session.observations ? [{ label: 'Observaciones', value: session.observations }] : []),
        ...(session.closedBy ? [{ label: 'Cerrado por', value: `${session.closedBy} a las ${session.closedAt}` }] : []),
      ],
    });
  };

  // ── Past sessions ──
  const pastSessions = cashSessions.filter(s => s.date !== today && s.closedAt).slice(-5).reverse();

  const handleCreateAccount = async () => {
    if (!newAccountName.trim()) return;
    await createFinancialAccount({ name: newAccountName, kind: newAccountKind });
    setNewAccountName('');
    toast({ title: 'Cuenta financiera creada' });
  };

  const handleTransfer = async () => {
    const amount = Number(transfer.amount);
    if (!amount || amount <= 0 || transfer.originAccountId === transfer.destinationAccountId) {
      toast({ title: 'Transferencia inválida', variant: 'destructive' }); return;
    }
    try {
      await transferFunds({ ...transfer, amount, date: today });
      setTransfer(previous => ({ ...previous, amount: '', observation: '' }));
      toast({ title: 'Transferencia registrada' });
    } catch (error) {
      toast({ title: 'No se pudo transferir', description: error instanceof Error && error.message === 'INSUFFICIENT_ACCOUNT_BALANCE' ? 'Saldo insuficiente.' : 'Revisa las cuentas.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Cuadre de Caja</h1>
        <p className="text-sm text-muted-foreground mt-1">Control de apertura y cierre diario</p>
      </div>

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {financialAccounts.filter(account => account.active).map(account => (
            <div key={account.id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4">
              <p className="break-words text-[10px] uppercase leading-tight text-muted-foreground" title={account.name}>{account.name}</p>
              <p className="break-words text-xl font-bold">{formatCurrency(account.balance)}</p>
              <p className="text-[10px] text-muted-foreground">{account.kind === 'cash' ? 'Caja' : account.kind === 'bank' ? 'Banco' : 'Billetera'}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> Nueva cuenta</h3>
            <div className="flex gap-2">
              <Input value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="Nombre de la cuenta" className="bg-secondary/50 border-border" />
              <select value={newAccountKind} onChange={e => setNewAccountKind(e.target.value as 'cash' | 'bank' | 'wallet')} className="rounded-lg border border-border bg-secondary/50 px-3 text-sm">
                <option value="cash">Caja</option><option value="bank">Banco</option><option value="wallet">Billetera</option>
              </select>
              <Button onClick={handleCreateAccount} variant="outline">Agregar</Button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Transferencia entre cuentas</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={transfer.originAccountId} onChange={e => setTransfer(previous => ({ ...previous, originAccountId: e.target.value }))} className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">{financialAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>Desde: {a.name}</option>)}</select>
              <select value={transfer.destinationAccountId} onChange={e => setTransfer(previous => ({ ...previous, destinationAccountId: e.target.value }))} className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">{financialAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>Hacia: {a.name}</option>)}</select>
              <Input type="number" value={transfer.amount} onChange={e => setTransfer(previous => ({ ...previous, amount: e.target.value }))} placeholder="Monto" className="bg-secondary/50 border-border" />
              <Button onClick={handleTransfer} className="gold-gradient text-primary-foreground">Transferir</Button>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Movimientos financieros recientes</h3>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {financialMovements.slice(0, 20).map(movement => (
              <div key={movement.id} className="grid grid-cols-[90px_1fr_auto] gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{movement.date}</span><span>{movement.reference} · {movement.observation}</span><span className="font-semibold">{formatCurrency(movement.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NO SESSION: OPEN ── */}
      {!todaySession && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
              <Unlock className="h-5 w-5 text-success" />
            </div>
            <div>
              <h2 className="font-semibold">Abrir Caja</h2>
              <p className="text-xs text-muted-foreground">Fecha: {today}</p>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Valor inicial en caja</label>
            <Input
              type="number"
              min={0}
              value={openAmount}
              onChange={e => setOpenAmount(e.target.value)}
              placeholder="Ej: 200000"
              className="bg-secondary/50 border-border text-lg font-semibold"
            />
          </div>
          <Button onClick={handleOpen} className="w-full gold-gradient text-primary-foreground font-semibold gap-2">
            <Unlock className="h-4 w-4" /> Abrir Caja
          </Button>
        </div>
      )}

      {/* ── SESSION OPEN: LIVE VIEW ── */}
      {isOpen && (
        <div className="space-y-4">
          {/* Status bar */}
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
              <Unlock className="h-4 w-4 text-success" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-success">Caja Abierta</p>
              <p className="text-xs text-muted-foreground">
                Abierta por {todaySession!.openedBy} a las {todaySession!.openedAt} · Base: {formatCurrency(todaySession!.initialAmount)}
              </p>
            </div>
            <PdfDocumentActions document={buildCashDocument} label="Documentos" />

          </div>

          {/* KPIs */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Base Inicial</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(todaySession!.initialAmount)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Ventas</p>
              <p className="text-xl font-bold text-success mt-1">{formatCurrency(todaySalesTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{todaySalesPaid.length} facturas</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Abonos</p>
              <p className="text-xl font-bold text-primary mt-1">{formatCurrency(todayLayawayTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{todayCashLayawayPayments.length} abonos en caja</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Egresos</p>
              <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(totalExpense)}</p>
              <p className="text-[10px] text-muted-foreground">{todayPurchases.length + todayExpenses.length} mov.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 ring-1 ring-primary/20">
              <p className="text-[10px] text-muted-foreground uppercase">Esperado en Caja</p>
              <p className="text-xl font-bold gold-text mt-1">{formatCurrency(expectedCash)}</p>
            </div>
          </div>

          {/* Detail tables */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-success" /> Ventas del Día
              </h3>
              {todaySalesPaid.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin ventas registradas</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {todaySalesPaid.map(i => (
                    <div key={i.id} className="flex justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                      <div>
                        <span className="font-mono text-xs text-primary">{i.number}</span>
                        <span className="ml-2">{i.clientName}</span>
                      </div>
                      <span className="font-medium text-success">{formatCurrency(i.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Egresos del Día
              </h3>
              {todayPurchases.length + todayExpenses.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin egresos registrados</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {todayPurchases.map(p => (
                    <div key={p.id} className="flex justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                      <span>Compra {p.number} · {p.supplierName}</span>
                      <span className="font-medium text-destructive">-{formatCurrency(p.total)}</span>
                    </div>
                  ))}
                  {todayExpenses.map(e => (
                    <div key={e.id} className="flex justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                      <span>Gasto {e.number} · {e.description}</span>
                      <span className="font-medium text-destructive">-{formatCurrency(e.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Layaway payments */}
          {todayCashLayawayPayments.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Abonos de Separados en Caja Principal (no incluidos en ventas)
              </h3>
              <div className="space-y-1.5">
                {todayCashLayawayPayments.map((p, i) => (
                  <div key={i} className="flex justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                    <span>{p.client} · {p.method}</span>
                    <span className="font-medium text-primary">+{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close */}
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-warning" />
              <h3 className="font-semibold">Cerrar Caja</h3>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Observaciones (opcional)</label>
              <textarea
                value={closeObservations}
                onChange={e => setCloseObservations(e.target.value)}
                rows={2}
                placeholder="Ej: Faltante de $5.000 en efectivo..."
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleClose} variant="outline" className="gap-2 border-warning text-warning hover:bg-warning/10">
                <Lock className="h-4 w-4" /> Cerrar Caja
              </Button>
              <PdfDocumentActions document={buildCashDocument} label="Documentos" />

            </div>
          </div>
        </div>
      )}

      {/* ── SESSION CLOSED ── */}
      {isClosed && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Caja Cerrada</p>
              <p className="text-xs text-muted-foreground">
                Abierta: {todaySession!.openedAt} · Cerrada: {todaySession!.closedAt} · Por: {todaySession!.closedBy}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowReopenConfirm(true)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reabrir para correcciones
              </Button>
              <PdfDocumentActions document={buildCashDocument} label="Documentos" />

            </div>
          </div>

          {/* Summary cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Base</p>
              <p className="text-lg font-bold mt-1">{formatCurrency(todaySession!.initialAmount)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Ventas</p>
              <p className="text-lg font-bold text-success mt-1">{formatCurrency(todaySalesTotal)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Abonos</p>
              <p className="text-lg font-bold text-primary mt-1">{formatCurrency(todayLayawayTotal)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Egresos</p>
              <p className="text-lg font-bold text-destructive mt-1">{formatCurrency(totalExpense)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] text-muted-foreground uppercase">Total en Caja</p>
              <p className="text-lg font-bold gold-text mt-1">{formatCurrency(expectedCash)}</p>
            </div>
          </div>

          {todaySession!.observations && (
            <div className="rounded-lg bg-secondary/30 p-3 text-sm">
              <span className="text-muted-foreground">Observaciones: </span>{todaySession!.observations}
            </div>
          )}
        </div>
      )}

      {/* REOPEN CONFIRMATION MODAL */}
      {showReopenConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setShowReopenConfirm(false)}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl border border-warning/30 bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10">
                <RotateCcw className="h-5 w-5 text-warning" />
              </div>
              <div>
                <h3 className="font-bold">Reabrir Caja</h3>
                <p className="text-xs text-muted-foreground">Para realizar correcciones</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que deseas reabrir la caja de hoy? Se registrará en las observaciones que fue reabierta para correcciones.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReopenConfirm(false)}>Cancelar</Button>
              <Button onClick={handleReopen} className="gap-2 bg-warning text-warning-foreground hover:bg-warning/90">
                <RotateCcw className="h-4 w-4" /> Confirmar Reapertura
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── PAST SESSIONS ── */}
      {pastSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Historial Reciente</h2>
          {pastSessions.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-sm font-medium">{s.date}</p>
                <p className="text-xs text-muted-foreground">{s.openedAt} → {s.closedAt} · {s.closedBy}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">Base: {formatCurrency(s.initialAmount)}</p>
                {s.observations && <p className="text-[10px] text-muted-foreground">{s.observations}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CashRegister;
