import "server-only";
import { redirect } from "next/navigation";
import { currentSession, type Session } from "@/auth/session";

// Receivables pages are staff tools: portal personas (resident, owner, vendor, applicant) go to
// their own portal, which shows only their own records.
export async function staffSession(): Promise<Session> {
  const session = await currentSession();
  if (session.persona.portal || session.actor.scope.kind === "self") redirect(session.persona.home);
  return session;
}
