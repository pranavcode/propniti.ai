import { cellText, display, generatedLabel, looksLikeFormula } from "./cells";
import { LOGO_PNG_BASE64 } from "./logo";
import type { Cell, ExportDoc, Kind } from "./types";
import { zip } from "./zip";

// A small XLSX (Office Open XML) writer: one sheet, inline strings, real numbers and dates with
// en-US number formats. It never writes a formula; text that looks like one also gets Excel's
// quotePrefix style, so editing the cell keeps it text.

// Characters XML 1.0 forbids, plus lone surrogates.
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlText = (s: string) => s.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const S = { header: 1, money: 2, date: 3, datetime: 4, pct: 5, int: 6, dec: 7, quoted: 8, title: 9, meta: 10, headerRight: 11 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="mmm d, yyyy"/><numFmt numFmtId="166" formatCode="mmm d, yyyy h:mm AM/PM"/><numFmt numFmtId="167" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF5F6B6A"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB4C2C0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const EPOCH = Date.UTC(1899, 11, 30);
// Excel serial day number. Stored dates are demo wall time written as UTC, so UTC parts are the wall clock.
function serial(v: string, withTime: boolean): number | null {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : Date.parse(v);
  if (Number.isNaN(ms)) return null;
  const days = (ms - EPOCH) / 86_400_000;
  return withTime ? Math.round(days * 86_400) / 86_400 : Math.floor(days);
}

const str = (ref: string, s: string, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`;
const num = (ref: string, n: number, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${n}</v></c>`;

function cell(ref: string, v: Cell, kind: Kind = "text"): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && kind !== "text" ? Number(v) : NaN;
  if (kind === "money" && Number.isFinite(n)) return num(ref, n, S.money);
  if (kind === "percent" && Number.isFinite(n)) return num(ref, n, S.pct);
  if (kind === "number" && Number.isFinite(n)) return num(ref, n, Number.isInteger(n) ? S.int : S.dec);
  if ((kind === "date" || kind === "datetime") && typeof v === "string") {
    const d = serial(v, kind === "datetime");
    if (d != null) return num(ref, d, kind === "date" ? S.date : S.datetime);
  }
  if (kind === "bool") return str(ref, display(v, "bool"));
  if (typeof v === "number") return Number.isFinite(v) ? num(ref, v) : "";
  const s = cellText(v);
  return str(ref, s, looksLikeFormula(s) ? S.quoted : 0);
}

const sheetName = (title: string) => title.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Export";

export async function toXlsx(doc: ExportDoc): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const ncol = Math.max(1, doc.columns.length);
  const rows: string[] = [];
  let r = 0;
  const row = (cells: string, attrs = "") => rows.push(`<row r="${++r}"${attrs}>${cells}</row>`);
  if (doc.branded) {
    // The logo floats over A1; the title sits in B1.
    row(str("B1", doc.title, S.title), ' ht="30" customHeight="1"');
    row(str(`A${r + 1}`, `Scope: ${doc.scope}`, S.meta));
    row(str(`A${r + 1}`, `Filters: ${doc.filters.length ? doc.filters.join("; ") : "None"}`, S.meta));
    row(str(`A${r + 1}`, `Generated ${generatedLabel(doc.generatedAt)}`, S.meta));
  } else {
    row(str("A1", doc.title, S.title), ' ht="22" customHeight="1"');
  }
  if (doc.note) row(str(`A${r + 1}`, doc.note, S.meta));
  r++;
  const headerRow = r + 1;
  const numeric = (k?: Kind) => k === "money" || k === "number" || k === "percent";
  row(doc.columns.map((c, i) => str(`${colName(i)}${headerRow}`, c.label, numeric(c.kind) ? S.headerRight : S.header)).join(""));
  for (const data of doc.rows) {
    const at = r + 1;
    row(doc.columns.map((c, i) => cell(`${colName(i)}${at}`, data[i], c.kind)).join(""));
  }
  if (doc.branded) {
    r++;
    row(str(`A${r + 1}`, "Generated by Propniti", S.meta));
  }

  const sample = doc.rows.slice(0, 500);
  const widths = doc.columns.map((c, i) => Math.min(60, Math.max(8, c.label.length + 2, ...sample.map((x) => display(x[i], c.kind).length + 2))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(ncol - 1)}${r}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.join("")}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="${ncol > 6 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>
${doc.branded ? `<headerFooter><oddFooter>&amp;LGenerated by Propniti&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>\n<drawing r:id="rId1"/>` : ""}
</worksheet>`;

  const files: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${doc.branded ? '<Default Extension="png" ContentType="image/png"/>' : ""}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${doc.branded ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheetName(doc.title))}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ];
  if (doc.branded) {
    const px = 9525;                       // EMU per pixel
    files.push(
      { name: "xl/worksheets/_rels/sheet1.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`) },
      { name: "xl/drawings/drawing1.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${4 * px}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${4 * px}</xdr:rowOff></xdr:from><xdr:ext cx="${32 * px}" cy="${32 * px}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Propniti logo" descr="Propniti"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${32 * px}" cy="${32 * px}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`) },
      { name: "xl/drawings/_rels/drawing1.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`) },
      { name: "xl/media/image1.png", data: Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)) },
    );
  }
  return zip(files);
}
