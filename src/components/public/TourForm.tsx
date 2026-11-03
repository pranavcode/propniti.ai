"use client";

import { useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOUR_KINDS, TourRequest } from "./schemas";

type Slot = { date: string; times: string[] };
type Errors = Partial<Record<keyof TourRequest | "form", string>>;

const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const input = "h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive";

export function TourForm({ listingId, slots }: { listingId: string; slots: Slot[] }) {
  const [kind, setKind] = useState<(typeof TOUR_KINDS)[number]>("In person");
  const [date, setDate] = useState(slots[0]?.date ?? "");
  const [time, setTime] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ when: string; kind: string; agent: string | null } | null>(null);
  const times = slots.find((s) => s.date === date)?.times ?? [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = TourRequest.safeParse({ name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"), note: String(fd.get("note") ?? "") || undefined, kind, date, time });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch(`/listings/${encodeURIComponent(listingId)}/tour`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setDone(body);
      else setErrors({ form: res.status === 429 ? "Too many requests. Try again in a minute." : (body.error ?? "Couldn't book the tour. Try again.") });
    } catch {
      setErrors({ form: "You seem to be offline. Check your connection and try again." });
    }
    setBusy(false);
  }

  if (done) {
    const [d, t] = done.when.split("T");
    return (
      <div role="status" className="flex gap-3 rounded-xl bg-tone-success/10 p-4">
        <CalendarCheck className="size-5 shrink-0 text-tone-success" aria-hidden />
        <div className="space-y-1 text-[14px]">
          <p className="font-semibold">Tour booked: {day(d, { weekday: "long", month: "long", day: "numeric" })} at {clock(t.slice(0, 5))}</p>
          <p className="text-muted-foreground">{done.kind} tour{done.agent ? ` with ${done.agent}` : ""}. It&apos;s on the leasing team&apos;s calendar now, and they&apos;ll reach out to confirm.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">Tour type</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {TOUR_KINDS.map((k) => (
            <label key={k} className="cursor-pointer">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" />
              <span className="block rounded-md py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{k === "Virtual" ? "Video" : k}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">Day</legend>
        <div className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1">
          {slots.map((s) => (
            <label key={s.date} className="shrink-0 snap-start cursor-pointer">
              <input type="radio" name="date" value={s.date} checked={date === s.date} onChange={() => (setDate(s.date), setTime(""))} className="peer sr-only" />
              <span className="flex w-14 flex-col items-center rounded-lg border py-1.5 text-[11.5px] text-muted-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:[&>b]:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                {day(s.date, { weekday: "short" })}<b className="text-[16px] font-semibold text-foreground">{day(s.date, { day: "numeric" })}</b>{day(s.date, { month: "short" })}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-muted-foreground">Time</span>
        <select value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={!!errors.time} className={input}>
          <option value="">Choose a time…</option>
          {times.map((t) => <option key={t} value={t}>{clock(t)}</option>)}
        </select>
        {errors.time && <span className="mt-1 block text-[12px] text-destructive">{errors.time}</span>}
      </label>
      {(["name", "email", "phone"] as const).map((f) => (
        <label key={f} className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-muted-foreground">{f === "name" ? "Full name" : f === "email" ? "Email" : "Phone"}</span>
          <input name={f} type={f === "email" ? "email" : f === "phone" ? "tel" : "text"} autoComplete={f === "name" ? "name" : f === "email" ? "email" : "tel"} aria-invalid={!!errors[f]} spellCheck={f === "email" ? false : undefined} className={input} />
          {errors[f] && <span className="mt-1 block text-[12px] text-destructive">{errors[f]}</span>}
        </label>
      ))}
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-muted-foreground">Anything we should know? (optional)</span>
        <textarea name="note" rows={2} maxLength={500} className={cn(input, "h-auto py-2")} />
      </label>
      {errors.form && <p role="alert" className="rounded-lg bg-tone-danger/10 px-3 py-2 text-[13px] text-tone-danger">{errors.form}</p>}
      <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-primary bg-background text-[15px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Book tour
      </button>
    </form>
  );
}
