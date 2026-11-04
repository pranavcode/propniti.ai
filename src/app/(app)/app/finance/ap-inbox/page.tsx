import type { Metadata } from "next";
import Link from "@/components/Link";
import { ChevronLeft, ChevronRight, FileUp, Inbox, ScanLine } from "lucide-react";
import { currentSession } from "@/auth/session";
import type { Role } from "@/entities/types";
import { getPlatform } from "@/lib/platform";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/display";
import { effective } from "@/server/query";
import { hardStop, runChecks, scannedTotalCents, viewableScan } from "@/extensions/payables/inbox/checks";
import { asOfDate, duplicateOf, glOptions, vendorFacts } from "@/extensions/payables/inbox/data";
import { SAMPLE_INVOICES, type ExtractedInvoice } from "@/extensions/payables/inbox/samples";
import { Workspace, type InboxItem } from "@/extensions/payables/inbox/Workspace";

// AP inbox (finance lane): an invoice becomes a bill. Document on the left, the bill on the right,
// the Payables checks under it; approve and pay through the guarded bill actions.

export const metadata: Metadata = { title: "AP inbox · Propniti" };

const ROLES: Role[] = ["principal", "regional_manager", "accountant"];
const PAGE = 15;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ApInboxPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { actor, ws } = await currentSession();
  if (!ROLES.includes(actor.role)) {
    return (
      <PageBody>
        <EmptyState title="The AP inbox isn't part of your role" description="Accountants, regional managers and principals enter and approve vendor bills here. Switch role from your avatar menu to see it." action={{ label: "Go to your home", href: "/app" }} />
      </PageBody>
    );
  }
  const db = getPlatform().db;
  const scope = actor.propertyIds === "all" ? "" : ` AND b.property_id IN (SELECT value FROM json_each(?))`;
  const scopeBind = actor.propertyIds === "all" ? [] : [JSON.stringify(actor.propertyIds)];
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const queueWhere = `(b.status = 'Draft' OR (b.status = 'Pending approval' AND b.document_id IS NOT NULL))${scope}`;
  const [vendors, gls, today, props, queue, count, pending] = await Promise.all([
    vendorFacts(db, ws),
    glOptions(db, ws),
    asOfDate(db),
    db.prepare(`SELECT p.id, p.name, p.owner_entity_id FROM ${effective("properties", ws)} p ${actor.propertyIds === "all" ? "" : "WHERE p.id IN (SELECT value FROM json_each(?))"} ORDER BY p.name`).bind(...scopeBind).all<{ id: string; name: string; owner_entity_id: string }>(),
    db.prepare(`SELECT b.id, b.status, b.invoice_number, b.amount_cents, b.due_on, b.document_id, v.company, p.name AS property FROM ${effective("bills", ws)} b
        JOIN ${effective("vendors", ws)} v ON v.id = b.vendor_id JOIN ${effective("properties", ws)} p ON p.id = b.property_id
        WHERE ${queueWhere} ORDER BY b.status = 'Draft' DESC, b.due_on ASC, b.id LIMIT ? OFFSET ?`).bind(...scopeBind, PAGE, (page - 1) * PAGE)
      .all<{ id: string; status: string; invoice_number: string; amount_cents: number; due_on: string; document_id: string | null; company: string; property: string }>(),
    db.prepare(`SELECT count(*) AS n FROM ${effective("bills", ws)} b WHERE ${queueWhere}`).bind(...scopeBind).first<{ n: number }>(),
    db.prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS c FROM ${effective("bills", ws)} b WHERE b.status = 'Pending approval'${scope}`).bind(...scopeBind).first<{ n: number; c: number }>(),
  ]);
  // node:sqlite rows have a null prototype; client components need plain objects.
  const properties = props.results.map((p) => ({ id: p.id, name: p.name, owner_entity_id: p.owner_entity_id }));
  const inScope = new Set(properties.map((p) => p.id));

  // Sample invoices: entered already (a bill of the visitor's with that vendor and invoice number)?
  const samples = await Promise.all(SAMPLE_INVOICES.filter((s) => inScope.has(s.property_id)).map(async (s) => {
    const entered = ws ? await db.prepare("SELECT id, status FROM bills WHERE workspace_id = ? AND vendor_id = ? AND invoice_number = ? AND deleted = 0 ORDER BY seq DESC LIMIT 1").bind(ws, s.vendor_id, s.extracted.invoice_number).first<{ id: string; status: string }>() : null;
    const vendor = vendors.find((v) => v.id === s.vendor_id) ?? null;
    const dup = await duplicateOf(db, ws, s.vendor_id, s.extracted.invoice_number, entered?.id);
    const lines = s.extracted.lines.map((l) => ({ description: l.description, gl_account_id: "", amount_cents: Math.round(l.amount * 100) }));
    const checks = runChecks({ vendor, amountCents: Math.round(s.extracted.total * 100), lines, duplicateOf: dup, remitLast4: s.extracted.remit_last4, gls });
    return { s, entered: entered ? { id: entered.id, status: entered.status } : null, flag: hardStop(checks) ? "Hold" : checks.filter((c) => c.level === "warn").length };
  }));

  const sel = one(sp.item) || (samples.find((x) => !x.entered) ? `sample:${samples.find((x) => !x.entered)!.s.key}` : queue.results[0] ? `bill:${queue.results[0].id}` : "upload");
  let item: InboxItem = { kind: "upload" };
  let selError: string | null = null;
  if (sel.startsWith("sample:")) {
    const hit = samples.find((x) => x.s.key === sel.slice(7));
    if (hit) item = { kind: "sample", key: hit.s.key, file: hit.s.file, title: hit.s.title, vendorId: hit.s.vendor_id, propertyId: hit.s.property_id, extracted: hit.s.extracted, enteredAs: hit.entered };
    else selError = "That sample invoice isn't in your scope.";
  } else if (sel.startsWith("bill:")) {
    const id = sel.slice(5);
    const b = await db.prepare(`SELECT b.*, d.url AS doc_url, d.extracted AS doc_extracted FROM ${effective("bills", ws)} b LEFT JOIN ${effective("documents", ws)} d ON d.id = b.document_id WHERE b.id = ?${scope}`).bind(id, ...scopeBind)
      .first<{ id: string; status: string; vendor_id: string; property_id: string; invoice_number: string; bill_date: string; due_on: string; amount_cents: number; doc_url: string | null; doc_extracted: string | null }>();
    if (b) {
      const lines = await db.prepare(`SELECT description, gl_account_id, amount_cents FROM ${effective("bill_lines", ws)} WHERE bill_id = ? ORDER BY seq`).bind(id).all<{ description: string; gl_account_id: string; amount_cents: number }>();
      let raw: Record<string, unknown> | null = null;
      try { raw = b.doc_extracted ? JSON.parse(b.doc_extracted) as Record<string, unknown> : null; } catch { raw = null; }
      const totalCents = scannedTotalCents(raw);
      const extracted: ExtractedInvoice | null = raw && totalCents != null ? {
        vendor: String(raw.vendor ?? ""), invoice_number: String(raw.invoice_number ?? b.invoice_number), invoice_date: String(raw.invoice_date ?? b.bill_date), due_date: String(raw.due_date ?? b.due_on),
        total: totalCents / 100, lines: Array.isArray(raw.lines) ? (raw.lines as ExtractedInvoice["lines"]) : [], confidence: typeof raw.confidence === "number" ? raw.confidence : 0.9,
        ...(typeof raw.remit_last4 === "string" ? { remit_last4: raw.remit_last4 } : {}),
      } : null;
      item = { kind: "bill", id: b.id, status: b.status, vendorId: b.vendor_id, propertyId: b.property_id, invoiceNumber: b.invoice_number, billDate: b.bill_date, dueOn: b.due_on, amount: b.amount_cents / 100,
        lines: lines.results.map((l) => ({ description: l.description, gl_account_id: l.gl_account_id, amount: l.amount_cents / 100 })), docUrl: viewableScan(b.doc_url) ? b.doc_url : null, docName: b.doc_url ? b.doc_url.split("/").pop() ?? null : null, extracted };
    } else selError = `Bill ${id} isn't in the inbox or your scope.`;
  }

  const total = count?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (item: string, p = page) => `/app/finance/ap-inbox?item=${encodeURIComponent(item)}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeader
        icon={<Inbox />}
        title="AP inbox"
        description="Turn vendor invoices into bills. Fields are read from the document, each line gets a suggested GL account, and the Payables checks run before anything is approved."
        meta={<>
          <span>{samples.filter((x) => !x.entered).length + total} to process</span>
          <span>·</span>
          <Link href="/app/payables/bills?view=to-approve" className="hover:text-foreground hover:underline">{pending?.n ?? 0} bills waiting for approval ({formatMoney((pending?.c ?? 0) / 100, "whole")})</Link>
          <span>·</span>
          <span>{actor.scope.label}</span>
        </>}
      />
      <PageBody className="xl:grid xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start xl:gap-4">
        <nav aria-label="Inbox queue" className="flex flex-col gap-3 xl:sticky xl:top-4">
          <Link href={href("upload")} className={cn("flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 hover:border-primary/50 hover:bg-primary/[0.03]", sel === "upload" && "border-primary bg-primary/[0.05]")}>
            <FileUp className="size-4 text-muted-foreground" />
            <span><span className="block font-medium">Upload an invoice</span><span className="block text-[11.5px] text-muted-foreground">PDF or image, read by AI</span></span>
          </Link>

          <QueueGroup title="New invoices" count={samples.length}>
            {samples.length === 0 && <li className="px-3 py-3 text-[12.5px] text-muted-foreground">No new invoices for your properties.</li>}
            {samples.map(({ s, entered, flag }) => (
              <QueueRow key={s.key} href={href(`sample:${s.key}`)} active={sel === `sample:${s.key}`} title={s.extracted.vendor} sub={`${s.extracted.invoice_number} · ${s.title}`} amount={s.extracted.total}
                badge={entered ? <StatusBadge value={entered.status} /> : flag === "Hold" ? <StatusBadge value="Hold" tone="danger" /> : flag ? <StatusBadge value={`${flag} to review`} tone="warning" /> : <StatusBadge value="Clean" tone="success" />} />
            ))}
          </QueueGroup>

          <QueueGroup title="Drafts and scanned bills" count={total}>
            {queue.results.length === 0 && <li className="px-3 py-3 text-[12.5px] text-muted-foreground">Nothing waiting. Drafts and scanned bills pending approval appear here.</li>}
            {queue.results.map((b) => (
              <QueueRow key={b.id} href={href(`bill:${b.id}`)} active={sel === `bill:${b.id}`} title={b.company} sub={`${b.invoice_number} · ${b.property}`} amount={b.amount_cents / 100}
                badge={<span className="inline-flex items-center gap-1">{b.document_id && <ScanLine className="size-3 text-muted-foreground" aria-label="Scanned" />}<StatusBadge value={b.status} /></span>} />
            ))}
            {pages > 1 && (
              <li className="flex items-center justify-between px-3 py-1.5 text-[12px] text-muted-foreground">
                {page > 1 ? <Link href={href(sel, page - 1)} className="inline-flex items-center hover:text-foreground" aria-label="Previous page"><ChevronLeft className="size-3.5" />Prev</Link> : <span />}
                <span className="tabular-nums">{page} of {pages}</span>
                {page < pages ? <Link href={href(sel, page + 1)} className="inline-flex items-center hover:text-foreground" aria-label="Next page">Next<ChevronRight className="size-3.5" /></Link> : <span />}
              </li>
            )}
          </QueueGroup>
        </nav>

        <div className="mt-4 min-w-0 xl:mt-0">
          {selError
            ? <EmptyState title="That item isn't available" description={selError} action={{ label: "Back to the inbox", href: "/app/finance/ap-inbox" }} />
            : <Workspace key={sel} item={item} vendors={vendors} properties={properties} gls={gls} today={today} canPay={actor.role === "accountant" || actor.role === "principal"} />}
        </div>
      </PageBody>
    </>
  );
}

function QueueGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="flex items-center justify-between border-b px-3 py-2 text-[12px] font-semibold text-muted-foreground">{title}<span className="font-normal tabular-nums">{count}</span></h2>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function QueueRow({ href, active, title, sub, amount, badge }: { href: string; active: boolean; title: string; sub: string; amount: number; badge: React.ReactNode }) {
  return (
    <li>
      <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={cn("flex flex-col gap-0.5 px-3 py-2 hover:bg-muted/50", active && "bg-primary/[0.08] font-medium")}>
        <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{title}</span><span className="tabular-nums">{formatMoney(amount, "full")}</span></span>
        <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{sub}</span>{badge}</span>
      </Link>
    </li>
  );
}
