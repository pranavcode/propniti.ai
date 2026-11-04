import type { Metadata } from "next";
import { Check } from "lucide-react";
import { AuthShell } from "@/components/marketing/AuthShell";
import { ButtonLink } from "@/components/marketing/ui";
import { DEMO_PASSWORD, demoEmail, PERSONAS } from "@/auth/personas";

export const metadata: Metadata = { title: "Get started · Propniti demo" };

export default function Signup() {
  return (
    <AuthShell
      title="This is a demo, so there's no account to create."
      subtitle={<>Use a demo account instead: every demo person signs in with password <code className="rounded bg-(--mk-teal-tint) px-1.5 py-0.5 font-mono text-[14px] text-(--mk-teal-deep)">{DEMO_PASSWORD}</code>, for example as {demoEmail("marcus")}. You&apos;re in the product straight away, on a sample portfolio of 30 properties.</>}
    >
      <ul className="flex flex-col gap-3 text-[15px]">
        {[`${PERSONAS.length} people to choose from: staff roles plus owner, resident, vendor and applicant portals`, "Your changes stay in a private copy of the data", "That copy resets at midnight Pacific"].map((t) => (
          <li key={t} className="flex gap-3"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--mk-teal)" />{t}</li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/login" arrow>Sign in to the demo</ButtonLink>
        <ButtonLink href="/book-demo" tone="secondary">Book a walkthrough</ButtonLink>
      </div>
    </AuthShell>
  );
}
