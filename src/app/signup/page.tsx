"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, SubmitButton, field } from "@/components/marketing/AuthShell";

const roles = [
  ["pm", "Manager", "I run properties"],
  ["owner", "Owner", "I own buildings"],
  ["vendor", "Vendor", "I do the work"],
] as const;

export default function Signup() {
  const router = useRouter();
  const [role, setRole] = useState<(typeof roles)[number][0]>("pm");
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell
      title={<>Start running <em className="text-[#8A6A45]">on autopilot.</em></>}
      subtitle="Set up your workspace in a couple of minutes."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-[#1C1917] underline underline-offset-4">Sign in</Link></>}
    >
      <form
        method="post"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          router.push(`/${role}`);
        }}
      >
        <fieldset>
          <legend className="text-sm">You are</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-[1.25rem] bg-[#1C1917]/[0.04] p-1 ring-1 ring-[#1C1917]/[0.05]">
            {roles.map(([id, label, hint]) => (
              <button
                type="button"
                key={id}
                onClick={() => setRole(id)}
                aria-pressed={role === id}
                className={`rounded-[1rem] px-3 py-2.5 text-left transition-[background-color,box-shadow,color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  role === id ? "bg-[#FFFDF8] text-[#1C1917] shadow-[0_2px_12px_-4px_rgba(28,25,23,0.28)]" : "text-[#78716C] hover:text-[#1C1917]"
                }`}
              >
                <span className="block font-serif text-xl leading-none">{label}</span>
                <span className="mt-1 block text-[11px]">{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Full name
            <input name="name" required autoComplete="name" placeholder="Maya Patel" className={field} />
          </label>
          <label className="block text-sm">
            Company
            <input name="company" autoComplete="organization" placeholder="Summit Residential" className={field} />
          </label>
        </div>
        <label className="block text-sm">
          Work email
          <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" className={field} />
        </label>
        <label className="block text-sm">
          Password
          <input type="password" name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" className={field} />
        </label>
        <SubmitButton busy={busy}>{busy ? "Creating workspace…" : "Create account"}</SubmitButton>
        <p className="text-center text-xs text-[#78716C]">By continuing you agree to the Terms and Privacy Policy.</p>
      </form>
    </AuthShell>
  );
}
