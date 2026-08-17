import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clock3,
  Diamond,
  Eye,
  EyeOff,
  Laptop,
  Loader2,
  LogIn,
  Monitor,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  isLanDuplicateLoginError,
  loginUser,
  type LanDuplicateSessionDetails,
} from '@/lib/auth';
import { useAuth } from '@/contexts/AuthContext';
import { APP_VERSION_LABEL } from '@/config/appVersion';
import WorkModeSelector from '@/components/WorkModeSelector';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const formatTimestamp = (value: string | null) => {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium' });
};

const formatElapsed = (value: string | null, fallbackMs: number | null, now: number) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  const elapsedMs = Number.isFinite(parsed)
    ? Math.max(0, now - parsed)
    : Math.max(0, Number(fallbackMs || 0));
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} día${days === 1 ? '' : 's'}`;
};

const SessionDetail = ({ icon: Icon, label, value }: {
  icon: LucideIcon;
  label: string;
  value: string;
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-secondary/30 p-3">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-semibold text-foreground">{value}</p>
    </div>
  </div>
);

const LoginPage = () => {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [duplicateSession, setDuplicateSession] = useState<LanDuplicateSessionDetails | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!duplicateSession) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [duplicateSession]);

  const update = (f: string, v: string) => {
    setForm(p => ({ ...p, [f]: v }));
    setError('');
    setTransferError('');
  };

  const handleLogin = async () => {
    if (!form.username.trim() || !form.password) return setError('Completa todos los campos');
    setLoading(true);
    try {
      const session = await loginUser(form.username, form.password);
      login(session);
    } catch (e: any) {
      if (isLanDuplicateLoginError(e)) {
        setDuplicateSession(e.duplicateSession);
        setTransferError('');
        setClock(Date.now());
      } else {
        setError(e instanceof Error ? e.message : 'No fue posible iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSessionTransfer = async () => {
    if (!duplicateSession) return;
    setTransferLoading(true);
    setTransferError('');
    try {
      const session = await loginUser(form.username, form.password, {
        transferExistingSession: true,
        expectedSourceClientId: duplicateSession.source.clientId,
        expectedSourceMachineId: duplicateSession.source.machineId,
      });
      setDuplicateSession(null);
      login(session);
    } catch (e: unknown) {
      if (isLanDuplicateLoginError(e)) {
        setDuplicateSession(e.duplicateSession);
        setClock(Date.now());
        setTransferError(
          e.reason === 'LAN_DUPLICATE_SESSION_CHANGED'
            ? 'La sesión activa cambió de equipo. Revisa la información actualizada antes de continuar.'
            : 'La sesión anterior continúa activa. Intenta nuevamente.',
        );
      } else {
        setTransferError(e instanceof Error ? e.message : 'No fue posible transferir la sesión');
      }
    } finally {
      setTransferLoading(false);
    }
  };

  const closeDuplicateDialog = () => {
    if (transferLoading) return;
    setDuplicateSession(null);
    setTransferError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl gold-gradient shadow-2xl">
            <Diamond className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold gold-text">JoyaControl</h1>
            <p className="text-sm text-muted-foreground mt-1">Sistema de Gestión para Joyería</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl space-y-5">
          <h2 className="font-bold text-lg text-center">Iniciar sesión</h2>

          <WorkModeSelector variant="login" />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Usuario
              </label>
              <Input
                value={form.username}
                onChange={e => update('username', e.target.value)}
                placeholder="Tu nombre de usuario"
                autoCapitalize="none"
                autoComplete="username"
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contraseña
              </label>
              <div className="relative">
                <Input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => update('password', e.target.value)}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  className="bg-secondary/50 pr-10"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full gold-gradient text-primary-foreground font-semibold h-11 gap-2"
          >
            <LogIn className="h-4 w-4" />
            {loading ? 'Verificando...' : 'Entrar'}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          JoyaControl Pro {APP_VERSION_LABEL} — Local o Cliente LAN
        </p>
      </div>

      <AlertDialog
        open={Boolean(duplicateSession)}
        onOpenChange={open => { if (!open) closeDuplicateDialog(); }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Este usuario ya tiene una sesión activa
            </AlertDialogTitle>
            <AlertDialogDescription>
              Solo se permite una sesión activa por usuario. Puedes cancelar o cerrar la sesión anterior para continuar en este equipo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {duplicateSession && (
            <div className="space-y-3">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Usuario</p>
                <p className="mt-1 text-base font-bold text-foreground">{duplicateSession.displayName}</p>
                <p className="text-sm text-muted-foreground">@{duplicateSession.username}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SessionDetail icon={Laptop} label="Equipo conectado" value={duplicateSession.source.deviceName} />
                <SessionDetail icon={Monitor} label="Hostname" value={duplicateSession.source.hostname} />
                <SessionDetail icon={Network} label="Dirección IP" value={duplicateSession.source.ip} />
                <SessionDetail icon={Clock3} label="Último heartbeat" value={formatTimestamp(duplicateSession.source.lastHeartbeat)} />
              </div>

              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tiempo desde la última actividad</p>
                <p className="mt-1 text-sm font-bold text-foreground">
                  {formatElapsed(
                    duplicateSession.source.lastActivity,
                    duplicateSession.source.inactiveForMs,
                    clock,
                  )}
                </p>
              </div>

              {transferError && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {transferError}
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDuplicateDialog} disabled={transferLoading}>
              Cancelar
            </AlertDialogCancel>
            <Button onClick={handleSessionTransfer} disabled={transferLoading} className="gap-2">
              {transferLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {transferLoading ? 'Transfiriendo sesión...' : 'Cerrar sesión anterior e iniciar aquí'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LoginPage;
