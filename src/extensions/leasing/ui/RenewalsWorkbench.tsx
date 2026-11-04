"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CornerDownRight, Loader2, Minus, Pencil, Plus, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { AIBadge, Confidence, type AISource } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkFairHousing } from "../fairHousing";
import { callAction, callAi, createRecord, patchRecord, runHref } from "./client";

export type Suggestion = { rent: number; reasons: { direction: "+" | "-" | "="; text: string }[]; confidence: number; runId: string | null; source: AISource; model?: string; title?: string };
export type Selected = {
  leaseId: string; resident: string; property: string; propertyId: string; unit: string; unitType: string; endOn: string; daysLeft: number; rent: number; market: number | null;
  offer: { id: string; status: string; rent: number; term: number; version: number; sentAt: string | null } | null;
  history: { id: string; version: number; status: string; rent: number; sentAt: string | null; respondedAt: string | null }[];
  suggestion: Suggestion | null;
  canEdit: boolean;
};

const ICON = { "+": Plus, "-": Minus, "=": CornerDownRight };

// One lease's renewal: the Renewals agent proposes a rent with its reasons, a person accepts or
// edits it, the AI drafts the message, the person edits and sends. Each AI step links to its run.
export function RenewalPanel({ s }: { s: Selected }) {
  const router = useRouter();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(s.suggestion);
  const [offerId, setOfferId] = useState<string | null>(s.offer?.status === "Draft" ? s.offer.id : null);
  const [rent, setRent] = useState<string>(String(s.offer?.status === "Draft" ? s.offer.rent : s.suggestion?.rent ?? s.rent));
  const [term, setTerm] = useState(String(s.offer?.term ?? 12));
  const [accepted, setAccepted] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string; runId: string; source: AISource; model: string } | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"propose" | "save" | "draft" | "send" | null>(null);
  const [rentError, setRentError] = useState(false);
  const open = !s.offer || s.offer.status === "Draft";
  const flags = checkFairHousing(body);
  const rentNum = Number(rent);
  const change = s.rent ? ((rentNum - s.rent) / s.rent) * 100 : 0;

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const ensureOffer = async () => {
    if (offerId) return offerId;
    const row = await createRecord("renewal_offers", { lease_id: s.leaseId, property_id: s.propertyId, term_months: Number(term) || 12, rent: s.rent, current_rent: s.rent, market_rent: s.market });
    setOfferId(row.id);
    return row.id;
  };

  const propose = async () => {
    setBusy("propose");
    try {
      const id = await ensureOffer();
      const r = await callAi<{ rentCents: number; reasons: Suggestion["reasons"]; confidence: number }>("renewal_offers", id, "propose");
      setSuggestion({ rent: r.rentCents / 100, reasons: r.reasons, confidence: r.confidence, runId: r.runId, source: r.source === "rules" ? "rules" : "live", model: r.model });
      setRent(String(r.rentCents / 100));
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!(rentNum > 0)) return setRentError(true);
    setBusy("save");
    try {
      const id = await ensureOffer();
      await patchRecord("renewal_offers", id, { rent: rentNum, term_months: Number(term) });
      setAccepted(true);
      toast.success(suggestion && rentNum === suggestion.rent ? "Accepted the agent's rent" : "Offer rent saved");
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const draftMessage = async () => {
    setBusy("draft");
    try {
      const id = await ensureOffer();
      const r = await callAi<{ subject: string; body: string }>("renewal_offers", id, "draft_message");
      setDraft({ subject: r.subject, body: r.body, runId: r.runId, source: r.source === "rules" ? "rules" : "live", model: r.model });
      setSubject(r.subject);
      setBody(r.body);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const send = async () => {
    setBusy("send");
    try {
      const id = await ensureOffer();
      const r = await callAction("renewal_offers", id, "send", { subject, body, channel: "Email", ai_drafted: !!draft });
      toast.success(r.message, { action: r.href ? { label: "View offer", onClick: () => router.push(r.href!) } : undefined });
      router.refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[12px] text-muted-foreground">{s.property} · #{s.unit}{s.unitType ? ` · ${s.unitType}` : ""}</p>
        <h2 className="text-[16px] font-semibold">{s.resident}</h2>
        <dl className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-[12px]">
          <div className="bg-card px-2.5 py-1.5"><dt className="text-muted-foreground">Lease ends</dt><dd className="font-medium">{formatDate(s.endOn, "always")} <span className="font-normal text-muted-foreground">({s.daysLeft}d)</span></dd></div>
          <div className="bg-card px-2.5 py-1.5"><dt className="text-muted-foreground">Current rent</dt><dd className="font-medium"><Money value={s.rent} style="whole" /></dd></div>
          <div className="bg-card px-2.5 py-1.5"><dt className="text-muted-foreground">Market (unit type)</dt><dd className="font-medium">{s.market != null ? <Money value={s.market} style="whole" /> : "—"}</dd></div>
        </dl>
        <Link href={`/app/leases/${s.leaseId}`} className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">Open lease and ledger<ArrowUpRight className="size-3" /></Link>
      </div>

      {!open ? (
        <section className="rounded-md border p-3 text-[13px]">
          <p className="flex items-center gap-2">Latest offer <StatusBadge value={s.offer!.status} /> <Money value={s.offer!.rent} style="whole" /> for {s.offer!.term} months</p>
          {s.offer!.sentAt && <p className="mt-1 text-[12px] text-muted-foreground">Sent {formatDate(s.offer!.sentAt.slice(0, 10), "always")}</p>}
        </section>
      ) : (
        <>
          <section className="relative overflow-hidden rounded-lg border border-tone-ai/25 bg-tone-ai/[0.03]" aria-labelledby="ren-ai">
            <div className="flex flex-col gap-2.5 p-3 pl-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 text-tone-ai" />
                <h3 id="ren-ai" className="text-[13px] font-semibold">Renewals agent</h3>
                {suggestion && <AIBadge source={suggestion.source} model={suggestion.source === "live" ? suggestion.model : undefined} size="xs" />}
                {suggestion?.runId && <Link href={runHref(suggestion.runId)!} className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>}
              </div>
              {suggestion ? (
                <>
                  <p className="text-[14px]">Offer <span className="font-semibold"><Money value={suggestion.rent} style="whole" /></span> a month <span className="text-muted-foreground">({s.rent ? `${suggestion.rent >= s.rent ? "+" : ""}${(((suggestion.rent - s.rent) / s.rent) * 100).toFixed(1)}%` : ""} vs today)</span></p>
                  <ul className="flex flex-col gap-1 text-[12.5px]">
                    {suggestion.reasons.map((r) => {
                      const I = ICON[r.direction];
                      return <li key={r.text} className="flex gap-1.5"><I className={cn("mt-0.5 size-3 shrink-0", r.direction === "+" ? "text-tone-success" : r.direction === "-" ? "text-tone-warning" : "text-muted-foreground")} /><span>{r.text}</span></li>;
                    })}
                  </ul>
                  <Confidence value={suggestion.confidence} />
                </>
              ) : (
                <p role="status" className="text-[12.5px] text-muted-foreground">{busy === "propose" ? "Reading the unit type's market rent, tenure and 12 months of payments…" : "No proposal yet. The agent prices from the unit type's market rent, how long they've lived here and their payment history."}</p>
              )}
              {s.canEdit && (
                <div className="flex gap-2">
                  <Button size="sm" variant={suggestion ? "outline" : "default"} disabled={!!busy} onClick={() => void propose()}>{busy === "propose" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}{suggestion ? "Price again" : "Ask the Renewals agent"}</Button>
                </div>
              )}
            </div>
          </section>

          {s.canEdit && (
            <section className="rounded-lg border p-3" aria-labelledby="ren-offer">
              <h3 id="ren-offer" className="mb-2 text-[13px] font-semibold">1 · Accept or edit the offer</h3>
              <FieldGroup className="flex-row flex-wrap items-end gap-2">
                <Field data-invalid={rentError || undefined} className="w-32">
                  <FieldLabel htmlFor="offer-rent" className="text-[12px]">Monthly rent</FieldLabel>
                  <Input id="offer-rent" name="offer-rent" autoComplete="off" type="number" inputMode="decimal" min={0} step={5} value={rent} onChange={(e) => { setRent(e.target.value); setAccepted(false); setRentError(false); }} aria-invalid={rentError || undefined} className="h-8 tabular-nums" />
                </Field>
                <Field className="w-auto">
                  <FieldLabel id="offer-term-label" className="text-[12px]">Term (months)</FieldLabel>
                  <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={term} onValueChange={(v) => { if (v) { setTerm(v); setAccepted(false); } }} aria-labelledby="offer-term-label">
                    {[6, 12, 13, 15, 18].map((m) => <ToggleGroupItem key={m} value={String(m)} aria-label={`${m} months`} className="tabular-nums">{m}</ToggleGroupItem>)}
                  </ToggleGroup>
                </Field>
                <Button size="sm" disabled={!!busy || accepted} onClick={() => void save()}>{busy === "save" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : accepted ? <Check data-icon="inline-start" /> : suggestion && rentNum === suggestion.rent ? <Check data-icon="inline-start" /> : <Pencil data-icon="inline-start" />}{accepted ? "Saved" : suggestion && rentNum === suggestion.rent ? "Accept" : "Save edit"}</Button>
                {rentError && <FieldError className="w-full">Enter the monthly rent to offer.</FieldError>}
                <span className={cn("pb-1.5 text-[12px] tabular-nums", change > 5 ? "text-tone-warning" : "text-muted-foreground")}>{rentNum > 0 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs today` : ""}</span>
              </FieldGroup>
            </section>
          )}

          {s.canEdit && (
            <section className={cn("rounded-lg border p-3", !accepted && "opacity-60")} aria-labelledby="ren-msg">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 id="ren-msg" className="text-[13px] font-semibold">2 · Message the resident</h3>
                {draft && <AIBadge source={draft.source} model={draft.source === "live" ? draft.model : undefined} size="xs" />}
                {draft && <Link href={runHref(draft.runId)!} className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>}
                <Button size="sm" variant="outline" className="ml-auto" disabled={!accepted || !!busy} onClick={() => void draftMessage()}>{busy === "draft" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles className="text-tone-ai" data-icon="inline-start" />}{draft ? "Draft again" : "Draft with AI"}</Button>
              </div>
              {!accepted && <p className="text-[12px] text-muted-foreground">Accept or save the rent first; the draft uses it.</p>}
              {accepted && (
                <div className="flex flex-col gap-2">
                  <Input name="subject" autoComplete="off" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`e.g. Your renewal offer at ${s.property}…`} aria-label="Subject" maxLength={200} className="h-8 text-[13px]" />
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} name="message" placeholder="Write the offer, or let the AI draft it from the lease and the rent you accepted…" aria-describedby="send-help" aria-label="Message" maxLength={4000} className="min-h-40 text-[13px] leading-relaxed" />
                  {flags.length > 0 && <p role="status" className="text-[12px] text-tone-danger">Fair-housing: “{flags[0].phrase}” ({flags[0].category}). {flags[0].suggestion}.</p>}
                  <p id="send-help" className="text-[11.5px] text-muted-foreground">Subject of 3+ characters and a message of 20+. Sending is checked: amounts must match the offer and no waivers can be promised.</p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!!busy || subject.trim().length < 3 || body.trim().length < 20 || flags.length > 0} onClick={() => void send()}>{busy === "send" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}Send offer</Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {s.history.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12.5px] font-semibold">Offer history</h3>
          <ol className="divide-y rounded-md border text-[12.5px]">
            {s.history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-muted-foreground">v{h.version}</span>
                <Link href={`/app/leasing/renewal-offers/${h.id}`} className="font-medium tabular-nums hover:underline"><Money value={h.rent} style="whole" /></Link>
                <StatusBadge value={h.status} />
                <span className="ml-auto text-muted-foreground">{h.sentAt ? formatDate(h.sentAt.slice(0, 10), "always") : "Not sent"}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
