import * as XLSX from 'xlsx';
import type {
  OwnerFinanceDashboard,
  OwnerFinancePeriodOption,
  OwnerWithdrawal,
} from './OwnerFinanceService';

const money = (value: number) => Number(value || 0).toFixed(2);
const safe = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

export interface OwnerFinanceExportContext {
  generatedAt?: string;
  generatedBy?: string;
}

export interface OwnerFinanceExportSummary {
  periodKey: string;
  periodLabel: string;
  periodStatus: string;
  generatedAt: string;
  generatedAtLabel: string;
  generatedBy: string;
  monthlyProfitGoal: number;
  generatedProfit: number;
  compliancePercentage: number;
  withdrawnProfit: number;
  availableBalance: number;
}

type OwnerFinanceExportExtension = 'pdf' | 'xlsx' | 'csv';

function normalizedPeriod(period?: OwnerFinancePeriodOption) {
  return {
    key: period?.key || '',
    label: period?.label || 'Período seleccionado',
    status: period?.status === 'CLOSED' ? 'Cerrado' : 'Abierto',
  };
}

function normalizedContext(context: OwnerFinanceExportContext = {}) {
  const parsed = new Date(context.generatedAt || new Date().toISOString());
  const generatedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  const generatedAtLabel = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(generatedAt));
  return {
    generatedAt,
    generatedAtLabel,
    generatedBy: safe(context.generatedBy) || 'Usuario no identificado',
  };
}

export function buildOwnerFinanceExportFilename(
  periodKey: string,
  extension: OwnerFinanceExportExtension,
): string {
  const normalizedKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey) ? periodKey : 'sin-periodo';
  return `Finanzas_${normalizedKey}.${extension}`;
}

export function buildOwnerFinanceExportSummary(
  dashboard: OwnerFinanceDashboard,
  period?: OwnerFinancePeriodOption,
  context: OwnerFinanceExportContext = {},
): OwnerFinanceExportSummary {
  const normalized = normalizedPeriod(period);
  const generated = normalizedContext(context);
  return {
    periodKey: normalized.key,
    periodLabel: normalized.label,
    periodStatus: normalized.status,
    generatedAt: generated.generatedAt,
    generatedAtLabel: generated.generatedAtLabel,
    generatedBy: generated.generatedBy,
    monthlyProfitGoal: dashboard.monthlyProfitGoal,
    generatedProfit: dashboard.profitMonth,
    compliancePercentage: dashboard.monthlyGoalProgressPercentage,
    withdrawnProfit: dashboard.withdrawnProfit,
    availableBalance: dashboard.availableBalance,
  };
}

function withdrawalRows(withdrawals: OwnerWithdrawal[], period?: OwnerFinancePeriodOption) {
  const periodLabel = period?.label || '';
  return withdrawals.map((item) => ({
    Periodo: periodLabel,
    Fecha: item.withdrawalDate.slice(0, 10),
    Hora: item.withdrawalDate.slice(11, 19),
    Usuario: item.userName,
    Concepto: item.conceptName,
    Valor: item.amount,
    Observaciones: item.observations,
    Caja: item.accountName,
    'Método de pago': item.paymentMethod,
    Estado: item.status === 'ACTIVE' ? 'Activo' : 'Anulado',
    'Motivo de anulación': item.cancellationReason || '',
  }));
}

export function buildOwnerFinanceReportRows(summary: OwnerFinanceExportSummary) {
  return [
    { Indicador: 'Período', Valor: summary.periodLabel },
    { Indicador: 'Estado del período', Valor: summary.periodStatus },
    { Indicador: 'Fecha de generación', Valor: summary.generatedAtLabel },
    { Indicador: 'Usuario que generó el reporte', Valor: summary.generatedBy },
    { Indicador: 'Meta mensual', Valor: summary.monthlyProfitGoal },
    { Indicador: 'Utilidad generada', Valor: summary.generatedProfit },
    { Indicador: 'Utilidad retirada', Valor: summary.withdrawnProfit },
    { Indicador: 'Saldo disponible', Valor: summary.availableBalance },
    { Indicador: 'Cumplimiento', Valor: `${summary.compliancePercentage.toFixed(2)} %` },
  ];
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function resolveExportArguments(
  period: OwnerFinancePeriodOption | undefined,
  contextOrFilename: OwnerFinanceExportContext | string | undefined,
  explicitFilename: string | undefined,
  extension: OwnerFinanceExportExtension,
) {
  const context = typeof contextOrFilename === 'string' ? {} : (contextOrFilename || {});
  const filename = typeof contextOrFilename === 'string'
    ? contextOrFilename
    : explicitFilename || buildOwnerFinanceExportFilename(period?.key || '', extension);
  return { context, filename };
}

export function exportOwnerFinanceCsv(
  withdrawals: OwnerWithdrawal[],
  dashboard: OwnerFinanceDashboard,
  period?: OwnerFinancePeriodOption,
  contextOrFilename?: OwnerFinanceExportContext | string,
  explicitFilename?: string,
) {
  const { context, filename } = resolveExportArguments(
    period,
    contextOrFilename,
    explicitFilename,
    'csv',
  );
  const summary = buildOwnerFinanceReportRows(buildOwnerFinanceExportSummary(dashboard, period, context))
    .map(item => [item.Indicador, item.Valor]);
  const header = ['Periodo', 'Fecha', 'Hora', 'Usuario', 'Concepto', 'Valor', 'Observaciones', 'Caja', 'Método de pago', 'Estado', 'Motivo de anulación'];
  const rows = withdrawalRows(withdrawals, period).map((row) => header.map((key) => row[key as keyof typeof row]));
  const csvRows = [['Indicador', 'Valor'], ...summary, [], header, ...rows];
  const csv = csvRows
    .map((line) => line.map((cell) => `"${safe(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  download(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), filename);
}

export function exportOwnerFinanceExcel(
  withdrawals: OwnerWithdrawal[],
  dashboard: OwnerFinanceDashboard,
  period?: OwnerFinancePeriodOption,
  contextOrFilename?: OwnerFinanceExportContext | string,
  explicitFilename?: string,
) {
  const { context, filename } = resolveExportArguments(
    period,
    contextOrFilename,
    explicitFilename,
    'xlsx',
  );
  const workbook = XLSX.utils.book_new();
  const summary = buildOwnerFinanceExportSummary(dashboard, period, context);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(buildOwnerFinanceReportRows(summary)), 'Resumen');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(withdrawalRows(withdrawals, period)), 'Retiros');
  XLSX.writeFile(workbook, filename);
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function exportOwnerFinancePdf(
  withdrawals: OwnerWithdrawal[],
  dashboard: OwnerFinanceDashboard,
  period?: OwnerFinancePeriodOption,
  contextOrFilename?: OwnerFinanceExportContext | string,
  explicitFilename?: string,
) {
  const { context, filename } = resolveExportArguments(
    period,
    contextOrFilename,
    explicitFilename,
    'pdf',
  );
  const summary = buildOwnerFinanceExportSummary(dashboard, period, context);
  const lines = [
    'FINANZAS DEL PROPIETARIO',
    `Periodo: ${safe(summary.periodLabel)}`,
    `Estado del periodo: ${summary.periodStatus}`,
    `Fecha de generacion: ${safe(summary.generatedAtLabel)}`,
    `Usuario: ${safe(summary.generatedBy)}`,
    `Meta mensual: ${money(summary.monthlyProfitGoal)}`,
    `Utilidad generada: ${money(summary.generatedProfit)}`,
    `Utilidad retirada: ${money(summary.withdrawnProfit)}`,
    `Saldo disponible: ${money(summary.availableBalance)}`,
    `Cumplimiento: ${summary.compliancePercentage.toFixed(2)}%`,
    '',
    ...withdrawals.slice(0, 35).map((item) =>
      `${item.withdrawalDate.slice(0, 10)} | ${safe(item.conceptName)} | ${money(item.amount)} | ${safe(item.accountName)} | ${item.status === 'ACTIVE' ? 'ACTIVO' : 'ANULADO'}`
    ),
  ];
  const content = ['BT', '/F1 10 Tf', '40 800 Td'];
  lines.forEach((line, index) => {
    if (index) content.push('0 -18 Td');
    content.push(`(${escapePdfText(line)}) Tj`);
  });
  content.push('ET');
  const stream = content.join('\n');
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>endobj',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => { offsets.push(pdf.length); pdf += `${object}\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  download(new Blob([pdf], { type: 'application/pdf' }), filename);
}
