import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Search, Save, Pencil, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/data/mockData';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/use-toast';
import type { InvoiceItem, Contact } from '@/data/mockData';
import { formatWeight } from '@/lib/utils';

const NewQuotation = () => {
  const navigate = useNavigate();
  const { products, contacts, setContacts, quotations, createQuotation } = useApp();
  const { toast } = useToast();
  const [clientId, setClientId] = useState('');
  const [searchCode, setSearchCode] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [validDays, setValidDays] = useState(15);
  const [notes, setNotes] = useState('');
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: '', document: '', phone: '', email: '', address: '' });

  const clients = contacts.filter(c => c.type === 'client');

  const matchedProducts = useMemo(() => {
    if (!searchCode) return [];
    return products.filter(p => p.code.toLowerCase().includes(searchCode.toLowerCase()) || p.name.toLowerCase().includes(searchCode.toLowerCase())).slice(0, 5);
  }, [searchCode, products]);

  const addProduct = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const existing = items.find(i => i.productId === productId);
    if (existing) {
      setItems(items.map(i => i.productId === productId ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice } : i));
    } else {
      setItems([...items, { productId: product.id, code: product.code, name: product.name, quantity: 1, weightGrams: product.weightGrams, unitPrice: product.salePrice, subtotal: product.salePrice, originalPrice: product.salePrice, priceModified: false }]);
    }
    setSearchCode('');
  };

  const removeItem = (productId: string) => setItems(items.filter(i => i.productId !== productId));

  const updateQuantity = (productId: string, qty: number) => {
    if (qty < 1) return;
    setItems(items.map(i => i.productId === productId ? { ...i, quantity: qty, subtotal: qty * i.unitPrice } : i));
  };

  const updateUnitPrice = (productId: string, newPrice: number) => {
    if (newPrice < 0) return;
    setItems(items.map(i => i.productId === productId ? { ...i, unitPrice: newPrice, subtotal: i.quantity * newPrice, priceModified: newPrice !== (i.originalPrice ?? 0), originalPrice: i.originalPrice ?? i.unitPrice } : i));
  };

  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal - discount + taxAmount;

  const handleSaveNewClient = () => {
    if (!newClientForm.name) return;
    const newClient: Contact = { id: crypto.randomUUID(), type: 'client', ...newClientForm, notes: '' };
    setContacts([newClient, ...contacts]);
    setClientId(newClient.id);
    setShowNewClient(false);
    setNewClientForm({ name: '', document: '', phone: '', email: '', address: '' });
    toast({ title: '✅ Cliente creado' });
  };

  const handleSave = async () => {
    if (items.length === 0 || !clientId) return;
    const client = clients.find(c => c.id === clientId);
    const today = new Date();
    const validUntilDate = new Date(today);
    validUntilDate.setDate(validUntilDate.getDate() + validDays);

    try {
      const quotation = await createQuotation({
        clientId,
        clientName: client?.name || '',
        items,
        subtotal,
        discount,
        tax: taxAmount,
        total,
        date: today.toISOString().split('T')[0],
        validUntil: validUntilDate.toISOString().split('T')[0],
        status: 'active',
        notes,
      });
      toast({ title: '✅ Cotización guardada', description: quotation.number });
      navigate('/cotizaciones');
    } catch (error) {
      console.error('No se pudo crear la cotización.', error);
      toast({
        title: 'No se pudo guardar la cotización',
        description: 'No se creó ningún registro. Intenta nuevamente.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="w-full max-w-7xl space-y-6">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={() => navigate('/cotizaciones')} className="rounded-lg p-2 hover:bg-secondary transition-colors"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold">Nueva Cotización</h1>
          <p className="text-sm text-muted-foreground">N° COT-{String(quotations.length + 1).padStart(4, '0')}</p>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Client */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cliente</label>
              <button onClick={() => setShowNewClient(true)} className="flex items-center gap-1 text-xs text-primary hover:underline"><UserPlus className="h-3.5 w-3.5" /> Crear nuevo</button>
            </div>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary">
              <option value="">Seleccionar cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} - {c.document}</option>)}
            </select>
          </div>

          {/* New client modal */}
          {showNewClient && (
            <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
              <h4 className="text-sm font-semibold">Nuevo Cliente</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Nombre *" value={newClientForm.name} onChange={e => setNewClientForm({ ...newClientForm, name: e.target.value })} className="bg-secondary/50 border-border" />
                <Input placeholder="Documento" value={newClientForm.document} onChange={e => setNewClientForm({ ...newClientForm, document: e.target.value })} className="bg-secondary/50 border-border" />
                <Input placeholder="Teléfono" value={newClientForm.phone} onChange={e => setNewClientForm({ ...newClientForm, phone: e.target.value })} className="bg-secondary/50 border-border" />
                <Input placeholder="Email" value={newClientForm.email} onChange={e => setNewClientForm({ ...newClientForm, email: e.target.value })} className="bg-secondary/50 border-border" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveNewClient} className="gold-gradient text-primary-foreground font-semibold">Guardar</Button>
                <Button size="sm" variant="outline" onClick={() => setShowNewClient(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* Product search */}
          <div className="rounded-xl border border-border bg-card p-4">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agregar Producto</label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código o nombre..." className="pl-9 bg-secondary/50 border-border" value={searchCode} onChange={e => setSearchCode(e.target.value)} />
            </div>
            {matchedProducts.length > 0 && (
              <div className="mt-2 rounded-lg border border-border bg-popover overflow-hidden">
                {matchedProducts.map(p => (
                  <button key={p.id} onClick={() => addProduct(p.id)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-secondary/50 transition-colors border-b border-border/50 last:border-0">
                    <div className="text-left">
                      <span className="font-mono text-xs text-primary mr-2">{p.code}</span><span>{p.name}</span><span className="text-muted-foreground ml-2">({formatWeight(p.weightGrams)} g)</span>
                    </div>
                    <span className="font-medium">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items table */}
          {items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[660px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Producto</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Cant.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">P. Unit.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Subtotal</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.productId} className="border-b border-border/50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.code} · {formatWeight(item.weightGrams)} g</p>
                        {item.priceModified && <span className="text-[10px] text-warning flex items-center gap-1 mt-0.5"><Pencil className="h-2.5 w-2.5" /> Precio modificado</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input type="number" min={1} value={item.quantity} onChange={e => updateQuantity(item.productId, parseInt(e.target.value) || 1)} className="w-14 rounded border border-border bg-secondary/50 px-2 py-1 text-center text-sm outline-none focus:ring-1 focus:ring-primary" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editingPrice === item.productId ? (
                          <input type="number" autoFocus min={0} value={item.unitPrice} onChange={e => updateUnitPrice(item.productId, parseFloat(e.target.value) || 0)} onBlur={() => setEditingPrice(null)} onKeyDown={e => e.key === 'Enter' && setEditingPrice(null)} className="w-28 rounded border border-primary bg-secondary/50 px-2 py-1 text-right text-sm outline-none focus:ring-1 focus:ring-primary" />
                        ) : (
                          <button onClick={() => setEditingPrice(item.productId)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">{formatCurrency(item.unitPrice)}<Pencil className="h-3 w-3" /></button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                      <td className="px-2 py-2.5"><button onClick={() => removeItem(item.productId)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notas / Condiciones</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Ej: Precios sujetos a cambio sin previo aviso. Garantía de 6 meses..." className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary resize-none" />
          </div>
        </div>

        {/* Right: Summary */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-6">
            <h3 className="font-semibold">Resumen Cotización</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Descuento</span>
                <input type="number" min={0} value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} className="w-28 rounded border border-border bg-secondary/50 px-2 py-1 text-right text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">IVA (%)</span>
                <input type="number" min={0} max={100} value={taxRate} onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} className="w-20 rounded border border-border bg-secondary/50 px-2 py-1 text-right text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              {taxAmount > 0 && <div className="flex justify-between text-muted-foreground"><span>Impuesto</span><span>{formatCurrency(taxAmount)}</span></div>}
              <div className="border-t border-border pt-2 flex justify-between font-bold text-lg"><span>Total</span><span className="gold-text">{formatCurrency(total)}</span></div>
            </div>

            {/* Validity */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vigencia (días)</label>
              <input type="number" min={1} value={validDays} onChange={e => setValidDays(parseInt(e.target.value) || 15)} className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
            </div>

            <Button onClick={handleSave} disabled={items.length === 0 || !clientId} className="w-full gold-gradient text-primary-foreground font-semibold gap-2 h-11">
              <Save className="h-4 w-4" /> Guardar Cotización
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewQuotation;
