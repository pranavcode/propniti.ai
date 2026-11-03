import { redirect } from "next/navigation";
import { currentSession } from "@/auth/session";
import { pageData } from "@/ai/ui/server";
import { Briefing } from "@/extensions/settings/briefing/Briefing";

export const metadata = { title: "Home · Propniti" };

// /app sends each persona to their home. Personas whose home is /app (principal, regional
// manager, property manager) and the admin roles, whose own pages are settings, get the AI
// briefing here; module widgets registered for the role render under it.
export default async function Home() {
  const session = await currentSession();
  const { persona } = session;
  if (persona.portal) redirect(persona.home);
  if (persona.home !== "/app" && persona.role !== "admin" && persona.role !== "platform_admin") redirect(persona.home);
  const { data } = await pageData();
  return <Briefing session={session} data={data} />;
}
