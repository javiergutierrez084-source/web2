import { ShieldX } from 'lucide-react';
export default function AccessDenied() {
  return <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-card p-8 text-center"><ShieldX className="mx-auto h-12 w-12 text-destructive"/><h1 className="mt-4 text-2xl font-bold">Acceso denegado</h1><p className="mt-2 text-muted-foreground">Esta sección está disponible únicamente para el usuario Maestro.</p></div>;
}
