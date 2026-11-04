"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/Link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck } from "lucide-react";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalItem } from "@/components/app/ai";
import { cn } from "@/lib/utils";
import { AGENT_LABEL, api, sourceOf, type ProposalJson } from "./client";

type Queue = "needs_you" | "auto_handled" | "waiting" | "decided";
const TABS: { key: Queue; label: string; hint: string }[] = [
  { key: "needs_you", label: "Needs you", hint: "Agents proposed these and stopped: a person decides." },
  { key: "auto_handled", label: "Handled automatically", hint: "Low-risk actions inside your approval policies, already applied and audited." },
  { key: "waiting", label: "Waiting on others", hint: "Over the owner's limit: the owner approves in their portal." },
  { key: "decided", label: "Decided", hint: "Approved, edited or rejected by a person." },
];
type Page = { rows: ProposalJson[]; total: number; page: number; size: number; counts: Partial<Record<Queue, number>> };

type MessageEffect = { kind: "message"; subject?: string; body?: string };

// focusId (from a ?proposal= or ?record= deep link) opens that proposal and scrolls it into view;
// missing says the link named a record with no proposal this persona can see yet.
export function ApprovalsInbox({ initial, initialQueue, focusId, missing }: { initial: Page; initialQueue: Queue; focusId?: string; missing?: { href?: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [queue, setQueue] = useState<Queue>(initialQueue);
  const [data, setData] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [editing, setEditing] = useState<{ p: ProposalJson; subject: string; body: string } | null>(null);
  const agent = sp.get("agent") ?? undefined;

  useEffect(() => {
    if (focusId) document.getElementById(`proposal-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);

  const load = useCallback(async (q: Queue, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<Page>(`/api/ai/proposals?queue=${q}&page=${pg}&size=25${agent ? `&agent=${agent}` : ""}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agent]);

  const goPage = (pg: number) => {
    setPage(pg);
    void load(queue, pg);
  };

  const switchTo = (q: Queue) => {
    setQueue(q);
    setPage(1);
    void load(q, 1);
    const next = new URLSearchParams(sp);
    next.set("tab", q);
    next.delete("proposal");
    next.delete("record");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const decide = async (p: ProposalJson, decision: "approve" | "reject", payload?: unknown) => {
    try {
      const r = await api<{ message: string }>(`/api/ai/proposals/${p.id}`, "POST", { decision, payload });
      toast.success(decision === "approve" ? r.message : "Rejected");
      setData((d) => ({ ...d, counts: { ...d.counts, needs_you: Math.max(0, (d.counts.needs_you ?? 1) - 1), decided: (d.counts.decided ?? 0) + 1 } }));
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  const safe = data.rows.filter((p) => p.risk === "Low" && p.amount_cents == null && !p.decision);
  const bulk = async () => {
    try {
      const r = await api<{ approved: number; results: { ok: boolean; message: string }[] }>("/api/ai/proposals/bulk", "POST", { ids: safe.map((p) => p.id) });
      toast.success(`Approved ${r.approved} low-risk item${r.approved === 1 ? "" : "s"}`);
      void load(queue, page);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const message = (p: ProposalJson) => ((p.payload.effects as MessageEffect[] | undefined) ?? []).find((e) => e.kind === "message");
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const tab = TABS.find((t) => t.key === queue)!;

  return (
    <div className="space-y-3 px-4 pb-10 md:px-6">
      <div role="tablist" className="flex flex-wrap items-center gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={queue === t.key} onClick={() => switchTo(t.key)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors", queue === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}<span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{data.counts[t.key] ?? 0}</span>
          </button>
        ))}
        {queue === "needs_you" && safe.length > 0 && (
          <Button size="sm" variant="outline" className="mb-1 ml-auto" onClick={() => void bulk()}><CheckCheck /> Approve {safe.length} low-risk</Button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">{tab.hint}{agent ? ` Showing ${AGENT_LABEL[agent] ?? agent} only.` : ""}</p>
      {missing && (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-[12.5px]">
          No agent proposal for this record yet. It appears here once the agent has scored it.{missing.href && <> <Link href={missing.href} className="font-medium text-primary hover:underline">Open the record</Link></>}
        </p>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load(queue, page)} />}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : data.rows.length ? (
        <div className={queue === "needs_you" ? "space-y-2" : "overflow-hidden rounded-lg border bg-card"}>
          {data.rows.map((p) => {
            const m = message(p);
            const decided = !!p.decision || queue !== "needs_you";
            const focused = p.id === focusId;
            return (
              <ApprovalItem
                key={p.id}
                id={`proposal-${p.id}`}
                className={focused ? "scroll-mt-20 ring-2 ring-inset ring-primary/60" : undefined}
                variant={queue === "needs_you" ? "card" : "row"}
                defaultOpen={focused}
                agent={AGENT_LABEL[p.agent] ?? p.agent}
                title={p.decision ? `${p.title} — ${p.decision.toLowerCase()} by ${p.decided_by}` : p.title}
                amount={p.amount_cents != null ? p.amount_cents / 100 : null}
                risk={p.risk}
                why={p.why}
                evidence={p.evidence.map((e) => ({ label: e.label, href: e.href }))}
                confidence={p.confidence}
                policy={p.assignee_role ? `Approver: ${p.assignee_role.replace(/_/g, " ")}` : undefined}
                runHref={p.run_id ? `/app/ai/runs/${p.run_id}` : undefined}
                recordHref={p.href}
                createdAt={p.created_at}
                source={sourceOf(p)}
                model={p.model ?? undefined}
                onApprove={decided ? undefined : () => decide(p, "approve")}
                onReject={decided ? undefined : () => decide(p, "reject")}
                onEdit={!decided && m ? () => setEditing({ p, subject: m.subject ?? "", body: m.body ?? "" }) : undefined}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState kind="inbox" title={queue === "needs_you" ? "Nothing needs you right now" : `No items in “${tab.label}”`} description={queue === "needs_you" ? "When an agent proposes something that needs a person, it lands here with its reasons and evidence." : tab.hint} action={queue === "needs_you" ? { label: "Run an agent", href: "/app/agents" } : undefined} />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
          <span>Page {page} of {pages} · {data.total} items</span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => goPage(page + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-surface="app">
          <DialogHeader>
            <DialogTitle>Edit before approving</DialogTitle>
            <DialogDescription>You can change the wording. The recipient, record and amounts stay as the agent computed them.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-2">
              <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} aria-label="Subject" />
              <Textarea rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Message" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (!editing) return; const e = editing; setEditing(null); void decide(e.p, "approve", { message: { subject: e.subject, body: e.body } }).then(() => load(queue, page), () => {}); }}>Approve and send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
