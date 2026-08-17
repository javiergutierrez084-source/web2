import { useState } from 'react';
import { Plus, Search, Users as UsersIcon, X, Pencil, Save } from 'lucide-react';
import { formatCurrency, isSoldByWeight } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/data/mockData';
import { buildTableDocumentData } from '@/lib/pdf';
import PdfDocumentActions from '@/components/PdfDocumentActions';
import { formatShortDate, formatWeight } from '@/lib/utils';
import { useSupplierHistoryService } from '@/hooks/useSupplierHistoryService';
import { calculateCustomerSalesSummary } from '@/lib/customerSalesAnalytics';

const Contacts = () => {
  const { company, contacts, setContacts, invoices } = useApp();
  const { service: supplierHistoryService } = useSupplierHistoryService();
  const { toast } = useToast();
  const [tab, setTab] = useState<'all' | 'client' | 'supplier'>('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', document: '', phone: '', email: '', address: '', notes: '', type: 'client' as 'client' | 'supplier' });
  const [detailContact, setDetailContact] = useState<string | null>(null);
  const [editContact, setEditContact] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const filtered = contacts.filter(c => {
    const matchTab = tab === 'all' || c.type === tab;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.document.includes(search);
    return matchTab && matchSearch;
  });

  const handleSave = () => {
    const normalizedName = form.name.trim();
    const normalizedDocument = form.document.trim();

    if (!normalizedName) {
      toast({ title: 'Nombre requerido', description: 'Ingrese el nombre del contacto.', variant: 'destructive' });
      return;
    }

    if (normalizedDocument && contacts.some(c => c.document.trim() === normalizedDocument)) {
      toast({ title: 'Documento duplicado', description: 'Ya existe un contacto con este documento/NIT.', variant: 'destructive' });
      return;
    }

    const newContact: Contact = {
      id: crypto.randomUUID(),
      ...form,
      name: normalizedName,
      document: normalizedDocument,
    };

    setContacts([newContact, ...contacts]);
    setShowForm(false);
    setForm({ name: '', document: '', phone: '', email: '', address: '', notes: '', type: 'client' });
    toast({ title: 'Contacto guardado' });
  };

  const startEditContact = (id: string) => {
    const c = contacts.find(x => x.id === id);
    if (c) { setEditForm({ ...c }); setEditContact(id); }
  };
  const saveEditContact = () => {
    const normalizedName = String(editForm.name ?? '').trim();
    const normalizedDocument = String(editForm.document ?? '').trim();

    if (!normalizedName) {
      toast({ title: 'Nombre requerido', description: 'Ingrese el nombre del contacto.', variant: 'destructive' });
      return;
    }

    const duplicated = contacts.some(
      c => c.id !== editContact && normalizedDocument && c.document.trim() === normalizedDocument,
    );

    if (duplicated) {
      toast({ title: 'Documento duplicado', description: 'Ya existe otro contacto con este documento/NIT.', variant: 'destructive' });
      return;
    }

    setContacts(contacts.map(c => c.id === editContact
      ? { ...c, ...editForm, name: normalizedName, document: normalizedDocument }
      : c));
    setEditContact(null);
    toast({ title: 'Contacto actualizado' });
  };
  const deleteContact = (id: string) => {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    if (!window.confirm('¿Está seguro de eliminar este contacto?')) return;

    const hasAssociatedMovements =
      (contact.type === 'client' && invoices.some(i => i.clientId === id)) ||
      (contact.type === 'supplier' && supplierHistoryService.hasCommercialHistory(id));

    if (hasAssociatedMovements) {
      toast({
        title: 'No se puede eliminar',
        description: 'Este contacto tiene movimientos asociados.',
        variant: 'destructive',
      });
      return;
    }

    setContacts(contacts.filter(c => c.id !== id));
    setDetailContact(null);
    toast({ title: 'Contacto eliminado correctamente.' });
  };
  // Detail view data
  const dc = detailContact ? contacts.find(c => c.id === detailContact) : null;

  const getClientStats = (clientId: string) => {
    const summary = calculateCustomerSalesSummary(invoices, clientId);
    const clientInvoices = summary?.invoices ?? [];
    const totalPurchased = summary?.totalPurchased ?? 0;
    const totalPaid = totalPurchased;
    const pending = 0;
    return { clientInvoices, totalPurchased, totalPaid, pending };
  };

  const getSupplierStats = (supplierId: string) => supplierHistoryService.getSupplierHistory(supplierId);

  const formatAdjustmentDate = (date: string, createdAt = '') => {
    const rawDate = date || createdAt;
    if (!rawDate) return '—';

    const parsed = new Date(rawDate.includes('T') ? rawDate : `${rawDate}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString('es-CO');
  };

  const buildContactsListDocument = (type: 'client' | 'supplier') => {
    const list = contacts.filter(contact => contact.type === type);
    return buildTableDocumentData({
      company,
      title: type === 'client' ? 'Listado de Clientes' : 'Listado de Proveedores',
      subtitle: `${list.length} registros`,
      columns: [
        { header: 'Nombre' }, { header: 'Documento' }, { header: 'Teléfono' },
        { header: 'Email' }, { header: 'Dirección' },
      ],
      rows: list.map(contact => [contact.name, contact.document, contact.phone, contact.email, contact.address]),
    });
  };

  const buildContactDetailDocument = (contact: Contact) => {
    if (contact.type === 'client') {
      const stats = getClientStats(contact.id);
      return buildTableDocumentData({
        company,
        title: `Ficha de Cliente: ${contact.name}`,
        subtitle: `${contact.document || 'Sin documento'} · ${contact.phone || 'Sin teléfono'}`,
        columns: [
          { header: 'Fecha' }, { header: 'Documento' }, { header: 'Estado' }, { header: 'Total', align: 'right' },
        ],
        rows: stats.clientInvoices.map(invoice => [invoice.date, invoice.number, invoice.status, formatCurrency(invoice.total)]),
        summaryLines: [
          { label: 'Total comprado', value: formatCurrency(stats.totalPurchased) },
          { label: 'Total pagado', value: formatCurrency(stats.totalPaid) },
          { label: 'Saldo pendiente', value: formatCurrency(stats.pending), bold: true },
        ],
        notes: [contact.address, contact.email, contact.notes].filter(Boolean).join(' · '),
      });
    }

    const stats = getSupplierStats(contact.id);
    return buildTableDocumentData({
      company,
      title: `Estado de Cuenta del Proveedor: ${contact.name}`,
      subtitle: `${contact.document || 'Sin documento'} · ${contact.phone || 'Sin teléfono'}`,
      columns: [
        { header: 'Fecha' }, { header: 'Documento' }, { header: 'Productos' },
        { header: 'Gramos', align: 'right' }, { header: 'Total', align: 'right' },
        { header: 'Proveedor' }, { header: 'Observaciones' },
      ],
      rows: stats.compras.map(entry => [
        formatAdjustmentDate(entry.date),
        entry.documentNumber,
        entry.productLabels.join(', ') || 'Producto no disponible',
        `${formatWeight(entry.grams)} g`,
        formatCurrency(entry.total),
        entry.supplierName || contact.name,
        entry.notes || '—',
      ]),
      summaryLines: [
        { label: 'Total invertido', value: formatCurrency(stats.totalInvertido) },
        { label: 'Total gramos adquiridos', value: `${formatWeight(stats.totalGramos)} g` },
        { label: 'Número de entradas', value: String(stats.numeroEntradas) },
        { label: 'Última compra', value: stats.ultimaCompra ? formatAdjustmentDate(stats.ultimaCompra) : 'Sin compras', bold: true },
      ],
      notes: [contact.address, contact.email, contact.notes].filter(Boolean).join(' · '),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Contactos</h1>
          <p className="text-sm text-muted-foreground mt-1">{contacts.length} contactos registrados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PdfDocumentActions document={() => buildContactsListDocument('client')} label="Clientes PDF" formats={['letter']} />
          <PdfDocumentActions document={() => buildContactsListDocument('supplier')} label="Proveedores PDF" formats={['letter']} />
          <Button onClick={() => setShowForm(true)} className="gold-gradient text-primary-foreground font-semibold gap-2">
            <Plus className="h-4 w-4" /> Nuevo Contacto
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-primary/20 bg-card p-5 space-y-4 animate-fade-in">
          <h3 className="font-semibold">Nuevo Contacto</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Tipo</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as any })} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
                <option value="client">Cliente</option>
                <option value="supplier">Proveedor</option>
              </select>
            </div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wider">Nombre *</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre completo" className="bg-secondary/50 border-border" /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wider">Documento / NIT</label><Input value={form.document} onChange={e => setForm({ ...form, document: e.target.value })} placeholder="Número de documento" className="bg-secondary/50 border-border" /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wider">Teléfono</label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Teléfono" className="bg-secondary/50 border-border" /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wider">Email</label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="correo@email.com" className="bg-secondary/50 border-border" /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase tracking-wider">Dirección</label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Dirección" className="bg-secondary/50 border-border" /></div>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleSave} className="gold-gradient text-primary-foreground font-semibold">Guardar</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
          {(['all', 'client', 'supplier'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'all' ? 'Todos' : t === 'client' ? 'Clientes' : 'Proveedores'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." className="pl-9 bg-card border-border" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map(c => (
          <div key={c.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-all cursor-pointer" onClick={() => setDetailContact(c.id)}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{c.document}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.type === 'client' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                {c.type === 'client' ? 'Cliente' : 'Proveedor'}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              {c.phone && <p>📞 {c.phone}</p>}
              {c.email && <p>✉️ {c.email}</p>}
              {c.address && <p>📍 {c.address}</p>}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <UsersIcon className="h-10 w-10 mb-2" /><p className="text-sm">No se encontraron contactos</p>
        </div>
      )}

      {/* DETAIL MODAL */}
      {dc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setDetailContact(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card p-6 space-y-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-bold">{dc.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${dc.type === 'client' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                  {dc.type === 'client' ? 'Cliente' : 'Proveedor'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <PdfDocumentActions compact document={() => buildContactDetailDocument(dc)} title="Documentos PDF" formats={['letter']} />
                <Button size="sm" variant="outline" className="gap-1.5" onClick={(e) => { e.stopPropagation(); setDetailContact(null); startEditContact(dc.id); }}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Button>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); deleteContact(dc.id); }}>
                  Eliminar
                </Button>
                <button onClick={() => setDetailContact(null)} className="p-1.5 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Documento:</span> {dc.document || '—'}</div>
              <div><span className="text-muted-foreground">Teléfono:</span> {dc.phone || '—'}</div>
              <div><span className="text-muted-foreground">Email:</span> {dc.email || '—'}</div>
              <div><span className="text-muted-foreground">Dirección:</span> {dc.address || '—'}</div>
            </div>

            {dc.type === 'client' && (() => {
              const stats = getClientStats(dc.id);
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Total comprado</p>
                      <p className="text-lg font-bold">{formatCurrency(stats.totalPurchased)}</p>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Total pagado</p>
                      <p className="text-lg font-bold text-success">{formatCurrency(stats.totalPaid)}</p>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Saldo pendiente</p>
                      <p className={`text-lg font-bold ${stats.pending > 0 ? 'text-warning' : ''}`}>{formatCurrency(stats.pending)}</p>
                    </div>
                  </div>
                  {stats.clientInvoices.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Historial de compras</p>
                      <div className="space-y-1.5">
                        {stats.clientInvoices.map(inv => (
                          <div key={inv.id} className="flex justify-between items-center rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                            <div><span className="font-mono text-primary text-xs mr-2">{inv.number}</span><span className="text-muted-foreground">{inv.date}</span></div>
                            <div className="text-right"><span className="font-medium">{formatCurrency(inv.total)}</span>
                              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{inv.status === 'paid' ? 'Pagada' : 'Pendiente'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {dc.type === 'supplier' && (() => {
              const stats = getSupplierStats(dc.id);
              const associatedProducts = stats.productos;

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <div className="col-span-2 flex min-w-0 flex-col items-stretch rounded-lg bg-primary/5 border border-primary/20 p-4 text-center lg:col-span-2">
                      <p className="text-xs text-muted-foreground uppercase mb-1">Total invertido</p>
                      <p className="block w-full min-w-0 whitespace-normal break-words text-lg font-bold leading-tight">{formatCurrency(stats.totalInvertido)}</p>
                    </div>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center">
                      <p className="text-xs text-muted-foreground uppercase mb-1">Total gramos adquiridos</p>
                      <p className="text-xl font-bold">{formatWeight(stats.totalGramos)} g</p>
                    </div>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center">
                      <p className="text-xs text-muted-foreground uppercase mb-1">Número de entradas</p>
                      <p className="text-xl font-bold">{stats.numeroEntradas}</p>
                    </div>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center">
                      <p className="text-xs text-muted-foreground uppercase mb-1">Última compra</p>
                      <p className="text-xl font-bold">{stats.ultimaCompra ? formatShortDate(stats.ultimaCompra) : 'Sin compras'}</p>
                    </div>
                  </div>

                  {associatedProducts.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">📦 Productos asociados en inventario</p>
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[640px] text-xs">
                          <thead>
                            <tr className="bg-secondary/50 border-b border-border">
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Código</th>
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Producto</th>
                              <th className="px-3 py-2 text-center text-muted-foreground font-medium">Stock</th>
                              <th className="px-3 py-2 text-right text-muted-foreground font-medium">Último P. compra</th>
                              <th className="px-3 py-2 text-right text-muted-foreground font-medium">P. venta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {associatedProducts.map(p => (
                              <tr key={p.id} className="border-b border-border/50">
                                <td className="px-3 py-2 font-mono text-primary">{p.code}</td>
                                <td className="px-3 py-2">{p.name}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${p.stock <= p.minStock ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}>
                                    {isSoldByWeight(p) ? `${formatWeight(p.stock)} g` : p.stock}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">{formatCurrency(p.purchasePrice)}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.salePrice)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {stats.compras.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Historial comercial reconstruido</p>
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full min-w-[900px] text-xs">
                          <thead>
                            <tr className="bg-secondary/50 border-b border-border">
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Fecha</th>
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Documento</th>
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Productos</th>
                              <th className="px-3 py-2 text-right text-muted-foreground font-medium">Gramos</th>
                              <th className="px-3 py-2 text-right text-muted-foreground font-medium">Total</th>
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Proveedor</th>
                              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Observaciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.compras.map(entry => (
                              <tr key={entry.id} className="border-b border-border/50">
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                  {formatAdjustmentDate(entry.date)}
                                </td>
                                <td className="px-3 py-2 font-mono text-primary">{entry.documentNumber}</td>
                                <td className="px-3 py-2">{entry.productLabels.join(', ') || 'Producto no disponible'}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatWeight(entry.grams)} g</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(entry.total)}</td>
                                <td className="px-3 py-2">{entry.supplierName || dc.name}</td>
                                <td className="px-3 py-2 text-muted-foreground">{entry.notes || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-secondary/20 px-4 py-6 text-center text-sm text-muted-foreground">
                      No hay compras ni entradas históricas registradas para este proveedor.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* EDIT CONTACT MODAL */}
      {editContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setEditContact(null)}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Editar Contacto</h3>
              <button onClick={() => setEditContact(null)} className="p-1.5 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Nombre</label><Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Documento</label><Input value={editForm.document} onChange={e => setEditForm({ ...editForm, document: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Teléfono</label><Input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground uppercase">Email</label><Input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="bg-secondary/50 border-border" /></div>
              <div className="space-y-1 sm:col-span-2"><label className="text-xs text-muted-foreground uppercase">Dirección</label><Input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} className="bg-secondary/50 border-border" /></div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={saveEditContact} className="gold-gradient text-primary-foreground font-semibold gap-2"><Save className="h-4 w-4" /> Guardar</Button>
              <Button variant="outline" onClick={() => setEditContact(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Contacts;
