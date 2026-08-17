import LanCommunicationPanel from '@/components/LanCommunicationPanel';

export default function LanConfigurationPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Comunicación LAN</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configuración exclusiva del usuario Maestro.</p>
      </div>
      <LanCommunicationPanel />
    </div>
  );
}
