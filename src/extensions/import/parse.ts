// File reading, always in code and in the browser: CSV, TSV and XLSX become a table of strings.
// No model sees a file; only the user's confirmed, cleaned records are sent to the server.

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_ROWS = 2000;
const MAX_XLSX_UNZIPPED = 30 * 1024 * 1024;

export class ParseError extends Error {}

function detectDelimiter(text: string) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", "\t", ";", "|"].map((d) => [d, line.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ",";
}

// RFC 4180 with leniency for real exports: a quote only opens a quoted field at the start of the
// field (so 5" pipe stays literal); doubled quotes escape; newlines inside quotes are kept.
export function parseDelimited(text: string): string[][] {
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, started = false;
  const end = () => { row.push(field.trim()); field = ""; started = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !started && !field.trim()) { quoted = true; started = true; field = ""; }
    else if (c === delim) end();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end();
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else { field += c; started = true; }
  }
  if (quoted) throw new ParseError("The file has an unclosed quote (\"), so its rows can't be read reliably.");
  end();
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// XLSX: a zip of XML parts. Read with the browser's DecompressionStream, no library.
// ---------------------------------------------------------------------------------------------

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ParseError("This doesn't look like an Excel (.xlsx) file.");
  const count = v.getUint16(eocd + 10, true);
  let off = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (v.getUint32(off, true) !== 0x02014b50) throw new ParseError("The Excel file is damaged.");
    const method = v.getUint16(off + 10, true), size = v.getUint32(off + 20, true), raw = v.getUint32(off + 24, true);
    const nameLen = v.getUint16(off + 28, true), extra = v.getUint16(off + 30, true), comment = v.getUint16(off + 32, true), local = v.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extra + comment;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(name)) continue;
    total += raw;
    if (total > MAX_XLSX_UNZIPPED) throw new ParseError("The Excel file is too large once unpacked. Save the sheet as CSV and upload that.");
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
    else throw new ParseError("The Excel file uses a compression this importer can't read. Save it as CSV.");
  }
  return out;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10)) : ENT[e.toLowerCase()] ?? _));
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1]!)).join("");
const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Built-in date formats (ECMA-376 numFmtId 14–22, 45–47) and custom formats with d/m/y outside quotes.
function dateStyles(styles: string | undefined): Set<number> {
  if (!styles) return new Set();
  const custom = new Map([...styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unxml(m[2]!)]));
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy]/i.test((custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => isDate(Number(m[1])) && out.add(i));
  return out;
}

const serialDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000)).toISOString().slice(0, 10);

export async function parseXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf);
  const text = (n: string) => (files.has(n) ? new TextDecoder().decode(files.get(n)) : undefined);
  const wb = text("xl/workbook.xml") ?? "";
  const rid = wb.match(/<sheet\s[^>]*r:id="([^"]+)"/)?.[1];
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = rid && [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
  const sheetName = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
  const sheet = text(sheetName) ?? text("xl/worksheets/sheet1.xml");
  if (!sheet) throw new ParseError("The Excel file has no worksheet.");
  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const dates = dateStyles(text("xl/styles.xml"));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!, body = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const s = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = texts(body);
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) val = t !== "str" && dates.has(s) && Number.isFinite(Number(v)) ? serialDate(Number(v)) : unxml(v);
      row[ref ? colIndex(ref) : row.length] = val.trim();
    }
    const filled = Array.from(row, (x) => x ?? "");
    if (filled.some(Boolean)) rows.push(filled);
  }
  return rows;
}

export async function readTable(name: string, bytes: Uint8Array): Promise<string[][]> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ParseError(`${name} is ${(bytes.byteLength / 1048576).toFixed(1)} MB; files can be up to ${MAX_FILE_BYTES / 1048576} MB. Split it or export fewer columns.`);
  if (/\.xls$/i.test(name)) throw new ParseError(`${name} is an old Excel (.xls) file. Save it as .xlsx or CSV and upload that.`);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xlsx$/i.test(name) || zip) return parseXlsx(bytes);
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseDelimited(text);
}

// ---------------------------------------------------------------------------------------------
// Layout: title rows above the header, property heading rows, total rows.
// ---------------------------------------------------------------------------------------------

const looksNumeric = (s: string) => /^[-$(]?[\d,.]+%?\)?$/.test(s) || /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(s);
const TOTAL = /^(grand\s+)?totals?\b|^total\s+for\b|^summary\b/i;

// The header is the first of the top rows that is wide and mostly words, which skips report
// titles and "As of" lines that exports put above it.
export function findHeaderRow(table: string[][]) {
  const width = Math.max(0, ...table.slice(0, 30).map((r) => r.filter(Boolean).length));
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const cells = table[i]!.filter(Boolean);
    const words = cells.filter((c) => !looksNumeric(c)).length;
    if (cells.length >= Math.max(2, Math.ceil(width * 0.6)) && words / cells.length >= 0.8) return i;
  }
  return 0;
}

export type SourceRow = { line: number; cells: string[]; section?: string };
export type Sheet = { headers: string[]; rows: SourceRow[]; skipped: { titles: number; totals: number; sections: number } };

// A row with only its first cell filled is a group heading ("-> Maple Court - 55 Maple Ct, Austin,
// TX"); rows under it carry it as their section, which stands in for a missing property column.
export function toSheet(table: string[][]): Sheet {
  const h = findHeaderRow(table);
  const headers = (table[h] ?? []).map((x, i) => x || `Column ${i + 1}`);
  const rows: SourceRow[] = [];
  const skipped = { titles: h, totals: 0, sections: 0 };
  let section: string | undefined;
  for (let i = h + 1; i < table.length; i++) {
    const cells = table[i]!;
    const filled = cells.filter(Boolean);
    if (TOTAL.test(filled[0] ?? "")) { skipped.totals++; continue; }
    if (filled.length === 1 && cells[0] && headers.length > 2) {
      section = cells[0].replace(/^[-=>\s]+/, "").trim();
      skipped.sections++;
      continue;
    }
    rows.push({ line: i + 1, cells: headers.map((_, c) => cells[c] ?? ""), section });
  }
  return { headers, rows, skipped };
}
