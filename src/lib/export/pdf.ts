import { display, generatedLabel } from "./cells";
import type { ExportDoc, Kind } from "./types";

// A minimal PDF 1.4 writer for one table: US Letter, the standard Helvetica fonts (no embedding),
// WinAnsi text, vector logo. Portrait up to 6 columns, landscape above. Content streams are left
// uncompressed so the output stays plain ASCII.

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for characters 32–126, from the AFM files.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Unicode → WinAnsi for the characters the app's formatters and seed text use.
const WIN: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };

function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "−") out.push(45);          // the UI's minus sign
    else if (c >= 32 && c <= 126) out.push(c);
    else if (WIN[ch]) out.push(WIN[ch]);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (c < 32) out.push(32);
    else out.push(63);                     // "?"
  }
  return out;
}

const charWidth = (b: number, bold: boolean) => (b >= 32 && b <= 126 ? (bold ? HELV_B : HELV)[b - 32] : 556);
export const textWidth = (s: string, size: number, bold = false) => (winAnsi(s).reduce((a, b) => a + charWidth(b, bold), 0) / 1000) * size;

// A PDF literal string: ( ) \ escaped, everything outside printable ASCII as octal.
export function pdfString(s: string) {
  return "(" + winAnsi(s).map((b) => (b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 || b > 126 ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b))).join("") + ")";
}

function fit(s: string, w: number, size: number, bold = false) {
  if (textWidth(s, size, bold) <= w) return s;
  // No glyph is narrower than 0.19 em, so anything past this many characters can't fit.
  let t = s.slice(0, Math.ceil(w / (0.19 * size)));
  while (t.length > 1 && textWidth(t + "…", size, bold) > w) t = t.slice(0, -1);
  return t + "…";
}

function wrap(s: string, w: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > w) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(l, w, size, bold));
}

const n = (x: number) => (Math.round(x * 100) / 100).toString();
const INK = "0.11 0.13 0.13";
const MUTED = "0.37 0.42 0.42";

// The Propniti mark (src/components/Logo.tsx: 64-unit tile, rx 14, MARK_PATH) at x, y (bottom left).
function logo(x: number, y: number, size: number) {
  const r = 14, k = 0.5523 * r, ka = 0.5523 * 10;
  const tile = `${r} 0 m ${64 - r} 0 l ${n(64 - r + k)} 0 64 ${n(r - k)} 64 ${r} c 64 ${64 - r} l 64 ${n(64 - r + k)} ${n(64 - r + k)} 64 ${64 - r} 64 c ${r} 64 l ${n(r - k)} 64 0 ${n(64 - r + k)} 0 ${64 - r} c 0 ${r} l 0 ${n(r - k)} ${n(r - k)} 0 ${r} 0 c h f`;
  const mark = `15 11 12 42 re 30 11 m 40 11 l ${n(40 + ka)} 11 50 ${n(21 - ka)} 50 21 c 50 40 l 30 40 l h 35 20 10 10 re f*`;
  return `q ${n(size / 64)} 0 0 ${n(-size / 64)} ${n(x)} ${n(y + size)} cm 0 0.412 0.416 rg ${tile} 1 1 1 rg ${mark} Q`;
}

const text = (s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: string } = {}) =>
  `BT /${opts.bold ? "F2" : "F1"} ${size} Tf ${opts.color ?? INK} rg ${n(x)} ${n(y)} Td ${pdfString(s)} Tj ET`;

export function toPdf(doc: ExportDoc): Uint8Array {
  const landscape = doc.columns.length > 6;
  const W = landscape ? 792 : 612, H = landscape ? 612 : 792, M = 36;
  const tableW = W - 2 * M;
  const size = landscape ? 7.5 : 8.5;
  const rowH = size * 1.75;
  const pad = 4;
  const right = (k?: Kind) => k === "money" || k === "number" || k === "percent";

  const cells = doc.rows.map((r) => doc.columns.map((c, i) => display(r[i], c.kind)));
  // Column widths follow the 95th-percentile cell, so one long value truncates instead of widening its column.
  const p95 = (i: number) => {
    const w = cells.map((r) => textWidth(r[i], size)).sort((a, b) => a - b);
    return w.length ? w[Math.floor(0.95 * (w.length - 1))] : 0;
  };
  const natural = doc.columns.map((c, i) => Math.min(tableW * 0.45, Math.max(textWidth(c.label, size, true), p95(i)) + 2 * pad));
  const total = natural.reduce((a, b) => a + b, 0) || 1;
  const widths = natural.map((w) => (w / total) * tableW);
  const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));

  // Page 1 heading, then the table; later pages repeat the table header.
  const head: string[] = [];
  let y = H - M;
  if (doc.branded) {
    head.push(logo(M, y - 22, 22), text("Propniti", M + 29, y - 15.5, 13, { bold: true }));
    const g = `Generated ${generatedLabel(doc.generatedAt)}`;
    head.push(text(g, W - M - textWidth(g, 8), y - 14, 8, { color: MUTED }));
    y -= 44;
    for (const l of wrap(doc.title, tableW, 15, true)) { head.push(text(l, M, y, 15, { bold: true })); y -= 19; }
    y += 4;
    for (const l of [...wrap(`Scope: ${doc.scope}`, tableW, 8.5), ...wrap(`Filters: ${doc.filters.length ? doc.filters.join("; ") : "None"}`, tableW, 8.5)]) { head.push(text(l, M, y, 8.5, { color: MUTED })); y -= 12; }
  } else {
    y -= 14;
    for (const l of wrap(doc.title, tableW, 14, true)) { head.push(text(l, M, y, 14, { bold: true })); y -= 18; }
    y += 4;
  }
  if (doc.note) for (const l of wrap(doc.note, tableW, 8.5)) { head.push(text(l, M, y, 8.5, { color: "0.6 0.35 0" })); y -= 12; }
  const firstTop = y - 6;
  const laterTop = doc.branded ? H - M - 14 : H - M;
  const bottom = doc.branded ? M + 14 : M;

  // Rows per page, then the total page count, before any page is drawn.
  const pages: { top: number; from: number; to: number }[] = [];
  let i = 0;
  do {
    const top = pages.length ? laterTop : firstTop;
    const fitRows = Math.max(1, Math.floor((top - bottom) / rowH) - 1);
    pages.push({ top, from: i, to: Math.min(doc.rows.length, i + fitRows) });
    i += fitRows;
  } while (i < doc.rows.length);

  const baseline = (rowTop: number) => rowTop - (rowH + size * 0.7) / 2;
  const contents = pages.map((p, pi) => {
    const ops: string[] = pi === 0 ? [...head] : [];
    if (pi > 0 && doc.branded) ops.push(text(fit(`${doc.title}`, tableW - 60, 8), M, H - M - 6, 8, { color: MUTED }));
    let top = p.top;
    ops.push(`0.933 0.953 0.949 rg ${n(M)} ${n(top - rowH)} ${n(tableW)} ${n(rowH)} re f`);
    doc.columns.forEach((c, ci) => {
      const label = fit(c.label, widths[ci] - 2 * pad, size, true);
      const x = right(c.kind) ? xs[ci] + widths[ci] - pad - textWidth(label, size, true) : xs[ci] + pad;
      ops.push(text(label, x, baseline(top), size, { bold: true }));
    });
    ops.push(`0.7 0.76 0.75 RG 0.6 w ${n(M)} ${n(top - rowH)} m ${n(M + tableW)} ${n(top - rowH)} l S`);
    top -= rowH;
    for (let r = p.from; r < p.to; r++) {
      doc.columns.forEach((c, ci) => {
        const s = fit(cells[r][ci], widths[ci] - 2 * pad, size);
        if (!s) return;
        const x = right(c.kind) ? xs[ci] + widths[ci] - pad - textWidth(s, size) : xs[ci] + pad;
        ops.push(text(s, x, baseline(top), size));
      });
      ops.push(`0.9 0.92 0.92 RG 0.4 w ${n(M)} ${n(top - rowH)} m ${n(M + tableW)} ${n(top - rowH)} l S`);
      top -= rowH;
    }
    if (!doc.rows.length) ops.push(text("No rows match.", M + pad, baseline(top), size, { color: MUTED }));
    if (doc.branded) {
      const pg = `Page ${pi + 1} of ${pages.length}`;
      ops.push(text("Generated by Propniti", M, M - 2, 8, { color: MUTED }), text(pg, W - M - textWidth(pg, 8), M - 2, 8, { color: MUTED }));
    }
    return ops.join("\n");
  });

  // Objects: 1 catalog, 2 pages, 3–4 fonts, 5 info, then a page and its content per page.
  const objs: string[] = [];
  const pageIds = pages.map((_, k) => 6 + k * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = `<< /Title ${pdfString(doc.title)}${doc.branded ? " /Producer (Propniti) /Creator (Propniti)" : ""} >>`;
  contents.forEach((c, k) => {
    objs[pageIds[k]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[k] + 1} 0 R >>`;
    objs[pageIds[k] + 1] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
