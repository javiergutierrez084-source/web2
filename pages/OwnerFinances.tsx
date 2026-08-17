import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Download,
  Lock,
  Pencil,
  Percent,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Unlock,
  WalletCards,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { OwnerFinanceGoalProgress } from '@/components/OwnerFinanceGoalProgress';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { OwnerFinanceRepositoryService } from '@/services/OwnerFinanceRepositoryService';
import { exportOwnerFinanceCsv, exportOwnerFinanceExcel, exportOwnerFinancePdf } from '@/lib/OwnerFinanceExports';
import {
  currentOwnerFinancePeriodKey,
  formatOwnerFinancePeriodLabel,
  isFutureOwnerFinancePeriod,
  ownerFinancePeriodDateRange,
  type OwnerFinanceFilters,
  type OwnerFinancePeriod,
  type OwnerFinancePeriodOption,
  type OwnerFinancePeriodStatus,
  type OwnerFinanceWorkspace,
  type OwnerWithdrawalConcept,
} from '@/lib/OwnerFinanceService';

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const pad = (value: number) => String(value).padStart(2, '0');

function localDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultWithdrawalDate(periodKey: string): string {
  const now = new Date();
  if (periodKey === currentOwnerFinancePeriodKey(now)) return localDateTimeInputValue(now);
  return `${periodKey}-01T12:00`;
}

function periodDateTimeBounds(periodKey: string): { min: string; max: string } {
  const range = ownerFinancePeriodDateRange(periodKey);
  return {
    min: `${range.from}T00:00`,
    max: `${range.to}T23:59`,
  };
}

function formatAuditTimestamp(value?: string | null): string {
  if (!value) return 'Sin registro';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

const initialPeriod = currentOwnerFinancePeriodKey();

const emptyDashboard: OwnerFinanceWorkspace['dashboard'] = {
  monthlyProfitGoal: 0,
  profitMonth: 0,
  availableProfit: 0,
  withdrawnProfit: 0,
  availableBalance: 0,
  projectedWithdrawalPercentage: 30,
  suggestedWithdrawalValue: 0,
  monthlyGoalProgressPercentage: 0,
  monthlyGoalProgressBarPercentage: 0,
  monthlyGoalReachedValue: 0,
  monthlyGoalRemainingValue: 0,
  monthlyGoalReached: false,
  exceedsAvailable: false,
};

const emptyWorkspace: OwnerFinanceWorkspace = {
  selectedPeriod: initialPeriod,
  periods: [{
    key: initialPeriod,
    label: formatOwnerFinancePeriodLabel(initialPeriod),
    status: 'OPEN',
    hasFinancialData: false,
  }],
  dashboard: emptyDashboard,
  withdrawals: [],
  concepts: [],
  settings: {
    projectedWithdrawalPercentage: 30,
    monthlyProfitGoal: 0,
    financialPeriod: 'MONTHLY',
    periodKey: initialPeriod,
    periodStatus: 'OPEN',
  },
  accounts: [],
  users: [],
  paymentMethods: [],
};

function readableError(reason: unknown, fallback: string): string {
  const code = reason instanceof Error ? reason.message : '';
  const messages: Record<string, string> = {
    OWNER_CONCEPT_NAME_REQUIRED: 'El nombre del concepto es obligatorio.',
    OWNER_CONCEPT_ALREADY_EXISTS: 'Ya existe un concepto con ese nombre.',
    OWNER_CONCEPT_NOT_FOUND: 'El concepto seleccionado ya no existe.',
    OWNER_CONCEPT_INACTIVE: 'El concepto seleccionado está desactivado.',
    OWNER_WITHDRAWAL_PERCENTAGE_INVALID: 'El porcentaje debe estar entre 0 % y 100 %.',
    OWNER_MONTHLY_PROFIT_GOAL_INVALID: 'La meta mensual debe ser un valor igual o mayor que cero.',
    OWNER_FINANCE_PERIOD_INVALID: 'El periodo financiero seleccionado no es válido.',
    OWNER_FINANCE_PERIOD_KEY_INVALID: 'El mes seleccionado no es válido.',
    OWNER_FINANCE_PERIOD_STATUS_INVALID: 'El estado del período no es válido.',
    OWNER_FINANCE_PERIOD_CLOSED: 'El período seleccionado está cerrado y solo permite consultas y exportaciones.',
    OWNER_FINANCE_PERIOD_REOPEN_VALUES_CHANGED: 'Reabra primero el período antes de modificar su configuración.',
    OWNER_FINANCE_FUTURE_PERIOD_CLOSE_NOT_ALLOWED: 'No es posible cerrar un período futuro. Espere a que el mes haya comenzado.',
    OWNER_WITHDRAWAL_AMOUNT_INVALID: 'El valor del retiro debe ser mayor que cero.',
    OWNER_WITHDRAWAL_INSUFFICIENT_ACCOUNT_BALANCE: 'La cuenta seleccionada no tiene saldo suficiente.',
    OWNER_WITHDRAWAL_ACCOUNT_REQUIRED: 'Debe seleccionar una caja o cuenta.',
    OWNER_WITHDRAWAL_ACCOUNT_NOT_FOUND: 'La caja o cuenta seleccionada no está disponible.',
    OWNER_WITHDRAWAL_PAYMENT_METHOD_REQUIRED: 'Debe seleccionar un método de pago.',
    OWNER_WITHDRAWAL_DATE_INVALID: 'La fecha del retiro no es válida.',
    OWNER_WITHDRAWAL_PERIOD_MISMATCH: 'La fecha del retiro debe pertenecer al período seleccionado.',
    OWNER_WITHDRAWAL_CANCELLATION_REASON_REQUIRED: 'Debe indicar el motivo de anulación.',
    OWNER_WITHDRAWAL_NOT_FOUND: 'El retiro ya no está disponible.',
    OWNER_WITHDRAWAL_ALREADY_CANCELLED: 'El retiro ya se encuentra anulado.',
    OWNER_FINANCE_REQUIRES_PRINCIPAL_SERVER: 'Finanzas del Propietario se administra exclusivamente desde el Servidor Principal.',
  };
  return messages[code] || code || fallback;
}

export default function OwnerFinances() {
  const { user } = useAuth();
  const { refreshFinancialData } = useApp();
  const loadRequestId = useRef(0);
  const [workspace, setWorkspace] = useState<OwnerFinanceWorkspace>(emptyWorkspace);
  const [filters, setFilters] = useState<OwnerFinanceFilters>({ periodKey: initialPeriod });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [percentage, setPercentage] = useState('30');
  const [monthlyGoal, setMonthlyGoal] = useState('0');
  const [financialPeriod, setFinancialPeriod] = useState<OwnerFinancePeriod>('MONTHLY');
  const [newConcept, setNewConcept] = useState('');
  const [editingConceptId, setEditingConceptId] = useState<string | null>(null);
  const [editingConceptName, setEditingConceptName] = useState('');
  const [cancellingWithdrawalId, setCancellingWithdrawalId] = useState<string | null>(null);
  const [pendingCancellationWithdrawalId, setPendingCancellationWithdrawalId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationDialogError, setCancellationDialogError] = useState('');
  const [periodCloseDialogOpen, setPeriodCloseDialogOpen] = useState(false);
  const [changingPeriodStatus, setChangingPeriodStatus] = useState(false);
  const [form, setForm] = useState({
    withdrawalDate: defaultWithdrawalDate(initialPeriod),
    conceptId: '',
    amount: '',
    observations: '',
    accountId: '',
    paymentMethod: 'EFECTIVO',
  });

  const selectedPeriod = filters.periodKey || workspace.selectedPeriod || initialPeriod;
  const selectedPeriodOption = useMemo<OwnerFinancePeriodOption>(() => (
    workspace.periods.find(period => period.key === selectedPeriod) || {
      key: selectedPeriod,
      label: formatOwnerFinancePeriodLabel(selectedPeriod),
      status: workspace.settings.periodStatus || 'OPEN',
      hasFinancialData: false,
    }
  ), [selectedPeriod, workspace.periods, workspace.settings.periodStatus]);
  const workspaceMatchesSelection = workspace.selectedPeriod === selectedPeriod;
  const periodStatus: OwnerFinancePeriodStatus = workspaceMatchesSelection
    ? workspace.settings.periodStatus || selectedPeriodOption.status || 'OPEN'
    : selectedPeriodOption.status || 'OPEN';
  const periodClosed = periodStatus === 'CLOSED';
  const selectedPeriodIsFuture = isFutureOwnerFinancePeriod(selectedPeriod);
  const displayedDashboard = workspaceMatchesSelection ? workspace.dashboard : emptyDashboard;
  const periodReady = workspaceMatchesSelection && !loading;
  const withdrawalDateBounds = useMemo(() => periodDateTimeBounds(selectedPeriod), [selectedPeriod]);
  const reportPeriod = useMemo<OwnerFinancePeriodOption>(() => ({
    ...selectedPeriodOption,
    status: periodStatus,
  }), [selectedPeriodOption, periodStatus]);
  const pendingCancellationWithdrawal = useMemo(() => (
    workspace.withdrawals.find(item => item.id === pendingCancellationWithdrawalId) || null
  ), [pendingCancellationWithdrawalId, workspace.withdrawals]);

  const refreshCurrentLiquidity = async () => {
    try {
      await refreshFinancialData();
    } catch (reason) {
      console.error('No fue posible actualizar la liquidez después del retiro del propietario.', reason);
    }
  };

  const load = async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError('');
    try {
      const next = await OwnerFinanceRepositoryService.fetchWorkspace({
        ...filters,
        periodKey: selectedPeriod,
      });
      if (requestId !== loadRequestId.current) return;
      setWorkspace(next);
      setPercentage(String(next.settings.projectedWithdrawalPercentage));
      setMonthlyGoal(String(next.settings.monthlyProfitGoal));
      setFinancialPeriod(next.settings.financialPeriod);
    } catch (reason) {
      if (requestId !== loadRequestId.current) return;
      setError(readableError(reason, 'No fue posible cargar Finanzas del Propietario.'));
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters.periodKey, filters.from, filters.to, filters.userId, filters.conceptId, filters.accountId, filters.paymentMethod]);

  const executiveSummary = useMemo(() => [
    { label: 'Utilidad generada', value: displayedDashboard.profitMonth, kind: 'money' },
    { label: 'Utilidad retirada', value: displayedDashboard.withdrawnProfit, kind: 'money' },
    { label: 'Saldo disponible', value: displayedDashboard.availableBalance, kind: 'money' },
    { label: 'Meta mensual', value: displayedDashboard.monthlyProfitGoal, kind: 'money' },
    { label: 'Cumplimiento', value: displayedDashboard.monthlyGoalProgressPercentage, kind: 'percentage' },
    { label: 'Valor restante para alcanzar la meta', value: displayedDashboard.monthlyGoalRemainingValue, kind: 'money' },
  ] as const, [displayedDashboard]);

  const changeSelectedPeriod = (periodKey: string) => {
    const option = workspace.periods.find(period => period.key === periodKey);
    setLoading(true);
    setWorkspace(current => ({
      ...current,
      selectedPeriod: periodKey,
      dashboard: emptyDashboard,
      withdrawals: [],
      settings: {
        projectedWithdrawalPercentage: 30,
        monthlyProfitGoal: 0,
        financialPeriod: 'MONTHLY',
        periodKey,
        periodStatus: option?.status || 'OPEN',
        closedAt: null,
        closedBy: null,
        reopenedAt: null,
        reopenedBy: null,
      },
    }));
    setPercentage('30');
    setMonthlyGoal('0');
    setFinancialPeriod('MONTHLY');
    setFilters(current => ({
      periodKey,
      userId: current.userId,
      conceptId: current.conceptId,
      accountId: current.accountId,
      paymentMethod: current.paymentMethod,
    }));
    setForm(current => ({
      ...current,
      withdrawalDate: defaultWithdrawalDate(periodKey),
      amount: '',
      observations: '',
    }));
    setEditingConceptId(null);
    setError('');
  };

  const submitWithdrawal = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (periodClosed) {
      setError(readableError(new Error('OWNER_FINANCE_PERIOD_CLOSED'), 'No es posible registrar el retiro.'));
      return;
    }
    try {
      const withdrawalInput = {
        ...form,
        periodKey: selectedPeriod,
        amount: Number(form.amount),
        withdrawalDate: form.withdrawalDate,
      };
      await OwnerFinanceRepositoryService.createWithdrawal(withdrawalInput);
      setForm(current => ({ ...current, amount: '', observations: '' }));
      await Promise.all([load(), refreshCurrentLiquidity()]);
    } catch (reason) {
      setError(readableError(reason, 'No fue posible registrar el retiro.'));
    }
  };

  const saveSettings = async () => {
    setError('');
    try {
      await OwnerFinanceRepositoryService.saveSettings({
        projectedWithdrawalPercentage: Number(percentage),
        monthlyProfitGoal: Number(monthlyGoal),
        financialPeriod,
        periodKey: selectedPeriod,
        periodStatus,
      });
      await load();
    } catch (reason) {
      setError(readableError(reason, 'No fue posible guardar la configuración.'));
    }
  };

  const changePeriodStatus = async (nextStatus: OwnerFinancePeriodStatus) => {
    if (nextStatus === 'CLOSED' && selectedPeriodIsFuture) {
      setError(readableError(
        new Error('OWNER_FINANCE_FUTURE_PERIOD_CLOSE_NOT_ALLOWED'),
        'No es posible cerrar el período seleccionado.',
      ));
      return;
    }

    setChangingPeriodStatus(true);
    setError('');
    try {
      await OwnerFinanceRepositoryService.saveSettings({
        ...workspace.settings,
        projectedWithdrawalPercentage: workspace.settings.projectedWithdrawalPercentage,
        monthlyProfitGoal: workspace.settings.monthlyProfitGoal,
        financialPeriod: workspace.settings.financialPeriod,
        periodKey: selectedPeriod,
        periodStatus: nextStatus,
      });
      await load();
    } catch (reason) {
      setError(readableError(reason, 'No fue posible cambiar el estado del período.'));
    } finally {
      setChangingPeriodStatus(false);
    }
  };

  const requestPeriodClose = () => {
    if (selectedPeriodIsFuture) {
      setError(readableError(
        new Error('OWNER_FINANCE_FUTURE_PERIOD_CLOSE_NOT_ALLOWED'),
        'No es posible cerrar el período seleccionado.',
      ));
      return;
    }
    setPeriodCloseDialogOpen(true);
  };

  const confirmPeriodClose = async () => {
    setPeriodCloseDialogOpen(false);
    await changePeriodStatus('CLOSED');
  };

  const addConcept = async () => {
    if (!newConcept.trim() || periodClosed) return;
    setError('');
    try {
      await OwnerFinanceRepositoryService.createConcept(newConcept);
      setNewConcept('');
      await load();
    } catch (reason) {
      setError(readableError(reason, 'No fue posible crear el concepto.'));
    }
  };

  const startConceptEdit = (concept: OwnerWithdrawalConcept) => {
    if (periodClosed) return;
    setEditingConceptId(concept.id);
    setEditingConceptName(concept.name);
  };

  const saveConceptEdit = async () => {
    if (!editingConceptId || periodClosed) return;
    setError('');
    try {
      await OwnerFinanceRepositoryService.updateConcept(editingConceptId, { name: editingConceptName });
      setEditingConceptId(null);
      setEditingConceptName('');
      await load();
    } catch (reason) {
      setError(readableError(reason, 'No fue posible editar el concepto.'));
    }
  };

  const toggleConcept = async (concept: OwnerWithdrawalConcept) => {
    if (periodClosed) return;
    setError('');
    try {
      await OwnerFinanceRepositoryService.updateConcept(concept.id, { active: !concept.active });
      if (concept.active && form.conceptId === concept.id) {
        setForm(current => ({ ...current, conceptId: '' }));
      }
      await load();
    } catch (reason) {
      setError(readableError(reason, 'No fue posible cambiar el estado del concepto.'));
    }
  };

  const openWithdrawalCancellationDialog = (withdrawalId: string) => {
    if (periodClosed) return;
    setPendingCancellationWithdrawalId(withdrawalId);
    setCancellationReason('');
    setCancellationDialogError('');
  };

  const closeWithdrawalCancellationDialog = () => {
    if (cancellingWithdrawalId) return;
    setPendingCancellationWithdrawalId(null);
    setCancellationReason('');
    setCancellationDialogError('');
  };

  const confirmWithdrawalCancellation = async () => {
    const withdrawalId = pendingCancellationWithdrawalId;
    const reason = cancellationReason.trim();
    if (!withdrawalId || periodClosed) return;
    if (!reason) {
      setCancellationDialogError('Debe indicar el motivo de anulación.');
      return;
    }

    setCancellationDialogError('');
    setError('');
    setCancellingWithdrawalId(withdrawalId);
    try {
      await OwnerFinanceRepositoryService.cancelWithdrawal(withdrawalId, reason);
      setPendingCancellationWithdrawalId(null);
      setCancellationReason('');
      await Promise.all([load(), refreshCurrentLiquidity()]);
    } catch (cause) {
      setCancellationDialogError(readableError(cause, 'No fue posible anular el retiro.'));
    } finally {
      setCancellingWithdrawalId(null);
    }
  };

  const createReportContext = () => ({
    generatedAt: new Date().toISOString(),
    generatedBy: user?.displayName || user?.username || 'Usuario no identificado',
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <WalletCards className="h-6 w-6" /> FINANZAS DEL PROPIETARIO
            </h1>
            <p className="text-sm text-muted-foreground">
              Panel simple de utilidad mensual y retiros manuales del propietario.
            </p>
          </div>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load()} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Cabecera del período financiero">
          <div className="rounded-lg bg-secondary/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Período seleccionado</p>
            <p className="mt-1 text-lg font-semibold" data-testid="owner-finance-selected-period">
              {selectedPeriodOption.label}
            </p>
          </div>
          <div className="rounded-lg bg-secondary/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado del período</p>
            <span className={`mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
              periodClosed ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
            }`} data-testid="owner-finance-period-status">
              {periodClosed ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              {periodClosed ? 'Cerrado' : 'Abierto'}
            </span>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-md space-y-2">
          <label htmlFor="owner-finance-period-selector" className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4" /> Mes
          </label>
          <select
            id="owner-finance-period-selector"
            className="w-full rounded-md border bg-background p-2"
            value={selectedPeriod}
            onChange={event => changeSelectedPeriod(event.target.value)}
            aria-label="Período financiero"
          >
            {workspace.periods.map(period => (
              <option key={period.key} value={period.key}>
                {period.label} — {period.status === 'OPEN' ? 'Abierto' : 'Cerrado'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periodClosed ? (
            <Button
              type="button"
              variant="outline"
              disabled={loading || changingPeriodStatus}
              onClick={() => void changePeriodStatus('OPEN')}
              className="gap-2"
            >
              <Unlock className="h-4 w-4" /> Reabrir período
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={loading || changingPeriodStatus}
              onClick={requestPeriodClose}
              className="gap-2"
            >
              <Lock className="h-4 w-4" /> Cerrar período
            </Button>
          )}
        </div>
      </section>

      {selectedPeriodIsFuture && !periodClosed && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>Este período es futuro. Puede consultarlo y configurarlo, pero no podrá cerrarse hasta que el mes haya comenzado.</span>
        </div>
      )}
      {periodClosed && (
        <div className="flex gap-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-slate-800">
          <Lock className="h-5 w-5 shrink-0" />
          <span>Este período está cerrado. Puede consultar y exportar información, pero no registrar, anular ni modificar datos.</span>
        </div>
      )}
      {displayedDashboard.exceedsAvailable && (
        <div className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>Los retiros activos superan la utilidad disponible. La advertencia no genera ni bloquea movimientos automáticamente.</span>
        </div>
      )}
      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}

      <section className="space-y-3" aria-label="Resumen ejecutivo del período">
        <div>
          <h2 className="font-semibold">Resumen ejecutivo</h2>
          <p className="text-xs text-muted-foreground">Información exclusiva de {selectedPeriodOption.label}.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {executiveSummary.map(metric => (
            <article key={metric.label} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="text-xs text-muted-foreground">{metric.label}</div>
              <div className="mt-2 text-lg font-semibold">
                {metric.kind === 'percentage' ? `${metric.value.toFixed(2)} %` : currency.format(metric.value)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <OwnerFinanceGoalProgress dashboard={displayedDashboard} />

      <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <article className="space-y-4 rounded-xl border p-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Settings className="h-4 w-4" /> Configuración</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              La meta y el porcentaje pertenecen a {selectedPeriodOption.label}. Guardarlos no registra retiros ni genera movimientos.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="owner-monthly-profit-goal">Meta mensual de utilidad</label>
            <Input
              id="owner-monthly-profit-goal"
              type="number"
              min="0"
              step="1000"
              value={monthlyGoal}
              disabled={periodClosed}
              onChange={event => setMonthlyGoal(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="owner-profit-percentage">Porcentaje de utilidad proyectada para retiro</label>
            <div className="relative">
              <Input
                id="owner-profit-percentage"
                type="number"
                min="0"
                max="100"
                step="1"
                value={percentage}
                disabled={periodClosed}
                onChange={event => setPercentage(event.target.value)}
                className="pr-9"
              />
              <Percent className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="owner-financial-period">Periodo financiero</label>
            <select
              id="owner-financial-period"
              className="w-full rounded-md border bg-background p-2"
              value={financialPeriod}
              disabled={periodClosed}
              onChange={event => setFinancialPeriod(event.target.value as OwnerFinancePeriod)}
            >
              <option value="MONTHLY">Mensual</option>
              <option value="FORTNIGHTLY">Quincenal</option>
            </select>
            <p className="text-xs text-muted-foreground">
              En esta versión los cálculos continúan siendo mensuales.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border bg-secondary/20 p-3" aria-label="Auditoría del período">
            <h3 className="text-sm font-semibold">Auditoría del período</h3>
            {workspace.settings.closedAt ? (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Último cierre:</span>{' '}
                {formatAuditTimestamp(workspace.settings.closedAt)} por {workspace.settings.closedBy || 'Usuario no identificado'}.
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Este período no registra cierres anteriores.</p>
            )}
            {workspace.settings.reopenedAt && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Última reapertura:</span>{' '}
                {formatAuditTimestamp(workspace.settings.reopenedAt)} por {workspace.settings.reopenedBy || 'Usuario no identificado'}.
              </div>
            )}
          </div>

          <Button type="button" onClick={() => void saveSettings()} disabled={loading || periodClosed} className="w-full">
            Guardar configuración
          </Button>
        </article>

        <article className="space-y-4 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">Conceptos de retiro</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Los conceptos utilizados permanecen en el historial. Pueden editarse o desactivarse, pero no se eliminan.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={newConcept}
              disabled={periodClosed}
              onChange={event => setNewConcept(event.target.value)}
              placeholder="Nuevo concepto"
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addConcept();
                }
              }}
            />
            <Button type="button" variant="outline" disabled={periodClosed} onClick={() => void addConcept()} className="gap-2">
              <Plus className="h-4 w-4" /> Crear
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {workspace.concepts.map(concept => (
              <div key={concept.id} className={`rounded-lg border p-3 ${concept.active ? 'bg-card' : 'bg-secondary/30 opacity-70'}`}>
                {editingConceptId === concept.id ? (
                  <div className="flex gap-2">
                    <Input value={editingConceptName} disabled={periodClosed} onChange={event => setEditingConceptName(event.target.value)} />
                    <Button type="button" size="icon" variant="outline" disabled={periodClosed} onClick={() => void saveConceptEdit()} aria-label="Guardar concepto">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => setEditingConceptId(null)} aria-label="Cancelar edición">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{concept.name}</p>
                      <p className="text-xs text-muted-foreground">{concept.active ? 'Activo' : 'Desactivado'}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" size="icon" variant="ghost" disabled={periodClosed} onClick={() => startConceptEdit(concept)} aria-label={`Editar ${concept.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={periodClosed}
                        onClick={() => void toggleConcept(concept)}
                        aria-label={`${concept.active ? 'Desactivar' : 'Activar'} ${concept.name}`}
                      >
                        <Power className={`h-4 w-4 ${concept.active ? 'text-green-600' : 'text-muted-foreground'}`} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <form onSubmit={submitWithdrawal} className="space-y-3 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">Registrar retiro · {selectedPeriodOption.label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Valor sugerido para retirar: <span className="font-semibold text-foreground">{currency.format(displayedDashboard.suggestedWithdrawalValue)}</span>
            </p>
          </div>
          <fieldset disabled={periodClosed || loading || !periodReady} className="space-y-3 disabled:opacity-60">
            <input
              required
              className="w-full rounded-md border bg-background p-2"
              type="datetime-local"
              min={withdrawalDateBounds.min}
              max={withdrawalDateBounds.max}
              value={form.withdrawalDate}
              onChange={event => setForm({ ...form, withdrawalDate: event.target.value })}
            />
            <select
              required
              className="w-full rounded-md border bg-background p-2"
              value={form.conceptId}
              onChange={event => setForm({ ...form, conceptId: event.target.value })}
            >
              <option value="">Seleccione un concepto</option>
              {workspace.concepts.filter(concept => concept.active).map(concept => (
                <option key={concept.id} value={concept.id}>{concept.name}</option>
              ))}
            </select>
            <Input
              required
              min="0.01"
              step="0.01"
              type="number"
              placeholder="Valor"
              value={form.amount}
              onChange={event => setForm({ ...form, amount: event.target.value })}
            />
            <select
              required
              className="w-full rounded-md border bg-background p-2"
              value={form.accountId}
              onChange={event => setForm({ ...form, accountId: event.target.value })}
            >
              <option value="">Caja o cuenta</option>
              {workspace.accounts.map(account => (
                <option key={account.id} value={account.id}>{account.name} · {currency.format(account.balance)}</option>
              ))}
            </select>
            <select
              required
              className="w-full rounded-md border bg-background p-2"
              value={form.paymentMethod}
              onChange={event => setForm({ ...form, paymentMethod: event.target.value })}
            >
              {workspace.paymentMethods.map(method => <option key={method}>{method}</option>)}
            </select>
            <textarea
              className="w-full rounded-md border bg-background p-2"
              placeholder="Observaciones"
              value={form.observations}
              onChange={event => setForm({ ...form, observations: event.target.value })}
            />
            <Button className="w-full">Registrar retiro</Button>
          </fieldset>
        </form>

        <article className="overflow-hidden rounded-xl border">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold">Historial de retiros · {selectedPeriodOption.label}</h2>
              <p className="text-xs text-muted-foreground">Los retiros anulados se conservan y aparecen en los reportes del período.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!periodReady}
                onClick={() => exportOwnerFinancePdf(workspace.withdrawals, displayedDashboard, reportPeriod, createReportContext())}
                className="gap-1"
              >
                <Download className="h-4 w-4" /> PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!periodReady}
                onClick={() => exportOwnerFinanceExcel(workspace.withdrawals, displayedDashboard, reportPeriod, createReportContext())}
              >
                Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!periodReady}
                onClick={() => exportOwnerFinanceCsv(workspace.withdrawals, displayedDashboard, reportPeriod, createReportContext())}
              >
                CSV
              </Button>
            </div>
          </div>
          <div className="grid gap-2 border-b p-3 md:grid-cols-3">
            <input
              type="date"
              min={ownerFinancePeriodDateRange(selectedPeriod).from}
              max={ownerFinancePeriodDateRange(selectedPeriod).to}
              className="rounded border bg-background p-2"
              value={filters.from || ''}
              onChange={event => setFilters({ ...filters, from: event.target.value || undefined })}
            />
            <input
              type="date"
              min={ownerFinancePeriodDateRange(selectedPeriod).from}
              max={ownerFinancePeriodDateRange(selectedPeriod).to}
              className="rounded border bg-background p-2"
              value={filters.to || ''}
              onChange={event => setFilters({ ...filters, to: event.target.value || undefined })}
            />
            <select
              className="rounded border bg-background p-2"
              value={filters.conceptId || ''}
              onChange={event => setFilters({ ...filters, conceptId: event.target.value || undefined })}
            >
              <option value="">Todos los conceptos</option>
              {workspace.concepts.map(concept => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-3">Fecha</th>
                  <th>Hora</th>
                  <th>Usuario</th>
                  <th>Concepto</th>
                  <th>Valor</th>
                  <th>Caja</th>
                  <th>Método</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workspace.withdrawals.map(item => (
                  <tr key={item.id} className={`border-b ${item.status === 'ANULADO' ? 'bg-secondary/20 text-muted-foreground' : ''}`}>
                    <td className="p-3">{new Date(item.withdrawalDate).toLocaleDateString('es-CO')}</td>
                    <td>{new Date(item.withdrawalDate).toLocaleTimeString('es-CO')}</td>
                    <td>{item.userName}</td>
                    <td>{item.conceptName}</td>
                    <td>{currency.format(item.amount)}</td>
                    <td>{item.accountName}</td>
                    <td>{item.paymentMethod}</td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          item.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                        title={item.cancellationReason || undefined}
                      >
                        {item.status === 'ACTIVE' ? 'Activo' : 'Anulado'}
                      </span>
                    </td>
                    <td className="pr-3">
                      {item.status === 'ACTIVE' && !periodClosed && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-700 hover:text-red-800"
                          disabled={cancellingWithdrawalId === item.id}
                          onClick={() => openWithdrawalCancellationDialog(item.id)}
                        >
                          {cancellingWithdrawalId === item.id ? 'Anulando…' : 'Anular retiro'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !workspace.withdrawals.length && (
              <div className="p-8 text-center text-muted-foreground">No hay retiros para el período y filtros seleccionados.</div>
            )}
          </div>
        </article>
      </section>

      <Dialog
        open={periodCloseDialogOpen}
        onOpenChange={open => {
          if (!changingPeriodStatus) setPeriodCloseDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              ¿Desea cerrar el período {selectedPeriodOption.label}?
            </DialogTitle>
            <DialogDescription>
              El cierre conserva toda la información y puede revertirse posteriormente mediante la reapertura del período.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">Después del cierre:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>No será posible registrar nuevos retiros.</li>
              <li>No será posible anular retiros.</li>
              <li>La información continuará disponible para consulta y exportación.</li>
              <li>Solo podrá modificarse nuevamente si el período es reabierto.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={changingPeriodStatus}
              onClick={() => setPeriodCloseDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={changingPeriodStatus}
              onClick={() => void confirmPeriodClose()}
            >
              {changingPeriodStatus ? 'Cerrando…' : 'Confirmar cierre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingCancellationWithdrawalId)}
        onOpenChange={open => {
          if (!open) closeWithdrawalCancellationDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Anular retiro
            </DialogTitle>
            <DialogDescription>
              El retiro original se conservará como anulado, se generará el movimiento reverso y el saldo regresará a la cuenta correspondiente.
            </DialogDescription>
          </DialogHeader>

          {pendingCancellationWithdrawal && (
            <div className="rounded-lg bg-secondary/40 p-3 text-sm" aria-label="Retiro seleccionado para anular">
              <p><span className="font-medium">Concepto:</span> {pendingCancellationWithdrawal.conceptName}</p>
              <p><span className="font-medium">Valor:</span> {currency.format(pendingCancellationWithdrawal.amount)}</p>
              <p><span className="font-medium">Fecha:</span> {new Date(pendingCancellationWithdrawal.withdrawalDate).toLocaleString('es-CO')}</p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="owner-withdrawal-cancellation-reason" className="text-sm font-medium">
              Motivo de anulación
            </label>
            <Textarea
              id="owner-withdrawal-cancellation-reason"
              autoFocus
              value={cancellationReason}
              disabled={Boolean(cancellingWithdrawalId)}
              onChange={event => {
                setCancellationReason(event.target.value);
                if (cancellationDialogError) setCancellationDialogError('');
              }}
              placeholder="Explique por qué se anula este retiro"
            />
            {cancellationDialogError && (
              <p className="text-sm text-destructive" role="alert">{cancellationDialogError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(cancellingWithdrawalId)}
              onClick={closeWithdrawalCancellationDialog}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={Boolean(cancellingWithdrawalId) || !cancellationReason.trim()}
              onClick={() => void confirmWithdrawalCancellation()}
            >
              {cancellingWithdrawalId ? 'Anulando…' : 'Confirmar anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
