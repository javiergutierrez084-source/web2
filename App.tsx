import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "@/contexts/AppContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "./components/AppLayout";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import Sales from "./pages/Sales";
import NewInvoice from "./pages/NewInvoice";
import Purchases from "./pages/Purchases";
import NewPurchase from "./pages/NewPurchase";
import Contacts from "./pages/Contacts";
import Inventory from "./pages/Inventory";
import NewProduct from "./pages/NewProduct";
import InventoryAdjustments from "./pages/InventoryAdjustments";
import Quotations from "./pages/Quotations";
import NewQuotation from "./pages/NewQuotation";
import Reports from "./pages/Reports";
import CashRegister from "./pages/CashRegister";
import AccountsPayable from "./pages/AccountsPayable";
import NotFound from "./pages/NotFound";
import LanConfigurationPage from "./pages/LanConfigurationPage";
import OnlineServerPage from "./pages/OnlineServerPage";
import AccessDenied from "./pages/AccessDenied";
import MasterOnlyRoute from "./components/MasterOnlyRoute";
import LanAuthenticationBridge from "./components/LanAuthenticationBridge";
import HttpsAuthenticationBridge from "./components/HttpsAuthenticationBridge";
import OnlineRepositoryServerBridge from "./components/OnlineRepositoryServerBridge";
import BackupAutomationBridge from "./components/BackupAutomationBridge";
import SecureCloseBridge from "./components/SecureCloseBridge";
import LayawayAlertBridge from "./components/LayawayAlertBridge";
import LanClientConnectionService from "./components/LanClientConnectionService";
import LanRepositoryChangePublisher from "./components/LanRepositoryChangePublisher";
import LanBootstrapProvider from "./components/LanBootstrapProvider";
import OnlineBootstrapProvider from "./components/OnlineBootstrapProvider";
import LanConnectionStateProvider from "./contexts/LanConnectionStateContext";
import { WorkModeProvider, useWorkMode } from "./contexts/WorkModeContext";
import WorkModeStartupBoundary from "./components/WorkModeStartupBoundary";
import { hasRouteAccess } from "./lib/auth";
import { getRolePermissions } from "./lib/authCore";
import { getOnlineServerStorageRepository } from "./repositories/OnlineServerStorageRepository";
import type { UserRole } from "./domain/models";
import AppErrorBoundary from "./components/AppErrorBoundary";

const queryClient = new QueryClient();

const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const BackupRestore = lazy(() => import("./pages/BackupRestore"));
const OwnerFinances = lazy(() => import("./pages/OwnerFinances"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));

const RouteLoadingFallback = () => (
  <div className="flex min-h-[45vh] items-center justify-center" aria-label="Cargando pantalla">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

type HttpsReadRequest = {
  requestId: string;
  resource: string;
  args?: Record<string, unknown>;
};

type HttpsReadBridge = NonNullable<Window['joyaControlHttps']> & {
  onReadRequest?: (handler: (request: HttpsReadRequest) => Promise<unknown>) => () => void;
};

function normalizeContactSearch(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeProductSearch(value: unknown): string {
  return normalizeContactSearch(value);
}

async function readOnlineInventory() {
  const repository = getOnlineServerStorageRepository();
  const [products, adjustments] = await Promise.all([
    repository.fetchProducts(),
    repository.fetchInventoryAdjustments(),
  ]);
  const latestByProduct = new Map<string, (typeof adjustments)[number]>();

  for (const adjustment of adjustments) {
    const current = latestByProduct.get(adjustment.productId);
    const currentTime = current ? Date.parse(current.date || current.createdAt || '') : Number.NEGATIVE_INFINITY;
    const candidateTime = Date.parse(adjustment.date || adjustment.createdAt || '');
    if (!current || (Number.isFinite(candidateTime) && candidateTime > currentTime)) {
      latestByProduct.set(adjustment.productId, adjustment);
    }
  }

  return products.map(product => {
    const lastMovement = latestByProduct.get(product.id);
    const productWithLocation = product as typeof product & { location?: unknown };
    return {
      product,
      location: String(productWithLocation.location || '').trim(),
      lastMovement: lastMovement
        ? { date: lastMovement.date || lastMovement.createdAt, type: lastMovement.type }
        : null,
    };
  });
}

export const HttpsReadOnlyServerBridge = () => {
  useEffect(() => {
    const bridge = window.joyaControlHttps as HttpsReadBridge | undefined;
    const dispose = bridge?.onReadRequest?.(async request => {
      if (request.resource === 'company') {
        return getOnlineServerStorageRepository().fetchCompany();
      }
      if (request.resource === 'permissions') {
        const role = String(request.args?.role || '') as UserRole;
        return getRolePermissions(role);
      }
      if (request.resource === 'contacts') {
        return getOnlineServerStorageRepository().fetchContacts();
      }
      if (request.resource === 'contact') {
        const id = String(request.args?.id || '').trim();
        if (!id) throw new Error('HTTPS_CONTACT_ID_INVALID');
        const contacts = await getOnlineServerStorageRepository().fetchContacts();
        return contacts.find(contact => contact.id === id) || null;
      }
      if (request.resource === 'contactsSearch') {
        const query = normalizeContactSearch(request.args?.query);
        if (!query) throw new Error('HTTPS_CONTACT_SEARCH_INVALID');
        const contacts = await getOnlineServerStorageRepository().fetchContacts();
        return contacts.filter(contact => {
          const typeLabel = contact.type === 'supplier' ? 'proveedor' : 'cliente';
          return [
            contact.name,
            contact.document,
            contact.phone,
            contact.email,
            contact.address,
            typeLabel,
          ].some(value => normalizeContactSearch(value).includes(query));
        });
      }
      if (request.resource === 'products') {
        return getOnlineServerStorageRepository().fetchProducts();
      }
      if (request.resource === 'product') {
        const id = String(request.args?.id || '').trim();
        if (!id) throw new Error('HTTPS_PRODUCT_ID_INVALID');
        const products = await getOnlineServerStorageRepository().fetchProducts();
        return products.find(product => product.id === id) || null;
      }
      if (request.resource === 'productsSearch') {
        const query = normalizeProductSearch(request.args?.query);
        if (!query) throw new Error('HTTPS_PRODUCT_SEARCH_INVALID');
        const products = await getOnlineServerStorageRepository().fetchProducts();
        return products.filter(product => [
          product.code,
          product.name,
          product.category,
          product.reference,
          product.description,
        ].some(value => normalizeProductSearch(value).includes(query)));
      }
      if (request.resource === 'inventory') {
        return readOnlineInventory();
      }
      if (request.resource === 'inventoryItem') {
        const id = String(request.args?.id || '').trim();
        if (!id) throw new Error('HTTPS_INVENTORY_ID_INVALID');
        const inventory = await readOnlineInventory();
        return inventory.find(item => item.product.id === id) || null;
      }
      throw new Error('HTTPS_READ_RESOURCE_NOT_ALLOWED');
    });
    return () => dispose?.();
  }, []);

  return null;
};

export const RuntimeRouter = ({ children }: { children: ReactNode }) => {
  if (window.location.protocol === "file:") {
    return <HashRouter>{children}</HashRouter>;
  }

  return <BrowserRouter>{children}</BrowserRouter>;
};

// Inner component that reads auth state
const AppRouter = () => {
  const { state, user } = useAuth();

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (state === 'setup') return <SetupPage />;
  if (state === 'login') return <LoginPage />;


  const authorizedElement = (path: string, element: ReactNode): ReactNode => (
    hasRouteAccess(user, path) ? element : <AccessDenied />
  );

  // Authenticated
  return (
    <RuntimeRouter>
      <AppProvider>
        <BackupAutomationBridge />
        <SecureCloseBridge />
        <LayawayAlertBridge />
        <LanClientConnectionService />
        <LanAuthenticationBridge />
        <LanRepositoryChangePublisher />
        <Toaster />
        <Sonner />
        <AppErrorBoundary>
          <AppLayout>
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ventas" element={authorizedElement('/ventas', <Sales />)} />
            <Route path="/ventas/nueva" element={authorizedElement('/ventas/nueva', <NewInvoice />)} />
            <Route path="/compras" element={authorizedElement('/compras', <Purchases />)} />
            <Route path="/cuentas-por-pagar/nueva" element={authorizedElement('/cuentas-por-pagar/nueva', <NewPurchase />)} />
            <Route path="/cuentas-por-pagar/editar/:id" element={authorizedElement('/cuentas-por-pagar/editar', <NewPurchase />)} />
            <Route path="/contactos" element={authorizedElement('/contactos', <Contacts />)} />
            <Route path="/inventario" element={authorizedElement('/inventario', <Inventory />)} />
            <Route path="/inventario/nuevo" element={authorizedElement('/inventario/nuevo', <NewProduct />)} />
            <Route path="/inventario/ajustes" element={authorizedElement('/inventario/ajustes', <InventoryAdjustments />)} />
            <Route path="/cotizaciones" element={authorizedElement('/cotizaciones', <Quotations />)} />
            <Route path="/cotizaciones/nueva" element={authorizedElement('/cotizaciones/nueva', <NewQuotation />)} />
            <Route path="/caja" element={authorizedElement('/caja', <CashRegister />)} />
            <Route path="/cuentas-por-pagar" element={authorizedElement('/cuentas-por-pagar', <AccountsPayable />)} />
            <Route path="/reportes" element={authorizedElement('/reportes', <Reports />)} />
            <Route path="/finanzas" element={authorizedElement('/finanzas', <OwnerFinances />)} />
            <Route path="/usuarios" element={authorizedElement('/usuarios', <UsersPage />)} />
            <Route path="/actividad" element={authorizedElement('/actividad', <ActivityPage />)} />
            <Route path="/configuracion" element={authorizedElement('/configuracion', <SettingsPage />)} />
            <Route path="/configuracion/lan" element={<MasterOnlyRoute><LanConfigurationPage /></MasterOnlyRoute>} />
            <Route path="/configuracion/servidor-online" element={<MasterOnlyRoute><OnlineServerPage /></MasterOnlyRoute>} />
            <Route path="/acceso-denegado" element={<AccessDenied />} />
            <Route path="/respaldos" element={authorizedElement('/respaldos', <BackupRestore />)} />
            <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppLayout>
        </AppErrorBoundary>
      </AppProvider>
    </RuntimeRouter>
  );
};

const WorkModeApplication = () => {
  const { effectiveMode } = useWorkMode();
  const application = (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );

  // Preserve the existing LAN bootstrap only for actual LAN clients. Local
  // installations and Principal Servers use Dexie directly and never probe a
  // remote server during application startup.
  if (effectiveMode === 'lan') {
    return <LanBootstrapProvider key="lan-client">{application}</LanBootstrapProvider>;
  }
  if (effectiveMode === 'online') {
    return <OnlineBootstrapProvider key="online-client">{application}</OnlineBootstrapProvider>;
  }
  return (
    <>
      <HttpsAuthenticationBridge />
      <HttpsReadOnlyServerBridge />
      <OnlineRepositoryServerBridge />
      {application}
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WorkModeProvider>
        <LanConnectionStateProvider>
          <WorkModeStartupBoundary>
            <WorkModeApplication />
          </WorkModeStartupBoundary>
        </LanConnectionStateProvider>
      </WorkModeProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
