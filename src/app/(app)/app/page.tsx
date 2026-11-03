import { redirect } from "next/navigation";
import { currentSession } from "@/auth/session";
import { pageData } from "@/ai/ui/server";
import { Briefing } from "@/extensions/settings/briefing/Briefing";
import { PortfolioHome } from "@/extensions/portfolio/home/Home";

export const metadata = { title: "Home · Propniti" };

// /app sends each persona to their home. Module lanes build the homes; this routes to them:
// principal and regional manager get the portfolio homes, the accountant the finance home, and
// personas whose home is a module page go there. Everyone else (property manager until the
// residents lane's Today page lands, admin, platform admin) gets the AI briefing, with the
// widgets modules register for that role underneath.
export default async function Home() {
  const session = await currentSession();
  const { persona } = session;
  const role = persona.role;
  if (persona.portal) redirect(persona.home);
  if (role === "principal") return <PortfolioHome session={session} variant="principal" />;
  if (role === "regional_manager") return <PortfolioHome session={session} variant="regional" />;
  if (role === "accountant") redirect("/app/finance");
  // INTEGRATE: property_manager → the residents lane's Today page (/app/today) once it exists.
  if (persona.home !== "/app" && role !== "admin" && role !== "platform_admin") redirect(persona.home);
  const { data } = await pageData();
  return <Briefing session={session} data={data} />;
}
