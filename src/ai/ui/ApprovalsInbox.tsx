"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/Link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, ChevronDown, X } from "lucide-react";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalItem } from "@/components/app/ai";
import { cn } from "@/lib/utils";
import { pickFilter, ResultsSummary } from "@/components/app/ResultsSummary";
import { resultsSummary } from "@/components/app/results";
import { RISKS, type ProposalFilters } from "@/ai/filters";
import { AGENT_LABEL, api, sourceOf, type ProposalJson } from "./client";

type Queue = "needs_you" | "auto_handled" | "waiting" | "decided";
const TABS: { key: Queue; label: string; hint: string }[] = [
  { key: "needs_you", label: "Needs you", hint: "Agents proposed these and stopped: a person decides." },
  { key: "auto_handled", label: "Handled automatically", hint: "Low-risk actions inside your approval policies, already applied and audited." },
  { key: "waiting", label: "Waiting on others", hint: "Over the owner's limit (the owner approves in their portal), or for another role to decide: notify them from here." },
  { key: "decided", label: "Decided", hint: "Approved, edited or rejected by a person." },
];
type Facet = { key: string; label: string; n: number };
type Page = { rows: ProposalJson[]; total: number; page: number; size: number; counts: Partial<Record<Queue, number>>; facets?: Record<keyof ProposalFilters, Facet[]> };
type Bulk = { count: number; more: boolean; cap: number };
const FILTER_KEYS = ["agent", "risk", "property", "entity"] as const;
const FILTER_LABEL = { agent: "Agent", risk: "Risk", property: "Property", entity: "Record type" } as const;
const ALIASES = ["f.agent", "f.risk", "f.property_id", "f.entity_type", "page"];

type MessageEffect = { kind: "message"; subject?: string; body?: string };

// focusId (from a ?proposal= or ?record= deep link) opens that proposal and scrolls it into view;
// missing says the link named a record with no proposal this persona can see yet.
export function ApprovalsInbox({ initial, initialQueue, initialFilters, focusId, missing }: { initial: Page; initialQueue: Queue; initialFilters?: ProposalFilters; focusId?: string; missing?: { href?: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [queue, setQueue] = useState<Queue>(initialQueue);
  const [data, setData] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [editing, setEditing] = useState<{ p: ProposalJson; subject: string; body: string } | null>(null);
  const [filters, setFilters] = useState<ProposalFilters>(initialFilters ?? {});
  // The full approvals page has filters; the home page's embedded queue doesn't.
  const filterable = !!initial.facets;
  const [confirm, setConfirm] = useState<Bulk | null>(null);
  const [notified, setNotified] = useState<Record<string, true>>({});

  useEffect(() => {
    if (focusId) document.getElementById(`proposal-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);

  // Filters ride along on every page and tab load, so page 2 of "High risk" is still High risk.
  const load = useCallback(async (q: Queue, pg: number, f: ProposalFilters = filters) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ queue: q, page: String(pg), size: "25", ...f, ...(filterable ? { facets: "1" } : {}) });
      setData(await api<Page>(`/api/ai/proposals?${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, filterable]);

  const goPage = (pg: number) => {
    setPage(pg);
    void load(queue, pg);
  };

  const syncUrl = (q: Queue, f: ProposalFilters) => {
    const next = new URLSearchParams(sp);
    next.set("tab", q);
    next.delete("proposal");
    next.delete("record");
    if (filterable) {
      for (const k of [...ALIASES, ...FILTER_KEYS]) next.delete(k);
      for (const k of FILTER_KEYS) if (f[k]) next.set(k, f[k]!);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const switchTo = (q: Queue) => {
    setQueue(q);
    setPage(1);
    void load(q, 1);
    syncUrl(q, filters);
  };

  const setFilter = (k: keyof ProposalFilters, v: string | undefined) => {
    pickFilter();
    const f = { ...filters, [k]: v };
    if (!v) delete f[k];
    setFilters(f);
    setPage(1);
    void load(queue, 1, f);
    syncUrl(queue, f);
  };

  const decide = async (p: ProposalJson, decision: "approve" | "reject", payload?: unknown) => {
    try {
      const r = await api<{ message: string }>(`/api/ai/proposals/${p.id}`, "POST", { decision, payload });
      toast.success(decision === "approve" ? r.message : "Rejected");
      setData((d) => ({ ...d, counts: { ...d.counts, needs_you: Math.max(0, (d.counts.needs_you ?? 1) - 1), decided: (d.counts.decided ?? 0) + 1 } }));
      // Re-render the server layout so the sidebar's Inbox count drops too.
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  // Every page, not just this one: the server finds the matching low-risk items this persona may
  // decide (capped), the confirm shows how many, and the same filters approve them.
  const previewBulk = async () => {
    try {
      setConfirm(await api<Bulk>("/api/ai/proposals/bulk", "POST", { match: filters, preview: true }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const bulk = async () => {
    setConfirm(null);
    try {
      const r = await api<{ approved: number; more: boolean }>("/api/ai/proposals/bulk", "POST", { match: filters });
      toast.success(`Approved ${r.approved} low-risk item${r.approved === 1 ? "" : "s"}${r.more ? ". More match: run it again for the rest." : ""}`);
      setPage(1);
      void load(queue, 1);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const notify = async (p: ProposalJson) => {
    try {
      const r = await api<{ message: string }>(`/api/ai/proposals/${p.id}/notify`, "POST", {});
      toast.success(r.message);
      setNotified((n) => ({ ...n, [p.id]: true }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const message = (p: ProposalJson) => ((p.payload.effects as MessageEffect[] | undefined) ?? []).find((e) => e.kind === "message");
  const filterText = (k: keyof ProposalFilters) => k === "risk" ? `${filters.risk} risk`
    : `${FILTER_LABEL[k]}: ${(k === "agent" && AGENT_LABEL[filters.agent!]) || data.facets?.[k]?.find((f) => f.key === filters[k])?.label || filters[k]}`;
  const clearFilters = () => { setFilters({}); setPage(1); void load(queue, 1, {}); syncUrl(queue, {}); };
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
        {queue === "needs_you" && data.total > 0 && (
          <Button size="sm" variant="outline" className="mb-1 ml-auto" onClick={() => void previewBulk()}><CheckCheck /> Approve all low-risk matching</Button>
        )}
      </div>
      {filterable && <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
        <div className="flex items-center gap-1" role="group" aria-label="Risk">
          {["", ...RISKS].map((r) => (
            <button key={r} aria-pressed={(filters.risk ?? "") === r} onClick={() => setFilter("risk", r || undefined)} className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", (filters.risk ?? "") === r ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {r ? `${r} risk` : "Any risk"}{r && data.facets?.risk.find((f) => f.key === r) ? <span className="ml-1 tabular-nums opacity-70">{data.facets.risk.find((f) => f.key === r)!.n}</span> : null}
            </button>
          ))}
        </div>
        <FilterChip label="Agent" value={filters.agent} options={(data.facets?.agent ?? []).map((f) => ({ ...f, label: AGENT_LABEL[f.key] ?? f.label }))} onChange={(v) => setFilter("agent", v)} />
        <FilterChip label="Property" value={filters.property} options={data.facets?.property ?? []} onChange={(v) => setFilter("property", v)} />
        <FilterChip label="Record type" value={filters.entity} options={data.facets?.entity ?? []} onChange={(v) => setFilter("entity", v)} />
        {FILTER_KEYS.some((k) => filters[k]) && <button className="text-[12px] text-primary hover:underline" onClick={clearFilters}>Clear filters</button>}
      </div>}
      <p className="text-[12px] text-muted-foreground">{tab.hint}</p>
      {filterable && <ResultsSummary text={!loading && FILTER_KEYS.some((k) => filters[k]) ? resultsSummary(data.total, { one: "item", many: "items" }, `matching ${FILTER_KEYS.filter((k) => filters[k]).map(filterText).join(", ")}`) : undefined} clear={clearFilters} />}
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
                policy={p.decide_reason ?? p.approver ?? (p.assignee_role ? `Approver: ${p.assignee_role.replace(/_/g, " ")}` : undefined)}
                runHref={p.run_id ? `/app/ai/runs/${p.run_id}` : undefined}
                recordHref={p.href}
                createdAt={p.created_at}
                source={sourceOf(p)}
                model={p.model ?? undefined}
                canApprove={p.can_decide !== false}
                onNotify={!p.decision && p.can_decide === false && !notified[p.id] ? () => notify(p) : undefined}
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

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-surface="app">
          <DialogHeader>
            <DialogTitle>{confirm?.count ? `Approve ${confirm.count} low-risk item${confirm.count === 1 ? "" : "s"}?` : "Nothing to approve in bulk"}</DialogTitle>
            <DialogDescription>
              {confirm?.count
                ? <>Across every page that matches {FILTER_KEYS.some((k) => filters[k]) ? "your filters" : "this queue"}: only low-risk items with no amount that your role may decide. Each one runs as if you approved it, and is logged to the audit trail.{confirm.more ? ` At most ${confirm.cap} per click; more match, so run it again for the rest.` : ""}</>
                : "No matching item is low risk, free of money and yours to decide. Review the others one by one."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            {!!confirm?.count && <Button onClick={() => void bulk()}><CheckCheck /> Approve {confirm.count}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function FilterChip({ label, value, options, onChange }: { label: string; value?: string; options: Facet[]; onChange: (v: string | undefined) => void }) {
  const current = options.find((o) => o.key === value);
  return (
    <span className={cn("inline-flex items-center rounded-full border text-[12px]", value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1 py-0.5 pr-1.5 pl-2.5 hover:text-foreground">{label}{value ? `: ${current?.label ?? value}` : ""}<ChevronDown className="size-3 opacity-60" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
          <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v || undefined)}>
            <DropdownMenuRadioItem value="">All</DropdownMenuRadioItem>
            {options.map((o) => <DropdownMenuRadioItem key={o.key} value={o.key}><span className="min-w-0 flex-1 truncate">{o.label}</span><span className="ml-2 text-[11px] text-muted-foreground tabular-nums">{o.n}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {value && <button aria-label={`Clear ${label.toLowerCase()} filter`} onClick={() => onChange(undefined)} className="pr-2 hover:text-foreground"><X className="size-3" /></button>}
    </span>
  );
}
