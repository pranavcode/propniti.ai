"use client";

import { useState } from "react";

// INTEGRATE: no demo-request API yet (requested in research/lane-requests.md). Until then the
// form opens the visitor's email app with the details filled in, and says so on the button.
const TO = "demo@propniti.ai";

const input = "h-11 w-full rounded-lg bg-white px-3.5 text-[15px] ring-1 ring-(--mk-line) placeholder:text-(--mk-muted) focus-visible:outline-2 focus-visible:outline-(--mk-teal)";

export function DemoRequest() {
  const [sent, setSent] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    const body = [`Name: ${v("name")}`, `Company: ${v("company")}`, `Role: ${v("role")}`, `Units managed: ${v("units")}`, "", v("notes")].join("\n");
    window.location.href = `mailto:${TO}?subject=${encodeURIComponent(`Propniti demo for ${v("company")}`)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-5 rounded-2xl bg-white p-6 ring-1 ring-(--mk-line) sm:grid-cols-2 sm:p-8">
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Your name<input name="name" required autoComplete="name" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Company<input name="company" required autoComplete="organization" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Your role
        <select name="role" className={input} defaultValue="Operator">
          <option>Operator</option><option>Owner or investor</option><option>Asset manager</option><option>Accounting</option><option>Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Units managed<input name="units" inputMode="numeric" pattern="[0-9,]*" placeholder="e.g. 1,200" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium sm:col-span-2">What would you like to see? <span className="font-normal text-(--mk-muted)">Optional</span>
        <textarea name="notes" rows={4} maxLength={1000} className={`${input} h-auto py-2.5`} />
      </label>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="submit" className="inline-flex h-11 items-center rounded-full bg-(--mk-teal) px-6 text-[15px] font-medium text-white transition-colors duration-200 hover:bg-(--mk-teal-deep) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal)">
          Write the email
        </button>
        <p className="text-[14px] text-(--mk-muted)" aria-live="polite">
          {sent ? `If your email app didn't open, write to ${TO}.` : "Opens your email app with these details filled in."}
        </p>
      </div>
    </form>
  );
}
