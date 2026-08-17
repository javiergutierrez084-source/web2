import { formatCurrency } from '@/data/mockData';
import type { Contact, Invoice, PurchaseInvoice } from '@/data/mockData';
import type { CompanyInfo } from '@/contexts/AppContext';

export type InvoiceDocumentFormat = 'letter' | 'ticket80' | 'ticket50';

export interface InvoiceDocumentItem {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface InvoiceDocumentData {
  invoiceId: string;
  number: string;
  date: string;
  status: Invoice['status'] | PurchaseInvoice['status'];
  type: 'sale' | 'purchase';
  title: string;
  company: CompanyInfo;
  entity: {
    id: string;
    label: 'Cliente' | 'Proveedor';
    name: string;
    document: string;
    phone: string;
    address: string;
    email: string;
  };
  items: InvoiceDocumentItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: string;
  notes: string;
  qrValue: string;
}

export interface InvoiceDocumentSource {
  invoice: Invoice | PurchaseInvoice;
  type: 'sale' | 'purchase';
  company: CompanyInfo;
  contact?: Contact;
}

const finiteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const buildInvoiceDocumentData = ({
  invoice,
  type,
  company,
  contact,
}: InvoiceDocumentSource): InvoiceDocumentData => {
  const sale = type === 'sale' ? invoice as Invoice : null;
  const purchase = type === 'purchase' ? invoice as PurchaseInvoice : null;
  const entityId = sale?.clientId || purchase?.supplierId || '';
  const entityName = sale?.clientName || purchase?.supplierName || '';

  return {
    invoiceId: invoice.id,
    number: invoice.number || '',
    date: invoice.date || '',
    status: invoice.status,
    type,
    title: type === 'sale' ? 'Factura de Venta' : 'Comprobante de Compra',
    company: { ...company },
    entity: {
      id: entityId,
      label: type === 'sale' ? 'Cliente' : 'Proveedor',
      name: entityName,
      document: contact?.document || '',
      phone: contact?.phone || '',
      address: contact?.address || '',
      email: contact?.email || '',
    },
    items: (invoice.items || []).map(item => ({
      productId: item.productId || '',
      code: item.code || '',
      name: item.name || '',
      quantity: finiteNumber(item.quantity),
      unitPrice: finiteNumber(item.unitPrice),
      subtotal: finiteNumber(item.subtotal),
    })),
    subtotal: finiteNumber(invoice.subtotal),
    discount: finiteNumber(invoice.discount),
    tax: finiteNumber(invoice.tax),
    total: finiteNumber(invoice.total),
    paymentMethod: invoice.paymentMethod || '',
    notes: sale?.clientNotes || purchase?.description || '',
    qrValue: ['JOYACONTROL', invoice.number || '', invoice.date || '', String(finiteNumber(invoice.total))].join('|'),
  };
};

const textEncoder = new TextEncoder();

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

const ascii = (value: string): Uint8Array => textEncoder.encode(value);

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const winAnsiBytes = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) || 0x3f;
    if (code <= 0xff) bytes.push(code);
    else bytes.push(CP1252[code] ?? 0x3f);
  }
  return Uint8Array.from(bytes);
};

const pdfHexText = (value: string): string =>
  `<${Array.from(winAnsiBytes(value), byte => byte.toString(16).padStart(2, '0')).join('')}>`;

class PdfBuilder {
  private objects: Array<Uint8Array | null> = [];

  reserve(): number {
    this.objects.push(null);
    return this.objects.length;
  }

  add(content: string | Uint8Array): number {
    const id = this.reserve();
    this.set(id, content);
    return id;
  }

  set(id: number, content: string | Uint8Array): void {
    this.objects[id - 1] = typeof content === 'string' ? ascii(content) : content;
  }

  stream(content: string | Uint8Array, extraDictionary = ''): number {
    const data = typeof content === 'string' ? ascii(content) : content;
    const body = concatBytes(
      ascii(`<< /Length ${data.length}${extraDictionary ? ` ${extraDictionary}` : ''} >>\nstream\n`),
      data,
      ascii('\nendstream'),
    );
    return this.add(body);
  }

  build(rootId: number): Blob {
    const header = ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const chunks: Uint8Array[] = [header];
    const offsets = [0];
    let offset = header.length;

    this.objects.forEach((object, index) => {
      if (!object) throw new Error(`PDF_OBJECT_${index + 1}_NOT_SET`);
      offsets.push(offset);
      const prefix = ascii(`${index + 1} 0 obj\n`);
      const suffix = ascii('\nendobj\n');
      chunks.push(prefix, object, suffix);
      offset += prefix.length + object.length + suffix.length;
    });

    const xrefOffset = offset;
    const xref = [
      `xref\n0 ${this.objects.length + 1}\n`,
      '0000000000 65535 f \n',
      ...offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`),
    ].join('');
    const trailer = `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    chunks.push(ascii(xref), ascii(trailer));
    return new Blob(chunks, { type: 'application/pdf' });
  }
}

class PdfCanvas {
  private commands: string[] = [];

  text(value: string, x: number, y: number, size = 10, bold = false, align: 'left' | 'center' | 'right' = 'left'): void {
    const estimatedWidth = winAnsiBytes(value).length * size * 0.51;
    const drawX = align === 'center' ? x - (estimatedWidth / 2) : align === 'right' ? x - estimatedWidth : x;
    this.commands.push(`0 g BT /${bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf 1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm ${pdfHexText(value)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0): void {
    this.commands.push(`${gray.toFixed(3)} G ${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  fillRect(x: number, y: number, width: number, height: number, gray = 0): void {
    this.commands.push(`q ${gray.toFixed(3)} g ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`);
  }

  strokeRect(x: number, y: number, width: number, height: number, lineWidth = 0.5, gray = 0): void {
    this.commands.push(`${gray.toFixed(3)} G ${lineWidth.toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  }

  image(name: string, x: number, y: number, width: number, height: number): void {
    this.commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`);
  }

  qr(matrix: boolean[][], x: number, y: number, size: number): void {
    const moduleSize = size / matrix.length;
    this.commands.push('0 g');
    matrix.forEach((row, rowIndex) => {
      row.forEach((dark, columnIndex) => {
        if (!dark) return;
        const moduleX = x + (columnIndex * moduleSize);
        const moduleY = y + ((matrix.length - rowIndex - 1) * moduleSize);
        this.commands.push(`${moduleX.toFixed(2)} ${moduleY.toFixed(2)} ${(moduleSize + 0.03).toFixed(2)} ${(moduleSize + 0.03).toFixed(2)} re f`);
      });
    });
  }

  barcode(bars: BarcodeBar[], x: number, y: number, width: number, height: number): void {
    const totalUnits = bars.reduce((sum, bar) => sum + bar.width, 0);
    const unit = width / totalUnits;
    let cursor = x;
    this.commands.push('0 g');
    bars.forEach(bar => {
      const barWidth = bar.width * unit;
      if (bar.dark) this.commands.push(`${cursor.toFixed(2)} ${y.toFixed(2)} ${barWidth.toFixed(2)} ${height.toFixed(2)} re f`);
      cursor += barWidth;
    });
  }

  toString(): string {
    return this.commands.join('\n');
  }
}

const wrapText = (value: string, maxCharacters: number): string[] => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  words.forEach(word => {
    if (!line) {
      line = word;
      return;
    }
    if (`${line} ${word}`.length <= maxCharacters) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines;
};

const CODE39: Record<string, number> = {
  '0': 0x034, '1': 0x121, '2': 0x061, '3': 0x160, '4': 0x031,
  '5': 0x130, '6': 0x070, '7': 0x025, '8': 0x124, '9': 0x064,
  A: 0x109, B: 0x049, C: 0x148, D: 0x019, E: 0x118, F: 0x058,
  G: 0x00d, H: 0x10c, I: 0x04c, J: 0x01c, K: 0x103, L: 0x043,
  M: 0x142, N: 0x013, O: 0x112, P: 0x052, Q: 0x007, R: 0x106,
  S: 0x046, T: 0x016, U: 0x181, V: 0x0c1, W: 0x1c0, X: 0x091,
  Y: 0x190, Z: 0x0d0, '-': 0x085, '.': 0x184, ' ': 0x0c4,
  '$': 0x094, '/': 0x0a8, '+': 0x0a2, '%': 0x08a, '*': 0x12a,
};

interface BarcodeBar {
  dark: boolean;
  width: number;
}

export const buildCode39Bars = (rawValue: string): BarcodeBar[] => {
  const sanitized = rawValue.toUpperCase().split('').filter(character => CODE39[character] !== undefined).join('') || 'JOYACONTROL';
  const encoded = `*${sanitized}*`;
  const bars: BarcodeBar[] = [];
  encoded.split('').forEach((character, characterIndex) => {
    const pattern = CODE39[character];
    for (let bit = 8; bit >= 0; bit -= 1) {
      bars.push({ dark: bit % 2 === 0, width: (pattern & (1 << bit)) ? 2.5 : 1 });
    }
    if (characterIndex < encoded.length - 1) bars.push({ dark: false, width: 1 });
  });
  return bars;
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255];
})();

const gfMultiply = (a: number, b: number): number => {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
};

const polynomialMultiply = (left: number[], right: number[]): number[] => {
  const output = new Array(left.length + right.length - 1).fill(0);
  left.forEach((leftValue, leftIndex) => {
    right.forEach((rightValue, rightIndex) => {
      output[leftIndex + rightIndex] ^= gfMultiply(leftValue, rightValue);
    });
  });
  return output;
};

const reedSolomonRemainder = (data: number[], degree: number): number[] => {
  let generator = [1];
  for (let index = 0; index < degree; index += 1) {
    generator = polynomialMultiply(generator, [1, GF_EXP[index]]);
  }
  const message = [...data, ...new Array(degree).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = message[index];
    if (factor === 0) continue;
    for (let generatorIndex = 0; generatorIndex < generator.length; generatorIndex += 1) {
      message[index + generatorIndex] ^= gfMultiply(generator[generatorIndex], factor);
    }
  }
  return message.slice(data.length);
};

const appendBits = (target: boolean[], value: number, count: number): void => {
  for (let bit = count - 1; bit >= 0; bit -= 1) target.push(((value >>> bit) & 1) !== 0);
};

const createQrCodewords = (value: string): number[] => {
  const rawBytes = Array.from(textEncoder.encode(value)).slice(0, 78);
  const bits: boolean[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, rawBytes.length, 8);
  rawBytes.forEach(byte => appendBits(bits, byte, 8));
  const maximumBits = 80 * 8;
  for (let index = 0; index < Math.min(4, maximumBits - bits.length); index += 1) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | (bits[index + bit] ? 1 : 0);
    data.push(byte);
  }
  let pad = true;
  while (data.length < 80) {
    data.push(pad ? 0xec : 0x11);
    pad = !pad;
  }
  return [...data, ...reedSolomonRemainder(data, 20)];
};

const formatBits = (): number => {
  const data = 0b01 << 3; // Error correction L, mask 0.
  let remainder = data;
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
};

export const createQrMatrix = (value: string): boolean[][] => {
  const size = 33; // QR version 4-L.
  const modules: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFunction = (row: number, column: number, dark: boolean): void => {
    if (row < 0 || column < 0 || row >= size || column >= size) return;
    modules[row][column] = dark;
    reserved[row][column] = true;
  };

  const drawFinder = (top: number, left: number): void => {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const inside = row >= 0 && row <= 6 && column >= 0 && column <= 6;
        const dark = inside && (
          row === 0 || row === 6 || column === 0 || column === 6 ||
          (row >= 2 && row <= 4 && column >= 2 && column <= 4)
        );
        setFunction(top + row, left + column, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    if (!reserved[6][index]) setFunction(6, index, index % 2 === 0);
    if (!reserved[index][6]) setFunction(index, 6, index % 2 === 0);
  }

  const alignmentCenters = [6, 26];
  alignmentCenters.forEach(centerRow => alignmentCenters.forEach(centerColumn => {
    if (reserved[centerRow][centerColumn]) return;
    for (let row = -2; row <= 2; row += 1) {
      for (let column = -2; column <= 2; column += 1) {
        setFunction(centerRow + row, centerColumn + column, Math.max(Math.abs(row), Math.abs(column)) !== 1);
      }
    }
  }));

  const drawFormat = (bits: number): void => {
    for (let index = 0; index <= 5; index += 1) setFunction(index, 8, ((bits >>> index) & 1) !== 0);
    setFunction(7, 8, ((bits >>> 6) & 1) !== 0);
    setFunction(8, 8, ((bits >>> 7) & 1) !== 0);
    setFunction(8, 7, ((bits >>> 8) & 1) !== 0);
    for (let index = 9; index < 15; index += 1) setFunction(8, 14 - index, ((bits >>> index) & 1) !== 0);
    for (let index = 0; index < 8; index += 1) setFunction(8, size - 1 - index, ((bits >>> index) & 1) !== 0);
    for (let index = 8; index < 15; index += 1) setFunction(size - 15 + index, 8, ((bits >>> index) & 1) !== 0);
    setFunction(size - 8, 8, true);
  };

  drawFormat(formatBits());

  const codewords = createQrCodewords(value);
  const dataBits: boolean[] = [];
  codewords.forEach(codeword => appendBits(dataBits, codeword, 8));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (reserved[row][column]) continue;
        const dataBit = bitIndex < dataBits.length ? dataBits[bitIndex] : false;
        const mask = (row + column) % 2 === 0;
        modules[row][column] = dataBit !== mask;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  return modules.map(row => row.map(module => module === true));
};

export const buildQrSvg = (value: string, pixelSize = 92): string => {
  const matrix = createQrMatrix(value);
  const quiet = 4;
  const viewBox = matrix.length + (quiet * 2);
  const rectangles: string[] = [];
  matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => {
    if (dark) rectangles.push(`<rect x="${columnIndex + quiet}" y="${rowIndex + quiet}" width="1" height="1"/>`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${viewBox} ${viewBox}" shape-rendering="crispEdges" aria-label="Código QR"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rectangles.join('')}</g></svg>`;
};

export const buildCode39Svg = (value: string, width = 220, height = 48): string => {
  const bars = buildCode39Bars(value);
  const totalUnits = bars.reduce((sum, bar) => sum + bar.width, 0);
  let cursor = 0;
  const rectangles: string[] = [];
  bars.forEach(bar => {
    if (bar.dark) rectangles.push(`<rect x="${cursor}" y="0" width="${bar.width}" height="${height - 12}"/>`);
    cursor += bar.width;
  });
  const safeValue = value.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${totalUnits} ${height}" preserveAspectRatio="none" aria-label="Código de barras"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rectangles.join('')}</g><text x="${totalUnits / 2}" y="${height - 2}" text-anchor="middle" font-family="monospace" font-size="8">${safeValue}</text></svg>`;
};

interface JpegImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const loadLogoAsJpeg = async (url?: string): Promise<JpegImage | null> => {
  if (!url || typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const maximum = 256;
        const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
        const binary = atob(base64);
        resolve({ bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), width, height });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
};


interface BuiltPage {
  width: number;
  height: number;
  content: string;
}

const validateInvoiceDocumentData = (data: InvoiceDocumentData): void => {
  if (!data.number.trim()) throw new Error('La factura no tiene número para generar el PDF.');
  if (!data.date.trim()) throw new Error('La factura no tiene fecha para generar el PDF.');
  if (data.items.length === 0) throw new Error('La factura no contiene artículos para generar el PDF.');
};

const buildLetterPages = (data: InvoiceDocumentData, hasLogo: boolean): BuiltPage[] => {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const rowsPerPage = 18;
  const chunks: InvoiceDocumentItem[][] = [];
  for (let index = 0; index < data.items.length; index += rowsPerPage) {
    chunks.push(data.items.slice(index, index + rowsPerPage));
  }
  if (chunks.length === 0) chunks.push([]);
  const qr = createQrMatrix(data.qrValue);
  const barcode = buildCode39Bars(data.number);

  return chunks.map((items, pageIndex) => {
    const canvas = new PdfCanvas();
    let y = pageHeight - 44;
    if (hasLogo) canvas.image('Im1', (pageWidth - 42) / 2, y - 35, 42, 42);
    y -= hasLogo ? 48 : 2;
    canvas.text(data.company.name || 'JoyaControl', pageWidth / 2, y, 17, true, 'center');
    y -= 14;
    const companyMeta = [
      data.company.nit ? `NIT: ${data.company.nit}` : '',
      data.company.phone ? `Tel: ${data.company.phone}` : '',
      data.company.email || '',
    ].filter(Boolean).join(' · ');
    if (companyMeta) canvas.text(companyMeta, pageWidth / 2, y, 8.5, false, 'center');
    y -= 15;
    canvas.line(margin, y, pageWidth - margin, y, 1.2);
    y -= 22;

    canvas.text(data.title.toUpperCase(), margin, y, 13, true);
    canvas.text(`No. ${data.number}`, margin, y - 15, 10);
    canvas.text(`Fecha: ${data.date}`, pageWidth - margin, y, 10, false, 'right');
    canvas.text(`Estado: ${data.status}`, pageWidth - margin, y - 15, 9, false, 'right');
    y -= 42;

    canvas.fillRect(margin, y - 42, pageWidth - (margin * 2), 42, 0.96);
    canvas.strokeRect(margin, y - 42, pageWidth - (margin * 2), 42, 0.5, 0.75);
    canvas.text(data.entity.label, margin + 10, y - 12, 8, true);
    canvas.text(data.entity.name || '—', margin + 10, y - 26, 11, true);
    if (data.entity.document) canvas.text(`Documento: ${data.entity.document}`, pageWidth - margin - 10, y - 12, 8, false, 'right');
    if (data.entity.phone) canvas.text(`Tel: ${data.entity.phone}`, pageWidth - margin - 10, y - 26, 8, false, 'right');
    y -= 62;

    const columns = { item: margin + 5, quantity: 355, price: 438, total: pageWidth - margin - 5 };
    canvas.fillRect(margin, y - 18, pageWidth - (margin * 2), 18, 0.91);
    canvas.text('Producto', columns.item, y - 13, 8, true);
    canvas.text('Cantidad', columns.quantity, y - 13, 8, true, 'right');
    canvas.text('Precio', columns.price, y - 13, 8, true, 'right');
    canvas.text('Total', columns.total, y - 13, 8, true, 'right');
    y -= 24;

    items.forEach(item => {
      const itemLines = wrapText(`${item.name} (${item.code})`, 43).slice(0, 2);
      const rowHeight = itemLines.length > 1 ? 29 : 21;
      itemLines.forEach((line, lineIndex) => canvas.text(line, columns.item, y - 10 - (lineIndex * 10), lineIndex === 0 ? 9 : 7.5, lineIndex === 0));
      canvas.text(String(item.quantity), columns.quantity, y - 10, 9, false, 'right');
      canvas.text(formatCurrency(item.unitPrice), columns.price, y - 10, 8.5, false, 'right');
      canvas.text(formatCurrency(item.subtotal), columns.total, y - 10, 8.5, true, 'right');
      canvas.line(margin, y - rowHeight, pageWidth - margin, y - rowHeight, 0.3, 0.82);
      y -= rowHeight;
    });

    if (pageIndex === chunks.length - 1) {
      y -= 8;
      const totalsX = 350;
      canvas.text('Subtotal', totalsX, y, 9);
      canvas.text(formatCurrency(data.subtotal), pageWidth - margin, y, 9, false, 'right');
      y -= 14;
      if (data.discount > 0) {
        canvas.text('Descuento', totalsX, y, 9);
        canvas.text(`-${formatCurrency(data.discount)}`, pageWidth - margin, y, 9, false, 'right');
        y -= 14;
      }
      if (data.tax > 0) {
        canvas.text('Impuestos', totalsX, y, 9);
        canvas.text(formatCurrency(data.tax), pageWidth - margin, y, 9, false, 'right');
        y -= 14;
      }
      canvas.line(totalsX, y + 6, pageWidth - margin, y + 6, 1);
      canvas.text('TOTAL', totalsX, y - 8, 12, true);
      canvas.text(formatCurrency(data.total), pageWidth - margin, y - 8, 12, true, 'right');
      y -= 28;
      canvas.text(`Forma de pago: ${data.paymentMethod || 'No especificada'}`, margin, y, 8.5);
      if (data.notes) {
        y -= 16;
        canvas.text('Observaciones:', margin, y, 8, true);
        wrapText(data.notes, 90).slice(0, 3).forEach((line, index) => canvas.text(line, margin, y - 12 - (index * 10), 8));
      }

      const qrSize = 58;
      canvas.qr(qr, margin, 42, qrSize);
      canvas.barcode(barcode, 330, 60, 220, 32);
      canvas.text(data.number, 440, 46, 7, false, 'center');
      canvas.text(`Generado por ${data.company.name || 'JoyaControl'} · JoyaControl`, pageWidth / 2, 26, 7.5, false, 'center');
    } else {
      canvas.text(`Página ${pageIndex + 1} de ${chunks.length}`, pageWidth / 2, 28, 8, false, 'center');
    }

    return { width: pageWidth, height: pageHeight, content: canvas.toString() };
  });
};

const buildTicketPage = (data: InvoiceDocumentData, format: 'ticket80' | 'ticket50', hasLogo: boolean): BuiltPage => {
  const width = format === 'ticket50' ? 141.73 : 226.77;
  const margin = format === 'ticket50' ? 6 : 10;
  const font = format === 'ticket50' ? 6.6 : 8.3;
  const itemNameCharacters = format === 'ticket50' ? 22 : 35;
  const itemLineCount = data.items.reduce((sum, item) => sum + Math.min(2, wrapText(item.name, itemNameCharacters).length), 0);
  const noteLines = data.notes ? Math.min(4, wrapText(data.notes, itemNameCharacters).length) : 0;
  const height = Math.max(
    format === 'ticket50' ? 360 : 420,
    250 + (itemLineCount * (font + 4)) + (data.items.length * 18) + (noteLines * 10),
  );
  const canvas = new PdfCanvas();
  const qr = createQrMatrix(data.qrValue);
  const barcode = buildCode39Bars(data.number);
  let y = height - 12;

  if (hasLogo) {
    const logoSize = format === 'ticket50' ? 24 : 32;
    canvas.image('Im1', (width - logoSize) / 2, y - logoSize, logoSize, logoSize);
    y -= logoSize + 5;
  }
  canvas.text(data.company.name || 'JoyaControl', width / 2, y, font + 2, true, 'center');
  y -= font + 5;
  if (data.company.nit) {
    canvas.text(`NIT: ${data.company.nit}`, width / 2, y, font - 0.5, false, 'center');
    y -= font + 2;
  }
  if (data.company.phone) {
    canvas.text(`Tel: ${data.company.phone}`, width / 2, y, font - 0.5, false, 'center');
    y -= font + 2;
  }
  canvas.line(margin, y, width - margin, y, 0.5);
  y -= 13;
  canvas.text(data.number, width / 2, y, font + 1, true, 'center');
  y -= font + 5;
  canvas.text(data.date, width / 2, y, font - 0.5, false, 'center');
  y -= font + 5;
  canvas.text(`${data.entity.label}: ${data.entity.name || '—'}`, margin, y, font);
  y -= font + 4;
  if (data.entity.document) {
    canvas.text(`Doc: ${data.entity.document}`, margin, y, font - 0.5);
    y -= font + 4;
  }
  canvas.line(margin, y, width - margin, y, 0.5);
  y -= 11;

  data.items.forEach(item => {
    const nameLines = wrapText(item.name, itemNameCharacters).slice(0, 2);
    nameLines.forEach((line, index) => {
      canvas.text(line, margin, y, font, index === 0);
      y -= font + 2;
    });
    canvas.text(`${item.quantity} × ${formatCurrency(item.unitPrice)}`, margin, y, font - 0.5);
    canvas.text(formatCurrency(item.subtotal), width - margin, y, font, true, 'right');
    y -= font + 6;
  });

  canvas.line(margin, y, width - margin, y, 0.5);
  y -= 12;
  canvas.text('Subtotal', margin, y, font);
  canvas.text(formatCurrency(data.subtotal), width - margin, y, font, false, 'right');
  y -= font + 4;
  if (data.discount > 0) {
    canvas.text('Descuento', margin, y, font);
    canvas.text(`-${formatCurrency(data.discount)}`, width - margin, y, font, false, 'right');
    y -= font + 4;
  }
  if (data.tax > 0) {
    canvas.text('Impuestos', margin, y, font);
    canvas.text(formatCurrency(data.tax), width - margin, y, font, false, 'right');
    y -= font + 4;
  }
  canvas.line(margin, y, width - margin, y, 0.8);
  y -= 13;
  canvas.text('TOTAL', margin, y, font + 1.5, true);
  canvas.text(formatCurrency(data.total), width - margin, y, font + 1.5, true, 'right');
  y -= font + 8;
  wrapText(`Pago: ${data.paymentMethod || 'No especificado'}`, itemNameCharacters).slice(0, 2).forEach(line => {
    canvas.text(line, margin, y, font - 0.5);
    y -= font + 3;
  });
  if (data.notes) {
    y -= 2;
    canvas.text('Observaciones:', margin, y, font - 0.5, true);
    y -= font + 3;
    wrapText(data.notes, itemNameCharacters).slice(0, 4).forEach(line => {
      canvas.text(line, margin, y, font - 0.8);
      y -= font + 2;
    });
  }

  const qrSize = format === 'ticket50' ? 45 : 58;
  y -= qrSize + 8;
  canvas.qr(qr, (width - qrSize) / 2, y, qrSize);
  y -= 42;
  canvas.barcode(barcode, margin, y, width - (margin * 2), format === 'ticket50' ? 24 : 30);
  y -= 12;
  canvas.text(data.number, width / 2, y, font - 1, false, 'center');
  y -= font + 5;
  canvas.line(margin, y, width - margin, y, 0.5);
  y -= 11;
  canvas.text('Gracias por su compra', width / 2, y, font, true, 'center');
  y -= font + 4;
  canvas.text(`${data.company.name || 'JoyaControl'} · JoyaControl`, width / 2, y, font - 1, false, 'center');

  return { width, height, content: canvas.toString() };
};

export const generateInvoicePdf = async (
  data: InvoiceDocumentData,
  format: InvoiceDocumentFormat,
): Promise<Blob> => {
  validateInvoiceDocumentData(data);
  const logo = await loadLogoAsJpeg(data.company.logoUrl);
  const builder = new PdfBuilder();
  const fontRegularId = builder.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = builder.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const imageId = logo
    ? builder.add(concatBytes(
        ascii(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`),
        logo.bytes,
        ascii('\nendstream'),
      ))
    : null;

  const pages = format === 'letter'
    ? buildLetterPages(data, Boolean(imageId))
    : [buildTicketPage(data, format, Boolean(imageId))];

  const pagesId = builder.reserve();
  const pageIds = pages.map(page => {
    const contentId = builder.stream(page.content);
    const resources = `<< /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ''} >>`;
    return builder.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
  });
  builder.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const catalogId = builder.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return builder.build(catalogId);
};
