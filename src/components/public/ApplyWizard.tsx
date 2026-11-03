"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Lock, Paperclip, X } from "lucide-react";
import type { z } from "zod";
import { cn } from "@/lib/utils";
import { ApplyRequest, Consent, CREDIT_BANDS, DOC_KINDS, Documents, EMPLOYMENT, Income, Personal, Residence } from "./schemas";

type Doc = z.infer<typeof Documents>["files"][number];
type Values = Record<string, string>;
type Errors = Record<string, string>;

const STEPS = [
  { key: "personal", title: "Your details", schema: Personal },
  { key: "residence", title: "Where you've lived", schema: Residence },
  { key: "income", title: "Income", schema: Income },
  { key: "documents", title: "Documents", schema: Documents },
  { key: "consent", title: "Review and sign", schema: Consent },
] as const;

const MAX_FILE = 10 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,image/webp";
const input = "h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive";

function issues(err: z.ZodError): Errors {
  const out: Errors = {};
  for (const i of err.issues) {
    const k = String(i.path[i.path.length - 1] ?? "form");
    out[k] ??= i.message;
  }
  return out;
}

// Module-level so inputs keep focus across re-renders.
function Field({ k, label, hint, error, children, className }: { k: string; label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={k} className="mb-1.5 block text-[13px] font-medium">{label}</label>
      {children}
      {error ? <p id={`${k}-err`} className="mt-1 text-[12.5px] text-destructive">{error}</p> : hint ? <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ApplyWizard({ listingId, leaseMonths, earliest, fee }: { listingId: string; leaseMonths: number[]; earliest: string; fee: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Values>({ lease_months: String(leaseMonths.includes(12) ? 12 : leaseMonths[0]), adults: "1", move_in: earliest, evicted: "", credit: "", employment: "" });
  const [docs, setDocs] = useState<Doc[]>([]);
  const [consent, setConsent] = useState({ screening: false, accurate: false });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const opt = (k: string) => (v[k]?.trim() ? v[k].trim() : undefined);

  function payload() {
    return {
      personal: { first_name: v.first_name ?? "", last_name: v.last_name ?? "", email: v.email ?? "", phone: v.phone ?? "", move_in: v.move_in ?? "", lease_months: v.lease_months, adults: v.adults },
      residence: { street: v.street ?? "", city: v.city ?? "", state: v.state ?? "", zip: v.zip ?? "", since: v.since ?? "", rent: v.rent ?? "", landlord: opt("landlord"), landlord_phone: opt("landlord_phone"), reason: opt("reason"), evicted: v.evicted || undefined },
      income: { employment: v.employment || undefined, employer: opt("employer"), title: opt("title"), monthly_income: v.monthly_income ?? "", other_income: opt("other_income"), other_source: opt("other_source"), credit: v.credit || undefined },
      documents: { files: docs },
      consent: { ...consent, signature: v.signature ?? "" },
    };
  }

  function go(to: number) {
    setStep(to);
    setErrors({});
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function next() {
    const s = STEPS[step];
    const r = s.schema.safeParse(payload()[s.key]);
    if (!r.success) return setErrors(issues(r.error));
    if (step < STEPS.length - 1) return go(step + 1);
    const all = ApplyRequest.safeParse(payload());
    if (!all.success) return setErrors(issues(all.error));
    setBusy(true);
    try {
      const res = await fetch(`/apply/${encodeURIComponent(listingId)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(all.data) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return router.push(`/apply/${encodeURIComponent(listingId)}/status?app=${encodeURIComponent(body.applicationId)}`);
      setErrors({ form: res.status === 429 ? "Too many requests. Try again in a minute." : (body.error ?? "Couldn't submit your application. Try again.") });
    } catch {
      setErrors({ form: "You seem to be offline. Your answers are still here; try again when you're connected." });
    }
    setBusy(false);
  }

  function addFiles(kind: Doc["kind"], list: FileList | null) {
    const added: Doc[] = [];
    const errs: string[] = [];
    for (const f of Array.from(list ?? [])) {
      if (f.size > MAX_FILE) errs.push(`${f.name} is over 10 MB`);
      else if (!ACCEPT.split(",").includes(f.type)) errs.push(`${f.name} isn't a PDF or image`);
      else added.push({ kind, name: f.name.slice(0, 160), size: f.size, type: f.type });
    }
    setDocs((d) => [...d, ...added].slice(0, 8));
    setErrors(errs.length ? { files: errs.join("; ") } : {});
  }

  const text = (k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={k} value={v[k] ?? ""} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${k}-err` : undefined} className={input} {...extra} />
  );

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-5 gap-1.5" aria-label="Application steps">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === step ? "step" : undefined}>
            <button type="button" disabled={i > step} onClick={() => go(i)} className="group w-full text-left disabled:cursor-default">
              <span className={cn("block h-1.5 rounded-full", i < step ? "bg-primary" : i === step ? "bg-primary/60" : "bg-muted")} />
              <span className={cn("mt-1.5 hidden text-[12px] sm:block", i === step ? "font-semibold text-foreground" : "text-muted-foreground", i < step && "group-hover:text-foreground")}>
                {i < step && <Check className="mr-0.5 inline size-3" aria-hidden />}{s.title}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => (e.preventDefault(), next())} noValidate className="space-y-5 rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <div>
          <p className="text-[12.5px] text-muted-foreground">Step {step + 1} of {STEPS.length}</p>
          <h2 ref={heading} tabIndex={-1} className="text-[20px] font-semibold outline-none">{STEPS[step].title}</h2>
        </div>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field k="first_name" error={errors.first_name} label="First name">{text("first_name", { autoComplete: "given-name" })}</Field>
            <Field k="last_name" error={errors.last_name} label="Last name">{text("last_name", { autoComplete: "family-name" })}</Field>
            <Field k="email" error={errors.email} label="Email" hint="We send your application status here.">{text("email", { type: "email", autoComplete: "email" })}</Field>
            <Field k="phone" error={errors.phone} label="Mobile phone">{text("phone", { type: "tel", autoComplete: "tel" })}</Field>
            <Field k="move_in" error={errors.move_in} label="Move-in date">{text("move_in", { type: "date", min: earliest })}</Field>
            <Field k="lease_months" error={errors.lease_months} label="Lease length">
              <select id="lease_months" value={v.lease_months} onChange={set("lease_months")} className={input}>{leaseMonths.map((m) => <option key={m} value={m}>{m} months</option>)}</select>
            </Field>
            <Field k="adults" error={errors.adults} label="Adults applying (18+)" hint="Each adult who will live in the home applies; we'll email the others a link.">
              <select id="adults" value={v.adults} onChange={set("adults")} className={input}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-6">
            <Field k="street" error={errors.street} label="Current street address" className="sm:col-span-6">{text("street", { autoComplete: "street-address" })}</Field>
            <Field k="city" error={errors.city} label="City" className="sm:col-span-3">{text("city", { autoComplete: "address-level2" })}</Field>
            <Field k="state" error={errors.state} label="State" className="sm:col-span-1">{text("state", { autoComplete: "address-level1", maxLength: 2, placeholder: "TX" })}</Field>
            <Field k="zip" error={errors.zip} label="ZIP" className="sm:col-span-2">{text("zip", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 5 })}</Field>
            <Field k="since" error={errors.since} label="Lived there since" className="sm:col-span-3">{text("since", { type: "month" })}</Field>
            <Field k="rent" error={errors.rent} label="Current monthly rent ($)" hint="0 if you own or live rent-free." className="sm:col-span-3">{text("rent", { inputMode: "numeric" })}</Field>
            <Field k="landlord" error={errors.landlord} label="Landlord or manager (optional)" className="sm:col-span-3">{text("landlord")}</Field>
            <Field k="landlord_phone" error={errors.landlord_phone} label="Their phone (optional)" className="sm:col-span-3">{text("landlord_phone", { type: "tel" })}</Field>
            <Field k="reason" error={errors.reason} label="Why are you moving? (optional)" className="sm:col-span-6">{text("reason", { maxLength: 300 })}</Field>
            <fieldset className="sm:col-span-6">
              <legend className="mb-1.5 text-[13px] font-medium">Have you been evicted in the last 7 years?</legend>
              <div className="flex gap-2">
                {["no", "yes"].map((o) => (
                  <label key={o} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-4 has-checked:border-primary has-checked:bg-primary/5">
                    <input type="radio" name="evicted" value={o} checked={v.evicted === o} onChange={set("evicted")} className="accent-[var(--primary)]" />{o === "no" ? "No" : "Yes"}
                  </label>
                ))}
              </div>
              {errors.evicted ? <p className="mt-1 text-[12.5px] text-destructive">{errors.evicted}</p> : <p className="mt-1 text-[12.5px] text-muted-foreground">A past eviction doesn&apos;t automatically mean a denial; a person reviews every application.</p>}
            </fieldset>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field k="employment" error={errors.employment} label="Employment">
              <select id="employment" value={v.employment} onChange={set("employment")} aria-invalid={!!errors.employment} className={input}>
                <option value="">Choose…</option>{EMPLOYMENT.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field k="employer" error={errors.employer} label="Employer or business">{text("employer", { autoComplete: "organization" })}</Field>
            <Field k="title" error={errors.title} label="Job title (optional)">{text("title", { autoComplete: "organization-title" })}</Field>
            <Field k="monthly_income" error={errors.monthly_income} label="Monthly income before tax ($)">{text("monthly_income", { inputMode: "numeric" })}</Field>
            <Field k="other_income" error={errors.other_income} label="Other monthly income ($, optional)" hint="Child support, benefits, vouchers or other lawful income all count.">{text("other_income", { inputMode: "numeric" })}</Field>
            <Field k="other_source" error={errors.other_source} label="Source of other income (optional)">{text("other_source")}</Field>
            <Field k="credit" error={errors.credit} label="Your estimated credit score" hint="Self-reported for now; the screening check confirms it." className="sm:col-span-2">
              <select id="credit" value={v.credit} onChange={set("credit")} aria-invalid={!!errors.credit} className={input}>
                <option value="">Choose a range…</option>{CREDIT_BANDS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-[14px] text-muted-foreground">Add a photo ID and at least one proof of income (recent pay stubs, an offer letter or bank statements). PDF or image, up to 10 MB each.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {DOC_KINDS.map((kind) => (
                <label key={kind} className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-5 text-center hover:border-primary hover:bg-primary/5 focus-within:border-primary">
                  <Paperclip className="size-5 text-muted-foreground" aria-hidden />
                  <span className="text-[14px] font-medium">{kind}{kind !== "Other" && <span className="text-destructive"> *</span>}</span>
                  <span className="text-[12px] text-muted-foreground">Choose files</span>
                  <input type="file" accept={ACCEPT} multiple onChange={(e) => (addFiles(kind, e.target.files), (e.target.value = ""))} className="sr-only" />
                </label>
              ))}
            </div>
            {docs.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {docs.map((d, i) => (
                  <li key={`${d.name}${i}`} className="flex items-center gap-3 px-3 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{d.name}</span>
                    <span className="text-[12px] text-muted-foreground">{d.kind} · {(d.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setDocs((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${d.name}`} className="grid size-8 place-items-center rounded-md hover:bg-muted"><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            {errors.files && <p role="alert" className="text-[13px] text-destructive">{errors.files}</p>}
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3.5" aria-hidden />Demo: we record each file&apos;s name, type and size; the file itself stays on your device.</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-muted/50 p-4 text-[14px] sm:grid-cols-2">
              <div><dt className="text-[12px] text-muted-foreground">Applicant</dt><dd>{v.first_name} {v.last_name} · {v.email}</dd></div>
              <div><dt className="text-[12px] text-muted-foreground">Move-in</dt><dd>{v.move_in} · {v.lease_months} months · {v.adults} adult{v.adults === "1" ? "" : "s"}</dd></div>
              <div><dt className="text-[12px] text-muted-foreground">Current address</dt><dd>{v.street}, {v.city}, {v.state?.toUpperCase()} {v.zip}</dd></div>
              <div><dt className="text-[12px] text-muted-foreground">Income</dt><dd>${Number(v.monthly_income || 0).toLocaleString("en-US")}/month{v.other_income ? ` + $${Number(v.other_income).toLocaleString("en-US")} other` : ""} · {v.employment}</dd></div>
              <div><dt className="text-[12px] text-muted-foreground">Documents</dt><dd>{docs.length} file{docs.length === 1 ? "" : "s"}</dd></div>
            </dl>
            {(["screening", "accurate"] as const).map((k) => (
              <label key={k} className="flex cursor-pointer gap-3 rounded-xl border p-3 has-checked:border-primary has-checked:bg-primary/5">
                <input type="checkbox" checked={consent[k]} onChange={(e) => setConsent((c) => ({ ...c, [k]: e.target.checked }))} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                <span className="text-[14px]">
                  {k === "screening" ? <>I authorize a credit check and a rental history check for this application. I understand the {fee} fee per adult covers the screening cost. <span className="text-muted-foreground">We don&apos;t ask about or use arrest records.</span></> : "The information I've given is true and complete."}
                  {errors[k] && <span className="mt-1 block text-[12.5px] text-destructive">{errors[k]}</span>}
                </span>
              </label>
            ))}
            <Field k="signature" error={errors.signature} label="Sign by typing your full name" hint={`Type it exactly as entered: ${v.first_name ?? ""} ${v.last_name ?? ""}`}>{text("signature", { autoComplete: "name", className: cn(input, "font-medium italic") })}</Field>
            <p className="text-[12.5px] text-muted-foreground">No payment is taken in this demo. A person reviews every application, and you can ask for the reasons for any decision in writing.</p>
          </div>
        )}

        {errors.form && <p role="alert" className="rounded-lg bg-tone-danger/10 px-3 py-2 text-[13.5px] text-tone-danger">{errors.form}</p>}

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          {step > 0 ? <button type="button" onClick={() => go(step - 1)} className="h-11 rounded-lg px-4 text-[15px] font-medium hover:bg-muted">Back</button> : <span />}
          <button type="submit" disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{step === STEPS.length - 1 ? "Submit application" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
