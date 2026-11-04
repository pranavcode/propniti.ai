import type { Metadata } from "next";
import { AuthShell } from "@/components/marketing/AuthShell";
import { ButtonLink } from "@/components/marketing/ui";

export const metadata: Metadata = { title: "Reset password · Propniti demo" };

export default function ForgotPassword() {
  return (
    <AuthShell
      title="The demo doesn't use passwords."
      subtitle="Every demo user signs in with one click from the demo picker, so there's nothing to reset. To come back as someone else, open the picker again or use Switch in the app's top bar."
    >
      <ButtonLink href="/login" arrow>Open the demo picker</ButtonLink>
    </AuthShell>
  );
}
