import * as XLSX from 'xlsx';
import type { BulkImportProductRecord } from '@/domain/models';
import { getActiveRepositoryMode, getDataRepository } from '@/repositories/RepositoryRegistry';
import { CategoryResolver } from '@/lib/categoryService';
import { requirePermission } from '@/lib/authCore';

export interface ImportRowError {
  row: number;
  code: string;
  reason: string;
}

export interface ImportSummary {
  totalRows: number;
  productsCreated: number;
  productsSkipped: number;
  categoriesCreated: string[];
  errors: ImportRowError[];
}

export type ImportStage = 'reading' | 'validating' | 'categories' | 'inserting' | 'done';

export interface ImportProgress {
  stage: ImportStage;
  progress: number; // 0..100
  message: string;
  processed?: number;
  total?: number;
}

export type ProgressCallback = (p: ImportProgress) => void;

interface RawRow {
  [key: string]: any;
}

const COLUMN_MAP: Record<string, string[]> = {
  code: ['codigo', 'código', 'code'],
  name: ['nombre', 'name', 'producto'],
  category: ['categoria', 'categoría', 'category'],
  purchasePrice: ['precio compra', 'preciocompra', 'purchase price', 'precio de compra'],
  salePrice: ['precio venta', 'precioventa', 'sale price', 'precio de venta'],
  weightGrams: ['peso', 'peso gramos', 'weight', 'gramos'],
  stock: ['stock', 'cantidad', 'existencia'],
  minStock: ['stock minimo', 'stock mínimo', 'minimo', 'mínimo', 'min stock'],
  description: ['descripcion', 'descripción', 'description'],
};

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findColumnKey(headers: string[], aliases: string[]): string | null {
  const normalizedAliases = aliases.map(a => stripAccents(a.toLowerCase().trim()));
  for (const h of headers) {
    const normalizedHeader = stripAccents(h.toLowerCase().trim());
    if (normalizedAliases.includes(normalizedHeader)) return h;
  }
  return null;
}

function buildColumnMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    mapping[field] = findColumnKey(headers, aliases);
  }
  return mapping;
}

function toNumber(value: any): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export async function parseExcelFile(file: File): Promise<RawRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows: RawRow[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows;
}

export async function runBulkImport(
  rows: RawRow[],
  existingProductCodes: Set<string>,
  onProgress?: ProgressCallback,
): Promise<{ summary: ImportSummary; newProducts: BulkImportProductRecord[] }> {
  if (getActiveRepositoryMode() !== 'lan') await requirePermission('manage_products');
  const errors: ImportRowError[] = [];
  const newProducts: BulkImportProductRecord[] = [];
  const seenCodesInFile = new Set<string>();

  const emit = (p: ImportProgress) => { try { onProgress?.(p); } catch {} };

  if (rows.length === 0) {
    emit({ stage: 'done', progress: 100, message: 'Archivo vacío' });
    return {
      summary: { totalRows: 0, productsCreated: 0, productsSkipped: 0, categoriesCreated: [], errors: [] },
      newProducts: [],
    };
  }

  const headers = Object.keys(rows[0]);
  const colMap = buildColumnMapping(headers);

  if (!colMap.code || !colMap.name || !colMap.category) {
    throw new Error(
      'El archivo no tiene las columnas requeridas. Se necesitan al menos: Codigo, Nombre y Categoria.'
    );
  }

  emit({ stage: 'categories', progress: 15, message: 'Cargando categorías existentes...' });
  const categoryResolver = new CategoryResolver();
  await categoryResolver.load();

  const now = new Date().toISOString();
  const total = rows.length;

  emit({ stage: 'validating', progress: 20, message: `Validando ${total} filas...`, processed: 0, total });

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const excelRow = index + 2;
    const code = String(row[colMap.code!] ?? '').trim();
    const name = String(row[colMap.name!] ?? '').trim();
    const categoryRaw = String(row[colMap.category!] ?? '').trim();

    const pushErr = (reason: string, c = code || '(vacio)') => errors.push({ row: excelRow, code: c, reason });

    if (!code) { pushErr('Codigo vacio'); }
    else if (!name) { pushErr('Nombre vacio'); }
    else if (!categoryRaw) { pushErr('Categoria vacia'); }
    else if (existingProductCodes.has(code)) { pushErr('El codigo ya existe en el inventario'); }
    else if (seenCodesInFile.has(code)) { pushErr('Codigo duplicado dentro del mismo archivo'); }
    else {
      const salePrice = toNumber(colMap.salePrice ? row[colMap.salePrice] : 0);
      if (salePrice <= 0) {
        pushErr('Precio de venta debe ser mayor a 0');
      } else {
        const { name: categoryName } = categoryResolver.resolve(categoryRaw);
        const purchasePrice = toNumber(colMap.purchasePrice ? row[colMap.purchasePrice] : 0);
        const margin = purchasePrice > 0 ? ((salePrice - purchasePrice) / purchasePrice) * 100 : 0;

        newProducts.push({
          id: crypto.randomUUID(),
          code,
          name,
          category: categoryName,
          purchase_price: purchasePrice,
          sale_price: salePrice,
          weight_grams: toNumber(colMap.weightGrams ? row[colMap.weightGrams] : 0),
          margin,
          stock: toNumber(colMap.stock ? row[colMap.stock] : 0),
          min_stock: toNumber(colMap.minStock ? row[colMap.minStock] : 0),
          description: colMap.description ? String(row[colMap.description] ?? '').trim() : '',
          supplier_ids: [],
          created_at: now,
        });
        seenCodesInFile.add(code);
      }
    }

    // Emit progress every ~50 rows to keep UI responsive without spamming
    if ((index + 1) % 50 === 0 || index === rows.length - 1) {
      const processed = index + 1;
      const pct = 20 + Math.round((processed / total) * 50); // 20% -> 70%
      emit({
        stage: 'validating',
        progress: pct,
        message: `Validando filas (${processed}/${total})...`,
        processed,
        total,
      });
      // Yield to the event loop so the UI can repaint
      await new Promise(r => setTimeout(r, 0));
    }
  }

  emit({
    stage: 'categories',
    progress: 75,
    message: 'Creando categorías nuevas...',
  });
  const createdCategories = await categoryResolver.commit();

  emit({
    stage: 'inserting',
    progress: 85,
    message: `Insertando ${newProducts.length} productos...`,
  });
  if (newProducts.length > 0) {
    await getDataRepository().bulkPutProducts(newProducts);
  }

  const summary: ImportSummary = {
    totalRows: rows.length,
    productsCreated: newProducts.length,
    productsSkipped: errors.length,
    categoriesCreated: createdCategories.map(c => c.name),
    errors,
  };

  emit({ stage: 'done', progress: 100, message: 'Importación completada' });

  return { summary, newProducts };
}

export function downloadImportTemplate(): void {
  const sampleData = [
    {
      'Codigo': 'AN-100', 'Nombre': 'Anillo Solitario Oro 18K', 'Categoria': 'Anillos',
      'Precio Compra': 450000, 'Precio Venta': 680000, 'Peso': 3.5,
      'Stock': 10, 'Stock Minimo': 3, 'Descripcion': 'Opcional',
    },
    {
      'Codigo': 'PU-200', 'Nombre': 'Pulsera Hombre Plata', 'Categoria': 'Pulseras Hombre',
      'Precio Compra': 80000, 'Precio Venta': 140000, 'Peso': 12,
      'Stock': 5, 'Stock Minimo': 2, 'Descripcion': '',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
  XLSX.writeFile(workbook, 'Plantilla_Carga_Masiva_Productos.xlsx');
}
