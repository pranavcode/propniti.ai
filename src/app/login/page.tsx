"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, SubmitButton, field } from "@/components/marketing/AuthShell";

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell
      title={<>Welcome <em className="text-[#8A6A45]">back.</em></>}
      subtitle="Sign in to see what your agents did while you were away."
      footer={<>New to Propniti? <Link href="/signup" className="font-medium text-[#1C1917] underline underline-offset-4">Create an account</Link></>}
    >
      <form
        method="post"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          router.push("/pm");
        }}
      >
        <label className="block text-sm">
          Work email
          <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" className={field} />
        </label>
        <label className="block text-sm">
          <span className="flex justify-between">
            Password
            <Link href="/forgot-password" className="text-[#57534E] underline underline-offset-4">Forgot password?</Link>
          </span>
          <input type="password" name="password" required minLength={8} autoComplete="current-password" placeholder="At least 8 characters" className={field} />
        </label>
        <SubmitButton busy={busy}>{busy ? "Signing in…" : "Sign in"}</SubmitButton>
      </form>
      <div className="mt-6 border-t border-[#1C1917]/10 pt-5 text-center text-sm text-[#57534E]">
        Just looking? <Link href="/demo" className="font-medium text-[#1C1917] underline underline-offset-4">Pick a demo persona</Link>
      </div>
    </AuthShell>
  );
}
