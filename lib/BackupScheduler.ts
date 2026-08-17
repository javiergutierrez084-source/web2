import { getEffectiveWorkMode } from '@/config/workMode';
import { BackupManager } from '@/lib/BackupManager';
import {
  PROFESSIONAL_BACKUP_INTERVAL_MS,
  ProfessionalBackupService,
} from '@/lib/ProfessionalBackupService';

// Programador exclusivo del Servidor Principal. La creación real se delega a
// ProfessionalBackupService, que mantiene una cola única para respaldos
// automáticos, manuales, cierre de caja, restauración y cierre de la aplicación.
class BackupSchedulerImpl {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private startupBackupDone = false;
  private nextRunAt: number | null = null;

  async init(): Promise<void> {
    if (this.initialized || getEffectiveWorkMode() !== 'server') return;
    this.initialized = true;
    try {
      const settings = await ProfessionalBackupService.ensureProfessionalSettings();
      if (settings.backupEnabled) this.armTimer();
      else this.disarmTimer();
      await this.maybeRunStartupBackup();
    } catch (error) {
      this.initialized = false;
      this.disarmTimer();
      throw error;
    }
  }

  async onSettingsChanged(): Promise<void> {
    if (getEffectiveWorkMode() !== 'server') {
      this.dispose();
      return;
    }
    const settings = await ProfessionalBackupService.ensureProfessionalSettings();
    this.initialized = true;
    if (settings.backupEnabled) this.armTimer();
    else this.disarmTimer();
  }

  dispose(): void {
    this.disarmTimer();
    this.initialized = false;
    this.startupBackupDone = false;
  }

  isArmed(): boolean {
    return this.timerId !== null;
  }

  getNextRunAt(): number | null {
    return this.nextRunAt;
  }

  private disarmTimer(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
    this.nextRunAt = null;
  }

  private armTimer(): void {
    this.disarmTimer();
    this.nextRunAt = Date.now() + PROFESSIONAL_BACKUP_INTERVAL_MS;
    this.timerId = setInterval(() => {
      // Refresh before enqueuing so the UI always reports the next real tick,
      // even while a backup is being written asynchronously.
      this.nextRunAt = Date.now() + PROFESSIONAL_BACKUP_INTERVAL_MS;
      void ProfessionalBackupService.createAutomaticBackup('interval').catch(error => {
        console.error('[Backup] Falló el respaldo automático de 15 minutos:', error);
      });
    }, PROFESSIONAL_BACKUP_INTERVAL_MS);
  }

  private async maybeRunStartupBackup(): Promise<void> {
    if (this.startupBackupDone) return;
    this.startupBackupDone = true;
    const settings = await BackupManager.loadSettings();
    if (!settings.backupOnStartup) return;
    await ProfessionalBackupService.createAutomaticBackup('startup').catch(error => {
      console.error('[Backup] Falló el respaldo de inicio:', error);
    });
  }
}

export const BackupScheduler = new BackupSchedulerImpl();
