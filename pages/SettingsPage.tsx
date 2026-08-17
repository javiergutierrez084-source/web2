import { useState } from 'react';
import { Save, Upload, Building2, Network, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import ExceptionalCashMaintenancePanel from '@/components/ExceptionalCashMaintenancePanel';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasSessionPermission } from '@/lib/auth';
import WorkModeSelector from '@/components/WorkModeSelector';
import BackupStatusIndicator from '@/components/BackupStatusIndicator';
import LayawayAlertSettingsPanel from '@/components/LayawayAlertSettingsPanel';

const SettingsPage = () => {
  const { company, setCompany } = useApp();
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ ...company });
  const canManageSettings = hasSessionPermission(user, 'manage_settings');

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setForm(prev => ({ ...prev, logoUrl: url }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    setCompany(form);
    toast({ title: '✅ Configuración guardada', description: 'Los datos de la empresa se actualizaron correctamente.' });
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración de Empresa</h1>
        <p className="text-sm text-muted-foreground mt-1">Estos datos aparecerán en facturas, cotizaciones y documentos PDF</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        {/* Logo */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Logo de la empresa</label>
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-20 w-20 rounded-xl border-2 border-dashed border-border bg-secondary/50 flex items-center justify-center overflow-hidden">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div>
              <label className="cursor-pointer">
                <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors">
                  <Upload className="h-4 w-4" />
                  Subir logo
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </label>
              <p className="text-[10px] text-muted-foreground mt-1">PNG, JPG hasta 2MB. Recomendado: 200x200px</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nombre de la empresa</label>
            <Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Mi Joyería" className="bg-secondary/50 border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">NIT</label>
            <Input value={form.nit} onChange={(e) => update('nit', e.target.value)} placeholder="900123456-1" className="bg-secondary/50 border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Teléfono</label>
            <Input value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="601 234 5678" className="bg-secondary/50 border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
            <Input value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="info@joyeria.com" className="bg-secondary/50 border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ciudad</label>
            <Input value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="Bogotá" className="bg-secondary/50 border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dirección</label>
            <Input value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="Cra 15 #45-20" className="bg-secondary/50 border-border" />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={handleSave} className="gold-gradient text-primary-foreground font-semibold gap-2">
            <Save className="h-4 w-4" />
            Guardar Configuración
          </Button>
        </div>
      </div>

      {canManageSettings && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Modo de trabajo</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cambiar entre datos locales, Cliente LAN o detección automática sin alterar la interfaz.</p>
          </div>
          <WorkModeSelector variant="settings" />
        </div>
      )}

      {canManageSettings && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Comunicación LAN</h2>
          <p className="mt-1 text-sm text-muted-foreground">Configurar el Servidor Principal, clientes y diagnóstico de red.</p>
          <Button asChild className="mt-4"><Link to="/configuracion/lan"><Network className="mr-2 h-4 w-4"/>Abrir Comunicación LAN</Link></Button>
        </div>
      )}

      {canManageSettings && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Servidor Online</h2>
          <p className="mt-1 text-sm text-muted-foreground">Descubrir, recordar e iniciar una sesión segura con un Servidor Principal HTTPS.</p>
          <Button asChild className="mt-4"><Link to="/configuracion/servidor-online"><Globe2 className="mr-2 h-4 w-4"/>Configurar Servidor Online</Link></Button>
        </div>
      )}

      {canManageSettings && <BackupStatusIndicator variant="settings" />}

      {canManageSettings && <LayawayAlertSettingsPanel />}

      <ExceptionalCashMaintenancePanel />

      {/* Preview */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold mb-3">Vista previa en facturas</h3>
        <div className="flex min-w-0 items-start gap-3 rounded-lg bg-secondary/30 p-4">
          <div className="h-12 w-12 rounded-lg bg-secondary flex items-center justify-center overflow-hidden shrink-0">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <Building2 className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="break-words font-bold">{form.name || 'Nombre de empresa'}</p>
            {form.nit && <p className="text-xs text-muted-foreground">NIT: {form.nit}</p>}
            {form.city && <p className="text-xs text-muted-foreground">{form.city}{form.address ? ` - ${form.address}` : ''}</p>}
            {form.phone && <p className="text-xs text-muted-foreground">Tel: {form.phone}</p>}
            {form.email && <p className="text-xs text-muted-foreground">{form.email}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
