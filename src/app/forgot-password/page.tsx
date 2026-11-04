import type { Metadata } from "next";
import { AuthShell } from "@/components/marketing/AuthShell";
import { ButtonLink } from "@/components/marketing/ui";
import { DEMO_PASSWORD } from "@/auth/personas";

export const metadata: Metadata = { title: "Reset password · Propniti demo" };

export default function ForgotPassword() {
  return (
    <AuthShell
      title="Demo accounts share one password."
      subtitle={<>Every demo person signs in with password <code className="rounded bg-(--mk-teal-tint) px-1.5 py-0.5 font-mono text-[14px] text-(--mk-teal-deep)">{DEMO_PASSWORD}</code>, so there&apos;s nothing to reset. To come back as someone else, pick another person on the sign-in page or switch role from your avatar menu in the app&apos;s top bar.</>}
    >
      <ButtonLink href="/login" arrow>Sign in to the demo</ButtonLink>
    </AuthShell>
  );
}
