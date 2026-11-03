// Writes a simple SVG invoice for every seeded bill document that points at /docs/invoices/*.svg,
// from the bill's extracted fields (vendor, number, dates, lines, total). Rerunnable; overwrites.
//   node scripts/seed-docs.mjs
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { baseData } = await jiti.import(join(root, "src/server/base.ts"));

const out = join(root, "public", "docs", "invoices");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const { tables } = baseData();
const props = new Map(tables.properties.map((p) => [p.id, p]));
let n = 0;
for (const d of tables.documents) {
  if (!String(d.url).startsWith("/docs/invoices/")) continue;
  const x = JSON.parse(d.extracted);
  const p = props.get(d.property_id);
  const lines = x.lines.length ? x.lines : [{ description: "Services", amount: x.total }];
  const rows = lines.map((l, i) => `<text x="40" y="${300 + i * 26}">${esc(l.description).slice(0, 70)}</text><text x="560" y="${300 + i * 26}" text-anchor="end">${usd(l.amount)}</text>`).join("");
  const y = 300 + lines.length * 26 + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${y + 120}" viewBox="0 0 600 ${y + 120}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#1f2328">
<rect width="100%" height="100%" fill="#fff"/><text x="40" y="60" font-size="22" font-weight="700">${esc(x.vendor)}</text>
<text x="560" y="60" text-anchor="end" font-size="20" fill="#57606a">INVOICE</text>
<text x="40" y="110">Bill to: ${esc(p?.name ?? "")}</text><text x="40" y="130">${esc(p ? `${p.street}, ${p.city}, ${p.state} ${p.zip}` : "")}</text>
<text x="560" y="110" text-anchor="end">Invoice # ${esc(x.invoice_number)}</text><text x="560" y="130" text-anchor="end">Date ${esc(x.date)}</text><text x="560" y="150" text-anchor="end">Due ${esc(x.due_date)}</text>
<line x1="40" y1="270" x2="560" y2="270" stroke="#d0d7de"/><text x="40" y="260" font-weight="700">Description</text><text x="560" y="260" text-anchor="end" font-weight="700">Amount</text>
${rows}<line x1="40" y1="${y - 10}" x2="560" y2="${y - 10}" stroke="#d0d7de"/><text x="560" y="${y + 16}" text-anchor="end" font-size="16" font-weight="700">Total ${usd(x.total)}</text>
<text x="40" y="${y + 80}" fill="#57606a" font-size="11">Sample document generated for the Propniti demo. Remit by ACH to the account on file.</text></svg>`;
  writeFileSync(join(out, String(d.url).split("/").pop()), svg);
  n++;
}
console.log(`public/docs/invoices: ${n} invoices (${readdirSync(out).length} files)`);
