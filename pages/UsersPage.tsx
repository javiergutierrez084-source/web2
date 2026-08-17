import { useState, useEffect } from 'react';
import { Plus, UserCheck, UserX, Shield, Eye, EyeOff, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { UserRecord, UserRole } from '@/domain/models';
import { createUser, fetchUsers, hashPassword, updateUser } from '@/lib/auth';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/auth';

const ROLE_LABELS: Record<UserRole, string> = {
  master: '👑 Maestro', admin: '🛡️ Admin', vendedor: '🛍️ Vendedor', cajero: '💰 Cajero',
};
const ROLE_DESC: Record<UserRole, string> = {
  master: 'Acceso total al sistema',
  admin: 'Reportes, inventario, respaldos. Sin gestión de usuarios',
  vendedor: 'Ventas, cotizaciones, contactos y compras',
  cajero: 'Solo caja registradora y ventas',
};

const UsersPage = () => {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showResetId, setShowResetId] = useState<string | null>(null);
  const [newPass, setNewPass] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [form, setForm] = useState({ displayName: '', username: '', password: '', role: 'vendedor' as UserRole });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => setUsers(await fetchUsers());
  useEffect(() => { load(); }, []);

  const update = (f: string, v: string) => { setForm(p => ({ ...p, [f]: v })); setError(''); };

  const handleCreate = async () => {
    if (!form.displayName.trim()) return setError('Ingresa el nombre completo');
    if (form.username.length < 3) return setError('Usuario mínimo 3 caracteres');
    if (form.password.length < 4) return setError('Contraseña mínimo 4 caracteres');
    // Only one master allowed
    if (form.role === 'master') return setError('Solo puede existir un usuario maestro');
    setLoading(true);
    try {
      await createUser(form.username, form.displayName, form.password, form.role);
      if (me) await logActivity(me, 'USER_CREATED', 'user', form.username, `Rol: ${form.role}`);
      toast({ title: '✅ Usuario creado', description: `${form.displayName} (${ROLE_LABELS[form.role]})` });
      setShowAdd(false);
      setForm({ displayName: '', username: '', password: '', role: 'vendedor' });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (u: UserRecord) => {
    if (u.role === 'master') return toast({ title: 'El usuario maestro no puede desactivarse', variant: 'destructive' });
    await updateUser(u.id, { active: !u.active });
    if (me) await logActivity(me, u.active ? 'USER_DEACTIVATED' : 'USER_ACTIVATED', 'user', u.username);
    toast({ title: u.active ? '🔒 Usuario desactivado' : '✅ Usuario activado' });
    load();
  };

  const handleResetPassword = async () => {
    if (!showResetId || newPass.length < 4) return;
    await updateUser(showResetId, { password_hash: await hashPassword(newPass) });
    if (me) await logActivity(me, 'PASSWORD_RESET', 'user', showResetId);
    toast({ title: '🔑 Contraseña actualizada' });
    setShowResetId(null);
    setNewPass('');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestiona los perfiles de acceso al sistema</p>
        </div>
        <Button onClick={() => { setShowAdd(true); setError(''); }} className="gold-gradient text-primary-foreground gap-2">
          <Plus className="h-4 w-4" /> Nuevo usuario
        </Button>
      </div>

      {/* User list */}
      <div className="space-y-3">
        {users.map(u => (
          <div key={u.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-5 sm:flex-nowrap">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {u.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="break-words font-semibold">{u.display_name}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  @{u.username}
                </span>
                {!u.active && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">inactivo</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{ROLE_LABELS[u.role]} · {ROLE_DESC[u.role]}</p>
              {u.last_login && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Último acceso: {new Date(u.last_login).toLocaleString('es-CO')}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {u.role !== 'master' && (
                <>
                  <Button variant="outline" size="icon" onClick={() => { setShowResetId(u.id); setNewPass(''); }}>
                    <Key className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => toggleActive(u)}>
                    {u.active ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-500" />}
                  </Button>
                </>
              )}
              {u.role === 'master' && (
                <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Maestro
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create user dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Crear nuevo usuario</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nombre completo</label>
              <Input value={form.displayName} onChange={e => update('displayName', e.target.value)} placeholder="Ej: María López" className="bg-secondary/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Usuario</label>
              <Input value={form.username} onChange={e => update('username', e.target.value)} placeholder="Ej: maria" autoCapitalize="none" className="bg-secondary/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contraseña</label>
              <div className="relative">
                <Input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => update('password', e.target.value)} placeholder="Mínimo 4 caracteres" className="bg-secondary/50 pr-10" />
                <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rol</label>
              <Select value={form.role} onValueChange={v => update('role', v)}>
                <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['admin','vendedor','cajero'] as UserRole[]).map(r => (
                    <SelectItem key={r} value={r}>
                      <span>{ROLE_LABELS[r]}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{ROLE_DESC[r]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleCreate} disabled={loading} className="w-full gold-gradient text-primary-foreground">
              {loading ? 'Creando...' : 'Crear usuario'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!showResetId} onOpenChange={() => setShowResetId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Restablecer contraseña</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nueva contraseña</label>
              <div className="relative">
                <Input type={showNewPass ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mínimo 4 caracteres" className="bg-secondary/50 pr-10" />
                <button type="button" onClick={() => setShowNewPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button onClick={handleResetPassword} disabled={newPass.length < 4} className="w-full gold-gradient text-primary-foreground">
              Guardar nueva contraseña
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersPage;
