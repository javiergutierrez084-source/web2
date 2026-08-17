import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Building2,
  Clock3,
  Globe2,
  Loader2,
  LockKeyhole,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/data/mockData';
import {
  clearOnlineServerSelection,
  loadOnlineServerSelection,
  saveOnlineServerSelection,
  type OnlineServerSelection,
} from '@/lib/OnlineServerConfig';
import {
  OnlineRepositoryReadError,
  OnlineRepositoryReader,
  type OnlineRepositorySnapshot,
} from '@/lib/OnlineRepositoryReader';
import {
  OnlineContactsRepository,
  type OnlineContact,
  type OnlineContactsSnapshot,
} from '@/lib/OnlineContactsRepository';
import {
  OnlineProductsRepository,
  type OnlineInventoryItem,
  type OnlineInventorySnapshot,
  type OnlineProduct,
  type OnlineProductsSnapshot,
  type OnlineStockStatus,
} from '@/lib/OnlineProductsRepository';
import {
  clearOnlineServerSession,
  HTTPS_CLIENT_VERSION,
  isOnlineServerSessionExpired,
  loadOnlineServerSession,
  saveOnlineServerSession,
  shouldClearOnlineServerSession,
  type OnlineServerSession,
} from '@/lib/OnlineServerSession';

const CONNECTION_ERROR_MESSAGES: Record<string, string> = {
  HTTPS_SERVER_NOT_FOUND: 'Servidor apagado o no encontrado. Verifique la URL, el puerto y la conexión a Internet.',
  HTTPS_TLS_INVALID: 'TLS inválido. El destino no está aceptando HTTPS correctamente en ese puerto.',
  HTTPS_CERTIFICATE_INVALID: 'Certificado inválido. Revise su vigencia, dominio y cadena de confianza.',
  HTTPS_TIMEOUT: 'Timeout. El servidor no respondió dentro del tiempo permitido.',
  HTTPS_VERSION_INCOMPATIBLE: 'Versión incompatible. El Cliente y el Servidor deben utilizar una versión HTTPS compatible.',
  HTTPS_URL_INVALID: 'La URL o el puerto del servidor no son válidos.',
  HTTPS_RESPONSE_INVALID: 'La respuesta recibida no corresponde a un servidor JoyaControl HTTPS válido.',
  HTTPS_SERVER_MISMATCH: 'Servidor incorrecto. La identidad recibida no coincide con el servidor guardado.',
  HTTPS_USER_NOT_FOUND: 'Usuario inexistente.',
  HTTPS_PASSWORD_INCORRECT: 'Contraseña incorrecta.',
  HTTPS_USER_DISABLED: 'Usuario desactivado. Contacte al administrador.',
  HTTPS_SESSION_REQUIRED: 'La sesión HTTPS es obligatoria.',
  HTTPS_SESSION_INVALID: 'La sesión HTTPS ya no es válida. Inicie sesión nuevamente.',
  HTTPS_SESSION_EXPIRED: 'La sesión HTTPS expiró. Inicie sesión nuevamente.',
  HTTPS_AUTH_PROVIDER_UNAVAILABLE: 'El servidor no pudo validar el usuario en este momento.',
  HTTPS_AUTH_RESPONSE_INVALID: 'El sistema de usuarios devolvió una respuesta incompleta.',
  HTTPS_LOGIN_FIELDS_REQUIRED: 'Usuario, contraseña y versión cliente son obligatorios.',
  HTTPS_READ_PROVIDER_UNAVAILABLE: 'El servidor no pudo consultar la información protegida en este momento.',
  HTTPS_COMPANY_RESPONSE_INVALID: 'La información de la empresa devuelta por el servidor no es válida.',
  HTTPS_CLIENT_UNAVAILABLE: 'La lectura HTTPS está disponible únicamente en la aplicación de escritorio.',
  HTTPS_CONTACT_NOT_FOUND: 'El contacto remoto solicitado no existe.',
  HTTPS_CONTACT_ID_INVALID: 'El identificador del contacto no es válido.',
  HTTPS_CONTACT_SEARCH_INVALID: 'Escriba un texto válido para buscar contactos.',
  HTTPS_CONTACT_RESPONSE_INVALID: 'El servidor devolvió un contacto incompleto.',
  HTTPS_CONTACTS_RESPONSE_INVALID: 'El servidor devolvió una colección de contactos incompleta.',
  HTTPS_PRODUCT_NOT_FOUND: 'El producto remoto solicitado no existe.',
  HTTPS_PRODUCT_ID_INVALID: 'El identificador del producto no es válido.',
  HTTPS_PRODUCT_SEARCH_INVALID: 'Escriba un texto válido para buscar productos.',
  HTTPS_PRODUCT_RESPONSE_INVALID: 'El servidor devolvió un producto incompleto.',
  HTTPS_PRODUCTS_RESPONSE_INVALID: 'El servidor devolvió una colección de productos incompleta.',
  HTTPS_INVENTORY_NOT_FOUND: 'La referencia de inventario solicitada no existe.',
  HTTPS_INVENTORY_ID_INVALID: 'El identificador de inventario no es válido.',
  HTTPS_INVENTORY_RESPONSE_INVALID: 'El servidor devolvió información de inventario incompleta.',
};

function errorMessage(code: string, fallback?: string): string {
  return CONNECTION_ERROR_MESSAGES[code] || fallback || 'No fue posible conectar con el servidor HTTPS.';
}

function savedForm(selection: OnlineServerSelection | null): { url: string; port: string } {
  return selection
    ? { url: selection.url, port: String(selection.port) }
    : { url: '', port: '' };
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    master: 'Maestro',
    admin: 'Administrador',
    vendedor: 'Vendedor',
    cajero: 'Cajero',
  };
  return labels[role] || role;
}

function sessionFromLogin(
  result: HttpsServerLoginSuccess,
  server: OnlineServerSelection,
): OnlineServerSession {
  return saveOnlineServerSession({
    sessionId: result.session.sessionId,
    serverId: result.session.serverId,
    username: result.session.usuario,
    displayName: result.session.nombre,
    role: result.session.rol,
    createdAt: result.session.fecha,
    expiresAt: result.session.expiracion,
    version: result.session.version,
    url: server.url,
    port: server.port,
    baseUrl: server.baseUrl,
    savedAt: new Date().toISOString(),
  });
}

function readableDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Sin comunicación';
}

function stockStatusLabel(status: OnlineStockStatus): string {
  if (status === 'out_of_stock') return 'Agotado';
  if (status === 'low_stock') return 'Stock bajo';
  return 'Disponible';
}

function stockStatusClass(status: OnlineStockStatus): string {
  if (status === 'out_of_stock') return 'border-destructive/40 text-destructive';
  if (status === 'low_stock') return 'border-amber-500/40 text-amber-600';
  return 'border-emerald-500/40 text-emerald-600';
}

const OnlineServerPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [savedServer, setSavedServer] = useState<OnlineServerSelection | null>(() => loadOnlineServerSelection());
  const initialForm = savedForm(savedServer);
  const [url, setUrl] = useState(initialForm.url);
  const [port, setPort] = useState(initialForm.port);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<HttpsServerConnectionSuccess | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [loadingRemoteData, setLoadingRemoteData] = useState(false);
  const [onlineSession, setOnlineSession] = useState<OnlineServerSession | null>(() => loadOnlineServerSession());
  const [sessionVerified, setSessionVerified] = useState(false);
  const [remoteSnapshot, setRemoteSnapshot] = useState<OnlineRepositorySnapshot | null>(null);
  const [contactsSnapshot, setContactsSnapshot] = useState<OnlineContactsSnapshot | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<OnlineContact[] | null>(null);
  const [selectedContact, setSelectedContact] = useState<OnlineContact | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [productsSnapshot, setProductsSnapshot] = useState<OnlineProductsSnapshot | null>(null);
  const [inventorySnapshot, setInventorySnapshot] = useState<OnlineInventorySnapshot | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<OnlineProduct[] | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<OnlineProduct | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<OnlineInventoryItem | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const reader = useMemo(() => {
    if (!savedServer || !onlineSession) return null;
    return new OnlineRepositoryReader({
      url: savedServer.url,
      port: savedServer.port,
      sessionId: onlineSession.sessionId,
      serverId: savedServer.serverId,
      version: savedServer.version,
      timeoutMs: 8_000,
    });
  }, [onlineSession?.sessionId, savedServer?.baseUrl, savedServer?.serverId, savedServer?.version]);

  const contactsReader = useMemo(() => {
    if (!savedServer || !onlineSession) return null;
    return new OnlineContactsRepository({
      url: savedServer.url,
      port: savedServer.port,
      sessionId: onlineSession.sessionId,
      serverId: savedServer.serverId,
      version: savedServer.version,
      timeoutMs: 8_000,
    });
  }, [onlineSession?.sessionId, savedServer?.baseUrl, savedServer?.serverId, savedServer?.version]);

  const productsReader = useMemo(() => {
    if (!savedServer || !onlineSession) return null;
    return new OnlineProductsRepository({
      url: savedServer.url,
      port: savedServer.port,
      sessionId: onlineSession.sessionId,
      serverId: savedServer.serverId,
      version: savedServer.version,
      timeoutMs: 8_000,
    });
  }, [onlineSession?.sessionId, savedServer?.baseUrl, savedServer?.serverId, savedServer?.version]);

  const invalidateSession = useCallback((message?: string) => {
    reader?.clearCache();
    contactsReader?.clearCache();
    productsReader?.clearCache();
    clearOnlineServerSession();
    setOnlineSession(null);
    setRemoteSnapshot(null);
    setContactsSnapshot(null);
    setContactResults(null);
    setSelectedContact(null);
    setContactsError(null);
    setProductsSnapshot(null);
    setInventorySnapshot(null);
    setProductResults(null);
    setSelectedProduct(null);
    setSelectedInventoryItem(null);
    setCatalogError(null);
    setSessionVerified(false);
    if (message) setConnectionError(message);
  }, [reader, contactsReader, productsReader]);

  useEffect(() => {
    if (!onlineSession) {
      setRemoteSnapshot(null);
      setContactsSnapshot(null);
      setContactResults(null);
      setSelectedContact(null);
      setProductsSnapshot(null);
      setInventorySnapshot(null);
      setProductResults(null);
      setSelectedProduct(null);
      setSelectedInventoryItem(null);
      return;
    }

    if (
      !savedServer
      || onlineSession.serverId !== savedServer.serverId
      || onlineSession.baseUrl !== savedServer.baseUrl
    ) {
      invalidateSession(CONNECTION_ERROR_MESSAGES.HTTPS_SERVER_MISMATCH);
      return;
    }

    if (isOnlineServerSessionExpired(onlineSession)) {
      invalidateSession(CONNECTION_ERROR_MESSAGES.HTTPS_SESSION_EXPIRED);
      return;
    }

    if (!window.joyaControlHttps?.getSession) return;
    let cancelled = false;
    setRestoringSession(true);

    void window.joyaControlHttps.getSession({
      url: savedServer.url,
      port: savedServer.port,
      sessionId: onlineSession.sessionId,
      expectedServerId: savedServer.serverId,
      expectedVersion: savedServer.version,
      timeoutMs: 8_000,
    }).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        if (shouldClearOnlineServerSession(result.errorCode)) {
          invalidateSession(errorMessage(result.errorCode, result.errorMessage));
        } else {
          setSessionVerified(false);
          setConnectionError(errorMessage(result.errorCode, result.errorMessage));
        }
        return;
      }

      const refreshed = saveOnlineServerSession({
        ...onlineSession,
        username: result.session.usuario,
        displayName: result.session.nombre,
        role: result.session.rol,
        createdAt: result.session.fecha,
        expiresAt: result.session.expiracion,
        version: result.session.version,
        savedAt: new Date().toISOString(),
      });
      setOnlineSession(refreshed);
      setSessionVerified(true);
      setConnectionError(null);
    }).finally(() => {
      if (!cancelled) setRestoringSession(false);
    });

    return () => { cancelled = true; };
  }, [savedServer, onlineSession?.sessionId, invalidateSession]);

  const loadRemoteData = useCallback(async (force = false) => {
    if (!reader) return;
    setLoadingRemoteData(true);
    try {
      const snapshot = await reader.getSnapshot(force);
      setRemoteSnapshot(snapshot);
      setSessionVerified(true);
      setConnectionError(null);
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) {
        invalidateSession(message);
      } else {
        setSessionVerified(false);
        setConnectionError(message);
      }
    } finally {
      setLoadingRemoteData(false);
    }
  }, [reader, invalidateSession]);

  const loadRemoteContacts = useCallback(async (force = false) => {
    if (!contactsReader) return;
    setLoadingContacts(true);
    try {
      const snapshot = await contactsReader.getContacts(force);
      setContactsSnapshot(snapshot);
      setContactsError(null);
      setSessionVerified(true);
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) {
        invalidateSession(message);
      } else {
        setContactsError(message);
      }
    } finally {
      setLoadingContacts(false);
    }
  }, [contactsReader, invalidateSession]);

  const loadRemoteCatalog = useCallback(async (force = false) => {
    if (!productsReader) return;
    setLoadingCatalog(true);
    try {
      const [products, inventory] = await Promise.all([
        productsReader.getProducts(force),
        productsReader.getInventory(force),
      ]);
      setProductsSnapshot(products);
      setInventorySnapshot(inventory);
      setCatalogError(null);
      setSessionVerified(true);
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setCatalogError(message);
    } finally {
      setLoadingCatalog(false);
    }
  }, [productsReader, invalidateSession]);

  useEffect(() => {
    if (!reader || !sessionVerified) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await loadRemoteData(false);
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reader, sessionVerified, loadRemoteData]);

  useEffect(() => {
    if (!contactsReader || !sessionVerified) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await loadRemoteContacts(false);
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [contactsReader, sessionVerified, loadRemoteContacts]);

  useEffect(() => {
    if (!productsReader || !sessionVerified) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await loadRemoteCatalog(false);
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [productsReader, sessionVerified, loadRemoteCatalog]);

  const updateUrl = (value: string) => {
    setUrl(value);
    setProbe(null);
    setConnectionError(null);
  };

  const updatePort = (value: string) => {
    setPort(value.replace(/[^\d]/g, ''));
    setProbe(null);
    setConnectionError(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setProbe(null);
    setConnectionError(null);

    try {
      if (!window.joyaControlHttps?.testConnection) {
        setConnectionError('La prueba HTTPS está disponible únicamente en la aplicación de escritorio.');
        return;
      }

      const result = await window.joyaControlHttps.testConnection({
        url: url.trim(),
        port: port.trim() ? Number(port) : undefined,
        timeoutMs: 8_000,
      });

      if (!result.ok) {
        setConnectionError(errorMessage(result.errorCode, result.errorMessage));
        return;
      }

      setUrl(result.endpoint.url);
      setPort(String(result.endpoint.port));
      setProbe(result);
      toast({
        title: 'Servidor encontrado',
        description: `${result.serverInfo.serverName} respondió en ${result.latencyMs} ms.`,
      });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'No fue posible conectar con el servidor HTTPS.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!probe) {
      toast({
        title: 'Prueba requerida',
        description: 'Pruebe la conexión antes de guardar el servidor.',
        variant: 'destructive',
      });
      return;
    }

    const selection = saveOnlineServerSelection({
      url: probe.endpoint.url,
      port: probe.endpoint.port,
      baseUrl: probe.endpoint.baseUrl,
      serverId: probe.serverInfo.serverId,
      serverName: probe.serverInfo.serverName,
      version: probe.serverInfo.version,
      hostname: probe.serverInfo.hostname,
      savedAt: new Date().toISOString(),
    });

    if (onlineSession && onlineSession.serverId !== selection.serverId) {
      invalidateSession();
    }
    setSavedServer(selection);
    toast({
      title: 'Servidor HTTPS guardado',
      description: `${selection.serverName} quedó seleccionado para JoyaControl v3.0.`,
    });
  };

  const handleDelete = () => {
    reader?.clearCache();
    contactsReader?.clearCache();
    productsReader?.clearCache();
    clearOnlineServerSession();
    clearOnlineServerSelection();
    setOnlineSession(null);
    setSessionVerified(false);
    setRemoteSnapshot(null);
    setContactsSnapshot(null);
    setContactResults(null);
    setSelectedContact(null);
    setContactSearch('');
    setContactsError(null);
    setProductsSnapshot(null);
    setInventorySnapshot(null);
    setProductResults(null);
    setSelectedProduct(null);
    setSelectedInventoryItem(null);
    setProductSearch('');
    setCatalogError(null);
    setSavedServer(null);
    setUrl('');
    setPort('');
    setProbe(null);
    setUsername('');
    setPassword('');
    setConnectionError(null);
    toast({ title: 'Configuración eliminada', description: 'Ya no hay un servidor HTTPS seleccionado.' });
  };

  const handleCancel = () => {
    const form = savedForm(savedServer);
    setUrl(form.url);
    setPort(form.port);
    setProbe(null);
    setConnectionError(null);
    navigate('/configuracion');
  };

  const handleLogin = async () => {
    if (!savedServer) return;
    if (!window.joyaControlHttps?.login) {
      setConnectionError('El inicio de sesión HTTPS está disponible únicamente en la aplicación de escritorio.');
      return;
    }

    setAuthenticating(true);
    setConnectionError(null);
    try {
      const result = await window.joyaControlHttps.login({
        url: savedServer.url,
        port: savedServer.port,
        username: username.trim(),
        password,
        clientVersion: HTTPS_CLIENT_VERSION,
        expectedServerId: savedServer.serverId,
        expectedVersion: savedServer.version,
        timeoutMs: 8_000,
      });
      if (!result.ok) {
        setConnectionError(errorMessage(result.errorCode, result.errorMessage));
        return;
      }

      const storedSession = sessionFromLogin(result, savedServer);
      setOnlineSession(storedSession);
      setSessionVerified(true);
      setRemoteSnapshot(null);
      setContactsSnapshot(null);
      setContactResults(null);
      setSelectedContact(null);
      setContactSearch('');
      setContactsError(null);
      setProductsSnapshot(null);
      setInventorySnapshot(null);
      setProductResults(null);
      setSelectedProduct(null);
      setSelectedInventoryItem(null);
      setProductSearch('');
      setCatalogError(null);
      setPassword('');
      toast({
        title: 'Sesión HTTPS iniciada',
        description: `Conectado como ${roleLabel(storedSession.role)} en ${savedServer.serverName}.`,
      });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'No fue posible iniciar sesión.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    if (!savedServer || !onlineSession) return;
    if (!window.joyaControlHttps?.logout) {
      setConnectionError('El cierre de sesión HTTPS está disponible únicamente en la aplicación de escritorio.');
      return;
    }

    setClosingSession(true);
    setConnectionError(null);
    try {
      const result = await window.joyaControlHttps.logout({
        url: savedServer.url,
        port: savedServer.port,
        sessionId: onlineSession.sessionId,
        expectedServerId: savedServer.serverId,
        expectedVersion: savedServer.version,
        timeoutMs: 8_000,
      });
      if (!result.ok) {
        if (shouldClearOnlineServerSession(result.errorCode)) {
          invalidateSession(errorMessage(result.errorCode, result.errorMessage));
        } else {
          setSessionVerified(false);
          setConnectionError(errorMessage(result.errorCode, result.errorMessage));
        }
        return;
      }

      invalidateSession();
      setUsername('');
      setPassword('');
      toast({ title: 'Sesión HTTPS cerrada', description: 'El servidor seleccionado se conserva.' });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'No fue posible cerrar la sesión HTTPS.');
    } finally {
      setClosingSession(false);
    }
  };

  const handleContactSearch = async () => {
    if (!contactsReader) return;
    const query = contactSearch.trim();
    if (!query) {
      setContactResults(null);
      setSelectedContact(null);
      setContactsError(null);
      return;
    }

    setSearchingContacts(true);
    setContactsError(null);
    try {
      const results = await contactsReader.searchContacts(query);
      setContactResults(results);
      setSelectedContact(null);
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setContactsError(message);
    } finally {
      setSearchingContacts(false);
    }
  };

  const handleSelectContact = async (contactId: string) => {
    if (!contactsReader) return;
    setLoadingContacts(true);
    setContactsError(null);
    try {
      setSelectedContact(await contactsReader.getContact(contactId));
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setContactsError(message);
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleProductSearch = async () => {
    if (!productsReader) return;
    const query = productSearch.trim();
    if (!query) {
      setProductResults(null);
      setSelectedProduct(null);
      setCatalogError(null);
      return;
    }

    setSearchingProducts(true);
    setCatalogError(null);
    try {
      const results = await productsReader.searchProducts(query);
      setProductResults(results);
      setSelectedProduct(null);
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setCatalogError(message);
    } finally {
      setSearchingProducts(false);
    }
  };

  const handleSelectProduct = async (productId: string) => {
    if (!productsReader) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      setSelectedProduct(await productsReader.getProduct(productId));
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setCatalogError(message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleSelectInventoryItem = async (inventoryId: string) => {
    if (!productsReader) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      setSelectedInventoryItem(await productsReader.getInventoryItem(inventoryId));
    } catch (error) {
      const code = error instanceof OnlineRepositoryReadError ? error.code : '';
      const message = errorMessage(code, error instanceof Error ? error.message : undefined);
      if (shouldClearOnlineServerSession(code)) invalidateSession(message);
      else setCatalogError(message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const displayedContacts = (contactResults || contactsSnapshot?.contacts || []).slice(0, 20);
  const displayedProducts = (productResults || productsSnapshot?.products || []).slice(0, 20);
  const displayedInventory = (inventorySnapshot?.items || []).slice(0, 20);
  const displayedUser = remoteSnapshot?.me;
  const displayedRole = displayedUser?.rol || onlineSession?.role || '';
  const permissions = remoteSnapshot?.permissions || displayedUser?.permisos || [];
  const company = remoteSnapshot?.company;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Globe2 className="h-6 w-6" />
          Servidor Online
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte el Cliente al Servidor Principal y consulte información protegida en modo estrictamente de solo lectura.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <label htmlFor="online-server-url" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">URL del servidor</label>
            <Input
              id="online-server-url"
              value={url}
              onChange={(event) => updateUrl(event.target.value)}
              placeholder="https://midominio.com"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">También puede usar una IP pública, siempre mediante HTTPS.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="online-server-port" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Puerto</label>
            <Input
              id="online-server-port"
              value={port}
              onChange={(event) => updatePort(event.target.value)}
              placeholder="443"
              inputMode="numeric"
              maxLength={5}
            />
            <p className="text-xs text-muted-foreground">Si se deja vacío, se utilizará 443.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleTestConnection} disabled={testing || !url.trim()}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            Probar conexión
          </Button>
          <Button onClick={handleSave} disabled={!probe || testing} className="gold-gradient text-primary-foreground">
            <Save className="mr-2 h-4 w-4" />
            Guardar
          </Button>
          <Button variant="outline" onClick={handleCancel}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
          {savedServer && (
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Borrar configuración
            </Button>
          )}
        </div>
      </div>

      {connectionError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {connectionError}
        </div>
      )}

      {probe && (
        <div className="rounded-xl border border-emerald-500/30 bg-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold">Servidor encontrado</h2>
                <p className="text-sm text-muted-foreground">Conexión HTTPS verificada.</p>
              </div>
            </div>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Online</Badge>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Nombre</dt><dd className="mt-1 font-medium">{probe.serverInfo.serverName}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Versión</dt><dd className="mt-1 font-medium">{probe.serverInfo.version}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Hostname</dt><dd className="mt-1 font-medium">{probe.serverInfo.hostname}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">ServerId</dt><dd className="mt-1 break-all font-mono text-sm">{probe.serverInfo.serverId}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Latencia</dt><dd className="mt-1 font-medium">{probe.latencyMs} ms</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Estado</dt><dd className="mt-1 font-medium">Online</dd></div>
          </dl>
        </div>
      )}

      {savedServer && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <Server className="mt-0.5 h-5 w-5 text-primary" />
            <div className="min-w-0">
              <h2 className="font-semibold">Servidor HTTPS seleccionado</h2>
              <p className="mt-1 break-all text-sm text-muted-foreground">{savedServer.baseUrl}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {savedServer.serverName} · v{savedServer.version} · {savedServer.hostname}
              </p>
            </div>
          </div>
        </div>
      )}

      {savedServer && !onlineSession && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2 text-primary"><LockKeyhole className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold">Iniciar sesión</h2>
              <p className="text-sm text-muted-foreground">Use un usuario existente del Servidor Principal.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="online-username" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Usuario</label>
              <Input
                id="online-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={authenticating}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="online-password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contraseña</label>
              <Input
                id="online-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={authenticating}
              />
            </div>
          </div>
          <Button onClick={handleLogin} disabled={authenticating || !username.trim() || !password}>
            {authenticating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRound className="mr-2 h-4 w-4" />}
            Conectar
          </Button>
        </div>
      )}

      {savedServer && onlineSession && (
        <div className="rounded-xl border border-emerald-500/30 bg-card p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-600"><ShieldCheck className="h-5 w-5" /></div>
              <div>
                <h2 className="font-semibold">Servidor conectado</h2>
                <p className="text-sm text-muted-foreground">
                  Conectado como: {roleLabel(displayedRole)}
                </p>
              </div>
            </div>
            <Badge variant="outline" className={sessionVerified ? 'border-emerald-500/40 text-emerald-600' : 'border-amber-500/40 text-amber-600'}>
              {restoringSession || loadingRemoteData ? 'Comunicando' : sessionVerified ? 'Online' : 'Sin comunicación'}
            </Badge>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Usuario</dt><dd className="mt-1 font-medium">{displayedUser?.nombre || onlineSession.displayName}</dd><dd className="text-xs text-muted-foreground">@{displayedUser?.usuario || onlineSession.username}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Rol</dt><dd className="mt-1 font-medium">{roleLabel(displayedRole)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Empresa</dt><dd className="mt-1 font-medium">{company?.nombreEmpresa || savedServer.serverName}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Versión</dt><dd className="mt-1 font-medium">{onlineSession.version}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Latencia</dt><dd className="mt-1 font-medium">{remoteSnapshot ? `${remoteSnapshot.latencyMs} ms` : 'Pendiente'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Estado</dt><dd className="mt-1 font-medium">{sessionVerified ? 'Conectado' : 'Servidor no disponible'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wider text-muted-foreground">ServerId</dt><dd className="mt-1 break-all font-mono text-sm">{onlineSession.serverId}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Última comunicación</dt><dd className="mt-1 font-medium">{remoteSnapshot ? readableDate(remoteSnapshot.lastCommunication) : 'Pendiente'}</dd></div>
          </dl>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><h3 className="font-semibold">Empresa</h3></div>
              {company ? (
                <dl className="space-y-2 text-sm">
                  <div><dt className="text-muted-foreground">Nombre</dt><dd className="font-medium">{company.nombreEmpresa || 'Sin configurar'}</dd></div>
                  <div><dt className="text-muted-foreground">NIT</dt><dd>{company.nit || 'Sin configurar'}</dd></div>
                  <div><dt className="text-muted-foreground">Dirección</dt><dd>{[company.direccion, company.ciudad].filter(Boolean).join(' · ') || 'Sin configurar'}</dd></div>
                  <div><dt className="text-muted-foreground">Teléfonos</dt><dd>{company.telefonos.join(' · ') || 'Sin configurar'}</dd></div>
                  <div><dt className="text-muted-foreground">Configuración de impresión</dt><dd>{company.configuracionImpresion ? 'Disponible en el servidor' : 'Sin configuración registrada'}</dd></div>
                </dl>
              ) : <p className="text-sm text-muted-foreground">Consultando empresa…</p>}
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h3 className="font-semibold">Permisos</h3></div>
              {permissions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {permissions.map(permission => <Badge key={permission} variant="secondary">{permission}</Badge>)}
                </div>
              ) : <p className="text-sm text-muted-foreground">Sin permisos devueltos por el servidor.</p>}
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <div>
                  <h3 className="font-semibold">Contactos remotos</h3>
                  <p className="text-xs text-muted-foreground">Lectura temporal desde el Repository del Servidor Principal.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">{contactsSnapshot?.totalClients ?? 0} clientes</Badge>
                <Badge variant="secondary">{contactsSnapshot?.totalSuppliers ?? 0} proveedores</Badge>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Buscar contactos remotos"
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleContactSearch(); }}
                placeholder="Nombre, documento, teléfono o correo"
                disabled={searchingContacts || loadingContacts}
              />
              <Button variant="outline" onClick={() => void handleContactSearch()} disabled={searchingContacts || loadingContacts}>
                {searchingContacts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setContactSearch(''); setContactResults(null); setSelectedContact(null); setContactsError(null); }}
                disabled={!contactSearch && !contactResults}
              >
                Limpiar
              </Button>
            </div>

            {contactsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{contactsError}</div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="overflow-hidden rounded-md border border-border">
                <div className="border-b border-border bg-secondary/30 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Primeros 20 resultados
                </div>
                <div className="max-h-80 divide-y divide-border overflow-y-auto">
                  {loadingContacts && displayedContacts.length === 0 ? (
                    <div className="flex items-center justify-center p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando contactos…</div>
                  ) : displayedContacts.length > 0 ? displayedContacts.map(contact => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => void handleSelectContact(contact.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-secondary/40"
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{contact.name}</span>
                        <span className="block break-words text-xs text-muted-foreground">{contact.document || contact.email || 'Sin documento'}</span>
                      </span>
                      <Badge variant="outline">{contact.type === 'supplier' ? 'Proveedor' : 'Cliente'}</Badge>
                    </button>
                  )) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">No se encontraron contactos remotos.</div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h4 className="font-medium">Detalle</h4>
                {selectedContact ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="text-muted-foreground">Nombre</dt><dd className="font-medium">{selectedContact.name}</dd></div>
                    <div><dt className="text-muted-foreground">Tipo</dt><dd>{selectedContact.type === 'supplier' ? 'Proveedor' : 'Cliente'}</dd></div>
                    <div><dt className="text-muted-foreground">Teléfono</dt><dd>{selectedContact.phone || 'Sin registrar'}</dd></div>
                    <div><dt className="text-muted-foreground">Correo</dt><dd className="break-all">{selectedContact.email || 'Sin registrar'}</dd></div>
                    <div><dt className="text-muted-foreground">Documento</dt><dd>{selectedContact.document || 'Sin registrar'}</dd></div>
                    <div><dt className="text-muted-foreground">Estado</dt><dd><Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Activo</Badge></dd></div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Seleccione un cliente o proveedor para consultar su detalle.</p>
                )}
              </div>
            </div>

            {contactsSnapshot && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Última comunicación: {readableDate(contactsSnapshot.lastCommunication)}</span>
                <span>Latencia: {contactsSnapshot.latencyMs} ms</span>
                <span>Cache hasta: {readableDate(contactsSnapshot.cacheExpiresAt)}</span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <div>
                  <h3 className="font-semibold">Productos</h3>
                  <p className="text-xs text-muted-foreground">Catálogo remoto saneado y estrictamente de solo lectura.</p>
                </div>
              </div>
              <Badge variant="secondary">{productsSnapshot?.totalProducts ?? 0} productos</Badge>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Buscar productos remotos"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleProductSearch(); }}
                placeholder="Código, nombre, categoría o referencia"
                disabled={searchingProducts || loadingCatalog}
              />
              <Button variant="outline" onClick={() => void handleProductSearch()} disabled={searchingProducts || loadingCatalog}>
                {searchingProducts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setProductSearch(''); setProductResults(null); setSelectedProduct(null); setCatalogError(null); }}
                disabled={!productSearch && !productResults}
              >
                Limpiar
              </Button>
            </div>

            {catalogError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{catalogError}</div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="overflow-hidden rounded-md border border-border">
                <div className="border-b border-border bg-secondary/30 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Primeros 20 resultados
                </div>
                <div className="max-h-96 divide-y divide-border overflow-y-auto">
                  {loadingCatalog && displayedProducts.length === 0 ? (
                    <div className="flex items-center justify-center p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando productos…</div>
                  ) : displayedProducts.length > 0 ? displayedProducts.map(product => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => void handleSelectProduct(product.id)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 text-left hover:bg-secondary/40"
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{product.name}</span>
                        <span className="block break-words text-xs text-muted-foreground">{product.code} · {product.category || 'Sin categoría'}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{product.weightGrams} g · {formatCurrency(product.salePrice)} · Stock {product.stock}</span>
                      </span>
                      <Badge variant="outline" className={stockStatusClass(product.status)}>{stockStatusLabel(product.status)}</Badge>
                    </button>
                  )) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">No se encontraron productos remotos.</div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h4 className="font-medium">Detalle del producto</h4>
                {selectedProduct ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="text-muted-foreground">Código</dt><dd className="font-medium">{selectedProduct.code}</dd></div>
                    <div><dt className="text-muted-foreground">Nombre</dt><dd>{selectedProduct.name}</dd></div>
                    <div><dt className="text-muted-foreground">Categoría</dt><dd>{selectedProduct.category || 'Sin categoría'}</dd></div>
                    <div><dt className="text-muted-foreground">Gramos por unidad</dt><dd>{selectedProduct.weightGrams} g</dd></div>
                    <div><dt className="text-muted-foreground">Gramos disponibles</dt><dd>{selectedProduct.availableGrams} g</dd></div>
                    <div><dt className="text-muted-foreground">Precio de venta</dt><dd>{formatCurrency(selectedProduct.salePrice)}</dd></div>
                    <div><dt className="text-muted-foreground">Stock</dt><dd>{selectedProduct.stock}</dd></div>
                    <div><dt className="text-muted-foreground">Estado</dt><dd><Badge variant="outline" className={stockStatusClass(selectedProduct.status)}>{stockStatusLabel(selectedProduct.status)}</Badge></dd></div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Seleccione un producto para consultar su detalle.</p>
                )}
              </div>
            </div>

            {productsSnapshot && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Última comunicación: {readableDate(productsSnapshot.lastCommunication)}</span>
                <span>Latencia: {productsSnapshot.latencyMs} ms</span>
                <span>Cache hasta: {readableDate(productsSnapshot.cacheExpiresAt)}</span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-primary" />
                <div>
                  <h3 className="font-semibold">Inventario</h3>
                  <p className="text-xs text-muted-foreground">Existencias actuales y último movimiento, sin costos internos.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{inventorySnapshot?.totalReferences ?? 0} referencias</Badge>
                <Badge variant="secondary">{inventorySnapshot?.totalExistences ?? 0} existencias</Badge>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="overflow-hidden rounded-md border border-border">
                <div className="border-b border-border bg-secondary/30 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Primeras 20 referencias
                </div>
                <div className="max-h-96 divide-y divide-border overflow-y-auto">
                  {loadingCatalog && displayedInventory.length === 0 ? (
                    <div className="flex items-center justify-center p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando inventario…</div>
                  ) : displayedInventory.length > 0 ? displayedInventory.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSelectInventoryItem(item.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-secondary/40"
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{item.name}</span>
                        <span className="block break-words text-xs text-muted-foreground">{item.code} · Stock {item.stock} · {item.availableGrams} g</span>
                      </span>
                      <Badge variant="outline" className={stockStatusClass(item.status)}>{stockStatusLabel(item.status)}</Badge>
                    </button>
                  )) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">No se encontraron referencias remotas.</div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h4 className="font-medium">Detalle de inventario</h4>
                {selectedInventoryItem ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="text-muted-foreground">Referencia</dt><dd className="font-medium">{selectedInventoryItem.code}</dd></div>
                    <div><dt className="text-muted-foreground">Producto</dt><dd>{selectedInventoryItem.name}</dd></div>
                    <div><dt className="text-muted-foreground">Existencias</dt><dd>{selectedInventoryItem.stock}</dd></div>
                    <div><dt className="text-muted-foreground">Gramos disponibles</dt><dd>{selectedInventoryItem.availableGrams} g</dd></div>
                    <div>
                      <dt className="text-muted-foreground">Ubicación</dt>
                      <dd className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selectedInventoryItem.location || 'Sin registrar'}</dd>
                    </div>
                    <div><dt className="text-muted-foreground">Último movimiento</dt><dd>{selectedInventoryItem.lastMovement ? `${readableDate(selectedInventoryItem.lastMovement.date)} · ${selectedInventoryItem.lastMovement.type === 'increase' ? 'Entrada' : 'Salida'}` : 'Sin movimientos'}</dd></div>
                    <div><dt className="text-muted-foreground">Estado</dt><dd><Badge variant="outline" className={stockStatusClass(selectedInventoryItem.status)}>{stockStatusLabel(selectedInventoryItem.status)}</Badge></dd></div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Seleccione una referencia para consultar su detalle.</p>
                )}
              </div>
            </div>

            {inventorySnapshot && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Última comunicación: {readableDate(inventorySnapshot.lastCommunication)}</span>
                <span>Latencia: {inventorySnapshot.latencyMs} ms</span>
                <span>Cache hasta: {readableDate(inventorySnapshot.cacheExpiresAt)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => { void loadRemoteData(true); void loadRemoteContacts(true); void loadRemoteCatalog(true); }} disabled={loadingRemoteData || loadingContacts || loadingCatalog || restoringSession}>
              {loadingRemoteData || loadingContacts || loadingCatalog ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualizar lecturas
            </Button>
            <Button variant="outline" onClick={handleLogout} disabled={closingSession || restoringSession}>
              {closingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Cerrar sesión
            </Button>
            {remoteSnapshot && (
              <span className="flex items-center gap-1 self-center text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Cache en memoria hasta {readableDate(remoteSnapshot.cacheExpiresAt)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
        Esta fase permite únicamente lecturas HTTPS de usuario, empresa, permisos, contactos, productos e inventario. No habilita ventas, compras, caja, sincronización ni escritura remota.
      </div>
    </div>
  );
};

export default OnlineServerPage;
