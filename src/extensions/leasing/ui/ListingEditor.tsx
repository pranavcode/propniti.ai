"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Check, ImagePlus, Loader2, Save, ShieldCheck, Sparkles, Star, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AIBadge } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { cn } from "@/lib/utils";
import { checkFairHousing, type FairHousingFlag } from "../fairHousing";
import { callAction, callAi, patchRecord, runHref } from "./client";

export type EditorData = {
  id: string; status: string; headline: string; description: string; photos: string[]; library: string[];
  syndication: Record<string, string>; rent: number; property: string; unit: string; typeName: string; canEdit: boolean; flags: FairHousingFlag[];
};

type Draft = { headline: string; description: string; runId: string; source: "live" | "rules"; model: string };
const thumb = (p: string) => p.replace(/(-400)?\.webp$/, "-400.webp");
const SYN_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { Live: "success", Pending: "warning", Error: "danger", Paused: "warning", Off: "neutral", Removed: "neutral" };

export function ListingEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  const [headline, setHeadline] = useState(data.headline);
  const [description, setDescription] = useState(data.description);
  const [photos, setPhotos] = useState(data.photos);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fromAi, setFromAi] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"draft" | "save" | "publish" | null>(null);
  const [headlineError, setHeadlineError] = useState(false);
  const flags = useMemo(() => checkFairHousing(`${headline} ${description}`), [headline, description]);
  const dirty = headline !== data.headline || description !== data.description || photos.join("|") !== data.photos.join("|");
  const unused = data.library.filter((p) => !photos.includes(p));

  const move = (i: number, by: number) => setPhotos((ps) => {
    const next = [...ps];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, x);
    return next;
  });

  const runDraft = async () => {
    setBusy("draft");
    try {
      const r = await callAi<{ headline: string; description: string }>("listings", data.id, "draft_description");
      setDraft({ headline: r.headline, description: r.description, runId: r.runId, source: r.source, model: r.model });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!headline.trim()) return setHeadlineError(true);
    setBusy("save");
    try {
      await patchRecord("listings", data.id, { headline: headline.trim(), description: description.trim(), photos });
      toast.success(fromAi ? "Saved. The AI draft run and your edit are both in the audit log." : "Listing saved");
      setFromAi(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    try {
      if (dirty) await patchRecord("listings", data.id, { headline: headline.trim(), description: description.trim(), photos });
      const r = await callAction("listings", data.id, "publish");
      toast.success(r.message);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-lg border bg-card" aria-labelledby="photos-h">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <h3 id="photos-h" className="text-[13px] font-semibold">Photos</h3>
            <span className="text-[12px] text-muted-foreground">{photos.length} selected · the first is the cover</span>
          </header>
          <div className="p-4">
            {photos.length ? (
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((p, i) => (
                  <li key={p} className={cn("group relative overflow-hidden rounded-md border bg-muted", i === 0 && "ring-2 ring-primary ring-offset-1 ring-offset-background")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- static webp thumbs */}
                    <img src={thumb(p)} alt={`Listing photo ${i + 1}`} width={400} height={300} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                    {i === 0 && <span className="absolute top-1.5 left-1.5 rounded bg-primary px-1.5 py-px text-[10.5px] font-medium text-primary-foreground">Cover</span>}
                    {data.canEdit && (
                      <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <span className="flex gap-1">
                          <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)} className="rounded bg-white/90 p-1 text-black disabled:opacity-40"><ArrowLeft className="size-3" /></button>
                          <button type="button" aria-label="Move later" disabled={i === photos.length - 1} onClick={() => move(i, 1)} className="rounded bg-white/90 p-1 text-black disabled:opacity-40"><ArrowRight className="size-3" /></button>
                        </span>
                        <span className="flex gap-1">
                          {i > 0 && <button type="button" aria-label="Make cover" onClick={() => move(i, -i)} className="rounded bg-white/90 p-1 text-black"><Star className="size-3" /></button>}
                          <button type="button" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))} className="rounded bg-white/90 p-1 text-black"><X className="size-3" /></button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-md border border-dashed px-3 py-6 text-center text-[12.5px] text-muted-foreground">No photos yet. Add some from the library below; the first one becomes the cover.</p>}
            {data.canEdit && unused.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground"><ImagePlus className="size-3.5" />Library: {data.typeName || "unit type"} and {data.property} photos</p>
                <ul className="flex flex-wrap gap-2">
                  {unused.map((p) => (
                    <li key={p}>
                      <button type="button" onClick={() => setPhotos((ps) => [...ps, p])} className="group relative block overflow-hidden rounded border hover:ring-2 hover:ring-primary/50" aria-label="Add photo">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static webp thumbs */}
                        <img src={thumb(p)} alt="" width={80} height={56} className="h-14 w-20 object-cover" loading="lazy" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100">Add</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card" aria-labelledby="copy-h">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <h3 id="copy-h" className="text-[13px] font-semibold">Headline and description</h3>
            {fromAi && <AIBadge source={fromAi.source} model={fromAi.source === "live" ? fromAi.model : undefined} size="xs" />}
            {fromAi && <Link href={runHref(fromAi.runId)!} className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>}
            {data.canEdit && (
              <Button size="sm" variant="outline" className="ml-auto" disabled={!!busy} onClick={() => void runDraft()}>
                {busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-tone-ai" />}Draft with AI
              </Button>
            )}
          </header>
          <div className="flex flex-col gap-3 p-4">
            {busy === "draft" && <p role="status" className="flex items-center gap-2 rounded-md border border-tone-ai/25 bg-tone-ai/[0.04] px-3 py-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin text-tone-ai" />Leasing agent is reading the unit, building and amenities…</p>}
            {draft && (
              <div role="status" className="relative overflow-hidden rounded-md border border-tone-ai/30 bg-tone-ai/[0.04] p-3">
                <span className="absolute inset-y-0 left-0 w-0.5 bg-tone-ai/70" aria-hidden />
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Sparkles className="size-3.5 text-tone-ai" /><span className="text-[12.5px] font-semibold">AI draft</span>
                  <AIBadge source={draft.source} model={draft.source === "live" ? draft.model : undefined} size="xs" />
                  <Link href={runHref(draft.runId)!} className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>
                </div>
                <p className="text-[13px] font-medium">{draft.headline}</p>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{draft.description}</p>
                <p className="mt-2 text-[11.5px] text-muted-foreground">Written from the unit, building and amenity facts only. Review it before saving.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => { setHeadline(draft.headline); setDescription(draft.description); setFromAi(draft); setDraft(null); }}><Check />Use draft, then edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}><X />Discard</Button>
                </div>
              </div>
            )}
            <label className="flex flex-col gap-1 text-[12px] font-medium">Headline
              <Input name="headline" autoComplete="off" value={headline} onChange={(e) => { setHeadline(e.target.value); setHeadlineError(false); }} maxLength={120} disabled={!data.canEdit} aria-invalid={headlineError || undefined} className="text-[13px] font-normal" />
            </label>
            {headlineError && <p className="-mt-2 text-[12px] text-tone-danger">Add a headline before saving.</p>}
            <label className="flex flex-col gap-1 text-[12px] font-medium">Description
              <Textarea name="description" autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} disabled={!data.canEdit} aria-describedby="desc-count" className="min-h-36 text-[13px] leading-relaxed font-normal" placeholder="Describe the home, the building and what’s nearby, or let the AI draft it…" />
            </label>
            <span id="desc-count" className="-mt-2 self-end text-[11px] text-muted-foreground tabular-nums">{description.length} / 2,000 characters</span>
            {data.canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}Save</Button>
                {(data.status === "Draft" || data.status === "Paused") && <Button size="sm" variant="outline" aria-describedby="publish-help" disabled={!!busy || flags.length > 0 || !description.trim()} onClick={() => void publish()}>{busy === "publish" ? <Loader2 className="animate-spin" /> : <Upload />}Save and publish</Button>}
                {dirty && <span className="text-[12px] text-muted-foreground">Unsaved changes</span>}
                {(data.status === "Draft" || data.status === "Paused") && (flags.length > 0 || !description.trim()) && <span id="publish-help" className="w-full text-[12px] text-muted-foreground">{flags.length ? "Fix the fair-housing wording to publish." : "Add a description to publish."}</span>}
              </div>
            )}
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className={cn("rounded-lg border p-4 text-[12.5px]", flags.length ? "border-tone-danger/30 bg-tone-danger/[0.04]" : "border-tone-success/25 bg-tone-success/[0.04]")} aria-labelledby="fh-h">
          <h3 id="fh-h" aria-live="polite" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
            {flags.length ? <AlertTriangle className="size-4 text-tone-danger" /> : <ShieldCheck className="size-4 text-tone-success" />}
            {flags.length ? `${flags.length} fair-housing ${flags.length === 1 ? "issue" : "issues"}` : "Fair-housing language check"}
          </h3>
          {flags.length ? (
            <ul className="flex flex-col gap-2.5">
              {flags.map((f) => (
                <li key={f.phrase + f.index}>
                  <p><span className="rounded bg-tone-danger/10 px-1 font-medium text-tone-danger">“{f.phrase}”</span> <span className="text-muted-foreground">· {f.category}</span></p>
                  <p className="mt-0.5 text-muted-foreground">{f.suggestion}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground">No phrases that state a preference about who may live here. Checked as you type; publishing is blocked while an issue is open.</p>}
        </section>

        <section className="rounded-lg border bg-card p-4 text-[12.5px]">
          <h3 className="mb-2 text-[13px] font-semibold">Syndication</h3>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(data.syndication).map(([site, st]) => (
              <li key={site} className="flex items-center justify-between gap-2"><span className="capitalize">{site}</span><StatusBadge value={st} tone={SYN_TONE[st] ?? "neutral"} /></li>
            ))}
          </ul>
          {Object.values(data.syndication).includes("Error") && <p className="mt-2 text-tone-danger">A site rejected this listing. Re-publishing sends it again.</p>}
        </section>

        <section className="overflow-hidden rounded-lg border bg-card text-[12.5px]">
          <h3 className="px-4 pt-3 text-[13px] font-semibold">Preview</h3>
          <div className="m-3 overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element -- static webp */}
            {photos[0] ? <img src={thumb(photos[0])} alt="" className="aspect-[16/9] w-full object-cover" /> : <div className="flex aspect-[16/9] items-center justify-center bg-muted text-muted-foreground">No cover photo</div>}
            <div className="p-3">
              <p className="font-semibold"><Money value={data.rent} style="whole" /> <span className="font-normal text-muted-foreground">/ month</span></p>
              <p className="mt-0.5 line-clamp-2 font-medium">{headline || "Headline"}</p>
              <p className="mt-1 line-clamp-3 text-muted-foreground">{description || "Description"}</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">{data.property} · #{data.unit}</p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
