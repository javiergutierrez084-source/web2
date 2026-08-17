import { useState } from 'react';
import { Diamond, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createUser, type SessionUser } from '@/lib/auth';
import { useAuth } from '@/contexts/AuthContext';
import { APP_VERSION_LABEL } from '@/config/appVersion';
import WorkModeSelector from '@/components/WorkModeSelector';

const SetupPage = () => {
  const { login } = useAuth();
  const [form, setForm] = useState({ displayName: '', username: '', password: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const update = (f: string, v: string) => { setForm(p => ({ ...p, [f]: v })); setError(''); };

  const handleSubmit = async () => {
    if (!form.displayName.trim()) return setError('Ingresa tu nombre completo');
    if (!form.username.trim()) return setError('Ingresa un nombre de usuario');
    if (form.username.length < 3) return setError('El usuario debe tener al menos 3 caracteres');
    if (form.password.length < 4) return setError('La contraseña debe tener al menos 4 caracteres');
    if (form.password !== form.confirm) return setError('Las contraseñas no coinciden');

    setLoading(true);
    try {
      const user = await createUser(form.username, form.displayName, form.password, 'master');
      const session: SessionUser = {
        id: user.id, username: user.username,
        displayName: user.display_name, role: user.role,
      };
      import('@/lib/auth').then(({ setSession }) => setSession(session));
      login(session);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl gold-gradient shadow-2xl">
            <Diamond className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold gold-text">JoyaControl Pro</h1>
            <p className="text-sm text-muted-foreground mt-1">{APP_VERSION_LABEL} — Configuración inicial</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Configuración inicial</h2>
              <p className="text-xs text-muted-foreground">Crea el usuario maestro del sistema</p>
            </div>
          </div>

          <WorkModeSelector variant="login" />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Nombre completo
              </label>
              <Input
                value={form.displayName}
                onChange={e => update('displayName', e.target.value)}
                placeholder="Ej: Javier Gutiérrez"
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Nombre de usuario
              </label>
              <Input
                value={form.username}
                onChange={e => update('username', e.target.value)}
                placeholder="Ej: javier"
                autoCapitalize="none"
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
                  placeholder="Mínimo 4 caracteres"
                  className="bg-secondary/50 pr-10"
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

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Confirmar contraseña
              </label>
              <Input
                type={showPass ? 'text' : 'password'}
                value={form.confirm}
                onChange={e => update('confirm', e.target.value)}
                placeholder="Repite la contraseña"
                className="bg-secondary/50"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full gold-gradient text-primary-foreground font-semibold h-11"
          >
            {loading ? 'Creando cuenta...' : 'Crear usuario maestro'}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            El usuario maestro tiene acceso completo al sistema y puede crear otros usuarios.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SetupPage;
