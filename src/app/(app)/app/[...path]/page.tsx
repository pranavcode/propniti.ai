import { notFound } from "next/navigation";
import { getEntityByRoute } from "@/entities";

// Generic entity list/detail page (lane C). Any /app path without a static route lands here and
// resolves through the registry: EntityDef.route → list, route/<id> → detail. Static routes win.
export default async function EntityPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hit = getEntityByRoute("/app/" + path.join("/"));
  if (!hit) notFound();
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{hit.id ? `${hit.def.label.one} ${hit.id}` : hit.def.label.many}</h1>
    </main>
  );
}
