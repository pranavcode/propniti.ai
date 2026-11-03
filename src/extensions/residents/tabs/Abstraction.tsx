import Link from "next/link";
import { Check, FileText, Minus, X } from "lucide-react";
import type { TabProps } from "@/extensions/tabs";
import { AIBadge, Confidence } from "@/components/app/ai";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { cn } from "@/lib/utils";
import { savedAbstract } from "../ai";
import { leaseDocument, type Comparison } from "../lib";
import { leaseRecord, pageCtx, sql } from "../server";
import { AbstractControls } from "../ui/abstract";
import { IssueFix } from "../ui/client";

// Lease abstraction: the document on the left with page numbers, the extracted terms on the right
// with their page and quote, compared with the lease record. Each difference is a data-health
// issue with "AI: fix this", which applies the document's value through the Data Health flow.

const show = (c: Comparison, v: unknown) => {
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
  if (c.key.endsWith("_cents")) return `$${(Number(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (c.key === "nnn_share_pct") return `${v}%`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return String(v);
};

const FIX_LABEL: Record<string, string> = { rent_cents: "Rent", end_on: "Lease ends", start_on: "Lease starts", term_months: "Term (months)", deposit_cents: "Deposit", nnn_share_pct: "Pro-rata share", cam_cents: "CAM estimate" };

export async function Abstraction({ id, actor }: TabProps) {
  const ctx = await pageCtx();
  const lease = await leaseRecord(ctx, id);
  if (!lease) return <EmptyState title="Lease not found" />;
  const saved = await savedAbstract(ctx, id);
  const pages = saved?.uploaded_pages ?? leaseDocument(lease);
  const r = saved?.abstract;
  const issues = await sql(ctx, "SELECT * FROM {data_issues} WHERE entity_type = 'leases' AND entity_id = ? AND status = 'open' ORDER BY severity = 'critical' DESC, detected_at DESC", [id]);
  const canRun = ["principal", "regional_manager", "property_manager", "broker", "accountant"].includes(actor.role);
  const quoted = new Set((r?.fields ?? []).map((f) => `${f.page}|${f.quote}`));
  const differs = r?.comparisons.filter((c) => c.match === false) ?? [];

  return (
    <div className="space-y-3" data-tour="lease-abstraction">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><FileText className="size-4 text-muted-foreground" />{r?.documentName ?? `Signed lease ${lease.id}.pdf`}<span className="text-[12px] font-normal text-muted-foreground">{pages.length} pages</span></h3>
          {r ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <AIBadge source={r.source} model={r.model} />
              <span>Abstracted <RelativeDate value={r.at} /></span>
              <Link href={`/app/ai/runs/${encodeURIComponent(r.runId)}`} className="text-primary hover:underline">View run</Link>
              {r.dropped > 0 && <span>· {r.dropped} value{r.dropped === 1 ? "" : "s"} dropped because the quote wasn&apos;t on the cited page</span>}
            </p>
          ) : <p className="mt-0.5 text-[12px] text-muted-foreground">Not abstracted yet. Abstraction reads each term with its page and checks it against the lease record.</p>}
        </div>
        {canRun && <AbstractControls leaseId={id} hasResult={!!r} />}
      </div>

      {r && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", differs.length ? "border-tone-warning/30 bg-tone-warning/[0.06]" : "border-tone-success/30 bg-tone-success/[0.06]")}>
          {differs.length ? <X className="size-4 text-tone-warning" /> : <Check className="size-4 text-tone-success" />}
          {differs.length
            ? <span><b>{differs.length}</b> term{differs.length === 1 ? "" : "s"} in the document differ from the lease record: {differs.map((d) => d.label.toLowerCase()).join(", ")}. Each one is logged as a data issue below.</span>
            : <span>Every compared term matches the lease record.</span>}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section aria-label="Lease document" className="max-h-[720px] overflow-y-auto rounded-lg border bg-muted/30 p-3">
          {pages.map((p, i) => (
            <article key={i} id={`page-${i + 1}`} className="mb-3 scroll-mt-3 rounded-md border bg-card px-5 py-4 font-serif text-[12.5px] leading-relaxed shadow-xs last:mb-0">
              {p.split("\n").map((line, j) => (
                <p key={j} className={cn("min-h-[1em] whitespace-pre-wrap", quoted.has(`${i + 1}|${line.trim()}`) && "-mx-1 rounded bg-tone-ai/10 px-1 ring-1 ring-tone-ai/20")}>{line}</p>
              ))}
              <div className="mt-3 text-center font-sans text-[10.5px] text-muted-foreground">Page {i + 1} of {pages.length}</div>
            </article>
          ))}
        </section>

        <section aria-label="Abstracted terms" className="space-y-3">
          {!r ? (
            <EmptyState compact kind="table" title="No abstraction yet" description={canRun ? "Run it on the lease on file, or upload a text copy of a lease to check it against this record." : "A property manager or broker can run abstraction on this lease."} />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full table-fixed text-[12.5px]">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-[11px] text-muted-foreground">
                    <th className="w-[30%] px-3 py-1.5 font-medium">Term</th>
                    <th className="px-3 py-1.5 font-medium">Document says</th>
                    <th className="px-3 py-1.5 font-medium">Record has</th>
                    <th className="w-24 px-3 py-1.5 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {r.comparisons.map((c) => (
                    <tr key={c.key} className={cn("border-b align-top last:border-0", c.match === false && "bg-tone-warning/[0.05]")}>
                      <td className="px-3 py-1.5 font-medium">{c.label}</td>
                      <td className="max-w-0 px-3 py-1.5">
                        <div className="line-clamp-2 tabular-nums" title={String(c.document ?? "")}>{show(c, c.document)}</div>
                        <a href={`#page-${c.page}`} className="text-[11px] text-primary hover:underline" title={`“${c.quote}”`}>Page {c.page}</a>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{c.match == null ? <span className="text-muted-foreground">—</span> : show(c, c.record)}</td>
                      <td className="px-3 py-1.5">{c.match == null ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="size-3" />Info</span> : c.match ? <StatusBadge value="Matches" tone="success" /> : <StatusBadge value="Differs" tone="warning" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2 border-t px-3 py-2 text-[11.5px] text-muted-foreground">
                <Confidence value={r.source === "live" ? 0.9 : 0.95} />
                <span>{r.source === "live" ? "Values without a matching quote on the cited page are dropped." : "Read by fixed rules from the labelled lines of the lease; no model was used."}</span>
              </div>
            </div>
          )}

          {issues.map((i) => {
            const fix = JSON.parse(String(i.suggested_fix ?? "{}"));
            const ev = JSON.parse(String(i.evidence ?? "{}"));
            const cur = lease as unknown as Record<string, unknown>;
            const fmtV = (k: string, v: unknown) => (v == null || v === "" ? null : k.endsWith("_cents") ? `$${(Number(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : String(v));
            const changes = Object.entries(fix.changes ?? {}).map(([k, after]) => ({ field: k, label: FIX_LABEL[k] ?? k, before: fmtV(k, k in cur ? cur[k] : ev.record ?? ev[k]), after: fmtV(k, after) }));
            return (
              <IssueFix key={String(i.id)} issueId={String(i.id)} rule={String(i.rule_id)}
                title={i.rule_id === "leases.abstract_mismatch" ? `AI: fix ${String(ev.label ?? "term").toLowerCase()} from the signed lease` : String(i.rule_id).replace("leases.", "").replace(/_/g, " ")}
                changes={changes} why={fix.why ?? []} confidence={Number(fix.confidence ?? 0.8)} source={fix.source === "rule" ? "rule" : `${fix.source ?? "rule"} agent`} />
            );
          })}
        </section>
      </div>
    </div>
  );
}
