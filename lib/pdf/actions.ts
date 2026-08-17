export interface GeneratedPdfFile {
  blob: Blob;
  url: string;
  filename: string;
}

export const sanitizePdfFilename = (value: string): string => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${normalized || 'documento'}.pdf`;
};

export const createPdfFile = (blob: Blob, filename: string): GeneratedPdfFile => ({
  blob,
  url: URL.createObjectURL(blob),
  filename: sanitizePdfFilename(filename.replace(/\.pdf$/i, '')),
});

export const revokePdfFile = (file: GeneratedPdfFile | null): void => {
  if (file) URL.revokeObjectURL(file.url);
};

export const downloadPdfFile = (file: GeneratedPdfFile): void => {
  const anchor = document.createElement('a');
  anchor.href = file.url;
  anchor.download = file.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

/**
 * Opens the already-generated PDF in the platform PDF viewer. The same blob is
 * used for preview, download and printing, so there is no HTML print variant.
 * Electron deployments can replace this with a native bridge without changing
 * document generation.
 */
export const openPdfForPrint = (file: GeneratedPdfFile): void => {
  const opened = window.open(file.url, '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('El visor de PDF fue bloqueado. Permite ventanas emergentes para imprimir.');
};
