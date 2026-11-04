import { currentSession } from "@/auth/session";
import { allEntities, can } from "@/entities";
import { NotInScope } from "@/components/app/NotInScope";

// notFound() anywhere under /app renders here, inside the app shell: unknown ids and records
// outside the persona's scope look the same (scope checks never confirm a record exists).
export default async function AppNotFound() {
  const { persona, actor } = await currentSession();
  const lists = allEntities().filter((d) => can(actor.role, "read", d.key)).map((d) => d.route);
  return <NotInScope scope={persona.scope.label} name={persona.name} home={persona.home} lists={lists} />;
}
