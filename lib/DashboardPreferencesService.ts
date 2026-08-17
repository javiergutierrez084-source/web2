export const DASHBOARD_PREFERENCES_CHANGED_EVENT = 'joyacontrol:dashboard-preferences-changed';

export const DASHBOARD_WIDGET_CATALOG = [
  { key: 'sales.today', label: 'Ventas Hoy', category: 'Ventas', defaultVisible: true },
  { key: 'sales.week', label: 'Ventas Semana', category: 'Ventas', defaultVisible: false },
  { key: 'sales.month', label: 'Ventas Mes', category: 'Ventas', defaultVisible: true },
  { key: 'sales.ticketAverage', label: 'Ticket promedio', category: 'Ventas', defaultVisible: false },
  { key: 'sales.invoices', label: 'Facturas emitidas', category: 'Ventas', defaultVisible: true },
  { key: 'sales.productsSold', label: 'Cantidad de productos vendidos', category: 'Ventas', defaultVisible: false },

  { key: 'profit.today', label: 'Utilidad Hoy', category: 'Utilidades', defaultVisible: false },
  { key: 'profit.week', label: 'Utilidad Semana', category: 'Utilidades', defaultVisible: false },
  { key: 'profit.month', label: 'Utilidad Mes', category: 'Utilidades', defaultVisible: false },

  { key: 'cash.main', label: 'Caja Principal', category: 'Caja', defaultVisible: true },
  { key: 'cash.banksToday', label: 'Bancos Hoy', category: 'Caja', defaultVisible: true },
  { key: 'cash.totalAvailable', label: 'Total Disponible', category: 'Caja', defaultVisible: true },
  { key: 'cash.layawayReserve', label: 'Caja Separados', category: 'Caja', defaultVisible: true },

  { key: 'inventory.lowStock', label: 'Productos con poco stock', category: 'Inventario', defaultVisible: true },
  { key: 'inventory.outOfStock', label: 'Productos agotados', category: 'Inventario', defaultVisible: false },
  { key: 'inventory.topProducts', label: 'Productos más vendidos', category: 'Inventario', defaultVisible: true },
  { key: 'inventory.leastProducts', label: 'Productos menos vendidos', category: 'Inventario', defaultVisible: false },
  { key: 'inventory.value', label: 'Valor del inventario', category: 'Inventario', defaultVisible: true },
  { key: 'inventory.grams', label: 'Gramos disponibles', category: 'Inventario', defaultVisible: true },

  { key: 'customers.new', label: 'Clientes nuevos', category: 'Clientes', defaultVisible: true },
  { key: 'customers.frequent', label: 'Clientes frecuentes', category: 'Clientes', defaultVisible: false },
  { key: 'customers.top', label: 'Clientes con mayor compra', category: 'Clientes', defaultVisible: false },

  { key: 'suppliers.payables', label: 'Cuentas por pagar', category: 'Proveedores', defaultVisible: false },
  { key: 'suppliers.overdue', label: 'Facturas vencidas', category: 'Proveedores', defaultVisible: false },

  { key: 'purchases.month', label: 'Compras del mes', category: 'Compras', defaultVisible: true },
  { key: 'purchases.expensesMonth', label: 'Gastos del mes', category: 'Compras', defaultVisible: false },

  { key: 'layaways.active', label: 'Separados activos', category: 'Separados', defaultVisible: true },
  { key: 'layaways.valueRetained', label: 'Valor retenido en separados', category: 'Separados', defaultVisible: true },
  { key: 'layaways.paymentsReceived', label: 'Abonos recibidos', category: 'Separados', defaultVisible: false },
  { key: 'layaways.upcoming', label: 'Separados próximos a vencer', category: 'Separados', defaultVisible: false },
  { key: 'layaways.overdue', label: 'Separados vencidos', category: 'Separados', defaultVisible: false },
  { key: 'layaways.noRecentPayments', label: 'Separados sin abonos recientes', category: 'Separados', defaultVisible: false },
  { key: 'layaways.alerts', label: 'Alertas de separados', category: 'Separados', defaultVisible: true },

  { key: 'finance.cashFlow', label: 'Flujo de caja', category: 'Indicadores financieros', defaultVisible: false },
  { key: 'finance.incomeExpense', label: 'Balance ingresos/egresos', category: 'Indicadores financieros', defaultVisible: false },
  { key: 'finance.profitability', label: 'Rentabilidad', category: 'Indicadores financieros', defaultVisible: false },
  { key: 'finance.availableCapital', label: 'Capital disponible', category: 'Indicadores financieros', defaultVisible: false },

  { key: 'charts.salesDay', label: 'Ventas por día', category: 'Gráficos', defaultVisible: true },
  { key: 'charts.salesMonth', label: 'Ventas por mes', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.profitMonth', label: 'Utilidad por mes', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.paymentMethods', label: 'Formas de pago', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.clientsTop', label: 'Clientes Top 10', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.productsTop', label: 'Productos Top 10', category: 'Gráficos', defaultVisible: true },
  { key: 'charts.categoriesTop', label: 'Categorías más vendidas', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.purchasesVsSales', label: 'Compras vs ventas', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.incomeVsExpenses', label: 'Ingresos vs egresos', category: 'Gráficos', defaultVisible: false },
  { key: 'charts.cashEvolution', label: 'Evolución de caja', category: 'Gráficos', defaultVisible: false },
] as const;

export type DashboardWidgetKey = typeof DASHBOARD_WIDGET_CATALOG[number]['key'];
export type DashboardWidgetCategory = typeof DASHBOARD_WIDGET_CATALOG[number]['category'];

export interface DashboardPreferences {
  visible: Record<DashboardWidgetKey, boolean>;
  order: DashboardWidgetKey[];
  updatedAt: string;
}

const STORAGE_PREFIX = 'joyacontrol_dashboard_preferences_v34';

const storageKey = (userId: string): string => `${STORAGE_PREFIX}:${userId || 'default'}`;

export const createDefaultDashboardPreferences = (): DashboardPreferences => ({
  visible: DASHBOARD_WIDGET_CATALOG.reduce((result, widget) => {
    result[widget.key] = widget.defaultVisible;
    return result;
  }, {} as Record<DashboardWidgetKey, boolean>),
  order: DASHBOARD_WIDGET_CATALOG.map(widget => widget.key),
  updatedAt: new Date().toISOString(),
});

const normalizePreferences = (value: unknown): DashboardPreferences => {
  const defaults = createDefaultDashboardPreferences();
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<DashboardPreferences>;
  const visibleCandidate = candidate.visible && typeof candidate.visible === 'object'
    ? candidate.visible as Partial<Record<DashboardWidgetKey, boolean>>
    : {};
  const visible = { ...defaults.visible };
  DASHBOARD_WIDGET_CATALOG.forEach(widget => {
    if (typeof visibleCandidate[widget.key] === 'boolean') visible[widget.key] = visibleCandidate[widget.key] as boolean;
  });

  const validKeys = new Set<DashboardWidgetKey>(DASHBOARD_WIDGET_CATALOG.map(widget => widget.key));
  const requestedOrder = Array.isArray(candidate.order)
    ? candidate.order.filter((key): key is DashboardWidgetKey => validKeys.has(key as DashboardWidgetKey))
    : [];
  const missing = defaults.order.filter(key => !requestedOrder.includes(key));

  return {
    visible,
    order: [...requestedOrder, ...missing],
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : defaults.updatedAt,
  };
};

export const loadDashboardPreferences = (userId: string): DashboardPreferences => {
  if (typeof window === 'undefined') return createDefaultDashboardPreferences();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? normalizePreferences(JSON.parse(raw)) : createDefaultDashboardPreferences();
  } catch {
    return createDefaultDashboardPreferences();
  }
};

export const saveDashboardPreferences = (userId: string, preferences: DashboardPreferences): DashboardPreferences => {
  const normalized = normalizePreferences({ ...preferences, updatedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(DASHBOARD_PREFERENCES_CHANGED_EVENT, {
      detail: { userId, preferences: normalized },
    }));
  }
  return normalized;
};

export const resetDashboardPreferences = (userId: string): DashboardPreferences => {
  const defaults = createDefaultDashboardPreferences();
  return saveDashboardPreferences(userId, defaults);
};

export const dashboardWidgetsByCategory = (): Array<{
  category: DashboardWidgetCategory;
  widgets: typeof DASHBOARD_WIDGET_CATALOG[number][];
}> => {
  const categories = Array.from(new Set(DASHBOARD_WIDGET_CATALOG.map(widget => widget.category)));
  return categories.map(category => ({
    category,
    widgets: DASHBOARD_WIDGET_CATALOG.filter(widget => widget.category === category),
  }));
};
