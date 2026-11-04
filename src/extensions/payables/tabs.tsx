import Link from "@/components/Link";
import { AlertOctagon, ArrowUpRight, CheckCircle2, TriangleAlert } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AIBadge } from "@/components/app/ai";
import { EmptyState } from "@/components/app/states";
import { effective } from "@/server/query";
import { actionsForRow } from "@/server/permissions";
import { registerTab, type TabProps } from "../tabs";
import { expectedGl, hardStop, proposeGl, runChecks, scannedTotalCents, viewableScan, type Check } from "./inbox/checks";
import { duplicateOf, glOptions, vendorFacts } from "./inbox/data";
import { BillActionBar, ConfirmBankForm, ProposalCard, RecodeSuggestion } from "./inbox/TabControls";

// Bill record tabs: Review (checks, the Payables agent's proposals, the scanned invoice, the
// bank-change hold) and Lines (GL coding with recode suggestions that a person approves).

const AP_AGENT = "Payables agent";
const parse = <T,>(s: unknown, d: T): T => { try { return typeof s === "string" ? JSON.parse(s) as T : d; } catch { return d; } };

async function billContext(id: string, row: TabProps["row"]) {
  const { ws, actor } = await currentSession();
  const db = getPlatform().db;
  const vendorId = String(row.vendor_id);
  const [vendors, gls, lines, doc, dup, issues] = await Promise.all([
    vendorFacts(db, ws, vendorId),
    glOptions(db, ws),
    db.prepare(`SELECT id, description, gl_account_id, amount_cents FROM ${effective("bill_lines", ws)} WHERE bill_id = ? ORDER BY seq`).bind(id).all<{ id: string; description: string; gl_account_id: string; amount_cents: number }>(),
    row.document_id ? db.prepare(`SELECT name, url, extracted FROM ${effective("documents", ws)} WHERE id = ?`).bind(String(row.document_id)).first<{ name: string; url: string; extracted: string | null }>() : Promise.resolve(null),
    duplicateOf(db, ws, vendorId, String(row.invoice_number ?? ""), id),
    db.prepare(`SELECT id, rule_id, entity_id, evidence, suggested_fix FROM ${effective("data_issues", ws)} WHERE rule_id LIKE '%gl_miscoded' AND status = 'open' AND (entity_id = ? OR entity_id IN (SELECT id FROM ${effective("bill_lines", ws)} WHERE bill_id = ?))`).bind(id, id)
      .all<{ id: string; rule_id: string; entity_id: string; evidence: string; suggested_fix: string | null }>(),
  ]);
  const extracted = parse<{ total?: number; total_cents?: number; remit_last4?: string } | null>(doc?.extracted, null);
  const vendor = vendors[0] ?? null;
  const checks = runChecks({
    vendor, amountCents: Math.round(Number(row.amount ?? 0) * 100), lines: lines.results, duplicateOf: dup, gls,
    scannedTotalCents: scannedTotalCents(extracted), remitLast4: extracted?.remit_last4 ?? null,
  });
  return { db, ws, actor, vendor, gls, lines: lines.results, doc, checks, issues: issues.results };
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y">
      {checks.map((c) => (
        <li key={c.key} className={cn("flex gap-2 px-3.5 py-2", c.level === "stop" && "bg-tone-danger/[0.04]")}>
          <span className="mt-0.5">{c.level === "ok" ? <CheckCircle2 className="size-3.5 text-tone-success" /> : c.level === "warn" ? <TriangleAlert className="size-3.5 text-tone-warning" /> : <AlertOctagon className="size-3.5 text-tone-danger" />}</span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium">{c.label}</div>
            <div className="text-[12px] text-muted-foreground">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function ReviewTab({ id, row }: TabProps) {
  const { db, ws, actor, vendor, checks, doc } = await billContext(id, row);
  const stop = hardStop(checks);
  const warn = checks.filter((c) => c.level === "warn").length;
  const proposals = await db.prepare(`SELECT p.*, (SELECT d.decision FROM ${effective("ai_decisions", ws)} d WHERE d.proposal_id = p.id ORDER BY d.decided_at DESC LIMIT 1) AS decision
      FROM ${effective("ai_proposals", ws)} p WHERE p.agent = 'ap' AND ((p.entity_type = 'bills' AND p.entity_id = ?) OR (p.entity_type = 'vendors' AND p.entity_id = ?)) ORDER BY p.created_at DESC LIMIT 6`)
    .bind(id, String(row.vendor_id)).all<Record<string, unknown>>();
  const actions = actionsForRow("bills", actor.role, row).map((a) => ({ key: a.key, label: a.label, money: !!a.money, confirm: a.confirm }));
  const canConfirm = actions.some((a) => a.key === "bills.confirm_vendor_bank");
  const decides = ["accountant", "principal", "regional_manager"].includes(actor.role);
  const docUrl = viewableScan(doc?.url) ? doc!.url : null;

  return (
    <div className={cn("grid gap-4", docUrl && "2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
      <div className="flex min-w-0 flex-col gap-4">
        {stop && (
          <div role="alert" className="rounded-lg border border-tone-danger/30 bg-tone-danger/[0.06] px-3.5 py-3">
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-tone-danger" />
              <div className="min-w-0 text-[12.5px]">
                <div className="font-semibold text-tone-danger">Payment hold</div>
                <p className="mt-0.5">{stop.detail}</p>
              </div>
            </div>
            {stop.key === "bank" && canConfirm && vendor && <ConfirmBankForm billId={id} company={vendor.company} />}
            {stop.key === "bank" && !canConfirm && <p className="mt-2 text-[12px] text-muted-foreground">An accountant or principal records the phone verification to lift the hold.</p>}
          </div>
        )}

        <section className="overflow-hidden rounded-lg border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2">
            <h3 className="text-[13px] font-semibold">Payables checks</h3>
            <span className={cn("text-[11.5px]", stop ? "font-medium text-tone-danger" : "text-muted-foreground")}>{stop ? "Payment hold" : warn ? `${warn} to review` : "Nothing unusual"}</span>
            <AIBadge source="rules" size="xs" className="ml-auto" />
          </header>
          <CheckList checks={checks} />
          {(row.status === "Pending approval" || row.status === "Approved") && (
            <div className="border-t px-3.5 py-2.5"><BillActionBar billId={id} actions={actions} hold={stop?.detail ?? null} /></div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">Payables agent <span className="font-normal text-muted-foreground">proposals on this bill and vendor</span></h3>
          {proposals.results.length === 0
            ? <p className="rounded-lg border border-dashed px-3.5 py-3 text-[12.5px] text-muted-foreground">The Payables agent hasn&apos;t reviewed this bill yet. It runs every two hours and when an invoice arrives; the checks above are the same rules it applies.</p>
            : proposals.results.map((p) => {
                const ev = parse<{ entity_type: string; entity_id: string; label: string }[]>(p.evidence, []);
                const model = typeof p.model === "string" ? p.model : null;
                return <ProposalCard key={String(p.id)} id={String(p.id)} agent={AP_AGENT} title={String(p.title)} amount={p.amount_cents == null ? null : Number(p.amount_cents) / 100}
                  risk={(["Low", "Medium", "High"].includes(String(p.risk)) ? p.risk : "Low") as "Low"} why={parse<string[]>(p.why, [])}
                  evidence={ev.map((e) => ({ label: e.label, href: e.entity_type === "bills" ? `/app/payables/bills/${encodeURIComponent(e.entity_id)}` : e.entity_type === "vendors" ? `/app/maintenance/vendors/${encodeURIComponent(e.entity_id)}` : undefined }))}
                  confidence={Number(p.confidence ?? 0)} runHref={p.run_id ? `/app/ai/runs/${encodeURIComponent(String(p.run_id))}` : undefined} createdAt={String(p.created_at)}
                  source={!model || model === "rules" ? "rules" : "precomputed"} model={model && model !== "rules" ? model : undefined} decided={(p.decision as string) ?? null} canApprove={decides} />;
              })}
        </section>
      </div>

      {docUrl && (
        <section aria-label="Scanned invoice" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 border-b bg-card px-3 py-1.5 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{doc?.name ?? "Scanned invoice"}</span>
            <a href={docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">Open <ArrowUpRight className="size-3" /></a>
          </div>
          <div className="max-h-[80vh] overflow-auto p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- same-site scan; the Workers build has no image optimizer */}
            {docUrl.endsWith(".pdf") ? <object data={docUrl} type="application/pdf" className="h-[70vh] w-full rounded border bg-white" aria-label="Invoice PDF" /> : <img src={docUrl} alt="Scanned invoice" className="w-full rounded border bg-white" />}
          </div>
        </section>
      )}
    </div>
  );
}

async function LinesTab({ id, row }: TabProps) {
  const { actor, vendor, gls, lines, issues } = await billContext(id, row);
  if (!lines.length) return <EmptyState compact title="No lines on this bill" description="Lines are added when the bill is submitted for approval, each coded to a GL account." />;
  const glName = (gid: string) => { const g = gls.find((x) => x.id === gid); return g ? `${g.number} ${g.name}` : gid; };
  const canAct = actor.role === "accountant" || actor.role === "principal" || actor.role === "regional_manager";
  const total = lines.reduce((s, l) => s + l.amount_cents, 0);

  // A suggestion per line: an open data-health issue first (precomputed by the generator or the
  // Data Health agent), else the vendor-history rule.
  type Suggestion = { line: (typeof lines)[number]; issueId?: string; gl: string; why: string[]; confidence: number; source: "precomputed" | "rules" };
  const suggestions = lines.flatMap((l): Suggestion[] => {
    const issue = issues.find((i) => i.entity_id === l.id) ?? issues.find((i) => i.entity_id === id && (parse<{ line_id?: string }>(i.evidence, {}).line_id ?? l.id) === l.id);
    if (issue) {
      const fix = parse<{ changes?: { gl_account_id?: string }; why?: string[]; confidence?: number; source?: string }>(issue.suggested_fix, {});
      const target = fix.changes?.gl_account_id ?? (vendor ? expectedGl(vendor, l.description) : null);
      if (target && target !== l.gl_account_id) {
        return [{ line: l, issueId: issue.id, gl: target, why: fix.why?.length ? fix.why : [`Data health rule ${issue.rule_id} flagged this line`], confidence: fix.confidence ?? 0.9, source: (fix.source && fix.source !== "rule" ? "precomputed" : "rules") as "precomputed" | "rules" }];
      }
    }
    if (!vendor) return [];
    const exp = expectedGl(vendor, l.description);
    if (!exp || exp === l.gl_account_id || exp === "gl-1500" || l.gl_account_id === "gl-1500") return [];
    const p = proposeGl(vendor, l.description, gls);
    return [{ line: l, issueId: undefined, gl: exp, why: [`Coded to ${glName(l.gl_account_id)}, which is unusual for ${vendor.company}`, ...(p?.why ?? [])], confidence: p?.confidence ?? 0.75, source: "rules" as const }];
  });

  return (
    <div className="flex flex-col gap-3">
      {suggestions.map((s) => (
        <RecodeSuggestion key={s.line.id} billId={id} lineId={s.line.id} issueId={s.issueId} glId={s.gl} glLabel={glName(s.gl)} description={s.line.description} why={s.why} confidence={s.confidence} source={s.source} canAct={canAct && row.status !== "Void"} />
      ))}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11.5px] text-muted-foreground">
            <tr><th className="px-3 py-2 text-left font-medium">Description</th><th className="px-3 py-2 text-left font-medium">GL account</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const flagged = suggestions.some((s) => s.line.id === l.id);
              return (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2"><Link href={`/app/gl/accounts/${encodeURIComponent(l.gl_account_id)}`} className={cn("hover:underline", flagged && "text-tone-warning")}>{glName(l.gl_account_id)}</Link>{flagged && <TriangleAlert className="ml-1.5 inline size-3.5 text-tone-warning" aria-label="Coding looks off" />}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.amount_cents / 100, "full")}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t bg-muted/30 font-medium"><td className="px-3 py-2" colSpan={2}>Total</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(total / 100, "full")}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

registerTab({ key: "payables.review", label: "Review", entity: "bills", component: ReviewTab });
registerTab({ key: "payables.lines", label: "Lines", entity: "bills", component: LinesTab });
