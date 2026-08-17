import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Box,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Landmark,
  Package,
  PackagePlus,
  ReceiptText,
  RefreshCcw,
  ShoppingBag,
  ShoppingCart,
  Settings2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/data/mockData';
import {
  type DashboardAlert,
  type DashboardSalesMetric,
  type DashboardSnapshot,
  type DashboardSnapshotInput,
} from '@/lib/DashboardMetricsService';
import { DashboardRepositoryService } from '@/lib/DashboardRepositoryService';
import { hasRouteAccess } from '@/lib/authCore';
import { getActiveRepositoryMode } from '@/repositories/RepositoryRegistry';
import { cn, formatShortDate, formatWeight } from '@/lib/utils';
import { calculateActiveLayawayBankFunds } from '@/lib/LayawayBankAccountingService';
import { Badge } from '@/components/ui/badge';
import BackupStatusIndicator from '@/components/BackupStatusIndicator';
import DashboardConfigurationPanel from '@/components/DashboardConfigurationPanel';
import DashboardWidgetGrid from '@/components/DashboardWidgetGrid';
import { useDashboardPreferences } from '@/hooks/useDashboardPreferences';
import { buildDashboardVisualMetrics } from '@/lib/DashboardVisualMetricsService';
import {
  LAYAWAY_ALERTS_CHANGED_EVENT,
  buildLayawayAlertSummary,
  ensureLayawayDeadlines,
  loadLayawayDeadlineRegistry,
} from '@/lib/LayawayAlertService';
import { fetchSupplierInvoices } from '@/lib/database';
import type { SupplierInvoiceView } from '@/domain/models';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type IconComponent = ComponentType<{ className?: string }>;

interface MetricCardProps {
  title: string;
  value: string;
  icon: IconComponent;
  accent?: boolean;
  rows: Array<{ label: string; value: string }>;
  actionHref?: string;
  actionLabel?: string;
  description?: string;
}

const MetricCard = ({
  title,
  value,
  icon: Icon,
  accent = false,
  rows,
  actionHref,
  actionLabel = 'Ver composición',
  description,
}: MetricCardProps) => (
  <Card className={cn(
    'group relative overflow-hidden border-border/80 bg-card/95 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5',
    accent && 'border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card',
  )}>
    <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-primary/5 blur-2xl" />
    <CardContent className="relative p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div>
          {description ? (
            <UiTooltip>
              <TooltipTrigger asChild>
                <p
                  className="cursor-help text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  tabIndex={0}
                  aria-label={`${title}. ${description}`}
                >
                  {title}
                </p>
              </TooltipTrigger>
              <TooltipContent>{description}</TooltipContent>
            </UiTooltip>
          ) : (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
          )}
          <p className={cn('mt-1 text-2xl font-bold tracking-tight', accent && 'gold-text')}>{value}</p>
        </div>
        <div className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/70',
          accent && 'gold-gradient border-transparent shadow-md shadow-primary/10',
        )}>
          <Icon className={cn('h-[18px] w-[18px] text-muted-foreground', accent && 'text-primary-foreground')} />
        </div>
      </div>
      <div className="space-y-1.5 border-t border-border/70 pt-2.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-semibold text-foreground">{row.value}</span>
          </div>
        ))}
        {actionHref && (
          <Button asChild variant="ghost" size="sm" className="mt-0.5 h-7 w-full justify-between px-0 text-xs text-primary hover:bg-transparent hover:text-primary/80">
            <Link to={actionHref}>
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);

const SalesCard = ({ title, metric, icon, accent }: {
  title: string;
  metric: DashboardSalesMetric;
  icon: IconComponent;
  accent?: boolean;
}) => (
  <MetricCard
    title={title}
    value={formatCurrency(metric.value)}
    icon={icon}
    accent={accent}
    rows={[
      { label: 'Documentos netos', value: metric.count.toLocaleString('es-CO') },
      { label: 'Fuente', value: 'Facturas válidas' },
    ]}
  />
);


const formatLedgerTimestamp = (value: string | null): string => {
  if (!value) return 'Sin movimientos';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed);
};

const alertClasses: Record<DashboardAlert['tone'], string> = {
  critical: 'border-destructive/25 bg-destructive/8 text-destructive',
  warning: 'border-warning/25 bg-warning/8 text-warning',
  info: 'border-primary/20 bg-primary/8 text-primary',
};

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DashboardSkeleton = () => (
  <div className="space-y-4" aria-label="Cargando Dashboard">
    <div className="flex justify-between gap-4">
      <div className="space-y-2"><Skeleton className="h-8 w-52" /><Skeleton className="h-4 w-72" /></div>
      <Skeleton className="h-9 w-32" />
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" />
    </div>
  </div>
);

const Dashboard = () => {
  const {
    products,
    contacts,
    invoices,
    purchaseInvoices,
    expenses,
    layaways,
    cashSessions,
    financialAccounts,
    financialMovements,
    financialSummary,
    isLoading,
  } = useApp();
  const { user } = useAuth();
  const repositoryMode = getActiveRepositoryMode();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [remoteRefreshVersion, setRemoteRefreshVersion] = useState(0);
  const [dashboardDayKey] = useState(() => localDateKey(new Date()));
  const requestIdRef = useRef(0);
  const snapshotRef = useRef<DashboardSnapshot | null>(null);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoiceView[]>([]);
  const [layawayDeadlineRegistry, setLayawayDeadlineRegistry] = useState(() => loadLayawayDeadlineRegistry());
  const { preferences, updatePreferences } = useDashboardPreferences(user?.id || 'default');

  useEffect(() => {
    let active = true;
    fetchSupplierInvoices()
      .then(rows => { if (active) setSupplierInvoices(rows); })
      .catch(error => console.error('No se pudieron cargar las cuentas por pagar del Dashboard.', error));
    return () => { active = false; };
  }, [remoteRefreshVersion]);

  useEffect(() => {
    const synchronizeLayawayAlerts = () => setLayawayDeadlineRegistry(ensureLayawayDeadlines(layaways));
    synchronizeLayawayAlerts();
    window.addEventListener(LAYAWAY_ALERTS_CHANGED_EVENT, synchronizeLayawayAlerts);
    return () => window.removeEventListener(LAYAWAY_ALERTS_CHANGED_EVENT, synchronizeLayawayAlerts);
  }, [layaways]);

  const dashboardDate = useMemo(
    () => new Date(`${dashboardDayKey}T12:00:00`),
    [dashboardDayKey],
  );

  const dashboardSource = useMemo<DashboardSnapshotInput>(() => ({
    products,
    contacts,
    invoices,
    purchases: purchaseInvoices,
    expenses,
    layaways,
    cashSessions,
    accounts: financialAccounts,
    movements: financialMovements,
    financialSummary,
    now: dashboardDate,
  }), [
    products,
    contacts,
    invoices,
    purchaseInvoices,
    expenses,
    layaways,
    cashSessions,
    financialAccounts,
    financialMovements,
    financialSummary,
    dashboardDate,
  ]);

  const activeLayawayBankFunds = useMemo(
    () => calculateActiveLayawayBankFunds(financialAccounts, layaways).total,
    [financialAccounts, layaways],
  );

  const loadDashboardMetrics = useCallback(async (source?: DashboardSnapshotInput) => {
    const requestId = ++requestIdRef.current;
    if (!snapshotRef.current) setDashboardLoading(true);
    try {
      const nextSnapshot = await DashboardRepositoryService.getDashboardMetrics(source);
      if (requestId !== requestIdRef.current) return;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    } catch (error) {
      // Keep the last successful snapshot visible during temporary LAN outages.
      console.error('No se pudieron cargar las métricas del Dashboard.', error);
    } finally {
      if (requestId === requestIdRef.current) setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (repositoryMode !== 'lan') return undefined;
    const handleRepositorySynchronized = () => {
      setRemoteRefreshVersion(version => version + 1);
    };
    window.addEventListener('joyacontrol:lan-repository-synchronized', handleRepositorySynchronized);
    return () => {
      window.removeEventListener('joyacontrol:lan-repository-synchronized', handleRepositorySynchronized);
    };
  }, [repositoryMode]);

  useEffect(() => {
    if (isLoading || repositoryMode === 'lan') return;
    void loadDashboardMetrics(dashboardSource);
  }, [dashboardSource, isLoading, loadDashboardMetrics, repositoryMode]);

  useEffect(() => {
    if (isLoading || repositoryMode !== 'lan') return;
    void loadDashboardMetrics();
  }, [dashboardDayKey, isLoading, loadDashboardMetrics, remoteRefreshVersion, repositoryMode]);

  const layawayAlertSummary = useMemo(
    () => buildLayawayAlertSummary(layaways, layawayDeadlineRegistry, dashboardDate),
    [dashboardDate, layawayDeadlineRegistry, layaways],
  );

  const visualMetrics = useMemo(() => {
    if (!snapshot) return null;
    return buildDashboardVisualMetrics({
      now: dashboardDate,
      snapshot,
      products,
      contacts,
      invoices,
      purchases: purchaseInvoices,
      expenses,
      movements: financialMovements,
      financialSummary,
      supplierInvoices,
      layawaySummary: layawayAlertSummary,
    });
  }, [
    contacts, dashboardDate, expenses, financialMovements, financialSummary, invoices,
    layawayAlertSummary, products, purchaseInvoices, snapshot, supplierInvoices,
  ]);

  const quickActions = useMemo(() => [
    { label: 'Nueva Venta', description: 'Crear factura', href: '/ventas/nueva', icon: ReceiptText },
    { label: 'Nuevo Producto', description: 'Agregar inventario', href: '/inventario/nuevo', icon: PackagePlus },
    { label: 'Nuevo Cliente', description: 'Abrir contactos', href: '/contactos', icon: UserPlus },
    { label: 'Nuevo Separado', description: 'Crear separado', href: '/ventas/nueva', icon: ShoppingBag },
    { label: 'Caja', description: 'Abrir o consultar', href: '/caja', icon: Wallet },
  ].filter(action => hasRouteAccess(user, action.href)), [user]);

  if (isLoading || (dashboardLoading && !snapshot)) return <DashboardSkeleton />;
  if (!snapshot || !visualMetrics) return <DashboardSkeleton />;

  const displayedLayawayBankFunds = repositoryMode === 'lan'
    ? Number(snapshot.financialPosition.layawayBankFunds || 0)
    : activeLayawayBankFunds;

  const todayLabel = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(dashboardDate);

  const chartTooltipStyle = {
    backgroundColor: 'hsl(220 18% 13%)',
    border: '1px solid hsl(220 14% 18%)',
    borderRadius: '10px',
    color: 'hsl(40 20% 92%)',
    fontSize: '12px',
  };

  return (
    <div className="space-y-4 pb-3">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/25 bg-primary/5 text-primary">
              Centro de control
            </Badge>
            <Badge variant="secondary" className="font-medium">
              {repositoryMode === 'lan' ? 'Cliente LAN' : 'Datos locales'}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Hola, {user?.displayName?.split(' ')[0] || 'bienvenido'}
          </h1>
          <p className="mt-0.5 text-sm capitalize text-muted-foreground">{todayLabel}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[520px]">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground">
            <RefreshCcw className="h-3.5 w-3.5 text-success" />
            <span>Información actualizada desde el Repository activo</span>
          </div>
          <BackupStatusIndicator />
          <Button type="button" variant="outline" className="gap-2 sm:col-span-2" onClick={() => setConfigurationOpen(true)}>
            <Settings2 className="h-4 w-4" /> Configurar Dashboard
          </Button>
        </div>
      </header>

      <section aria-labelledby="quick-actions-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="quick-actions-title" className="text-sm font-semibold">Accesos rápidos</h2>
          <span className="text-xs text-muted-foreground">Operaciones frecuentes</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {quickActions.map(action => (
            <Button key={action.label} asChild variant="outline" className="h-auto justify-start gap-2.5 border-border bg-card px-3 py-2.5 hover:border-primary/35 hover:bg-primary/5">
              <Link to={action.href}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <action.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block break-words text-xs font-semibold leading-tight">{action.label}</span>
                  <span className="block break-words text-[10px] font-normal leading-tight text-muted-foreground">{action.description}</span>
                </span>
              </Link>
            </Button>
          ))}
        </div>
      </section>

      <DashboardWidgetGrid
        preferences={preferences}
        snapshot={snapshot}
        metrics={visualMetrics}
        layawayBankFunds={displayedLayawayBankFunds}
      />

      <section className="grid items-start gap-3 xl:grid-cols-2" aria-label="Actividad reciente y alertas generales">
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 pb-2 pt-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-warning" /> Alertas generales</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Situaciones detectadas en datos existentes</p>
            </div>
            {snapshot.alerts.length > 0 && <Badge variant="destructive">{snapshot.alerts.length}</Badge>}
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {snapshot.alerts.length === 0 ? (
              <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-4 py-3 text-center">
                <Box className="mb-1.5 h-6 w-6 text-success" /><p className="text-sm font-semibold">Todo bajo control</p>
              </div>
            ) : (
              <div className="space-y-2">
                {snapshot.alerts.map(alert => (
                  <Link key={alert.id} to={alert.href} className={cn('group flex items-start gap-2.5 rounded-xl border p-2.5 transition-colors hover:bg-secondary/50', alertClasses[alert.tone])}>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-foreground">{alert.title}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{alert.description}</span></span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 pb-2 pt-4">
            <div><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" /> Últimas ventas</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">Últimos 10 registros pagados</p></div>
            <Button asChild size="sm" variant="ghost" className="h-8 text-xs"><Link to="/ventas">Ver ventas <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {snapshot.recentSales.length === 0 ? <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">Aún no hay ventas registradas.</div> : (
              <Table><TableHeader><TableRow><TableHead>Factura</TableHead><TableHead>Cliente</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader><TableBody>{snapshot.recentSales.map(invoice => <TableRow key={invoice.id}><TableCell className="font-medium text-primary">{invoice.number}</TableCell><TableCell>{invoice.clientName || 'Consumidor final'}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatShortDate(invoice.date)}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(invoice.total)}</TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </section>

      <DashboardConfigurationPanel
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
        preferences={preferences}
        onSave={updatePreferences}
      />

    </div>
  );
};

export default Dashboard;
