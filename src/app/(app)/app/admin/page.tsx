import { currentSession } from "@/auth/session";
import { pageData } from "@/ai/ui/server";
import { Briefing } from "@/extensions/settings/briefing/Briefing";

export const metadata = { title: "Briefing · Propniti" };

// The AI briefing home for the admin and platform-admin personas (and anyone who opens it):
// overnight agent work, what needs you, risks, the ask box and recent records.
export default async function BriefingPage() {
  const session = await currentSession();
  const { data } = await pageData();
  return <Briefing session={session} data={data} />;
}
