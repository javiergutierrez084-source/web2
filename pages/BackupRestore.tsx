import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import BackupStatusIndicator from '@/components/BackupStatusIndicator';
import { useToast } from '@/hooks/use-toast';
import { useApp } from '@/contexts/AppContext';
import { useWorkMode } from '@/contexts/WorkModeContext';
import { BackupManager, type BackupEnvelope } from '@/lib/BackupManager';
import { BackupScheduler } from '@/lib/BackupScheduler';
import { downloadBackupFile } from '@/lib/backup';
import {
  PROFESSIONAL_BACKUP_STATUS_EVENT,
  ProfessionalBackupService,
  type ProfessionalBackupStatus,
} from '@/lib/ProfessionalBackupService';
import { deleteBackupHistoryEntry } from '@/lib/database';
import {
  BackupType, BackupDestination, countBackupRecords,
  type BackupHistory, type BackupSettings, type BackupInfo,
} from '@/types/backup';
import {
  buildBackupUiMetrics, deleteBackupUiMetrics, getBackupUiMetrics,
  linkBackupUiMetrics, saveBackupUiMetrics, type BackupUiMetrics,
} from '@/lib/backupUiMonitor';
import {
  FolderOpen, Download, Upload, HardDrive, Shield, AlertTriangle, Database, CheckCircle,
  History, Settings as SettingsIcon, Loader2, Activity, Trash2, Eye,
  RotateCcw, XCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const HISTORY_PAGE_SIZE = 10;
const PROGRESS_STAGES = [
  'Preparando datos', 'Productos', 'Ventas', 'Clientes', 'Inventario', 'Finanzas',
  'Configuración', 'Calculando checksum', 'Escribiendo archivo', 'Finalizando',
];

type RestoreOrigin = 'OPFS (Interno)' | 'Carpeta seleccionada' | 'Archivo JSON' | 'Historial';
type OperationState = 'idle' | 'running' | 'success' | 'error';

interface PendingRestore {
  envelope: BackupEnvelope;
  origin: RestoreOrigin;
}

interface OperationMonitor {
  state: OperationState;
  title: string;
  stage: string;
  progress: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  metrics: BackupUiMetrics | null;
}

const HISTORY_TYPE_LABELS: Record<string, string> = {
  [BackupType.MANUAL]: 'Manual',
  [BackupType.AUTOMATIC]: 'Automático',
  [BackupType.PRE_RESTORE]: 'Antes de restaurar',
  restore: 'Restauración',
  restore_failed: 'Restauración fallida',
  validation_failed: 'Validación fallida',
};

const HISTORY_DESTINATION_LABELS: Record<string, string> = {
  [BackupDestination.LOCAL]: 'Interno OPFS',
  [BackupDestination.USB]: 'Carpeta / USB',
  [BackupDestination.NETWORK]: 'Red',
  [BackupDestination.SERVER]: 'Servidor',
  [BackupDestination.NAS]: 'NAS',
  [BackupDestination.CLOUD]: 'Nube',
};

const initialMonitor: OperationMonitor = {
  state: 'idle', title: '', stage: '', progress: 0,
  startedAt: null, finishedAt: null, error: null, metrics: null,
};

function formatBackupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round((bytes / 1024) * 10) / 10} KB`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-CO');
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('es-CO');
}

function sameInstant(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const first = Date.parse(a);
  const second = Date.parse(b);
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) < 3000;
}

const BackupRestore = () => {
  const { toast } = useToast();
  const { reloadFromDatabase } = useApp();
  const { effectiveMode } = useWorkMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [processing, setProcessing] = useState(false);
  const [monitor, setMonitor] = useState<OperationMonitor>(initialMonitor);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<BackupHistory | null>(null);
  const [opfsEnvelope, setOpfsEnvelope] = useState<BackupEnvelope | null>(null);
  const [opfsInfo, setOpfsInfo] = useState<BackupInfo | null>(null);
  const [lastBackup, setLastBackup] = useState<BackupHistory | null>(null);
  const [history, setHistory] = useState<BackupHistory[]>([]);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'today' | 'yesterday' | 'week'>('all');
  const [now, setNow] = useState(Date.now());
  const [professionalStatus, setProfessionalStatus] = useState<ProfessionalBackupStatus | null>(null);

  const fsSupported = BackupManager.isFileSystemAccessSupported();
  const opfsSupported = BackupManager.isOPFSSupported();
  const externalFolderSupported = effectiveMode === 'server' && Boolean(window.joyaControlBackup?.selectFolder);

  const refreshStatus = useCallback(async () => {
    const [info, last, hist, loadedSettings, localEnvelope, professional] = await Promise.all([
      opfsSupported ? BackupManager.getBackupInfo() : Promise.resolve(null),
      BackupManager.getLastBackup(),
      BackupManager.listHistory(1000),
      BackupManager.loadSettings(),
      opfsSupported ? BackupManager.peekLocalBackup().catch(() => null) : Promise.resolve(null),
      ProfessionalBackupService.getStatus(),
    ]);
    hist.forEach(linkBackupUiMetrics);
    setOpfsInfo(info);
    setLastBackup(last);
    setHistory(hist);
    setSettings(loadedSettings);
    setOpfsEnvelope(localEnvelope);
    setProfessionalStatus(professional);
  }, [opfsSupported]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    const refresh = () => { if (!processingRef.current) void refreshStatus(); };
    window.addEventListener(PROFESSIONAL_BACKUP_STATUS_EVENT, refresh);
    return () => window.removeEventListener(PROFESSIONAL_BACKUP_STATUS_EVENT, refresh);
  }, [refreshStatus]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!processingRef.current) void refreshStatus();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const beginProgress = useCallback((title: string) => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const startedAt = performance.now();
    setMonitor({
      state: 'running', title, stage: PROGRESS_STAGES[0], progress: 4,
      startedAt, finishedAt: null, error: null, metrics: null,
    });
    let index = 0;
    progressTimerRef.current = setInterval(() => {
      index = Math.min(index + 1, PROGRESS_STAGES.length - 1);
      setMonitor(current => current.state !== 'running' ? current : {
        ...current,
        stage: PROGRESS_STAGES[index],
        progress: Math.min(92, 8 + index * 9),
      });
    }, 350);
    return startedAt;
  }, []);

  const finishProgress = useCallback((metrics: BackupUiMetrics | null) => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const finishedAt = performance.now();
    setMonitor(current => ({
      ...current, state: 'success', stage: 'Respaldo completado correctamente',
      progress: 100, finishedAt, metrics, error: null,
    }));
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setMonitor(initialMonitor), 9000);
  }, []);

  const failProgress = useCallback((error: unknown) => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setMonitor(current => ({
      ...current, state: 'error', stage: 'Error durante el respaldo', progress: 100,
      finishedAt: performance.now(), error: error instanceof Error ? error.message : String(error),
    }));
  }, []);

  const runExclusive = useCallback(async (title: string, action: (startedAt: number) => Promise<void>) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    const startedAt = beginProgress(title);
    try {
      await action(startedAt);
    } catch (error) {
      failProgress(error);
      throw error;
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [beginProgress, failProgress]);

  const persistMetrics = useCallback(async (envelope: BackupEnvelope, startedAt: number) => {
    const validation = await BackupManager.validateBackup(envelope);
    const metrics = buildBackupUiMetrics(envelope, performance.now() - startedAt, validation.valid);
    saveBackupUiMetrics(metrics);
    await refreshStatus();
    finishProgress(metrics);
    return metrics;
  }, [finishProgress, refreshStatus]);

  const openConfirm = useCallback((envelope: BackupEnvelope, origin: RestoreOrigin) => {
    setPendingRestore({ envelope, origin });
    setConfirmOpen(true);
  }, []);

  const handleOPFSSave = useCallback(() => {
    void runExclusive('Respaldando información...', async startedAt => {
      try {
        const result = await ProfessionalBackupService.createManualBackup();
        if (!result.envelope) throw new Error('No fue posible crear el respaldo en este modo de trabajo.');
        await persistMetrics(result.envelope, startedAt);
        if (result.externalError) {
          toast({ title: 'Backup interno correcto; externo con error', description: result.externalError, variant: 'destructive' });
        }
      } catch (error) {
        toast({ title: 'Error durante el respaldo', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      }
    });
  }, [persistMetrics, runExclusive, toast]);

  const handleSaveToFolder = useCallback(() => {
    void runExclusive('Respaldando información...', async startedAt => {
      try {
        let folder = settings?.backupFolder || '';
        if (!folder) folder = await ProfessionalBackupService.selectExternalFolder() || '';
        if (!folder) {
          setMonitor(initialMonitor);
          return;
        }
        const result = await ProfessionalBackupService.createManualBackup();
        if (!result.envelope) throw new Error('No fue posible crear el respaldo manual.');
        await persistMetrics(result.envelope, startedAt);
        if (result.externalError) throw new Error(result.externalError);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setMonitor(initialMonitor);
          return;
        }
        toast({ title: 'Error durante el respaldo', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      }
    });
  }, [persistMetrics, runExclusive, settings?.backupFolder, toast]);

  const handleDownload = useCallback(() => {
    void runExclusive('Preparando descarga...', async startedAt => {
      try {
        const result = await ProfessionalBackupService.createManualBackup();
        if (!result.envelope) throw new Error('No fue posible preparar el respaldo.');
        downloadBackupFile(result.envelope);
        await persistMetrics(result.envelope, startedAt);
      } catch (error) {
        toast({ title: 'Error durante el respaldo', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      }
    });
  }, [persistMetrics, runExclusive, toast]);

  const handleOPFSRestore = useCallback(() => {
    void runExclusive('Leyendo respaldo interno...', async () => {
      try {
        const envelope = await BackupManager.peekLocalBackup();
        setMonitor(initialMonitor);
        if (!envelope) throw new Error('No hay respaldo interno guardado aún.');
        openConfirm(envelope, 'OPFS (Interno)');
      } catch (error) {
        toast({ title: 'No fue posible leer el respaldo', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      }
    });
  }, [openConfirm, runExclusive, toast]);

  const handleReadFromFolder = useCallback(() => {
    void runExclusive('Leyendo archivo de respaldo...', async () => {
      try {
        const envelope = await BackupManager.importBackup();
        setMonitor(initialMonitor);
        openConfirm(envelope, 'Carpeta seleccionada');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setMonitor(initialMonitor);
          return;
        }
        toast({ title: 'No fue posible abrir el respaldo', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      }
    });
  }, [openConfirm, runExclusive, toast]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.target;
    void runExclusive('Validando archivo de respaldo...', async () => {
      try {
        const envelope = await BackupManager.importBackup(file);
        setMonitor(initialMonitor);
        openConfirm(envelope, 'Archivo JSON');
      } catch (error) {
        toast({ title: 'Archivo de respaldo inválido', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      } finally {
        input.value = '';
      }
    });
  }, [openConfirm, runExclusive, toast]);

  const handleConfirmRestore = useCallback(() => {
    if (!pendingRestore) return;
    void runExclusive('Restaurando información...', async () => {
      try {
        await ProfessionalBackupService.restoreBackup(pendingRestore.envelope);
        await reloadFromDatabase();
        await refreshStatus();
        finishProgress(null);
        toast({ title: 'Respaldo restaurado', description: 'La aplicación ya refleja la información restaurada.' });
      } catch (error) {
        toast({ title: 'Error al restaurar', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        throw error;
      } finally {
        setConfirmOpen(false);
        setPendingRestore(null);
      }
    });
  }, [finishProgress, pendingRestore, refreshStatus, reloadFromDatabase, runExclusive, toast]);

  const handleRestoreHistory = useCallback(async (entry: BackupHistory) => {
    if (!opfsEnvelope || !sameInstant(entry.date, opfsEnvelope.createdAt)) {
      toast({
        title: 'Archivo histórico no disponible',
        description: 'El historial conserva la auditoría, pero OPFS mantiene un único respaldo activo. Selecciona el archivo original para restaurar esta versión.',
        variant: 'destructive',
      });
      return;
    }
    openConfirm(opfsEnvelope, 'Historial');
  }, [openConfirm, opfsEnvelope, toast]);

  const handleDeleteHistory = useCallback(async (entry: BackupHistory) => {
    if (opfsEnvelope && sameInstant(entry.date, opfsEnvelope.createdAt)) {
      toast({ title: 'Registro protegido', description: 'No se elimina el historial del respaldo interno activo.', variant: 'destructive' });
      return;
    }
    await deleteBackupHistoryEntry(entry.id);
    deleteBackupUiMetrics(entry.id);
    await refreshStatus();
  }, [opfsEnvelope, refreshStatus, toast]);

  const handleToggleSetting = useCallback(async (key: keyof BackupSettings, value: boolean) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setSettingsSaving(true);
    try {
      await BackupManager.saveSettings(updated);
      await BackupScheduler.onSettingsChanged();
    } catch (error) {
      toast({ title: 'Error al guardar configuración', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setSettingsSaving(false);
    }
  }, [settings, toast]);

  const handleChangeExternalFolder = useCallback(async () => {
    try {
      const selected = await ProfessionalBackupService.selectExternalFolder();
      if (!selected) return;
      await refreshStatus();
      toast({ title: 'Carpeta actualizada', description: selected });
    } catch (error) {
      toast({ title: 'No fue posible cambiar la carpeta', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  }, [refreshStatus, toast]);

  const handleOpenExternalFolder = useCallback(async () => {
    try {
      await ProfessionalBackupService.openExternalFolder();
    } catch (error) {
      toast({ title: 'No fue posible abrir la carpeta', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  }, [toast]);

  const successfulBackups = useMemo(() => history.filter(item =>
    item.status === 'success' && [BackupType.MANUAL, BackupType.AUTOMATIC, BackupType.PRE_RESTORE].includes(item.type as BackupType),
  ), [history]);

  const storageStats = useMemo(() => {
    const total = successfulBackups.reduce((sum, item) => sum + item.size, 0);
    return {
      count: successfulBackups.length,
      total,
      average: successfulBackups.length ? total / successfulBackups.length : 0,
      nextToDelete: settings?.deleteOldBackups
        ? [...successfulBackups]
          .filter(item => item.type === BackupType.AUTOMATIC)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(settings.maxBackups || 100)[0] ?? null
        : null,
    };
  }, [settings, successfulBackups]);

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return history;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const week = new Date(today); week.setDate(today.getDate() - 7);
    return history.filter(item => {
      const date = new Date(item.date);
      if (historyFilter === 'today') return date >= today;
      if (historyFilter === 'yesterday') return date >= yesterday && date < today;
      return date >= week;
    });
  }, [history, historyFilter]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const visibleHistory = useMemo(() => {
    const safePage = Math.min(historyPage, totalHistoryPages);
    const start = (safePage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistory, historyPage, totalHistoryPages]);

  useEffect(() => setHistoryPage(1), [historyFilter]);

  const schedulerArmed = Boolean(settings?.backupEnabled) && BackupScheduler.isArmed();

  const nextBackupText = useMemo(() => {
    if (!schedulerArmed) return 'Programador detenido';
    const nextRunAt = BackupScheduler.getNextRunAt();
    if (nextRunAt === null) return 'Programador detenido';
    const totalSeconds = Math.max(0, Math.ceil((nextRunAt - now) / 1000));
    if (totalSeconds <= 0) return 'Ejecutando...';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, '0')} s` : `${seconds} s`;
  }, [now, schedulerArmed]);

  const latestMetrics = useMemo(() => lastBackup ? getBackupUiMetrics(lastBackup) : null, [lastBackup]);
  const selectedMetrics = useMemo(() => selectedHistory ? getBackupUiMetrics(selectedHistory) : null, [selectedHistory]);
  const activeChecksumValid = useMemo(() => {
    if (!opfsEnvelope) return null;
    const metrics = successfulBackups.find(item => sameInstant(item.date, opfsEnvelope.createdAt));
    return metrics ? getBackupUiMetrics(metrics)?.checksumValid ?? null : null;
  }, [opfsEnvelope, successfulBackups]);

  const healthItems = useMemo(() => [
    { ok: opfsSupported, label: 'OPFS operativo' },
    { ok: activeChecksumValid !== false, label: activeChecksumValid === null ? 'Checksum disponible al validar' : 'Checksum válido' },
    { ok: Boolean(settings?.deleteOldBackups), label: settings?.deleteOldBackups ? 'Rotación activa' : 'Rotación deshabilitada' },
    { ok: schedulerArmed, label: schedulerArmed ? 'Respaldo automático activo' : settings?.backupEnabled ? 'Programador automático detenido' : 'Respaldo automático desactivado por el usuario' },
    { ok: Boolean(opfsEnvelope), label: opfsEnvelope ? 'Restauración disponible' : 'No existen respaldos internos' },
    { ok: true, label: 'Compatibilidad V2–V6' },
  ], [activeChecksumValid, opfsEnvelope, opfsSupported, schedulerArmed, settings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Copias de Seguridad Profesionales</h1>
        <p className="mt-1 text-muted-foreground">Respaldo interno, redundancia externa y recuperación segura sin alterar el formato Backup V2–V6.</p>
      </div>

      <BackupStatusIndicator variant="backup-page" />

      {monitor.state !== 'idle' && (
        <Card className={monitor.state === 'error' ? 'border-destructive/40' : 'border-primary/30'}>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {monitor.state === 'running' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                {monitor.state === 'success' && <CheckCircle className="h-5 w-5 text-success" />}
                {monitor.state === 'error' && <XCircle className="h-5 w-5 text-destructive" />}
                <div>
                  <p className="font-semibold">{monitor.title}</p>
                  <p className="text-sm text-muted-foreground">{monitor.stage}</p>
                </div>
              </div>
              <span className="text-sm font-semibold">{monitor.progress}%</span>
            </div>
            <Progress value={monitor.progress} />
            {monitor.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{monitor.error}</p>}
            {monitor.state === 'success' && monitor.metrics && (
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs uppercase text-muted-foreground">Hora</p><p className="font-medium">{new Date().toLocaleTimeString('es-CO')}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Tamaño</p><p className="font-medium">{formatBackupSize(monitor.metrics.realSize)}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Registros</p><p className="font-medium">{monitor.metrics.recordCount.toLocaleString('es-CO')}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Duración</p><p className="font-medium">{formatDuration(monitor.metrics.durationMs)}</p></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Respaldos almacenados</CardDescription><CardTitle>{storageStats.count} / {settings?.maxBackups ?? 10}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><p>Espacio utilizado: <strong className="text-foreground">{formatBackupSize(storageStats.total)}</strong></p><p>Promedio: <strong className="text-foreground">{formatBackupSize(storageStats.average)}</strong></p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Almacenamiento interno</CardDescription><CardTitle className="text-lg">OPFS</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><p>{opfsInfo ? '1 respaldo activo' : 'Sin respaldo activo'}</p><p>{opfsInfo ? formatBackupSize(opfsInfo.sizeKB * 1024) : '0 KB'} utilizados</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Próximo respaldo automático</CardDescription><CardTitle className="text-lg">{nextBackupText}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Estado: {schedulerArmed ? 'Activo · intervalo 15 minutos' : 'Programador detenido'}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Último respaldo</CardDescription><CardTitle className="text-lg">{lastBackup ? formatDate(lastBackup.date) : 'Sin registros'}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{lastBackup ? `${formatTime(lastBackup.date)} · ${HISTORY_TYPE_LABELS[lastBackup.type] ?? lastBackup.type}` : 'Crea el primer respaldo'}</CardContent></Card>
      </div>

      <Card className="border-primary/20">
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Estado del sistema de respaldos</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {healthItems.map(item => <div key={item.label} className="flex items-center gap-2 text-sm">{item.ok ? <CheckCircle className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}<span>{item.label}</span></div>)}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" />Almacenamiento interno</CardTitle><CardDescription>Origin Private File System (OPFS)</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>Estado: <strong>{opfsSupported ? 'Correcto' : 'No disponible'}</strong></p>
              <p>Cantidad: <strong>{opfsInfo ? 1 : 0}</strong></p>
              <p>Espacio: <strong>{opfsInfo ? formatBackupSize(opfsInfo.sizeKB * 1024) : '0 KB'}</strong></p>
              <p>Última escritura: <strong>{opfsInfo ? `${formatDate(opfsInfo.date)} ${formatTime(opfsInfo.date)}` : '—'}</strong></p>
              <p>Última lectura: <strong>{opfsEnvelope ? new Date().toLocaleTimeString('es-CO') : '—'}</strong></p>
              <p>Registros: <strong>{opfsInfo?.recordCount?.toLocaleString('es-CO') ?? '—'}</strong></p>
            </div>
            <div className="flex flex-wrap gap-3"><Button onClick={handleOPFSSave} disabled={processing || !opfsSupported}><Database className="mr-2 h-4 w-4" />Guardar respaldo interno</Button><Button onClick={handleOPFSRestore} disabled={processing || !opfsEnvelope} variant="outline"><Upload className="mr-2 h-4 w-4" />Restaurar desde interno</Button></div>
          </CardContent>
        </Card>

        <Card className={professionalStatus?.external.status === 'error' ? 'border-destructive/40' : 'border-primary/20'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5 text-primary" />Backup externo automático</CardTitle>
            <CardDescription>La ubicación se conserva y recibe una copia cada vez que se completa el respaldo interno del Servidor Principal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>Estado: <strong>{professionalStatus?.external.status === 'error' ? 'Error' : professionalStatus?.external.configuredFolder ? 'Correcto' : 'Sin configurar'}</strong></p>
              <p>Última copia: <strong>{professionalStatus?.external.lastSuccessAt ? `${formatDate(professionalStatus.external.lastSuccessAt)} ${formatTime(professionalStatus.external.lastSuccessAt)}` : '—'}</strong></p>
              <p>Próxima copia: <strong>{nextBackupText}</strong></p>
              <p>Última carpeta seleccionada: <strong className="break-all">{professionalStatus?.external.configuredFolder || '—'}</strong></p>
              <p className="sm:col-span-2">Ruta actual: <strong className="break-all">{professionalStatus?.external.configuredFolder || 'Seleccione una carpeta permanente'}</strong></p>
              {professionalStatus?.external.lastError && (
                <p className="sm:col-span-2 rounded-lg bg-destructive/10 p-3 text-destructive">
                  No fue posible guardar la copia automática. {professionalStatus.external.lastError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleChangeExternalFolder} disabled={processing || !externalFolderSupported}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {professionalStatus?.external.configuredFolder ? 'Cambiar carpeta' : 'Seleccionar carpeta'}
              </Button>
              <Button
                onClick={handleOpenExternalFolder}
                disabled={processing || !professionalStatus?.external.configuredFolder}
                variant="outline"
              >
                <FolderOpen className="mr-2 h-4 w-4" />Abrir carpeta de Backups
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Rotación automática</CardTitle><CardDescription>Las copias AUTO externas conservan como máximo 30 días o 100 archivos, lo que ocurra primero.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>La limpieza solo afecta la carpeta AUTO. Las copias MANUAL y RESTORE POINTS nunca se eliminan por esta política.</p>
            <div className="rounded-lg bg-muted p-3"><p className="text-xs uppercase text-muted-foreground">Próximo registro a eliminar</p><p className="font-medium">{storageStats.nextToDelete ? `${formatDate(storageStats.nextToDelete.date)} ${formatTime(storageStats.nextToDelete.date)}` : 'Ninguno por ahora'}</p></div>
            <p className="text-xs text-muted-foreground">El historial interno conserva hasta {settings?.maxBackups ?? 100} registros. OPFS mantiene un único archivo activo verificado.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5 text-primary" />Guardar respaldo</CardTitle><CardDescription>El archivo conserva exactamente el BackupEnvelope oficial.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{externalFolderSupported && <Button onClick={handleSaveToFolder} disabled={processing} className="w-full"><FolderOpen className="mr-2 h-4 w-4" />Guardar en carpeta configurada</Button>}<Button onClick={handleDownload} disabled={processing} className="w-full" variant={externalFolderSupported ? 'outline' : 'default'}><Download className="mr-2 h-4 w-4" />Descargar archivo</Button></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" />Restaurar respaldo</CardTitle><CardDescription>Valida metadata y checksum antes de mostrar la confirmación.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{fsSupported && <Button onClick={handleReadFromFolder} disabled={processing} className="w-full"><FolderOpen className="mr-2 h-4 w-4" />Abrir desde carpeta</Button>}<Button onClick={() => fileInputRef.current?.click()} disabled={processing} className="w-full" variant={fsSupported ? 'outline' : 'default'}><Upload className="mr-2 h-4 w-4" />Seleccionar archivo</Button><input ref={fileInputRef} type="file" accept=".json,.jcb" onChange={handleFileSelect} className="hidden" /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />Historial profesional de respaldos</CardTitle><CardDescription>{filteredHistory.length} registros. La tabla se pagina para evitar renders innecesarios.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">{(['all', 'today', 'yesterday', 'week'] as const).map(filter => <Button key={filter} size="sm" variant={historyFilter === filter ? 'default' : 'outline'} onClick={() => setHistoryFilter(filter)}>{filter === 'all' ? 'Todos' : filter === 'today' ? 'Hoy' : filter === 'yesterday' ? 'Ayer' : 'Semana pasada'}</Button>)}</div>
          {visibleHistory.length === 0 ? <p className="text-sm text-muted-foreground">No hay respaldos para este periodo.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Hora</th><th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Destino</th><th className="py-2 pr-3">Tamaño</th><th className="py-2 pr-3">Registros</th><th className="py-2 pr-3">Duración</th><th className="py-2 pr-3">Estado</th><th className="py-2">Acciones</th></tr></thead><tbody>{visibleHistory.map(entry => { const metrics = getBackupUiMetrics(entry); const active = Boolean(opfsEnvelope && sameInstant(entry.date, opfsEnvelope.createdAt)); return <tr key={entry.id} className="border-b border-border/50"><td className="py-3 pr-3">{formatDate(entry.date)}</td><td className="py-3 pr-3">{formatTime(entry.date)}</td><td className="py-3 pr-3">{HISTORY_TYPE_LABELS[entry.type] ?? entry.type}</td><td className="py-3 pr-3">{HISTORY_DESTINATION_LABELS[entry.destination] ?? entry.destination}</td><td className="py-3 pr-3">{formatBackupSize(entry.size)}</td><td className="py-3 pr-3">{metrics?.recordCount?.toLocaleString('es-CO') ?? '—'}</td><td className="py-3 pr-3">{metrics ? formatDuration(metrics.durationMs) : '—'}</td><td className="py-3 pr-3"><span className={entry.status === 'success' ? 'text-success' : 'text-destructive'}>{entry.status === 'success' ? 'Exitoso' : 'Error'}</span>{entry.notes && <span className="block max-w-[260px] break-words text-xs text-muted-foreground" title={entry.notes}>{entry.notes}</span>}</td><td className="py-3"><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => { setSelectedHistory(entry); setDetailsOpen(true); }}><Eye className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => void handleRestoreHistory(entry)} disabled={entry.status !== 'success'} title={active ? 'Restaurar respaldo activo' : 'Requiere el archivo histórico original'}><RotateCcw className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => void handleDeleteHistory(entry)} disabled={active} title={active ? 'El respaldo activo está protegido' : 'Eliminar solo del historial'}><Trash2 className="h-4 w-4" /></Button></div></td></tr>; })}</tbody></table></div>}
          <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Página {Math.min(historyPage, totalHistoryPages)} de {totalHistoryPages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={historyPage <= 1} onClick={() => setHistoryPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="outline" disabled={historyPage >= totalHistoryPages} onClick={() => setHistoryPage(page => Math.min(totalHistoryPages, page + 1))}><ChevronRight className="h-4 w-4" /></Button></div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-primary" />Configuración de respaldos</CardTitle><CardDescription>{settingsSaving ? 'Guardando cambios...' : 'En modo Servidor Principal, el intervalo automático permanece fijo en 15 minutos mientras el programador esté activado.'}</CardDescription></CardHeader>
        <CardContent>{settings ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([
          ['deleteOldBackups', 'Rotación del historial', 'Conserva el límite configurado.'],
          ['verifyChecksum', 'Verificar checksum', 'Valida integridad antes de restaurar.'],
          ['backupBeforeRestore', 'Respaldo antes de restaurar', 'Crea una copia preventiva.'],
          ['backupOnStartup', 'Al iniciar', 'Crea respaldo al abrir la aplicación.'],
        ] as const).map(([key, title, description]) => <label key={key} className="flex items-start gap-3 rounded-lg border p-3"><input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(settings[key])} onChange={event => void handleToggleSetting(key, event.target.checked)} disabled={settingsSaving} /><span><span className="block font-medium">{title}</span><span className="text-xs text-muted-foreground">{description}</span></span></label>)}</div> : <p className="text-sm text-muted-foreground">Cargando configuración...</p>}</CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Detalles del respaldo</DialogTitle><DialogDescription>Información de auditoría disponible sin modificar el archivo original.</DialogDescription></DialogHeader>{selectedHistory && <div className="grid gap-3 text-sm sm:grid-cols-2"><Detail label="Versión Backup" value={`V${selectedMetrics?.backupVersion ?? selectedHistory.version}`} /><Detail label="Versión Base" value={selectedMetrics ? `V${selectedMetrics.databaseVersion}` : '—'} /><Detail label="Fecha" value={formatDate(selectedHistory.date)} /><Detail label="Hora" value={formatTime(selectedHistory.date)} /><Detail label="Duración" value={selectedMetrics ? formatDuration(selectedMetrics.durationMs) : 'No registrada por esta versión'} /><Detail label="Checksum" value={selectedMetrics?.checksumValid === true ? 'Válido' : selectedMetrics?.checksumValid === false ? 'Inválido' : 'No registrado en historial'} /><Detail label="Cantidad de tablas" value={selectedMetrics?.tableCount?.toString() ?? '—'} /><Detail label="Cantidad de registros" value={selectedMetrics?.recordCount?.toLocaleString('es-CO') ?? '—'} /><Detail label="Equipo" value={selectedMetrics?.deviceId ?? selectedHistory.deviceId} /><Detail label="Usuario" value={selectedMetrics?.createdBy ?? selectedHistory.createdBy} /><Detail label="Estado" value={selectedHistory.status === 'success' ? 'Exitoso' : 'Error'} /><Detail label="Ubicación" value={HISTORY_DESTINATION_LABELS[selectedHistory.destination] ?? selectedHistory.destination} /><Detail label="Tamaño real" value={formatBackupSize(selectedMetrics?.realSize ?? selectedHistory.size)} /><Detail label="Tamaño comprimido" value={selectedMetrics?.compressedSize ? formatBackupSize(selectedMetrics.compressedSize) : 'No aplica'} /></div>}<DialogFooter><Button variant="outline" onClick={() => setDetailsOpen(false)}>Cerrar</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Confirmar restauración</DialogTitle><DialogDescription>Las tablas presentes en el respaldo reemplazarán sus datos actuales. Las tablas ausentes se conservarán.</DialogDescription></DialogHeader>{pendingRestore && <div className="space-y-3"><div className="rounded-lg bg-muted p-3 text-sm space-y-1"><p><strong>Origen:</strong> {pendingRestore.origin}</p><p><strong>Fecha:</strong> {new Date(pendingRestore.envelope.createdAt).toLocaleString('es-CO')}</p><p><strong>Versión:</strong> Backup V{pendingRestore.envelope.version} · Dexie V{pendingRestore.envelope.databaseVersion}</p><p><strong>Usuario:</strong> {pendingRestore.envelope.metadata.createdBy}</p><p><strong>Checksum:</strong> {pendingRestore.envelope.checksum ? 'Incluido y validable' : 'Formato heredado sin checksum'}</p><p><strong>Tablas:</strong> {Object.values(pendingRestore.envelope.data.tables).filter(Array.isArray).length}</p><p><strong>Registros:</strong> {countBackupRecords(pendingRestore.envelope.data).toLocaleString('es-CO')}</p><p><strong>Tamaño:</strong> {formatBackupSize(new Blob([JSON.stringify(pendingRestore.envelope)]).size)}</p></div></div>}<DialogFooter><Button variant="outline" onClick={() => { setConfirmOpen(false); setPendingRestore(null); }} disabled={processing}>Cancelar</Button><Button variant="destructive" onClick={handleConfirmRestore} disabled={processing}>{processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restaurar</Button></DialogFooter></DialogContent></Dialog>

      {latestMetrics && <span className="hidden" aria-hidden="true">{latestMetrics.recordCount}</span>}
    </div>
  );
};

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted p-3"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 break-all font-medium">{value}</p></div>;
}

export default BackupRestore;
