import { currentSession } from "@/auth/session";
import { NotInScope } from "@/components/app/NotInScope";

// notFound() anywhere under /app renders here, inside the app shell: unknown ids and records
// outside the persona's scope look the same (scope checks never confirm a record exists).
export default async function AppNotFound() {
  const { persona } = await currentSession();
  return <NotInScope scope={persona.scope.label} name={persona.name} home={persona.home} />;
}
