import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/data/mockData';

const NewProduct = () => {
  const navigate = useNavigate();
  const { products, setProducts, contacts, setContacts, categories } = useApp();
  const { toast } = useToast();

  const [form, setForm] = useState({
    code: '', name: '', category: categories[0] || '', purchasePrice: '', salePrice: '',
    weightGrams: '', stock: '', minStock: '', description: '', supplierIds: [] as string[],
  });

  // New supplier inline form
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', document: '', phone: '', email: '', address: '' });

  const purchase = parseFloat(form.purchasePrice) || 0;
  const sale = parseFloat(form.salePrice) || 0;
  const margin = purchase > 0 ? ((sale - purchase) / purchase * 100) : 0;
  const profit = sale - purchase;

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const toggleSupplier = (id: string) => {
    setForm(prev => ({ ...prev, supplierIds: prev.supplierIds.includes(id) ? prev.supplierIds.filter(s => s !== id) : [...prev.supplierIds, id] }));
  };

  const handleCreateSupplier = () => {
    if (!newSupplier.name.trim()) {
      toast({ title: '⚠️ El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    const newContact: Contact = {
      id: crypto.randomUUID(),
      type: 'supplier',
      name: newSupplier.name.trim(),
      document: newSupplier.document,
      phone: newSupplier.phone,
      email: newSupplier.email,
      address: newSupplier.address,
      notes: '',
    };
    setContacts([newContact, ...contacts]);
    setForm(prev => ({ ...prev, supplierIds: [...prev.supplierIds, newContact.id] }));
    setNewSupplier({ name: '', document: '', phone: '', email: '', address: '' });
    setShowNewSupplier(false);
    toast({ title: '✅ Proveedor creado y asociado' });
  };

  const handleSave = () => {
    if (products.some(p => p.code === form.code)) { toast({ title: '⚠️ Código duplicado', variant: 'destructive' }); return; }
    if (!form.code || !form.name) { toast({ title: '⚠️ Código y nombre obligatorios', variant: 'destructive' }); return; }
    if (sale <= 0) { toast({ title: '⚠️ Precio de venta obligatorio', description: 'Debe ser mayor a 0', variant: 'destructive' }); return; }
    const newProduct = {
      id: crypto.randomUUID(), code: form.code, name: form.name, category: form.category,
      purchasePrice: purchase, salePrice: sale, weightGrams: parseFloat(form.weightGrams) || 0,
      margin, stock: parseFloat(form.stock) || 0, minStock: parseFloat(form.minStock) || 0,
      description: form.description, supplierIds: form.supplierIds,
    };
    setProducts([newProduct, ...products]);
    toast({ title: '✅ Producto creado', description: form.code });
    navigate('/inventario');
  };

  // Get current suppliers list (including newly created ones)
  const currentSuppliers = contacts.filter(c => c.type === 'supplier');

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="rounded-lg p-2 hover:bg-secondary transition-colors"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0"><h1 className="break-words text-2xl font-bold">Nuevo Producto</h1><p className="break-words text-sm text-muted-foreground">Registrar un nuevo artículo al inventario</p></div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Código *</label><Input placeholder="Ej: AN-003" value={form.code} onChange={e => update('code', e.target.value)} className="bg-secondary/50 border-border" /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nombre *</label><Input placeholder="Nombre del producto" value={form.name} onChange={e => update('name', e.target.value)} className="bg-secondary/50 border-border" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Categoría</label>
            <select value={form.category} onChange={e => update('category', e.target.value)} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Peso (gramos)</label><Input type="number" step="0.1" placeholder="0.0" value={form.weightGrams} onChange={e => update('weightGrams', e.target.value)} className="bg-secondary/50 border-border" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Precio Compra</label><Input type="number" placeholder="0" value={form.purchasePrice} onChange={e => update('purchasePrice', e.target.value)} className="bg-secondary/50 border-border" /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Precio Venta</label><Input type="number" placeholder="0" value={form.salePrice} onChange={e => update('salePrice', e.target.value)} className="bg-secondary/50 border-border" /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Margen</label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <span className={`text-sm font-bold ${margin > 0 ? 'text-success' : 'text-muted-foreground'}`}>{margin.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">({profit > 0 ? '+' : ''}{profit.toLocaleString('es-CO')})</span>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{form.category === 'Venta por gramos' ? 'Stock (gramos)' : 'Stock Actual'}</label><Input type="number" step={form.category === 'Venta por gramos' ? '0.1' : '1'} placeholder="0" value={form.stock} onChange={e => update('stock', e.target.value)} className="bg-secondary/50 border-border" /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{form.category === 'Venta por gramos' ? 'Stock Mínimo (gramos)' : 'Stock Mínimo'}</label><Input type="number" step={form.category === 'Venta por gramos' ? '0.1' : '1'} placeholder="0" value={form.minStock} onChange={e => update('minStock', e.target.value)} className="bg-secondary/50 border-border" /></div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proveedores</label>
            <button
              type="button"
              onClick={() => setShowNewSupplier(!showNewSupplier)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Nuevo proveedor
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {currentSuppliers.map(s => (
              <button key={s.id} type="button" onClick={() => toggleSupplier(s.id)} className={`rounded-full px-3 py-1 text-xs font-medium border transition-all ${form.supplierIds.includes(s.id) ? 'bg-primary/10 border-primary text-primary' : 'bg-secondary/50 border-border text-muted-foreground hover:text-foreground'}`}>{s.name}</button>
            ))}
            {currentSuppliers.length === 0 && !showNewSupplier && (
              <p className="text-xs text-muted-foreground">No hay proveedores. Crea uno nuevo.</p>
            )}
          </div>

          {/* Inline new supplier form */}
          {showNewSupplier && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 mt-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Nuevo Proveedor</h4>
                <button onClick={() => setShowNewSupplier(false)} className="p-1 rounded hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Nombre *</label>
                  <Input value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="Nombre del proveedor" className="h-8 text-sm bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">NIT / Documento</label>
                  <Input value={newSupplier.document} onChange={e => setNewSupplier({ ...newSupplier, document: e.target.value })} placeholder="NIT" className="h-8 text-sm bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Teléfono</label>
                  <Input value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} placeholder="Teléfono" className="h-8 text-sm bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase">Email</label>
                  <Input value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} placeholder="correo@email.com" className="h-8 text-sm bg-card border-border" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreateSupplier} className="gold-gradient text-primary-foreground text-xs gap-1">
                  <Save className="h-3 w-3" /> Crear y Asociar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewSupplier(false)} className="text-xs">Cancelar</Button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Descripción</label>
          <textarea placeholder="Descripción opcional..." value={form.description} onChange={e => update('description', e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={handleSave} className="gold-gradient text-primary-foreground font-semibold gap-2"><Save className="h-4 w-4" /> Guardar Producto</Button>
          <Button variant="outline" onClick={() => navigate('/inventario')}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
};

export default NewProduct;
