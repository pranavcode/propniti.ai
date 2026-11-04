"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AIBadge } from "@/components/app/ai";
import { fillTemplate } from "../lib";
import { runAction } from "../ui/client";

type Prop = { id: string; name: string; recipients: number };
type Draft = { id: string; title: string; body: string; channels: string[]; propertyId: string; status: string; sendAt: string | null };
const CHANNELS = ["Email", "SMS", "Portal"] as const;

export function ComposerForm({ properties, templates, draft, provenance, initialProperty }: {
  properties: Prop[]; templates: { id: string; name: string; subject: string; body: string }[]; draft: Draft | null;
  provenance: { runId: string; source: "live" | "rules" } | null; initialProperty: string;
}) {
  const router = useRouter();
  const [property, setProperty] = useState(initialProperty);
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [channels, setChannels] = useState<string[]>(draft?.channels.length ? draft.channels : ["Email", "SMS"]);
  const [when, setWhen] = useState<"now" | "later">(draft?.status === "Scheduled" ? "later" : "now");
  const [sendAt, setSendAt] = useState(draft?.sendAt?.slice(0, 16) ?? "");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  // Sending reaches every resident at the property, so it takes a second click to confirm.
  const [armed, setArmed] = useState(false);
  const prop = properties.find((p) => p.id === property);
  const locked = !!draft;

  const aiDraft = async () => {
    setBusy("draft");
    try {
      let id = draft?.id;
      if (!id) {
        const r = await runAction("properties", property, "properties.new_announcement", { title: topic.slice(0, 160), body: topic, channels });
        id = new URLSearchParams(r.href?.split("?")[1] ?? "").get("id") ?? undefined;
        if (!id) throw new Error("The draft wasn't created");
      }
      const r = await runAction("announcements", id, "announcements.ai_draft", { topic: topic || `${title}. ${body}` });
      toast.success(r.message ?? "Draft written");
      router.replace(r.href ?? `/app/communications/announcements/new?id=${id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft it");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      let id = draft?.id;
      if (!id) {
        const r = await runAction("properties", property, "properties.new_announcement", { title, body, channels });
        id = new URLSearchParams(r.href?.split("?")[1] ?? "").get("id") ?? undefined;
        if (!id) throw new Error("The draft wasn't created");
      }
      const r = await runAction("announcements", id, "announcements.send", { title, body, channels, send_at: when === "later" && sendAt ? new Date(sendAt).toISOString() : undefined });
      toast.success(r.message ?? "Sent");
      router.push(`/app/communications/announcements/${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not sent");
    } finally {
      setBusy(null);
    }
  };

  const ready = title.trim().length >= 3 && body.trim().length >= 10 && channels.length > 0 && (when === "now" || !!sendAt);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">Property</span>
              <Select value={property} disabled={locked} onValueChange={setProperty}>
                <SelectTrigger className="w-full" aria-label="Property"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">Recipients</span>
              <p className="h-8 text-[13px] leading-8 tabular-nums"><b>{prop?.recipients ?? 0}</b> current and notice residents</p>
            </div>
          </div>
          {!draft && (
            <div className="flex flex-col gap-2 rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] p-3">
              <label htmlFor="topic" className="flex items-center gap-1.5 text-[12.5px] font-medium"><Sparkles className="size-3.5 text-tone-ai" />What is it about?</label>
              <Textarea id="topic" rows={2} maxLength={500} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Water shutoff Thursday Nov 12, 9 am to 1 pm, building B, for a valve replacement…" />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy !== null || topic.trim().length < 3 || !property} onClick={aiDraft}>{busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />}Draft with AI</Button>
                <span className="text-[11.5px] text-muted-foreground">Keeps your dates and times exactly; marks anything missing as [date] for you to fill in.</span>
              </div>
            </div>
          )}
          {!draft && templates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-muted-foreground">Or start from a template:</span>
              {templates.map((t) => (
                <button key={t.id} type="button" className="rounded-full border px-2 py-0.5 hover:border-primary/40 hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50" onClick={() => { const v = { property: prop?.name ?? "", due_date: "[date]" }; setTitle(fillTemplate(t.subject || t.name, v)); setBody(fillTemplate(t.body, v)); }}>{t.name}</button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          {provenance && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <AIBadge source={provenance.source} />
              <span>{provenance.source === "live" ? "Drafted by the model from your request. Read it before sending." : "Drafted by rules from your description or a notice template; no model was used."}</span>
              <Link href={`/app/ai/runs/${encodeURIComponent(provenance.runId)}`} className="text-primary hover:underline">View run</Link>
              {provenance && <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => { setTopic(`${title}. ${body}`); void aiDraft(); }}>{busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />}Redraft</Button>}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Title</span>
            <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Water shutoff on Thursday…" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Message</span>
            <Textarea value={body} rows={9} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Residents of …" />
          </label>
          {/\[(date|time)\]/i.test(`${title} ${body}`) && <p className="text-[12px] text-tone-warning">Fill in the [date] or [time] placeholders before sending.</p>}
        </section>
      </div>

      <aside className="flex flex-col gap-3">
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[12px] font-medium">Channels</legend>
            <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} aria-label="Channels" value={channels} onValueChange={(v) => v.length && setChannels(v)}>
              {CHANNELS.map((c) => <ToggleGroupItem key={c} value={c}>{c}</ToggleGroupItem>)}
            </ToggleGroup>
            {channels.includes("SMS") && body.length > 320 && <p className="text-[11.5px] text-tone-warning">SMS sends the first 320 characters with a link to the full notice.</p>}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[12px] font-medium">When</legend>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="When" value={when} onValueChange={(v) => v && setWhen(v as "now" | "later")}>
              <ToggleGroupItem value="now">Send now</ToggleGroupItem>
              <ToggleGroupItem value="later"><CalendarClock data-icon="inline-start" />Schedule</ToggleGroupItem>
            </ToggleGroup>
            {when === "later" && <Input type="datetime-local" aria-label="Send at" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
          </fieldset>
          <Button className="w-full" variant={armed ? "destructive" : "default"} disabled={!ready || busy !== null || /\[(date|time)\]/i.test(`${title} ${body}`)}
            onClick={() => (armed ? void send() : (setArmed(true), setTimeout(() => setArmed(false), 5000)))}>
            {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}{armed ? `Confirm: ${when === "later" ? "schedule" : "send"} to ${prop?.recipients ?? 0} residents` : `${when === "later" ? "Schedule" : "Send"} to ${prop?.recipients ?? 0} residents`}
          </Button>
          <p className="text-[11.5px] text-muted-foreground">Logged to the audit trail with who sent it. Nothing leaves the system in this demo.</p>
        </section>
        <section className="rounded-lg border bg-muted/30 p-4">
          <div className="text-[11px] font-medium text-muted-foreground">Preview · {channels[0] ?? "Email"}</div>
          <div className="mt-2 rounded-md border bg-card p-3 text-[13px]">
            <div className="font-semibold">{title || "Title"}</div>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body || "Your message appears here."}</p>
          </div>
        </section>
      </aside>
    </div>
  );
}
