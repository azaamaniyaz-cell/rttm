import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import { existsSync } from 'node:fs';

export const labels = {
  new: 'Yangi', reviewing: 'Ko‘rib chiqilmoqda', assigned: 'Biriktirildi', in_progress: 'Jarayonda', completed: 'Bajarildi', confirmed: 'Tasdiqlandi', closed: 'Yopildi', waiting: 'Kutishda', rejected: 'Rad etildi', reopened: 'Qayta ochildi',
  critical: 'Shoshilinch', high: 'Yuqori', medium: 'O‘rta', low: 'Past', warehouse: 'Omborda', in_use: 'Foydalanishda', reserve: 'Zaxirada', diagnostics: 'Diagnostikada', repair: 'Ta’mirlashda', faulty: 'Nosoz', retired: 'Hisobdan chiqarilgan', planned: 'Rejada', done: 'Bajarilgan', draft: 'Loyiha', approved: 'Tasdiqlangan'
};
export function validateXlsx(buffer) {
  // Inspect ZIP central directory before decompressing untrusted workbooks.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  const invalid = () => { throw Object.assign(new Error('XLSX formati noto‘g‘ri yoki xavfsiz hajm chegarasidan oshgan'), { status: 400 }); };
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) invalid();
  const entries = buffer.readUInt16LE(end + 10); let cursor = buffer.readUInt32LE(end + 16), total = 0;
  if (!entries || entries > 2000 || cursor >= end) invalid();
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), size = buffer.readUInt32LE(cursor + 24);
    total += size;
    if ((flags & 1) || ![0, 8].includes(method) || size > 10 * 1024 * 1024 || total > 20 * 1024 * 1024) invalid();
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    if (cursor > end) invalid();
  }
}
const printable = value => value === null || value === undefined ? '—' : labels[value] || String(value);
export async function excelBuffer(title, columns, records) {
  const book = new ExcelJS.Workbook();
  book.creator = 'RTM IT Management';
  const sheet = book.addWorksheet(title.slice(0, 30), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([key, header]) => ({ key, header, width: key === 'title' || key === 'model' ? 44 : 24 }));
  for (const record of records) sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, printable(record[key])])));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF184E48' } };
  sheet.getRow(1).height = 28;
  sheet.autoFilter = { from: 'A1', to: { row: records.length + 1, column: columns.length } };
  return Buffer.from(await book.xlsx.writeBuffer());
}
export function csvBuffer(columns, records) {
  const cell = value => '"' + (/^[=+@\-\t\r]/.test(printable(value)) ? "'" : '') + printable(value).replaceAll('"', '""') + '"';
  return '\uFEFF' + [columns.map(([, name]) => cell(name)).join(','), ...records.map(row => columns.map(([key]) => cell(row[key])).join(','))].join('\r\n');
}
export function pdfBuffer(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Author: 'RTM IT Management' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const font = [process.env.PDF_FONT, 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(path => path && existsSync(path));
    if (font) doc.font(font);
    doc.fillColor('#184E48').fontSize(11).text('NUKUS FILIALI  /  RAQAMLI TA’LIM TEXNOLOGIYALARI MARKAZI');
    doc.moveDown(1.5).fillColor('#182B2A').fontSize(20).text(title);
    doc.moveDown().fontSize(10).fillColor('#52635F').text(`Yaratilgan: ${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`);
    doc.moveDown().fillColor('#182B2A').fontSize(11);
    for (const line of lines) doc.text(line, { lineGap: 5 }).moveDown(0.45);
    doc.moveDown().fontSize(9).fillColor('#687C75').text('Test tizimida yaratilgan hujjat. Rasmiy kuchga kirishi muassasaning tasdiqlash tartibiga bog‘liq.');
    doc.end();
  });
}
export async function docxBuffer(title, lines) {
  const doc = new Document({ styles: { default: { document: { run: { font: 'Arial', size: 22, color: '000000' }, paragraph: { spacing: { after: 160, line: 300 } } } }, paragraphStyles: [{ id: 'Title', name: 'Title', basedOn: 'Normal', run: { font: 'Arial', size: 36, bold: true, color: '000000' }, paragraph: { spacing: { after: 320 } } }] }, sections: [{ children: [new Paragraph({ text: title, heading: 'Title' }), ...lines.map(text => new Paragraph({ children: [new TextRun(text)], spacing: { after: 180 } })), new Paragraph('Imzolar: topshiruvchi __________________  qabul qiluvchi __________________')] }] });
  return Packer.toBuffer(doc);
}
export const exportColumns = {
  tickets: [['id', 'ID'], ['title', 'Mavzu'], ['department', 'Bo‘lim'], ['creator', 'Murojaatchi'], ['assignee', 'Ijrochi'], ['category', 'Toifa'], ['priority', 'Ustuvorlik'], ['status', 'Holat'], ['created_at', 'Yaratilgan'], ['due_at', 'SLA muddati']],
  devices: [['inventory_no', 'Inventar raqami'], ['category', 'Toifa'], ['model', 'Model'], ['serial_no', 'Seriya raqami'], ['department', 'Bo‘lim'], ['employee', 'Xodim'], ['building', 'Bino'], ['room', 'Xona'], ['status', 'Holat'], ['warranty_until', 'Kafolat']],
  stock: [['name', 'Nomi'], ['unit', 'Birlik'], ['quantity', 'Qoldiq'], ['minimum', 'Minimal zaxira'], ['location', 'Joylashuv']],
  maintenance: [['title', 'Ish nomi'], ['inventory_no', 'Inventar raqami'], ['assignee', 'Ijrochi'], ['planned_at', 'Reja sanasi'], ['status', 'Holat'], ['minutes', 'Sarflangan daqiqa']]
};
