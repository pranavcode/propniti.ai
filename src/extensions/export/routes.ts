import "server-only";
import { handle, readCtx } from "@/app/api/e/_lib/http";
import { sessionFromRequest } from "@/auth/session";
import { demoNowIso } from "@/lib/clock";
import { toCsv } from "@/lib/export/csv";
import { toPdf } from "@/lib/export/pdf";
import { FORMATS, type ExportDoc, type Format } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { rateLimit } from "@/lib/guard";
import { getPlatform } from "@/lib/platform";
import { getDef, parseListQuery, QueryError, withView } from "@/server/query";
import { entityDoc } from "./entity";
import { reportDoc } from "./reports";
import { statementDoc } from "./statement";

// Download routes. Each one takes the same rate limit as the CSV export (the "write" budget), reads
// the person from their cookies and applies the same scope and permission checks as the page.
// ?brand=0 drops the Propniti branding; CSV never has any.

const TYPES: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

async function file(doc: ExportDoc, format: Format, name: string): Promise<Response> {
  const body = format === "csv" ? "﻿" + toCsv(doc) : format === "xlsx" ? await toXlsx(doc) : toPdf(doc);
  const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export"}-${demoNowIso().slice(0, 10)}.${format}`;
  return new Response(body as BodyInit, {
    headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-Rows": String(doc.rows.length) },
  });
}

const options = (request: Request) => {
  const sp = new URL(request.url).searchParams;
  const format = sp.get("format") ?? "";
  if (!(FORMATS as readonly string[]).includes(format)) throw new QueryError(400, "Choose CSV, XLSX or PDF");
  return { sp, format: format as Format, branded: sp.get("brand") !== "0" };
};

// GET /api/e/[entity]/export.xlsx|pdf with the list's URL state (filters, search, view, sort, cols).
export function entityExport(request: Request, entity: string, format: Exclude<Format, "csv">) {
  return handle(async () => {
    const limited = await rateLimit(request, "write");
    if (limited) return limited;
    const def = getDef(entity);
    const raw = new URL(request.url).searchParams;
    const view = def.list.savedViews?.find((v) => v.key === raw.get("view"))?.label;
    const doc = await entityDoc(await readCtx(request), entity, parseListQuery(withView(def, raw)), { branded: raw.get("brand") !== "0", view });
    return file(doc, format, def.label.many);
  });
}

// GET /api/export/report?r=<report>&format=…, with the report page's own params.
export function reportExport(request: Request) {
  return handle(async () => {
    const limited = await rateLimit(request, "write");
    if (limited) return limited;
    const { sp, format, branded } = options(request);
    const doc = await reportDoc(await readCtx(request), sp, branded);
    return file(doc, format, doc.name);
  });
}

// GET /api/export/statement?entity=&period=&format=…, for staff and the owner portal alike.
export function statementExport(request: Request) {
  return handle(async () => {
    const limited = await rateLimit(request, "write");
    if (limited) return limited;
    const { sp, format, branded } = options(request);
    const s = await sessionFromRequest(request);
    const doc = await statementDoc({ db: getPlatform().db, ws: s.ws }, s, sp.get("entity") ?? "", sp.get("period") ?? "", branded);
    return file(doc, format, doc.name);
  });
}
