import { getSession } from '@/lib/authCore';
import { loadLanConfig } from '@/lib/LanCommunicationConfig';
import type {
  PrintDocumentRequest,
  PrintDocumentType,
  PrintExecutionResult,
  PrintSettingsMap,
  PrintSettingsWorkspace,
  PrintTestRequest,
  PrintTestResult,
} from '@/lib/printAgentTypes';
import { getDataRepository } from '@/repositories/RepositoryRegistry';

interface PrintCapableRepository {
  printDocument(input: PrintDocumentRequest): Promise<PrintExecutionResult>;
  getPrintSettings(): Promise<PrintSettingsWorkspace>;
}

function getLocalService() {
  const service = window.joyaControlPrintAgent;
  if (!service) throw new Error('PRINT_SERVICE_UNAVAILABLE');
  return service;
}

function getRemoteRepository(): PrintCapableRepository {
  const repository = getDataRepository() as unknown as Partial<PrintCapableRepository>;
  if (
    typeof repository.printDocument !== 'function'
    || typeof repository.getPrintSettings !== 'function'
  ) {
    throw new Error('PRINT_REPOSITORY_UNAVAILABLE');
  }
  return repository as PrintCapableRepository;
}

function isLanClient(): boolean {
  const config = loadLanConfig();
  return config.mode === 'lan' && config.role === 'client';
}

export class PrintRepositoryService {
  static async printDocument(input: PrintDocumentRequest): Promise<PrintExecutionResult> {
    if (isLanClient()) return getRemoteRepository().printDocument(input);
    const session = getSession();
    const config = loadLanConfig();
    return getLocalService().printDocument({
      ...input,
      clientId: config.clientId || 'SERVER_LOCAL',
      userId: session?.id || 'SYSTEM',
    });
  }

  static async getPrintSettings(): Promise<PrintSettingsWorkspace> {
    if (isLanClient()) return getRemoteRepository().getPrintSettings();
    return getLocalService().getPrintSettings();
  }

  static async savePrintSettings(settings: PrintSettingsMap): Promise<PrintSettingsWorkspace> {
    if (isLanClient()) throw new Error('PRINT_SETTINGS_SERVER_ONLY');
    return getLocalService().savePrintSettings({ settings });
  }

  static async refreshPrinters(): Promise<PrintSettingsWorkspace> {
    if (isLanClient()) throw new Error('PRINT_SETTINGS_SERVER_ONLY');
    return getLocalService().refreshPrinters();
  }

  static async testPrinter(input: PrintTestRequest): Promise<PrintTestResult> {
    if (isLanClient()) throw new Error('PRINT_SETTINGS_SERVER_ONLY');
    return getLocalService().testPrinter(input);
  }

  static async submitHtml(input: { documentType: PrintDocumentType; html: string }): Promise<PrintExecutionResult> {
    return this.printDocument({
      documentType: input.documentType,
      content: { kind: 'html', data: input.html },
    });
  }

  static async submitPdfBlob(input: { documentType: PrintDocumentType; blob: Blob }): Promise<PrintExecutionResult> {
    const data = await blobToBase64(input.blob);
    return this.printDocument({
      documentType: input.documentType,
      content: { kind: 'pdf', data },
    });
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('PRINT_PDF_READ_FAILED'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.readAsDataURL(blob);
  });
}
