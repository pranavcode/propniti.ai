"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, SubmitButton, field } from "@/components/marketing/AuthShell";

export default function ForgotPassword() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <AuthShell
      title={sentTo ? <>Check your <em className="text-[#8A6A45]">inbox.</em></> : <>Reset your <em className="text-[#8A6A45]">password.</em></>}
      subtitle={sentTo ? `If an account exists for ${sentTo}, a reset link is on its way.` : "Enter your work email and we'll send you a reset link."}
      footer={<Link href="/login" className="font-medium text-[#1C1917] underline underline-offset-4">Back to sign in</Link>}
    >
      {sentTo ? (
        <div className="space-y-4 text-sm text-[#57534E]">
          <p>The link expires in 30 minutes. Didn&apos;t get it? Check spam, or try again.</p>
          <button onClick={() => setSentTo(null)} className="font-medium text-[#1C1917] underline underline-offset-4">Use a different email</button>
        </div>
      ) : (
        <form
          method="post"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSentTo(String(new FormData(e.currentTarget).get("email")));
          }}
        >
          <label className="block text-sm">
            Work email
            <input type="email" name="email" required autoComplete="email" placeholder="you@company.com" className={field} />
          </label>
          <SubmitButton>Send reset link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
