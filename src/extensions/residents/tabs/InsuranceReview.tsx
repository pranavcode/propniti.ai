import { FileText, Sparkles } from "lucide-react";
import type { TabProps } from "@/extensions/tabs";
import { StatusBadge } from "@/components/app/display";
import { safeHref } from "@/lib/links";
import { one, pageCtx } from "../server";
import { InsuranceDecision } from "../ui/insurance";

const VERIFIERS = ["principal", "regional_manager", "property_manager", "leasing_agent"];
const FIELD: Record<string, string> = { carrier: "Carrier", policyNumber: "Policy number", liability: "Liability", startsOn: "Starts", expiresOn: "Expires" };

// The resident's declarations page next to the values they confirmed, with verify or reject. A
// rejection's reason shows on the resident's portal tracker.
export async function InsuranceReview({ id, row, actor }: TabProps) {
  const ctx = await pageCtx();
  const doc = await one<{ name: string; url: string; extracted: string | null; uploaded_at: string }>(ctx, "SELECT d.name, d.url, d.extracted, d.uploaded_at FROM {documents} d WHERE d.entity_type = 'renters_insurance' AND d.entity_id = ? ORDER BY d.uploaded_at DESC LIMIT 1", [id]);
  const read = (() => { try { return JSON.parse(doc?.extracted ?? "{}") as { source?: string; read_by_ai?: string[]; sample?: boolean }; } catch { return {}; } })();
  const href = doc ? safeHref(doc.url) : undefined;
  const pending = row.status === "Pending verification";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section className="rounded-lg border p-4">
        <h3 className="mb-2 text-[13px] font-semibold">Declarations page</h3>
        {doc ? (
          <div className="space-y-2 text-[13px]">
            <p className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden />{href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{doc.name}</a> : <span className="font-medium">{doc.name}</span>}</p>
            <p className="text-[12px] text-muted-foreground">Sent by the resident from their portal{read.sample ? " · the demo's sample file" : ""}.</p>
            {read.read_by_ai?.length ? <p className="flex items-center gap-1.5 text-[12px] text-tone-ai"><Sparkles className="size-3.5" aria-hidden />AI read {read.read_by_ai.map((f) => FIELD[f] ?? f).join(", ")}; the resident confirmed each value.</p> : <p className="text-[12px] text-muted-foreground">The resident typed the values.</p>}
          </div>
        ) : <p className="text-[13px] text-muted-foreground">No declarations page on file for this policy.</p>}
      </section>
      <section className="rounded-lg border p-4">
        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">Review</h3><StatusBadge value={String(row.status)} /></div>
        {pending && VERIFIERS.includes(actor.role) ? <InsuranceDecision id={id} />
          : row.status === "Rejected" ? <p className="text-[13px]">Rejected: {String(row.review_note ?? "no reason recorded")}. The resident can upload a corrected page.</p>
          : <p className="text-[13px] text-muted-foreground">{pending ? "Waiting for the property team to verify." : "Nothing to review."}</p>}
      </section>
    </div>
  );
}
