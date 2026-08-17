import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, Smartphone, Monitor, Apple, Check, ChevronLeft, Wifi, WifiOff, Share, MoreVertical, Plus, Globe } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'pc' | 'android' | 'ios' | null;

const InstallApp = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => setIsInstalled(true);

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">¡App instalada!</h1>
        <p className="text-muted-foreground">JoyaControl ya está disponible en tu dispositivo. Puedes acceder desde tu pantalla de inicio.</p>
      </div>
    );
  }

  const platforms = [
    {
      id: 'pc' as Platform,
      icon: Monitor,
      label: 'PC / Escritorio',
      desc: 'Windows, Mac o Linux',
    },
    {
      id: 'android' as Platform,
      icon: Smartphone,
      label: 'Android',
      desc: 'Chrome o navegador compatible',
    },
    {
      id: 'ios' as Platform,
      icon: Apple,
      label: 'iPhone / iPad',
      desc: 'Safari',
    },
  ];

  const renderPlatformGuide = () => {
    if (selectedPlatform === 'pc') {
      return (
        <div className="space-y-5">
          {deferredPrompt ? (
            <div className="space-y-4 text-center">
              <p className="text-muted-foreground">Tu navegador soporta instalación directa. Haz clic en el botón para instalar.</p>
              <Button onClick={handleInstall} className="w-full h-12 text-base gap-2" size="lg">
                <Download className="h-5 w-5" /> Instalar JoyaControl
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Step number={1} icon={<Globe className="h-5 w-5 text-primary" />}>
                Abre <strong>JoyaControl</strong> en <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>.
              </Step>
              <Step number={2} icon={<Download className="h-5 w-5 text-primary" />}>
                Busca el ícono de <strong>instalación</strong> (⊕) en la <strong>barra de direcciones</strong> del navegador.
              </Step>
              <Step number={3} icon={<Check className="h-5 w-5 text-primary" />}>
                Haz clic en <strong>"Instalar"</strong> en el diálogo que aparece. ¡Listo!
              </Step>
            </div>
          )}
        </div>
      );
    }

    if (selectedPlatform === 'android') {
      return (
        <div className="space-y-4">
          {deferredPrompt ? (
            <div className="space-y-4 text-center">
              <p className="text-muted-foreground">Tu navegador soporta instalación directa. Toca el botón para instalar.</p>
              <Button onClick={handleInstall} className="w-full h-12 text-base gap-2" size="lg">
                <Download className="h-5 w-5" /> Instalar JoyaControl
              </Button>
            </div>
          ) : (
            <>
              <Step number={1} icon={<Globe className="h-5 w-5 text-primary" />}>
                Abre <strong>JoyaControl</strong> en <strong>Google Chrome</strong>.
              </Step>
              <Step number={2} icon={<MoreVertical className="h-5 w-5 text-primary" />}>
                Toca el menú <strong>⋮</strong> (tres puntos) en la esquina superior derecha.
              </Step>
              <Step number={3} icon={<Plus className="h-5 w-5 text-primary" />}>
                Selecciona <strong>"Instalar app"</strong> o <strong>"Agregar a pantalla de inicio"</strong>.
              </Step>
              <Step number={4} icon={<Check className="h-5 w-5 text-primary" />}>
                Confirma tocando <strong>"Instalar"</strong>. ¡La app aparecerá en tu inicio!
              </Step>
            </>
          )}
        </div>
      );
    }

    if (selectedPlatform === 'ios') {
      return (
        <div className="space-y-4">
          <Step number={1} icon={<Globe className="h-5 w-5 text-primary" />}>
            Abre <strong>JoyaControl</strong> en <strong>Safari</strong> (obligatorio en iOS).
          </Step>
          <Step number={2} icon={<Share className="h-5 w-5 text-primary" />}>
            Toca el botón <strong>Compartir</strong> (cuadrado con flecha hacia arriba) en la barra inferior.
          </Step>
          <Step number={3} icon={<Plus className="h-5 w-5 text-primary" />}>
            Desplázate y selecciona <strong>"Agregar a pantalla de inicio"</strong>.
          </Step>
          <Step number={4} icon={<Check className="h-5 w-5 text-primary" />}>
            Toca <strong>"Agregar"</strong> en la esquina superior derecha. ¡Listo!
          </Step>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Instalar JoyaControl</h1>
        <p className="text-sm text-muted-foreground">
          Instala la app en tu dispositivo para acceder rápidamente, incluso sin conexión.
        </p>
        <div className="flex items-center justify-center gap-1.5 text-xs">
          {isOnline ? (
            <span className="flex items-center gap-1 text-primary"><Wifi className="h-3.5 w-3.5" /> En línea</span>
          ) : (
            <span className="flex items-center gap-1 text-accent"><WifiOff className="h-3.5 w-3.5" /> Sin conexión</span>
          )}
        </div>
      </div>

      {/* Platform selection or guide */}
      {!selectedPlatform ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground text-center">¿En qué dispositivo estás?</p>
          {platforms.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:border-primary/50 transition-colors border-border"
              onClick={() => setSelectedPlatform(p.id)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <p.icon className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">{p.label}</h3>
                  <p className="text-xs text-muted-foreground">{p.desc}</p>
                </div>
                <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedPlatform(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Cambiar dispositivo
          </button>

          <Card className="border-border">
            <CardContent className="p-5 space-y-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  {selectedPlatform === 'pc' && <Monitor className="h-5 w-5 text-primary" />}
                  {selectedPlatform === 'android' && <Smartphone className="h-5 w-5 text-primary" />}
                  {selectedPlatform === 'ios' && <Apple className="h-5 w-5 text-primary" />}
                </div>
                <h2 className="font-semibold text-foreground text-lg">
                  {platforms.find(p => p.id === selectedPlatform)?.label}
                </h2>
              </div>
              {renderPlatformGuide()}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

const Step = ({ number, icon, children }: { number: number; icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex gap-3 items-start">
    <div className="flex flex-col items-center gap-1">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
        {icon ?? number}
      </div>
    </div>
    <div className="pt-1 text-sm text-muted-foreground leading-relaxed">{children}</div>
  </div>
);

export default InstallApp;
