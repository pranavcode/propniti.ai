import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentSession, type Session } from "@/auth/session";
import { DashboardSkeleton } from "@/components/app/dashboard/DashboardSkeleton";
import { pageData } from "@/ai/ui/server";
import { Briefing } from "@/extensions/settings/briefing/Briefing";
import { PortfolioHome } from "@/extensions/portfolio/home/Home";
import { getPlatform } from "@/lib/platform";
import { personaGreeting } from "@/lib/format";
import { companyState, setupFinished } from "@/extensions/onboarding/empty";
import { canOnboard } from "@/extensions/onboarding/state";
import { EmptyPage } from "@/extensions/onboarding/ui/NothingYet";

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
  if (role === "accountant") redirect("/app/finance");
  // INTEGRATE: property_manager → the residents lane's Today page (/app/today) once it exists.
  if (role !== "principal" && role !== "regional_manager" && persona.home !== "/app" && role !== "admin" && role !== "platform_admin") redirect(persona.home);
  // A company with no properties yet (Lakeside) lands in Guided setup until setup is finished;
  // after that, home says what to do instead of showing empty charts.
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const empty = await companyState(ctx);
  if (empty === "empty" && canOnboard(role) && !(await setupFinished(ctx))) redirect("/app/onboarding");
  if (empty) return <EmptyPage title={personaGreeting(persona)} meta={`${persona.title} · ${persona.scope.label}`} state={empty} role={role} />;
  // Redirects above run before the stream starts; the home's queries load behind the skeleton.
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      {role === "principal" || role === "regional_manager"
        ? <PortfolioHome session={session} variant={role === "principal" ? "principal" : "regional"} />
        : <BriefingHome session={session} />}
    </Suspense>
  );
}

async function BriefingHome({ session }: { session: Session }) {
  const { data } = await pageData();
  return <Briefing session={session} data={data} />;
}
