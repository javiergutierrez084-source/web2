import { useState, useEffect } from 'react';
import { Activity, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ActivityLogRecord } from '@/domain/models';
import { fetchActivityLog } from '@/lib/auth';
import { useApp } from '@/contexts/AppContext';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import ExcelDocumentActions from '@/components/ExcelDocumentActions';

const ACTION_LABELS: Record<string, string> = {
  INVOICE_CREATED: '🧾 Factura creada', INVOICE_CANCELLED: '❌ Factura cancelada',
  PRODUCT_CREATED: '📦 Producto creado', PRODUCT_UPDATED: '✏️ Producto editado',
  PRODUCT_DELETED: '🗑️ Producto eliminado', USER_CREATED: '👤 Usuario creado',
  USER_ACTIVATED: '✅ Usuario activado', USER_DEACTIVATED: '🔒 Usuario desactivado',
  PASSWORD_RESET: '🔑 Contraseña restablecida', PURCHASE_CREATED: '🛒 Compra creada', PURCHASE_EDITED: '✏️ Compra editada', PURCHASE_DELETED: '🗑️ Compra eliminada', PURCHASE_MARKED_AS_PAID: '💳 Compra pagada', PAYABLE_EDITED: '✏️ Cuenta por pagar editada', PAYABLE_DELETED: '🗑️ Cuenta por pagar eliminada', EXPENSE_MARKED_AS_PAID: '💳 Gasto pagado',
  QUOTATION_CREATED: '📋 Cotización creada', INVENTORY_ADJUSTED: '📊 Inventario ajustado',
  CASH_OPENED: '💰 Caja abierta', CASH_CLOSED: '🔐 Caja cerrada',
  BACKUP_CREATED: '💾 Respaldo creado', BACKUP_RESTORED: '♻️ Respaldo restaurado',
};

const ActivityPage = () => {
  const { company } = useApp();
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchActivityLog(500).then(setLogs);
  }, []);

  const filtered = logs.filter(l =>
    !search || l.user_name.toLowerCase().includes(search.toLowerCase()) ||
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    l.detail.toLowerCase().includes(search.toLowerCase())
  );

  const buildActivityDocument = () => buildTableDocumentData({
    company,
    title: 'Registro de Actividad',
    subtitle: `${filtered.length} acciones`,
    columns: [
      { header: 'Fecha' }, { header: 'Usuario' }, { header: 'Acción' },
      { header: 'Entidad' }, { header: 'Referencia' }, { header: 'Detalle' },
    ],
    rows: filtered.map(log => [
      new Date(log.created_at).toLocaleString('es-CO'),
      log.user_name,
      ACTION_LABELS[log.action] || log.action,
      log.entity,
      log.entity_id,
      log.detail,
    ]),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 break-words text-2xl font-bold">
            <Activity className="h-6 w-6 text-primary" /> Registro de Actividad
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Últimas 500 acciones del sistema</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2"><PdfDocumentActions document={buildActivityDocument} label="PDF" formats={['letter']} /><ExcelDocumentActions document={buildActivityDocument} /></div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por usuario, acción..." className="pl-9 bg-secondary/50" />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No hay actividad registrada</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((log, i) => (
              <div key={i} className="flex items-start gap-4 px-5 py-3 hover:bg-secondary/20 transition-colors">
                <div className="shrink-0 pt-0.5">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {log.user_name.charAt(0).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{log.user_name}</span>
                    <span className="text-sm">{ACTION_LABELS[log.action] || log.action}</span>
                  </div>
                  {log.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{log.detail}</p>}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground text-right">
                  {new Date(log.created_at).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityPage;
