import * as XLSX from 'xlsx';

export interface ExcelColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
  width?: number;
}

export interface ExcelExportOptions<T> {
  filename: string;
  sheetName: string;
  columns: ExcelColumn<T>[];
  rows: T[];
}

const sanitizeFilename = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '');

export function buildExcelMatrix<T>(columns: ExcelColumn<T>[], rows: T[]): Array<Array<string | number | boolean>> {
  return [
    columns.map(column => column.header),
    ...rows.map(row => columns.map(column => column.value(row) ?? '')),
  ];
}

export function exportRowsToExcel<T>({ filename, sheetName, columns, rows }: ExcelExportOptions<T>): void {
  const matrix = buildExcelMatrix(columns, rows);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  worksheet['!cols'] = columns.map(column => ({ wch: column.width ?? Math.max(12, column.header.length + 2) }));
  worksheet['!autofilter'] = { ref: worksheet['!ref'] || 'A1:A1' };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${sanitizeFilename(filename) || 'exportacion'}.xlsx`);
}

export interface ExcelSummaryLine {
  label: string;
  value: string | number;
}

export function exportRowsWithSummaryToExcel<T>({
  filename,
  sheetName,
  columns,
  rows,
  summaryLines = [],
}: ExcelExportOptions<T> & { summaryLines?: ExcelSummaryLine[] }): void {
  const matrix: Array<Array<string | number | boolean>> = buildExcelMatrix(columns, rows);
  if (summaryLines.length > 0) {
    matrix.push([]);
    summaryLines.forEach(line => matrix.push([line.label, line.value]));
  }
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  worksheet['!cols'] = columns.map(column => ({ wch: column.width ?? Math.max(12, column.header.length + 2) }));
  worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, columns.length - 1))}${rows.length + 1}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${sanitizeFilename(filename) || 'exportacion'}.xlsx`);
}
